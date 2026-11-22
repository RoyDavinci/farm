import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { Query } from '../database/client.js';
import { ensure } from '../lib/errors.js';
import type { RequestInput } from '../lib/http.js';
import type { AppDeps } from '../types/deps.js';
import { allergenNames } from '../config/recipes.js';
import {
  ingredientSchema,
  invalidatePlannerContent,
  plannerContent,
  recipeSchema,
  templateSchema,
} from './planner-content.service.js';
import { audit } from './audit.service.js';
import { notify } from './communications.service.js';

export const allergenReportInput = z
  .object({
    listing_id: z.uuid().optional(),
    recipe: z.string().max(60).optional(),
    issue: z.enum(['MISSING', 'INCORRECT', 'REACTION', 'OTHER']),
    allergens: z.array(z.string().max(40)).max(10).default([]),
    details: z.string().trim().min(10).max(2000),
  })
  .refine((d) => d.listing_id || d.recipe, { message: 'Choose the product or recipe.' });
export const allergenReviewInput = z.object({
  status: z.enum(['REVIEWING', 'RESOLVED', 'DISMISSED']),
  resolution: z.string().trim().min(10).max(2000),
});

const n = (v: unknown) => Number(v ?? 0);
/** Small counts about health data are shown as "<5" so nobody can be singled out. */
const suppress = (count: number) => (count > 0 && count < 5 ? '<5' : String(count));

/** Allergen reports (buyers and staff) and aggregate Smart Planner usage for the admin console. */
export function createPlannerAdminService(deps: AppDeps) {
  const { db } = deps;

  async function reportAllergen(q: Query, user: any, input: RequestInput) {
    const d = allergenReportInput.parse(input.body);
    if (d.listing_id) {
      const [l] = await q.query('SELECT id FROM listings WHERE id=$1', [d.listing_id]);
      ensure(l, 404, 'NOT_FOUND', 'That product was not found.');
    }
    if (d.recipe)
      ensure(
        (await plannerContent(q)).recipes.some((r) => r.key === d.recipe),
        400,
        'UNKNOWN_RECIPE',
        'That recipe was not found.',
      );
    const [open] = await q.query(
      "SELECT COUNT(*)::int AS n FROM allergen_reports WHERE reporter_id=$1 AND created_at>now()-interval '1 day'",
      [user.id],
    );
    ensure(
      open.n < 20,
      429,
      'TOO_MANY_REPORTS',
      'You have sent many reports today. Please try again tomorrow.',
    );
    const id = randomUUID();
    await q.query(
      'INSERT INTO allergen_reports(id,reporter_id,listing_id,recipe,issue,allergens,details) VALUES($1,$2,$3,$4,$5,$6,$7)',
      [id, user.id, d.listing_id ?? null, d.recipe ?? null, d.issue, d.allergens, d.details],
    );
    return {
      id,
      message:
        d.issue === 'REACTION'
          ? 'Thank you. Our team will review this urgently. If you or someone else is unwell, get medical help now.'
          : 'Thank you. Our team will check this information with the seller.',
    };
  }

  async function myAllergenReports(user: any, _input?: RequestInput) {
    return db.query(
      `SELECT r.id,r.listing_id,l.title AS listing_title,r.recipe,r.issue,r.allergens,r.details,r.status,r.resolution,r.created_at,r.reviewed_at
       FROM allergen_reports r LEFT JOIN listings l ON l.id=r.listing_id WHERE r.reporter_id=$1 ORDER BY r.created_at DESC LIMIT 50`,
      [user.id],
    );
  }

  async function listAllergenReports(_user: any, input: RequestInput) {
    const { status } = z
      .object({
        status: z.enum(['OPEN', 'REVIEWING', 'RESOLVED', 'DISMISSED', 'ALL']).default('ALL'),
      })
      .parse(input.query);
    const rows = await db.query(
      `SELECT r.id,r.listing_id,l.title AS listing_title,l.category,s.business_name,s.user_id AS seller_id,r.recipe,r.issue,r.allergens,r.details,
         r.status,r.resolution,r.created_at,r.reviewed_at,u.name AS reporter_name,rv.name AS reviewer_name
       FROM allergen_reports r JOIN users u ON u.id=r.reporter_id LEFT JOIN users rv ON rv.id=r.reviewed_by
       LEFT JOIN listings l ON l.id=r.listing_id LEFT JOIN sellers s ON s.user_id=l.seller_id
       WHERE ($1='ALL' OR r.status=$1)
       ORDER BY (r.status IN ('OPEN','REVIEWING')) DESC,(r.issue='REACTION') DESC,r.created_at DESC LIMIT 200`,
      [status],
    );
    const contentRecipes = (await plannerContent(db)).recipes;
    return rows.map((r: any) => ({
      ...r,
      recipe_name: r.recipe
        ? (contentRecipes.find((x) => x.key === r.recipe)?.name ?? r.recipe)
        : null,
      allergen_labels: (r.allergens || []).map(
        (a: string) => allergenNames[a as keyof typeof allergenNames] || a,
      ),
      urgent: r.issue === 'REACTION' && ['OPEN', 'REVIEWING'].includes(r.status),
    }));
  }

  async function reviewAllergenReport(q: Query, user: any, input: RequestInput) {
    const d = allergenReviewInput.parse(input.body);
    const [r] = await q.query('SELECT * FROM allergen_reports WHERE id=$1 FOR UPDATE', [
      input.params.id,
    ]);
    ensure(r, 404, 'NOT_FOUND', 'Report not found.');
    ensure(
      !['RESOLVED', 'DISMISSED'].includes(r.status),
      409,
      'ALREADY_CLOSED',
      'This report is already closed.',
    );
    await q.query(
      'UPDATE allergen_reports SET status=$1,resolution=$2,reviewed_by=$3,reviewed_at=now() WHERE id=$4',
      [d.status, d.resolution, user.id, r.id],
    );
    await audit(q, user.id, `allergen_report.${d.status.toLowerCase()}`, r.id, {
      resolution: d.resolution,
      listing_id: r.listing_id,
      recipe: r.recipe,
    });
    if (d.status !== 'REVIEWING')
      await notify(
        q,
        r.reporter_id,
        'report',
        'Allergen report reviewed',
        `We ${d.status === 'RESOLVED' ? 'have acted on' : 'have reviewed'} your allergen report: ${d.resolution}`,
      );
    return { ok: true };
  }

  /** Aggregate planner usage. No individual plans, profiles or names are returned. */
  async function plannerUsage(_user: any, _input?: RequestInput) {
    const [plans] = await db.query(
      `SELECT COUNT(*)::int AS total,COUNT(*) FILTER (WHERE created_at>now()-interval '30 days')::int AS last30,
         COUNT(*) FILTER (WHERE status='ACTIVE')::int AS active,COUNT(*) FILTER (WHERE status='COMPLETED')::int AS completed,
         COUNT(DISTINCT user_id)::int AS planners,
         COUNT(DISTINCT user_id) FILTER (WHERE user_id IN (SELECT user_id FROM plans GROUP BY user_id HAVING COUNT(*)>1))::int AS repeat_planners
       FROM plans`,
    );
    const byTemplate = await db.query(
      "SELECT template,kind,COUNT(*)::int AS plans,COUNT(*) FILTER (WHERE status='COMPLETED')::int AS completed FROM plans GROUP BY template,kind ORDER BY plans DESC",
    );
    const [items] = await db.query(
      `SELECT COUNT(*)::int AS total,COUNT(*) FILTER (WHERE listing_id IS NOT NULL)::int AS linked,
         COUNT(*) FILTER (WHERE status='PURCHASED')::int AS purchased,COUNT(*) FILTER (WHERE status='OWNED')::int AS owned,
         COUNT(*) FILTER (WHERE status='NOT_NEEDED')::int AS not_needed,COUNT(*) FILTER (WHERE source='RECIPE')::int AS from_recipes
       FROM plan_items`,
    );
    const [conversion] = await db.query(
      `SELECT COUNT(DISTINCT i.plan_id) FILTER (WHERE c.id IS NOT NULL)::int AS plans_with_cart,
         (SELECT COUNT(DISTINCT pi.plan_id)::int FROM bookings b JOIN plan_items pi ON pi.id=b.plan_item_id) AS plans_with_orders,
         (SELECT COUNT(*)::int FROM bookings WHERE plan_item_id IS NOT NULL) AS orders,
         (SELECT COALESCE(SUM(total_kobo),0)::bigint FROM bookings WHERE plan_item_id IS NOT NULL AND status IN ('ACCEPTED','READY_FOR_PICKUP','COMPLETED')) AS confirmed_kobo,
         (SELECT COUNT(*)::int FROM bookings WHERE plan_item_id IS NOT NULL AND status='COMPLETED') AS completed_orders
       FROM plan_items i LEFT JOIN cart_items c ON c.plan_item_id=i.id`,
    );
    const [budget] = await db.query(
      `SELECT COUNT(*)::int AS with_budget,
         COUNT(*) FILTER (WHERE spent<=budget_kobo)::int AS within_budget
       FROM (SELECT p.budget_kobo,COALESCE((SELECT SUM(b.total_kobo) FROM bookings b JOIN plan_items i ON i.id=b.plan_item_id
               WHERE i.plan_id=p.id AND b.status IN ('ACCEPTED','READY_FOR_PICKUP','COMPLETED')),0) AS spent
             FROM plans p WHERE p.budget_kobo IS NOT NULL) x`,
    );
    const recipes = await db.query(
      'SELECT recipe,COUNT(*)::int AS meals,SUM(servings)::int AS servings FROM plan_meals GROUP BY recipe ORDER BY meals DESC LIMIT 10',
    );
    const [diet] = await db.query(
      `SELECT COUNT(*)::int AS profiles,COUNT(*) FILTER (WHERE cardinality(allergies)>0)::int AS with_allergies,
         COUNT(*) FILTER (WHERE cardinality(patterns)>0)::int AS with_diet FROM diet_profiles`,
    );
    const allergenCounts = await db.query(
      'SELECT a AS allergen,COUNT(*)::int AS n FROM diet_profiles,unnest(allergies) a GROUP BY a ORDER BY n DESC',
    );
    const [reports] = await db.query(
      `SELECT COUNT(*) FILTER (WHERE status IN ('OPEN','REVIEWING'))::int AS open,
         COUNT(*) FILTER (WHERE status IN ('OPEN','REVIEWING') AND issue='REACTION')::int AS urgent,
         COUNT(*)::int AS total,
         COALESCE(ROUND(AVG(EXTRACT(EPOCH FROM reviewed_at-created_at)/3600) FILTER (WHERE status IN ('RESOLVED','DISMISSED'))),0)::int AS hours_to_close
       FROM allergen_reports`,
    );
    const daily = await db.query(
      `SELECT to_char(d,'YYYY-MM-DD') AS day,(SELECT COUNT(*)::int FROM plans p WHERE p.created_at::date=d::date) AS plans
       FROM generate_series(current_date-13,current_date,interval '1 day') d ORDER BY d`,
    );
    const content = await plannerContent(db);
    const pct = (a: number, b: number) => (b ? Math.round((a / b) * 1000) / 10 : 0);
    return {
      plans: { ...plans, completion_rate: pct(plans.completed, plans.total) },
      by_template: byTemplate.map((t: any) => ({
        ...t,
        title: t.template
          ? (content.templates.find((x) => x.key === t.template)?.title ?? t.template)
          : 'Other',
      })),
      items: { ...items, linked_rate: pct(items.linked, items.total) },
      conversion: {
        plans_with_cart: conversion.plans_with_cart,
        plans_with_orders: conversion.plans_with_orders,
        plan_to_order_rate: pct(conversion.plans_with_orders, plans.total),
        orders: conversion.orders,
        completed_orders: conversion.completed_orders,
        confirmed_kobo: n(conversion.confirmed_kobo),
        average_order_kobo: conversion.orders
          ? Math.round(n(conversion.confirmed_kobo) / Math.max(1, conversion.orders))
          : 0,
      },
      budgets: { ...budget, adherence_rate: pct(budget.within_budget, budget.with_budget) },
      top_recipes: recipes.map((r: any) => ({
        ...r,
        name: content.recipes.find((x) => x.key === r.recipe)?.name ?? r.recipe,
      })),
      diet: {
        profiles: suppress(diet.profiles),
        with_allergies: suppress(diet.with_allergies),
        with_diet: suppress(diet.with_diet),
        allergens: allergenCounts.map((a: any) => ({
          allergen: allergenNames[a.allergen as keyof typeof allergenNames] || a.allergen,
          profiles: suppress(a.n),
        })),
      },
      allergen_reports: reports,
      daily,
      privacy:
        'Aggregate figures only. Counts under 5 about health information are shown as “<5” so nobody can be identified.',
    };
  }

  // ---------- editable planner content ----------
  const contentType = z.enum(['TEMPLATE', 'RECIPE', 'INGREDIENT']);
  async function getContent(_user: any, _input?: RequestInput) {
    const c = await plannerContent(db);
    const disabled = await db.query('SELECT type,key FROM planner_content WHERE NOT active');
    return {
      templates: c.templates.map((t) => ({
        key: t.key,
        title: t.title,
        custom: c.custom.TEMPLATE.has(t.key),
        data: t,
      })),
      recipes: c.recipes.map((r) => ({
        key: r.key,
        title: r.name,
        custom: c.custom.RECIPE.has(r.key),
        data: r,
      })),
      ingredients: Object.entries(c.ingredients).map(([key, x]) => ({
        key,
        title: x.name,
        custom: c.custom.INGREDIENT.has(key),
        data: x,
      })),
      hidden: disabled,
      help: 'Edit the JSON and save. Saving changes a default or adds a new item; Hide removes it from the app; Reset returns a default to the built-in version.',
    };
  }
  async function saveContent(q: Query, user: any, input: RequestInput) {
    const type = contentType.parse(input.params.type);
    const key = z
      .string()
      .regex(/^[a-z0-9_-]{2,60}$/)
      .parse(input.params.key);
    const body = z
      .object({ data: z.unknown().optional(), active: z.boolean().default(true) })
      .parse(input.body);
    let data: unknown = {};
    if (body.active) {
      const schema = {
        TEMPLATE: templateSchema,
        RECIPE: recipeSchema,
        INGREDIENT: ingredientSchema,
      }[type];
      const parsed = (schema as z.ZodType).safeParse(body.data);
      ensure(
        parsed.success,
        400,
        'INVALID_CONTENT',
        `Check the ${type.toLowerCase()}: ${parsed.error?.issues
          .map((i) => `${i.path.join('.')} ${i.message}`)
          .slice(0, 3)
          .join('; ')}`,
      );
      data = parsed.data;
      ensure(
        type === 'INGREDIENT' || (data as any).key === key,
        400,
        'KEY_MISMATCH',
        'The key in the JSON must match.',
      );
      if (type === 'RECIPE') {
        const { ingredients } = await plannerContent(q);
        const unknown = Object.keys((data as any).per_serving).filter((k) => !ingredients[k]);
        ensure(
          !unknown.length,
          400,
          'UNKNOWN_INGREDIENT',
          `Add these ingredients first: ${unknown.join(', ')}.`,
        );
      }
    }
    await q.query(
      `INSERT INTO planner_content(type,key,data,active,updated_by) VALUES($1,$2,$3,$4,$5)
       ON CONFLICT(type,key) DO UPDATE SET data=EXCLUDED.data,active=EXCLUDED.active,updated_by=EXCLUDED.updated_by,updated_at=now()`,
      [type, key, JSON.stringify(data), body.active, user.id],
    );
    await audit(
      q,
      user.id,
      body.active ? 'planner_content.save' : 'planner_content.hide',
      `${type}:${key}`,
    );
    invalidatePlannerContent();
    return { ok: true };
  }
  async function resetContent(q: Query, user: any, input: RequestInput) {
    const type = contentType.parse(input.params.type);
    await q.query('DELETE FROM planner_content WHERE type=$1 AND key=$2', [type, input.params.key]);
    await audit(q, user.id, 'planner_content.reset', `${type}:${input.params.key}`);
    invalidatePlannerContent();
    return { ok: true };
  }

  return {
    getContent,
    saveContent,
    resetContent,
    reportAllergen,
    myAllergenReports,
    listAllergenReports,
    reviewAllergenReport,
    plannerUsage,
  };
}
