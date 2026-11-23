import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { Query } from '../database/client.js';
import { ensure } from '../lib/errors.js';
import type { RequestInput } from '../lib/http.js';
import type { AppDeps } from '../types/deps.js';
import {
  readRequest,
  templateByKey,
  templateItems,
  type Tier,
} from '../config/planner-templates.js';
import {
  allergenNames,
  checkRecipe,
  dietPatterns,
  shoppingQuantity,
  type DietProfile,
} from '../config/recipes.js';
import { unitPrice } from './catalog.service.js';
import { plannerContent, type PlannerContent } from './planner-content.service.js';
import {
  createPlannerWizardService,
  scheduleItems,
  wizardAnswers,
} from './planner-wizard.service.js';
import { answersFromRequest, wizardFor } from '../config/planner-wizards.js';
import { activePromotion } from './promotions.service.js';
import { notify } from './communications.service.js';
import { verifiedSql } from './business-verification.service.js';

const tiers = ['BASIC', 'STANDARD', 'PREMIUM'] as const;
const priorities = ['ESSENTIAL', 'IMPORTANT', 'OPTIONAL'] as const;
const itemStatuses = [
  'PLANNED',
  'SAVED',
  'PURCHASED',
  'UNAVAILABLE',
  'NOT_NEEDED',
  'OWNED',
] as const;
const meals = ['BREAKFAST', 'LUNCH', 'DINNER'] as const;
const kobo = z.number().int().min(0).max(100_000_000_000);
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD.');
const FOOD_CATEGORIES = [
  'Vegetables',
  'Fruit',
  'Grains',
  'Tubers',
  'Livestock',
  'Food & groceries',
];
export const ALLERGEN_UNKNOWN =
  'Allergen information unavailable – check with the seller or manufacturer before buying.';

export const planCreateInput = z.object({
  template: z.string().max(40).default('custom'),
  title: z.string().trim().min(1).max(120).optional(),
  budget_kobo: kobo.nullable().optional(),
  people: z.number().int().min(1).max(2000).nullable().optional(),
  rooms: z.number().int().min(1).max(20).nullable().optional(),
  tier: z.enum(tiers).default('STANDARD'),
  target_date: date.nullable().optional(),
  /** Answers from the step-by-step planner; when given, the plan is built from them. */
  answers: wizardAnswers.optional(),
});
export const planUpdateInput = z.object({
  title: z.string().trim().min(1).max(120).optional(),
  budget_kobo: kobo.nullable().optional(),
  target_date: date.nullable().optional(),
  status: z.enum(['ACTIVE', 'PAUSED', 'COMPLETED']).optional(),
});
export const planItemInput = z.object({
  name: z.string().trim().min(1).max(120),
  section: z.string().trim().min(1).max(60).default('Items'),
  category: z.string().max(80).nullable().optional(),
  keywords: z.string().max(200).default(''),
  quantity: z.number().positive().max(100000).default(1),
  unit: z.string().trim().min(1).max(30).default('piece'),
  budget_kobo: kobo.default(0),
  priority: z.enum(priorities).default('IMPORTANT'),
});
export const planItemUpdateInput = planItemInput.partial().extend({
  status: z.enum(itemStatuses).optional(),
  /** Who is buying this: the plan owner or a member it is shared with; null to clear. */
  assignee_id: z.string().max(60).nullable().optional(),
  listing_id: z.uuid().nullable().optional(),
  variant_id: z.uuid().nullable().optional(),
});
export const planMealInput = z.object({
  recipe: z.string().max(60),
  day: z.number().int().min(1).max(31).default(1),
  meal: z.enum(meals).default('DINNER'),
  servings: z.number().int().min(1).max(500),
});
export const dietProfileInput = z.object({
  allergies: z.array(z.string().trim().min(1).max(40)).max(20).default([]),
  intolerances: z.array(z.string().trim().min(1).max(40)).max(20).default([]),
  avoid: z.array(z.string().trim().min(1).max(40)).max(30).default([]),
  patterns: z
    .array(z.enum(Object.keys(dietPatterns) as [string, ...string[]]))
    .max(10)
    .default([]),
  /** Required to store allergies or intolerances: they are sensitive health information. */
  consent: z.boolean().default(false),
});
export const planReadInput = z.object({ text: z.string().trim().min(1).max(300) });
export const planShareInput = z.object({
  /** Email or phone number of an existing Ahia account. */
  contact: z.string().trim().min(5).max(160),
  role: z.enum(['VIEWER', 'EDITOR']).default('EDITOR'),
});

/**
 * Turns a plan's meals into one grocery list: ingredient quantities scaled to servings and added
 * up. Items already marked owned, bought or linked to a product keep that state.
 */
export async function rebuildGroceryList(q: Query, plan: { id?: any }, content: PlannerContent) {
  const planMeals = await q.query('SELECT recipe,servings FROM plan_meals WHERE plan_id=$1', [
    plan.id,
  ]);
  const totals = new Map<string, number>();
  for (const m of planMeals) {
    const recipe = content.recipes.find((r) => r.key === m.recipe);
    if (!recipe) continue;
    for (const [key, qty] of Object.entries(recipe.per_serving))
      totals.set(key, (totals.get(key) || 0) + qty * m.servings);
  }
  const existing = await q.query("SELECT * FROM plan_items WHERE plan_id=$1 AND source='RECIPE'", [
    plan.id,
  ]);
  const byKey = new Map(existing.map((i: any) => [i.ingredient_key, i]));
  const [last] = await q.query(
    'SELECT COALESCE(MAX(position),0) AS p FROM plan_items WHERE plan_id=$1',
    [plan.id],
  );
  let position = n(last.p);
  let added = 0,
    updated = 0,
    removed = 0;
  for (const [key, amount] of totals) {
    const x = content.ingredients[key];
    if (!x) continue;
    const quantity = shoppingQuantity(key, amount, content.ingredients);
    const budget = Math.round(quantity * x.price * 100);
    const allergens = [...new Set([...(x.allergens || []), ...(x.may || [])])];
    const found: any = byKey.get(key);
    if (found) {
      await q.query(
        'UPDATE plan_items SET quantity=$1,budget_kobo=$2,allergens=$3,updated_at=now() WHERE id=$4',
        [quantity, budget, allergens, found.id],
      );
      updated++;
    } else {
      await q.query(
        "INSERT INTO plan_items(id,plan_id,section,name,category,keywords,quantity,unit,budget_kobo,priority,source,ingredient_key,allergens,position) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'ESSENTIAL','RECIPE',$10,$11,$12)",
        [
          randomUUID(),
          plan.id,
          x.category,
          x.name,
          x.category,
          x.keywords,
          quantity,
          x.unit,
          budget,
          key,
          allergens,
          ++position,
        ],
      );
      added++;
    }
  }
  for (const i of existing as any[])
    if (
      !totals.has(i.ingredient_key) &&
      ['PLANNED', 'SAVED', 'UNAVAILABLE'].includes(i.status) &&
      !i.listing_id
    ) {
      await q.query('DELETE FROM plan_items WHERE id=$1', [i.id]);
      removed++;
    }
  return { added, updated, removed };
}

const CONFIRMED = "('ACCEPTED','READY_FOR_PICKUP','COMPLETED')";
const n = (v: unknown) => Number(v ?? 0);

/**
 * Smart Planner without AI: guided templates, a recipe library and rules. Plans are suggestions the
 * customer edits; products always come from live listings and estimates are labelled as estimates.
 */
export function createPlannerService(deps: AppDeps) {
  const { db, config: c } = deps;
  const wizard = createPlannerWizardService(deps);

  async function profileOf(userId: string): Promise<DietProfile | null> {
    const [p] = await db.query(
      'SELECT allergies,intolerances,avoid,patterns FROM diet_profiles WHERE user_id=$1',
      [userId],
    );
    return (p as DietProfile) ?? null;
  }
  /**
   * A plan the user may use: the owner can do anything; shared members can view, and editors can
   * also change items, meals and the budget. Others get "not found".
   */
  async function ownPlan(
    q: Query,
    userId: string,
    planId: string,
    lock = false,
    need: 'view' | 'edit' | 'owner' = lock ? 'edit' : 'view',
  ) {
    const [plan] = await q.query(
      `SELECT p.*,CASE WHEN p.user_id=$2 THEN 'OWNER' ELSE m.role END AS access
       FROM plans p LEFT JOIN plan_members m ON m.plan_id=p.id AND m.user_id=$2
       WHERE p.id=$1 AND (p.user_id=$2 OR m.user_id IS NOT NULL)${lock ? ' FOR UPDATE OF p' : ''}`,
      [planId, userId],
    );
    ensure(plan, 404, 'PLAN_NOT_FOUND', 'Plan not found.');
    ensure(
      need === 'view' || plan.access === 'OWNER' || (need === 'edit' && plan.access === 'EDITOR'),
      403,
      'PLAN_READ_ONLY',
      need === 'owner'
        ? 'Only the person who created this plan can do that.'
        : 'This plan was shared with you to view only.',
    );
    return plan;
  }
  const touch = (q: Query, planId: string) =>
    q.query('UPDATE plans SET updated_at=now() WHERE id=$1', [planId]);

  // ---------- reference data ----------
  async function listTemplates(_user?: any, _input?: RequestInput) {
    const { templates } = await plannerContent(db);
    return templates.map((t) => ({
      key: t.key,
      kind: t.kind,
      title: t.title,
      description: t.description,
      questions: t.questions,
      rooms_label: t.roomsLabel ?? null,
      people_label: t.peopleLabel ?? null,
      item_count: wizardFor(t.key)?.items.length || t.items.length,
      wizard: !!wizardFor(t.key),
    }));
  }
  async function listRecipes(user: any, _input?: RequestInput) {
    const profile = await profileOf(user.id);
    const { recipes, ingredients } = await plannerContent(db);
    return recipes.map((r) => {
      const check = checkRecipe(r, profile, ingredients);
      const cost = Object.entries(r.per_serving).reduce(
        (sum, [key, qty]) => sum + qty * ingredients[key].price,
        0,
      );
      return {
        key: r.key,
        name: r.name,
        description: r.description,
        time_minutes: r.time,
        meals: r.meals,
        steps: r.steps,
        ingredients: Object.entries(r.per_serving).map(([key, qty]) => ({
          key,
          name: ingredients[key].name,
          per_serving: qty,
          unit: ingredients[key].unit,
        })),
        estimated_cost_per_serving_kobo: Math.round(cost * 100),
        allergens: check.allergens,
        may_contain: check.may,
        diet_status: check.status,
        diet_reasons: check.reasons,
      };
    });
  }
  async function readText(_user: any, input: RequestInput) {
    const text = planReadInput.parse(input.body).text;
    const read = readRequest(text, (await plannerContent(db)).templates);
    return { ...read, answers: answersFromRequest(read.template, read, text) };
  }

  // ---------- diet profile (sensitive) ----------
  async function getDietProfile(user: any, _input?: RequestInput) {
    const [p] = await db.query(
      'SELECT allergies,intolerances,avoid,patterns,consented_at,updated_at FROM diet_profiles WHERE user_id=$1',
      [user.id],
    );
    return {
      profile: p ?? {
        allergies: [],
        intolerances: [],
        avoid: [],
        patterns: [],
        consented_at: null,
        updated_at: null,
      },
      allergen_options: Object.entries(allergenNames).map(([key, label]) => ({ key, label })),
      pattern_options: Object.entries(dietPatterns).map(([key, v]) => ({ key, label: v.label })),
      notice:
        'Used only to filter recipes and flag products for you. Sellers never see it. This is planning help, not medical advice: always check labels and ask the seller or manufacturer.',
    };
  }
  async function saveDietProfile(q: Query, user: any, input: RequestInput) {
    const d = dietProfileInput.parse(input.body);
    const clean = (a: string[]) => [...new Set(a.map((x) => x.toLowerCase()))];
    const health = d.allergies.length + d.intolerances.length > 0;
    ensure(
      !health || d.consent,
      400,
      'CONSENT_REQUIRED',
      'Please agree to us storing your allergy information before saving it.',
    );
    await q.query(
      `INSERT INTO diet_profiles(user_id,allergies,intolerances,avoid,patterns,consented_at,updated_at)
       VALUES($1,$2,$3,$4,$5,CASE WHEN $6 THEN now() END,now())
       ON CONFLICT(user_id) DO UPDATE SET allergies=EXCLUDED.allergies,intolerances=EXCLUDED.intolerances,
         avoid=EXCLUDED.avoid,patterns=EXCLUDED.patterns,
         consented_at=CASE WHEN $6 THEN COALESCE(diet_profiles.consented_at,now()) END,updated_at=now()`,
      [user.id, clean(d.allergies), clean(d.intolerances), clean(d.avoid), d.patterns, health],
    );
    return { ok: true };
  }
  async function deleteDietProfile(q: Query, user: any, _input?: RequestInput) {
    await q.query('DELETE FROM diet_profiles WHERE user_id=$1', [user.id]);
    return { ok: true };
  }

  // ---------- plans ----------
  /** Budget picture: planned estimates, live prices of linked products, confirmed spending. */
  async function summarise(planIds: string[]) {
    if (!planIds.length) return new Map<string, any>();
    const items = await db.query(
      `SELECT i.plan_id,i.section,i.budget_kobo,i.quantity,i.unit,i.status,i.priority,i.name,
         v.price_kobo,v.unit AS vunit,v.wholesale_tiers,v.active,l.status AS listing_status
       FROM plan_items i LEFT JOIN listing_variants v ON v.id=i.variant_id LEFT JOIN listings l ON l.id=i.listing_id
       WHERE i.plan_id=ANY($1)`,
      [planIds],
    );
    const spend = await db.query(
      `SELECT i.plan_id,
         COALESCE(SUM(b.total_kobo) FILTER (WHERE b.status IN ${CONFIRMED}),0)::bigint AS spent,
         COALESCE(SUM(b.total_kobo) FILTER (WHERE b.status IN ('REQUESTED','COUNTERED')),0)::bigint AS requested
       FROM bookings b JOIN plan_items i ON i.id=b.plan_item_id WHERE i.plan_id=ANY($1) GROUP BY i.plan_id`,
      [planIds],
    );
    const out = new Map<string, any>();
    for (const id of planIds)
      out.set(id, {
        planned: 0,
        estimate: 0,
        items: 0,
        done: 0,
        optional: [] as any[],
        sections: new Map(),
      });
    for (const i of items) {
      const s = out.get(i.plan_id);
      s.items++;
      if (['PURCHASED', 'OWNED', 'NOT_NEEDED'].includes(i.status)) s.done++;
      if (['NOT_NEEDED', 'OWNED'].includes(i.status)) continue;
      const planned = n(i.budget_kobo);
      const live =
        i.price_kobo != null && i.active && i.listing_status === 'ACTIVE'
          ? unitPrice({ price_kobo: i.price_kobo, wholesale_tiers: i.wholesale_tiers || [] }, 1) *
            (i.vunit === i.unit ? Math.ceil(i.quantity) : 1)
          : null;
      s.planned += planned;
      s.estimate += live ?? planned;
      s.sections.set(i.section, (s.sections.get(i.section) || 0) + planned);
      if (i.priority === 'OPTIONAL' && i.status !== 'PURCHASED')
        s.optional.push({ name: i.name, budget_kobo: planned });
    }
    for (const row of spend)
      Object.assign(out.get(row.plan_id), { spent: n(row.spent), requested: n(row.requested) });
    return out;
  }
  function shapeSummary(plan: any, s: any) {
    const budget = plan.budget_kobo == null ? null : n(plan.budget_kobo);
    const spent = s.spent || 0;
    const over = budget == null ? 0 : Math.max(0, s.estimate - budget);
    const optionalTotal = s.optional.reduce((a: number, o: any) => a + o.budget_kobo, 0);
    return {
      budget_kobo: budget,
      planned_kobo: s.planned,
      estimate_kobo: s.estimate,
      spent_kobo: spent,
      requested_kobo: s.requested || 0,
      remaining_kobo: budget == null ? null : budget - spent,
      over_budget_kobo: over,
      item_count: s.items,
      done_count: s.done,
      sections: [...s.sections.entries()].map(([section, planned]: [string, number]) => ({
        section,
        planned_kobo: planned,
        share: s.planned ? Math.round((planned / s.planned) * 1000) / 10 : 0,
      })),
      suggestions: over
        ? [
            `Your estimate is ₦${Math.round(over / 100).toLocaleString('en-NG')} over budget.`,
            ...(optionalTotal
              ? [
                  `Skipping the ${s.optional.length} optional item${s.optional.length === 1 ? '' : 's'} would save about ₦${Math.round(optionalTotal / 100).toLocaleString('en-NG')}.`,
                ]
              : []),
            'Open an item and tap “Cheaper options” to compare lower prices.',
          ]
        : [],
      note: 'Estimates are a guide only. Prices come from sellers and can change until a seller accepts your order.',
    };
  }

  async function listPlans(user: any, _input?: RequestInput) {
    const plans = await db.query(
      `SELECT p.*,CASE WHEN p.user_id=$1 THEN 'OWNER' ELSE m.role END AS access,u.name AS owner_name
       FROM plans p JOIN users u ON u.id=p.user_id LEFT JOIN plan_members m ON m.plan_id=p.id AND m.user_id=$1
       WHERE p.user_id=$1 OR m.user_id IS NOT NULL
       ORDER BY (p.status='ACTIVE') DESC,p.updated_at DESC LIMIT 80`,
      [user.id],
    );
    const sums = await summarise(plans.map((p: any) => p.id));
    return plans.map((p: any) => ({ ...shapePlan(p), summary: shapeSummary(p, sums.get(p.id)) }));
  }
  function shapePlan(p: any) {
    return {
      id: p.id,
      title: p.title,
      kind: p.kind,
      template: p.template,
      budget_kobo: p.budget_kobo == null ? null : n(p.budget_kobo),
      people: p.people,
      rooms: p.rooms,
      tier: p.tier,
      target_date: p.target_date ? new Date(p.target_date).toISOString().slice(0, 10) : null,
      status: p.status,
      created_at: p.created_at,
      updated_at: p.updated_at,
      access: (p.access ?? 'OWNER') as 'OWNER' | 'EDITOR' | 'VIEWER',
      owner_name: p.owner_name ?? null,
    };
  }

  async function createPlan(q: Query, user: any, input: RequestInput) {
    const d = planCreateInput.parse(input.body);
    const t = templateByKey(d.template, (await plannerContent(q)).templates);
    ensure(t, 400, 'UNKNOWN_TEMPLATE', 'Choose one of the plan types.');
    const [count] = await q.query('SELECT COUNT(*)::int AS n FROM plans WHERE user_id=$1', [
      user.id,
    ]);
    ensure(
      count.n < 50,
      400,
      'PLAN_LIMIT',
      'You can keep up to 50 plans. Delete one to start another.',
    );
    // Step-by-step answers build a detailed plan; a plan type with no fixed list always uses them.
    const guided = wizardFor(t.key);
    if (guided && (d.answers || (!t.items.length && !guided.meals)))
      return await wizard.createFromWizard(q, user, d);
    const id = randomUUID();
    await q.query(
      'INSERT INTO plans(id,user_id,title,kind,template,budget_kobo,people,rooms,tier,target_date) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',
      [
        id,
        user.id,
        d.title || t.title,
        t.kind,
        t.key,
        d.budget_kobo ?? null,
        d.people ?? null,
        d.rooms ?? null,
        d.tier,
        d.target_date ?? null,
      ],
    );
    for (const item of templateItems(t, { people: d.people, rooms: d.rooms, tier: d.tier as Tier }))
      await q.query(
        "INSERT INTO plan_items(id,plan_id,section,name,category,keywords,quantity,unit,budget_kobo,priority,source,position) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'TEMPLATE',$11)",
        [
          randomUUID(),
          id,
          item.section,
          item.name,
          item.category,
          item.keywords,
          item.quantity,
          item.unit,
          item.budget_kobo,
          item.priority,
          item.position,
        ],
      );
    return { id };
  }

  async function getPlan(user: any, input: RequestInput) {
    const plan = await ownPlan(db, user.id, input.params.id);
    const content = await plannerContent(db);
    // Items with a completed order are bought.
    await db.query(
      `UPDATE plan_items i SET status='PURCHASED',updated_at=now() WHERE i.plan_id=$1 AND i.status IN ('PLANNED','SAVED','UNAVAILABLE')
       AND EXISTS(SELECT 1 FROM bookings b WHERE b.plan_item_id=i.id AND b.status='COMPLETED')`,
      [plan.id],
    );
    const items = await db.query(
      `SELECT i.*,l.title AS listing_title,l.image_url,l.confirmed_at,l.status AS listing_status,
         (SELECT m.thumbnail_url FROM media m WHERE m.url=l.image_url) AS thumbnail_url,
         v.name AS variant_name,v.price_kobo,v.unit AS variant_unit,v.stock,v.active,v.wholesale_tiers,s.business_name,
         (SELECT au.name FROM users au WHERE au.id=i.assignee_id) AS assignee_name,
         (SELECT json_agg(json_build_object('id',b.id,'status',b.status,'total_kobo',b.total_kobo) ORDER BY b.created_at)
            FROM bookings b WHERE b.plan_item_id=i.id) AS orders
       FROM plan_items i LEFT JOIN listings l ON l.id=i.listing_id LEFT JOIN listing_variants v ON v.id=i.variant_id
       LEFT JOIN sellers s ON s.user_id=l.seller_id
       WHERE i.plan_id=$1 ORDER BY i.position,i.created_at`,
      [plan.id],
    );
    const planMeals = await db.query(
      'SELECT id,recipe,day,meal,servings FROM plan_meals WHERE plan_id=$1 ORDER BY day,meal,created_at',
      [plan.id],
    );
    const profile = await profileOf(user.id);
    const allergies = new Set(profile?.allergies || []);
    const sums = await summarise([plan.id]);
    return {
      ...shapePlan(plan),
      answers: plan.answers ?? {},
      summary: shapeSummary(plan, sums.get(plan.id)),
      items: items.map((i: any) => {
        const conflicts = (i.allergens || []).filter((a: string) => allergies.has(a));
        return {
          id: i.id,
          section: i.section,
          name: i.name,
          category: i.category,
          keywords: i.keywords,
          quantity: n(i.quantity),
          unit: i.unit,
          budget_kobo: n(i.budget_kobo),
          priority: i.priority,
          status: i.status,
          source: i.source,
          ingredient_key: i.ingredient_key,
          icon: i.icon ?? null,
          photo_url: i.photo_url ?? null,
          price_source: i.price_source,
          market_sellers: i.market_sellers,
          buy_by: i.buy_by ? new Date(i.buy_by).toISOString().slice(0, 10) : null,
          assignee_id: i.assignee_id ?? null,
          assignee_name: i.assignee_name ?? null,
          allergens: i.allergens || [],
          allergy_warning: conflicts.length
            ? `Contains or may contain ${conflicts.map((a: string) => allergenNames[a as keyof typeof allergenNames] || a).join(', ')}, which is in your allergy profile.`
            : null,
          listing: i.listing_id
            ? {
                listing_id: i.listing_id,
                variant_id: i.variant_id,
                title: i.listing_title,
                variant_name: i.variant_name,
                business_name: i.business_name,
                image_url: i.image_url,
                thumbnail_url: i.thumbnail_url,
                price_kobo:
                  i.price_kobo == null
                    ? null
                    : unitPrice(
                        { price_kobo: i.price_kobo, wholesale_tiers: i.wholesale_tiers || [] },
                        1,
                      ),
                unit: i.variant_unit,
                available: i.listing_status === 'ACTIVE' && !!i.active && n(i.stock) > 0,
                price_checked_at: i.confirmed_at,
              }
            : null,
          orders: i.orders || [],
        };
      }),
      meals: planMeals.map((m: any) => ({
        ...m,
        recipe_name: content.recipes.find((r) => r.key === m.recipe)?.name ?? m.recipe,
      })),
    };
  }

  async function updatePlan(q: Query, user: any, input: RequestInput) {
    const d = planUpdateInput.parse(input.body);
    const plan = await ownPlan(q, user.id, input.params.id, true);
    await q.query(
      'UPDATE plans SET title=$1,budget_kobo=$2,target_date=$3,status=$4,updated_at=now() WHERE id=$5',
      [
        d.title ?? plan.title,
        d.budget_kobo === undefined ? plan.budget_kobo : d.budget_kobo,
        d.target_date === undefined ? plan.target_date : d.target_date,
        d.status ?? plan.status,
        plan.id,
      ],
    );
    if (d.target_date !== undefined)
      await scheduleItems(q, { id: plan.id, template: plan.template, target_date: d.target_date });
    return { ok: true };
  }
  async function deletePlan(q: Query, user: any, input: RequestInput) {
    const plan = await ownPlan(q, user.id, input.params.id, true, 'owner');
    await q.query('DELETE FROM plans WHERE id=$1', [plan.id]);
    return { ok: true };
  }
  async function duplicatePlan(q: Query, user: any, input: RequestInput) {
    const plan = await ownPlan(q, user.id, input.params.id);
    const [count] = await q.query('SELECT COUNT(*)::int AS n FROM plans WHERE user_id=$1', [
      user.id,
    ]);
    ensure(
      count.n < 50,
      400,
      'PLAN_LIMIT',
      'You can keep up to 50 plans. Delete one to start another.',
    );
    const id = randomUUID();
    await q.query(
      `INSERT INTO plans(id,user_id,title,kind,template,budget_kobo,people,rooms,tier,target_date)
       SELECT $1,user_id,left(title||' (copy)',120),kind,template,budget_kobo,people,rooms,tier,target_date FROM plans WHERE id=$2`,
      [id, plan.id],
    );
    await q.query(
      `INSERT INTO plan_items(id,plan_id,section,name,category,keywords,quantity,unit,budget_kobo,priority,status,listing_id,variant_id,source,ingredient_key,allergens,position)
       SELECT gen_random_uuid()::text,$1,section,name,category,keywords,quantity,unit,budget_kobo,priority,
         CASE WHEN status IN ('OWNED','NOT_NEEDED') THEN status ELSE 'PLANNED' END,listing_id,variant_id,source,ingredient_key,allergens,position
       FROM plan_items WHERE plan_id=$2`,
      [id, plan.id],
    );
    await q.query(
      'INSERT INTO plan_meals(id,plan_id,recipe,day,meal,servings) SELECT gen_random_uuid()::text,$1,recipe,day,meal,servings FROM plan_meals WHERE plan_id=$2',
      [id, plan.id],
    );
    return { id };
  }

  // ---------- items ----------
  async function addItem(q: Query, user: any, input: RequestInput) {
    const d = planItemInput.parse(input.body);
    const plan = await ownPlan(q, user.id, input.params.id, true);
    const [count] = await q.query(
      'SELECT COUNT(*)::int AS n,COALESCE(MAX(position),0) AS last FROM plan_items WHERE plan_id=$1',
      [plan.id],
    );
    ensure(count.n < 300, 400, 'PLAN_ITEM_LIMIT', 'A plan can hold up to 300 items.');
    const id = randomUUID();
    await q.query(
      'INSERT INTO plan_items(id,plan_id,section,name,category,keywords,quantity,unit,budget_kobo,priority,position) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',
      [
        id,
        plan.id,
        d.section,
        d.name,
        d.category ?? null,
        d.keywords || d.name,
        d.quantity,
        d.unit,
        d.budget_kobo,
        d.priority,
        n(count.last) + 1,
      ],
    );
    await touch(q, plan.id);
    return { id };
  }
  async function updateItem(q: Query, user: any, input: RequestInput) {
    const d = planItemUpdateInput.parse(input.body);
    const plan = await ownPlan(q, user.id, input.params.id, true);
    const [item] = await q.query('SELECT * FROM plan_items WHERE id=$1 AND plan_id=$2', [
      input.params.itemId,
      plan.id,
    ]);
    ensure(item, 404, 'PLAN_ITEM_NOT_FOUND', 'That plan item was not found.');
    let listing = item.listing_id,
      variant = item.variant_id;
    if (d.listing_id !== undefined) {
      listing = d.listing_id;
      variant = null;
      if (listing) {
        const [v] = await q.query(
          `SELECT v.id FROM listing_variants v JOIN listings l ON l.id=v.listing_id WHERE v.listing_id=$1 AND v.active AND ${d.variant_id ? 'v.id=$2' : 'v.is_primary'}`,
          d.variant_id ? [listing, d.variant_id] : [listing],
        );
        ensure(v, 400, 'VARIANT_REQUIRED', 'Choose an available product option.');
        variant = v.id;
      }
    }
    let assignee = item.assignee_id;
    if (d.assignee_id !== undefined) {
      assignee = d.assignee_id;
      if (assignee) {
        const [ok] = await q.query(
          'SELECT 1 FROM plans WHERE id=$1 AND user_id=$2 UNION SELECT 1 FROM plan_members WHERE plan_id=$1 AND user_id=$2',
          [plan.id, assignee],
        );
        ensure(ok, 400, 'NOT_A_MEMBER', 'Share the plan with this person first.');
        if (assignee !== user.id && assignee !== item.assignee_id)
          await notify(
            q,
            assignee,
            'planner',
            `You’re buying ${item.name}`,
            `${user.name} asked you to cover “${item.name}” for “${plan.title}”.`,
          );
      }
    }
    // Remember the price when a product is linked, to tell the customer if it drops.
    const [linked] =
      variant && variant !== item.variant_id
        ? await q.query('SELECT price_kobo FROM listing_variants WHERE id=$1', [variant])
        : [];
    await q.query(
      `UPDATE plan_items SET assignee_id=$1,linked_price_kobo=CASE WHEN $2::bigint IS NOT NULL THEN $2::bigint WHEN $3::text IS NULL THEN NULL ELSE linked_price_kobo END WHERE id=$4`,
      [assignee, linked?.price_kobo ?? null, variant, item.id],
    );
    await q.query(
      `UPDATE plan_items SET name=$1,section=$2,category=$3,keywords=$4,quantity=$5,unit=$6,budget_kobo=$7,priority=$8,status=$9,
         listing_id=$10,variant_id=$11,updated_at=now() WHERE id=$12`,
      [
        d.name ?? item.name,
        d.section ?? item.section,
        d.category === undefined ? item.category : d.category,
        d.keywords ?? item.keywords,
        d.quantity ?? item.quantity,
        d.unit ?? item.unit,
        d.budget_kobo ?? item.budget_kobo,
        d.priority ?? item.priority,
        d.status ??
          (listing && !item.listing_id && item.status === 'PLANNED' ? 'SAVED' : item.status),
        listing,
        variant,
        item.id,
      ],
    );
    await touch(q, plan.id);
    return { ok: true };
  }
  async function deleteItem(q: Query, user: any, input: RequestInput) {
    const plan = await ownPlan(q, user.id, input.params.id, true);
    const [item] = await q.query('DELETE FROM plan_items WHERE id=$1 AND plan_id=$2 RETURNING id', [
      input.params.itemId,
      plan.id,
    ]);
    ensure(item, 404, 'PLAN_ITEM_NOT_FOUND', 'That plan item was not found.');
    await touch(q, plan.id);
    return { ok: true };
  }

  /**
   * Real listings for a plan item, ranked by how well they fit: words matched, category, price
   * against the estimate, stock, rating and distance. Sponsored listings are labelled and get no
   * extra rank, so payment never outranks the customer's budget or filters.
   */
  async function matches(user: any, input: RequestInput) {
    const query = z
      .object({
        lat: z.coerce.number().min(-90).max(90).optional(),
        lng: z.coerce.number().min(-180).max(180).optional(),
        sort: z.enum(['best', 'price']).default('best'),
      })
      .parse(input.query);
    const plan = await ownPlan(db, user.id, input.params.id);
    const [item] = await db.query('SELECT * FROM plan_items WHERE id=$1 AND plan_id=$2', [
      input.params.itemId,
      plan.id,
    ]);
    ensure(item, 404, 'PLAN_ITEM_NOT_FOUND', 'That plan item was not found.');
    return await findMatches(db, user, item, query);
  }
  /** Products that could fill a plan item, best first (or cheapest first with sort=price). */
  async function findMatches(
    db: Query,
    user: any,
    item: any,
    query: { lat?: number; lng?: number; sort: 'best' | 'price' },
  ) {
    const words = [
      ...new Set(
        `${item.keywords} ${item.name}`
          .toLowerCase()
          .split(/[^a-z0-9]+/)
          .filter((w) => w.length >= 3 && !['and', 'for', 'with', 'the', 'set', 'per'].includes(w)),
      ),
    ].slice(0, 8);
    if (!words.length)
      return { items: [], note: 'Add a few words describing this item to find products.' };
    const patterns = words.map((w) => `%${w}%`);
    const point = query.lat != null && query.lng != null;
    const distance = point
      ? `6371*acos(LEAST(1.0,GREATEST(-1.0,sin(radians($4::float8))*sin(radians(s.public_latitude))+cos(radians($4::float8))*cos(radians(s.public_latitude))*cos(radians(s.public_longitude-$5::float8)))))`
      : 'NULL::float8';
    const rows = await db.query(
      `SELECT l.id,l.title,l.category,l.image_url,l.confirmed_at,l.condition,l.pickup_available,l.delivery_available,
         (SELECT m.thumbnail_url FROM media m WHERE m.url=l.image_url) AS thumbnail_url,
         s.business_name,s.area,s.city,s.business_type,
         v.id AS variant_id,v.name AS variant_name,v.unit,v.price_kobo,v.wholesale_tiers,v.stock,v.min_quantity,
         COALESCE((SELECT AVG(r.score) FROM ratings r WHERE r.seller_id=s.user_id),0)::float8 AS rating_avg,
         (SELECT COUNT(*)::int FROM ratings r WHERE r.seller_id=s.user_id) AS rating_count,
         ${verifiedSql()} AS verified,
         ${distance} AS distance_km,
         ${c.features.promotions ? activePromotion : 'FALSE'} AS sponsored,
         (SELECT COUNT(*)::int FROM unnest($2::text[]) w WHERE l.title ILIKE w) AS title_hits,
         (SELECT COUNT(*)::int FROM unnest($2::text[]) w WHERE l.description ILIKE w) AS desc_hits
       FROM listings l JOIN sellers s ON s.user_id=l.seller_id
       JOIN listing_variants v ON v.listing_id=l.id AND v.is_primary AND v.active
       WHERE l.status='ACTIVE' AND s.status='APPROVED' AND l.seller_id<>$1
         AND (l.title ILIKE ANY($2) OR l.description ILIKE ANY($2) OR l.category=$3)
       LIMIT 200`,
      point
        ? [user.id, patterns, item.category ?? '', query.lat, query.lng]
        : [user.id, patterns, item.category ?? ''],
    );
    const target =
      n(item.quantity) > 0 ? n(item.budget_kobo) / Math.max(1, Math.ceil(n(item.quantity))) : 0;
    const profile = await profileOf(user.id);
    const allergyProfile = !!profile?.allergies.length;
    // Products whose title or description matches come first; same-category products only fill in
    // when nothing matches by name.
    const named = rows.filter((r: any) => r.title_hits > 0 || r.desc_hits > 0);
    const pool = named.length ? named : rows.filter((r: any) => r.category === item.category);
    const sameUnit = (u: string) =>
      u.toLowerCase().replace(/e?s$/, '') === String(item.unit).toLowerCase().replace(/e?s$/, '');
    const ranked = pool
      .map((r: any) => {
        const price = unitPrice(
          { price_kobo: r.price_kobo, wholesale_tiers: r.wholesale_tiers || [] },
          1,
        );
        // Prices are only compared with the estimate when sold in the same unit (kg vs kg).
        const comparable = target > 0 && sameUnit(r.unit);
        const inBudget = !comparable || price <= target * 1.15;
        const inStock = n(r.stock) >= Math.max(1, n(r.min_quantity));
        const reasons: string[] = [];
        if (comparable)
          reasons.push(
            inBudget
              ? 'Within your estimate'
              : `₦${Math.round((price - target) / 100).toLocaleString('en-NG')} above your estimate`,
          );
        else if (target > 0) reasons.push(`Sold per ${r.unit}: check how much you need`);
        reasons.push(inStock ? 'In stock' : 'Out of stock');
        if (r.rating_count)
          reasons.push(
            `${Number(r.rating_avg).toFixed(1)}★ from ${r.rating_count} review${r.rating_count === 1 ? '' : 's'}`,
          );
        if (r.distance_km != null)
          reasons.push(`About ${Math.max(1, Math.round(r.distance_km))} km away`);
        if (r.verified) reasons.push('Verified business');
        if (r.title_hits > 0) reasons.push('Matches your item');
        const score =
          r.title_hits * 4 +
          (r.desc_hits > 0 ? 1 : 0) +
          (r.verified ? 1 : 0) +
          (r.category === item.category ? 2 : 0) +
          (inBudget ? 2 : 0) +
          (inStock ? 2 : -6) +
          n(r.rating_avg) / 2 -
          (r.distance_km != null ? Math.min(4, r.distance_km / 10) : 0);
        const food = FOOD_CATEGORIES.includes(r.category);
        return {
          listing_id: r.id,
          variant_id: r.variant_id,
          title: r.title,
          variant_name: r.variant_name,
          category: r.category,
          condition: r.condition,
          image_url: r.image_url,
          thumbnail_url: r.thumbnail_url,
          business_name: r.business_name,
          area: r.area,
          city: r.city,
          unit: r.unit,
          price_kobo: price,
          in_stock: inStock,
          within_estimate: inBudget,
          rating_avg: r.rating_count ? Math.round(Number(r.rating_avg) * 10) / 10 : null,
          rating_count: r.rating_count,
          distance_km: r.distance_km == null ? null : Math.round(r.distance_km * 10) / 10,
          pickup_available: r.pickup_available,
          delivery_available: r.delivery_available,
          price_checked_at: r.confirmed_at,
          sponsored: !!r.sponsored,
          verified: !!r.verified,
          reasons,
          allergen_note: food && allergyProfile ? ALLERGEN_UNKNOWN : null,
          score,
        };
      })
      .sort((a: any, b: any) =>
        query.sort === 'price'
          ? Number(b.in_stock) - Number(a.in_stock) || a.price_kobo - b.price_kobo
          : b.score - a.score || a.price_kobo - b.price_kobo,
      )
      .slice(0, 20)
      .map(({ score, ...rest }: any) => rest);
    return {
      items: ranked,
      estimate_unit_kobo: Math.round(target),
      note: 'Prices and stock come from sellers. Sponsored listings are labelled and are never ranked higher for paying.',
    };
  }

  // ---------- meals and grocery list ----------
  async function addMeal(q: Query, user: any, input: RequestInput) {
    const d = planMealInput.parse(input.body);
    const plan = await ownPlan(q, user.id, input.params.id, true);
    const content = await plannerContent(q);
    const recipe = content.recipes.find((r) => r.key === d.recipe);
    ensure(recipe, 400, 'UNKNOWN_RECIPE', 'Choose a recipe from the list.');
    const check = checkRecipe(recipe, await profileOf(user.id), content.ingredients);
    ensure(
      check.status !== 'EXCLUDED',
      409,
      'DIET_CONFLICT',
      `${recipe.name} conflicts with your diet profile: ${check.reasons.join('; ')}.`,
    );
    const [count] = await q.query('SELECT COUNT(*)::int AS n FROM plan_meals WHERE plan_id=$1', [
      plan.id,
    ]);
    ensure(count.n < 100, 400, 'MEAL_LIMIT', 'A plan can hold up to 100 meals.');
    const id = randomUUID();
    await q.query(
      'INSERT INTO plan_meals(id,plan_id,recipe,day,meal,servings) VALUES($1,$2,$3,$4,$5,$6)',
      [id, plan.id, recipe.key, d.day, d.meal, d.servings],
    );
    await touch(q, plan.id);
    return { id, warnings: check.status === 'WARNING' ? check.reasons : [] };
  }
  /** Changes the step-by-step answers and rebuilds the plan, keeping anything acted on. */
  async function changeAnswers(q: Query, user: any, input: RequestInput) {
    const d = z
      .object({
        answers: wizardAnswers,
        budget_kobo: kobo.nullable().optional(),
        target_date: date.nullable().optional(),
      })
      .parse(input.body);
    const plan = await ownPlan(q, user.id, input.params.id, true);
    const result = await wizard.rebuildFromAnswers(q, user, plan, d);
    return result;
  }
  /**
   * Fills the cart with the whole plan: products already chosen, and for the rest the best
   * in-stock match (within the estimate where possible). Items with no match are listed.
   */
  async function fillCart(q: Query, user: any, input: RequestInput) {
    const plan = await ownPlan(q, user.id, input.params.id, true);
    const items = await q.query(
      "SELECT * FROM plan_items WHERE plan_id=$1 AND status IN ('PLANNED','SAVED') ORDER BY position",
      [plan.id],
    );
    const missing: string[] = [];
    const sellers = new Set<string>();
    let added = 0,
      total = 0;
    const [count] = await q.query('SELECT COUNT(*)::int AS n FROM cart_items WHERE user_id=$1', [
      user.id,
    ]);
    let room = 100 - count.n;
    for (const item of items) {
      if (room <= 0) {
        missing.push(item.name);
        continue;
      }
      let pick: any = null;
      if (item.variant_id) {
        const [v] = await q.query(
          `SELECT l.id AS listing_id,v.id AS variant_id,v.unit,v.price_kobo,l.seller_id FROM listing_variants v JOIN listings l ON l.id=v.listing_id
           JOIN sellers s ON s.user_id=l.seller_id
           WHERE v.id=$1 AND v.active AND v.stock>0 AND l.status='ACTIVE' AND s.status='APPROVED' AND l.seller_id<>$2`,
          [item.variant_id, user.id],
        );
        pick = v ?? null;
      }
      if (!pick) {
        const found = await findMatches(q, user, item, { sort: 'best' });
        const best =
          found.items.find((m: any) => m.in_stock && m.within_estimate) ??
          found.items.find((m: any) => m.in_stock);
        if (best) {
          const [l] = await q.query('SELECT seller_id FROM listings WHERE id=$1', [
            best.listing_id,
          ]);
          pick = { ...best, seller_id: l.seller_id };
        }
      }
      if (!pick) {
        missing.push(item.name);
        continue;
      }
      const sameUnit =
        String(pick.unit).toLowerCase().replace(/e?s$/, '') ===
        String(item.unit).toLowerCase().replace(/e?s$/, '');
      const quantity = Math.min(1000, sameUnit ? Math.max(1, Math.ceil(n(item.quantity))) : 1);
      await q.query(
        `INSERT INTO cart_items(id,user_id,listing_id,variant_id,quantity,plan_item_id) VALUES($1,$2,$3,$4,$5,$6)
         ON CONFLICT(user_id,variant_id) DO UPDATE SET quantity=GREATEST(cart_items.quantity,EXCLUDED.quantity),
           plan_item_id=COALESCE(cart_items.plan_item_id,EXCLUDED.plan_item_id),updated_at=now()`,
        [randomUUID(), user.id, pick.listing_id, pick.variant_id, quantity, item.id],
      );
      await q.query(
        "UPDATE plan_items SET listing_id=$1,variant_id=$2,status='SAVED',linked_price_kobo=COALESCE(linked_price_kobo,$3),updated_at=now() WHERE id=$4",
        [pick.listing_id, pick.variant_id, pick.price_kobo, item.id],
      );
      sellers.add(pick.seller_id);
      total += n(pick.price_kobo) * quantity;
      added++;
      room--;
    }
    await touch(q, plan.id);
    return { added, missing, sellers: sellers.size, total_kobo: total };
  }
  /** A fresh copy of a grocery, household or meal plan for the next round of shopping. */
  async function repeatPlan(q: Query, user: any, input: RequestInput) {
    const plan = await ownPlan(q, user.id, input.params.id, false, 'owner');
    const [count] = await q.query('SELECT COUNT(*)::int AS n FROM plans WHERE user_id=$1', [
      user.id,
    ]);
    ensure(
      count.n < 50,
      400,
      'PLAN_LIMIT',
      'You can keep up to 50 plans. Delete one to start another.',
    );
    const id = randomUUID();
    const month = new Date().toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
    const base = String(plan.title).replace(/ · [A-Z][a-z]+ \d{4}$/, '');
    await q.query(
      `INSERT INTO plans(id,user_id,title,kind,template,budget_kobo,people,rooms,tier,answers)
       SELECT $1,user_id,left($3,120),kind,template,budget_kobo,people,rooms,tier,answers FROM plans WHERE id=$2`,
      [id, plan.id, `${base} · ${month}`],
    );
    // Same list, same chosen products; everything is to buy again except what wasn't needed.
    await q.query(
      `INSERT INTO plan_items(id,plan_id,section,name,category,keywords,quantity,unit,budget_kobo,priority,status,listing_id,variant_id,source,ingredient_key,allergens,position,icon,photo_url,price_source,market_sellers,linked_price_kobo)
       SELECT gen_random_uuid()::text,$1,section,name,category,keywords,quantity,unit,budget_kobo,priority,
         CASE WHEN status='NOT_NEEDED' THEN status WHEN listing_id IS NOT NULL THEN 'SAVED' ELSE 'PLANNED' END,
         listing_id,variant_id,source,ingredient_key,allergens,position,icon,photo_url,price_source,market_sellers,linked_price_kobo
       FROM plan_items WHERE plan_id=$2`,
      [id, plan.id],
    );
    await q.query(
      'INSERT INTO plan_meals(id,plan_id,recipe,day,meal,servings) SELECT gen_random_uuid()::text,$1,recipe,day,meal,servings FROM plan_meals WHERE plan_id=$2',
      [id, plan.id],
    );
    await q.query('UPDATE plans SET repeat_reminded_at=now() WHERE id=$1', [plan.id]);
    return { id };
  }
  /** Swaps a meal for the next best dish and refreshes the grocery list. */
  async function swapMeal(q: Query, user: any, input: RequestInput) {
    const plan = await ownPlan(q, user.id, input.params.id, true);
    const result = await wizard.swapMeal(q, user, plan, String(input.params.mealId));
    await touch(q, plan.id);
    return result;
  }
  async function removeMeal(q: Query, user: any, input: RequestInput) {
    const plan = await ownPlan(q, user.id, input.params.id, true);
    const [meal] = await q.query('DELETE FROM plan_meals WHERE id=$1 AND plan_id=$2 RETURNING id', [
      input.params.mealId,
      plan.id,
    ]);
    ensure(meal, 404, 'MEAL_NOT_FOUND', 'That meal was not found.');
    await touch(q, plan.id);
    return { ok: true };
  }
  /** Rebuilds the grocery list from the plan's meals. */
  async function buildGroceryList(q: Query, user: any, input: RequestInput) {
    const plan = await ownPlan(q, user.id, input.params.id, true);
    const result = await rebuildGroceryList(q, plan, await plannerContent(q));
    await touch(q, plan.id);
    return result;
  }

  // ---------- sharing ----------
  async function listMembers(user: any, input: RequestInput) {
    const plan = await ownPlan(db, user.id, input.params.id);
    const members = await db.query(
      `SELECT m.user_id,u.name,m.role,m.created_at FROM plan_members m JOIN users u ON u.id=m.user_id
       WHERE m.plan_id=$1 ORDER BY m.created_at`,
      [plan.id],
    );
    const [owner] = await db.query('SELECT id,name FROM users WHERE id=$1', [plan.user_id]);
    return { owner: { user_id: owner.id, name: owner.name }, members, you: plan.access };
  }
  async function shareWith(q: Query, user: any, input: RequestInput) {
    const d = planShareInput.parse(input.body);
    const plan = await ownPlan(q, user.id, input.params.id, true, 'owner');
    const [invitee] = await q.query(
      "SELECT id,name FROM users WHERE (lower(email)=lower($1) OR phone=$1) AND status='ACTIVE'",
      [d.contact.trim()],
    );
    ensure(
      invitee,
      404,
      'USER_NOT_FOUND',
      'No Ahia account uses that email or phone number. Ask them to create one first.',
    );
    ensure(invitee.id !== user.id, 400, 'OWN_PLAN', 'This is already your plan.');
    const [count] = await q.query('SELECT COUNT(*)::int AS n FROM plan_members WHERE plan_id=$1', [
      plan.id,
    ]);
    ensure(count.n < 20, 400, 'MEMBER_LIMIT', 'A plan can be shared with up to 20 people.');
    await q.query(
      `INSERT INTO plan_members(plan_id,user_id,role,invited_by) VALUES($1,$2,$3,$4)
       ON CONFLICT(plan_id,user_id) DO UPDATE SET role=EXCLUDED.role`,
      [plan.id, invitee.id, d.role, user.id],
    );
    await notify(
      q,
      invitee.id,
      'plan',
      'A plan was shared with you',
      `${user.name} shared “${plan.title}” with you${d.role === 'EDITOR' ? ' to edit together' : ''}. Open My Planner to see it.`,
    );
    return { ok: true, name: invitee.name as string };
  }
  async function removeMember(q: Query, user: any, input: RequestInput) {
    const plan = await ownPlan(
      q,
      user.id,
      input.params.id,
      true,
      input.params.userId === user.id ? 'view' : 'owner',
    );
    const [gone] = await q.query(
      'DELETE FROM plan_members WHERE plan_id=$1 AND user_id=$2 RETURNING user_id',
      [plan.id, input.params.userId],
    );
    ensure(gone, 404, 'NOT_FOUND', 'That person is not on this plan.');
    return { ok: true };
  }

  return {
    getWizard: wizard.getWizard,
    changeAnswers,
    fillCart,
    repeatPlan,
    previewPlan: wizard.previewPlan,
    swapMeal,
    listMembers,
    shareWith,
    removeMember,
    listTemplates,
    listRecipes,
    readText,
    getDietProfile,
    saveDietProfile,
    deleteDietProfile,
    listPlans,
    createPlan,
    getPlan,
    updatePlan,
    deletePlan,
    duplicatePlan,
    addItem,
    updateItem,
    deleteItem,
    matches,
    addMeal,
    removeMeal,
    buildGroceryList,
  };
}
