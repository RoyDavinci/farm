import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { Database, Query } from '../database/client.js';
import { ensure } from '../lib/errors.js';
import type { RequestInput } from '../lib/http.js';
import type { AppDeps } from '../types/deps.js';
import {
  answerValue,
  applicableItems,
  buyBy,
  cleanAnswers,
  fitBudget,
  type WizardLine,
  ingredientIcons,
  peopleOf,
  roomsOf,
  tierOf,
  wizardFor,
  type Answers,
  type Wizard,
} from '../config/planner-wizards.js';
import { checkRecipe, shoppingQuantity, type DietProfile, type Recipe } from '../config/recipes.js';
import { plannerContent, type PlannerContent } from './planner-content.service.js';
import { rebuildGroceryList } from './planner.service.js';
import { notify } from './communications.service.js';
import { translateSteps } from '../config/planner-i18n.js';

const kobo = z.number().int().min(0).max(100_000_000_000);
export const wizardAnswers = z.record(
  z.string().max(40),
  z.union([z.number().min(0).max(5000), z.string().max(40), z.array(z.string().max(120)).max(200)]),
);
export const wizardInput = z.object({
  template: z.string().max(40),
  answers: wizardAnswers.default({}),
  budget_kobo: kobo.nullable().optional(),
});

const DAYS = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];
const MEAL_ORDER = ['BREAKFAST', 'LUNCH', 'DINNER'] as const;
const SWALLOWS = ['eba-garri', 'semo-swallow'];
const SOUPS = ['egusi-soup', 'efo-riro', 'okra-soup', 'ogbono-soup'];
const FAMILY = [
  'jollof-rice',
  'rice-and-stew',
  'egusi-soup',
  'beans-and-plantain',
  'fried-rice',
  'moi-moi',
  'akara-and-pap',
  'yam-and-egg',
];

export interface PlannedMeal {
  day: number;
  meal: (typeof MEAL_ORDER)[number];
  recipe: string;
  servings: number;
}

/** Estimated naira cost of one serving, from the ingredient price list. */
const servingCost = (r: Recipe, content: PlannerContent) =>
  Object.entries(r.per_serving).reduce(
    (sum, [k, qty]) => sum + qty * (content.ingredients[k]?.price ?? 0),
    0,
  );

/** Recipes this household can make and will eat, given their kitchen, dislikes and diet profile. */
export function mealCandidates(content: PlannerContent, a: Answers, profile: DietProfile | null) {
  const dislikes = new Set((a.dislikes as string[]) || []);
  const kitchen = new Set((a.kitchen as string[]) || []);
  return content.recipes.filter(
    (r) =>
      !SWALLOWS.includes(r.key) &&
      !Object.keys(r.per_serving).some((k) => dislikes.has(k)) &&
      (kitchen.has('blender') || !r.steps.some((s) => /\bblend/i.test(s))) &&
      (kitchen.has('oven') || !r.steps.some((s) => /\b(oven|bake)/i.test(s))) &&
      checkRecipe(r, profile, content.ingredients).status !== 'EXCLUDED',
  );
}

/**
 * Picks a recipe for every chosen day and meal: scores each candidate for the household's style
 * (quick, budget, family favourites, soups, light, variety) and avoids repeating the same dish.
 * Soups come with a swallow. With `cheap`, cost per plate outweighs everything else.
 */
export function planMeals(
  content: PlannerContent,
  a: Answers,
  profile: DietProfile | null,
  cheap = false,
): PlannedMeal[] {
  const candidates = mealCandidates(content, a, profile);
  const styles = new Set((a.style as string[]) || []);
  const wanted = MEAL_ORDER.filter((m) => ((a.meals as string[]) || []).includes(m));
  const days = ((a.days as string[]) || DAYS).map((d) => DAYS.indexOf(d) + 1).filter((d) => d > 0);
  const servings = Math.max(1, Math.ceil(Number(a.adults || 1) + Number(a.kids || 0) * 0.6));
  const costs = new Map(candidates.map((r) => [r.key, servingCost(r, content)]));
  const max = Math.max(1, ...costs.values());
  const used = new Map<string, number>();
  const last = new Map<string, string>();
  const swallow = SWALLOWS.filter((k) => content.recipes.some((r) => r.key === k));
  const oily = (r: Recipe) => (r.per_serving.veg_oil || 0) + (r.per_serving.palm_oil || 0);
  const out: PlannedMeal[] = [];
  let swallowTurn = 0;
  for (const day of days)
    for (const meal of wanted) {
      const options = candidates.filter((r) => r.meals.includes(meal));
      if (!options.length) continue;
      const score = (r: Recipe) => {
        let s = 0;
        const cost = (costs.get(r.key) || 0) / max;
        if (cheap) s += 10 * (1 - cost);
        if (styles.has('budget')) s += 3 * (1 - cost);
        if (styles.has('quick') && r.time <= 45) s += 3;
        if (styles.has('family') && FAMILY.includes(r.key)) s += 2;
        if (styles.has('soups') && SOUPS.includes(r.key)) s += 3;
        if (styles.has('light') && oily(r) <= 0.02) s += 2;
        s -= (used.get(r.key) || 0) * (styles.has('variety') ? 4 : 1.5);
        if (last.get(meal) === r.key) s -= 6;
        // Stable tie-break so the same answers give the same plan.
        return s - r.key.length / 1000;
      };
      const best = [...options].sort((x, y) => score(y) - score(x))[0];
      used.set(best.key, (used.get(best.key) || 0) + 1);
      last.set(meal, best.key);
      out.push({ day, meal, recipe: best.key, servings });
      if (SOUPS.includes(best.key) && swallow.length)
        out.push({ day, meal, recipe: swallow[swallowTurn++ % swallow.length], servings });
    }
  return out;
}

/** Live price picture for one item from active Ahia listings (naira), or null when too few. */
export interface Market {
  p25: number;
  p50: number;
  p75: number;
  sellers: number;
  photo: string | null;
}
const marketCache = new Map<string, { at: number; value: Market | null }>();
/** Forget cached market prices (tests, or after big catalogue changes). */
export const clearMarketCache = () => marketCache.clear();

/**
 * What sellers on Ahia charge for an item: listings in the same category, sold in the same unit,
 * whose title matches the item. Needs at least three sellers; the quartiles become the basic,
 * standard and premium prices. Cached for ten minutes.
 */
export async function marketPrice(
  q: Query,
  item: { keywords: string; category: string | null; unit: string },
): Promise<Market | null> {
  const words = item.keywords
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 3)
    .slice(0, 4);
  if (!words.length || !item.category) return null;
  const key = `${item.category}|${item.unit}|${words.join(' ')}`;
  const hit = marketCache.get(key);
  if (hit && Date.now() - hit.at < 600_000) return hit.value;
  const rows = await q.query<{ price_kobo: number; seller_id: string; photo: string | null }>(
    `SELECT DISTINCT ON (l.seller_id) l.seller_id,v.price_kobo,
       COALESCE((SELECT m.thumbnail_url FROM media m WHERE m.url=l.image_url),l.image_url) AS photo
     FROM listings l JOIN sellers s ON s.user_id=l.seller_id
     JOIN listing_variants v ON v.listing_id=l.id AND v.is_primary AND v.active
     WHERE l.status='ACTIVE' AND s.status='APPROVED' AND l.category=$1
       AND l.title ILIKE ANY($2)
       AND lower(regexp_replace(v.unit,'e?s$',''))=lower(regexp_replace($3,'e?s$',''))
     ORDER BY l.seller_id,v.price_kobo LIMIT 80`,
    [item.category, words.map((w) => `%${w}%`), item.unit],
  );
  let value: Market | null = null;
  if (rows.length >= 3) {
    const prices = rows.map((r) => Number(r.price_kobo) / 100).sort((a, b) => a - b);
    const mid = prices[Math.floor(prices.length / 2)];
    // Leave out prices far from the middle (a mislabelled bulk pack, a typo).
    const sane = prices.filter((p) => p >= mid / 3 && p <= mid * 3);
    const at = (f: number) => sane[Math.min(sane.length - 1, Math.floor(f * (sane.length - 1)))];
    value = {
      p25: Math.round(at(0.25)),
      p50: Math.round(at(0.5)),
      p75: Math.round(at(0.75)),
      sellers: sane.length,
      photo: rows.find((r) => r.photo)?.photo ?? null,
    };
  }
  marketCache.set(key, { at: Date.now(), value });
  return value;
}

/** Shopping estimate for a set of meals, leaving out ingredients the household already has. */
export function mealShopping(
  content: PlannerContent,
  meals: PlannedMeal[],
  have: Set<string>,
  market: Map<string, Market> = new Map(),
) {
  const totals = new Map<string, number>();
  for (const m of meals) {
    const r = content.recipes.find((x) => x.key === m.recipe);
    if (!r) continue;
    for (const [k, qty] of Object.entries(r.per_serving))
      totals.set(k, (totals.get(k) || 0) + qty * m.servings);
  }
  let total = 0;
  const lines: Line[] = [];
  for (const [k, amount] of totals) {
    const x = content.ingredients[k];
    if (!x) continue;
    const quantity = shoppingQuantity(k, amount, content.ingredients);
    const live = market.get(k);
    const cost = Math.round(quantity * (live?.p50 ?? x.price) * 100);
    const owned = have.has(k);
    if (!owned) total += cost;
    lines.push({
      key: k,
      name: x.name,
      icon: ingredientIcons[k] || '🛒',
      photo: live?.photo ?? null,
      quantity,
      unit: x.unit,
      kobo: cost,
      have: owned,
      section: x.category,
      price_source: live ? 'MARKET' : 'ESTIMATE',
      sellers: live?.sellers ?? 0,
    });
  }
  return { total_kobo: total, lines, totals };
}

interface Line {
  key: string;
  name: string;
  icon: string;
  photo: string | null;
  quantity: number;
  unit: string;
  kobo: number;
  have: boolean;
  section: string;
  price_source: 'MARKET' | 'ESTIMATE';
  sellers: number;
}
type PricedLine = WizardLine & {
  price_source: 'MARKET' | 'ESTIMATE';
  sellers: number;
  photo: string | null;
};

/** The plan's items with live market prices where Ahia has enough sellers. */
async function pricedItems(q: Query, w: Wizard, a: Answers): Promise<PricedLine[]> {
  const lines = applicableItems(w, a, tierOf(a));
  const out: PricedLine[] = [];
  for (const l of lines) {
    const live = await marketPrice(q, l);
    if (!live) {
      out.push({ ...l, price_source: 'ESTIMATE', sellers: 0, photo: null });
      continue;
    }
    const price: [number, number, number] = [live.p25, live.p50, live.p75];
    out.push({
      ...l,
      price,
      budget_kobo: l.quantity * price[l.tier] * 100,
      price_source: 'MARKET',
      sellers: live.sellers,
      photo: live.photo,
    });
  }
  return out;
}

/** The questions answered so far, priced: totals, budget fit, the "have" tiles and the list. */
export async function preview(
  q: Query,
  w: Wizard,
  content: PlannerContent,
  rawAnswers: Answers,
  budgetKobo: number | null,
  profile: DietProfile | null,
) {
  const a = cleanAnswers(w, rawAnswers);
  const have = new Set((a.have as string[]) || []);
  if (w.meals) {
    const marketFor = async (meals: PlannedMeal[]) => {
      const market = new Map<string, Market>();
      for (const k of mealShopping(content, meals, have).totals.keys()) {
        const x = content.ingredients[k];
        const live = x && (await marketPrice(q, x));
        if (live) market.set(k, live);
      }
      return market;
    };
    let meals = planMeals(content, a, profile);
    let shopping = mealShopping(content, meals, have, await marketFor(meals));
    const changes: string[] = [];
    const full = shopping.total_kobo;
    if (budgetKobo && shopping.total_kobo > budgetKobo) {
      meals = planMeals(content, a, profile, true);
      shopping = mealShopping(content, meals, have, await marketFor(meals));
      changes.push('Swapped in cheaper dishes to fit your budget');
    }
    const plates = meals
      .filter((m) => !SWALLOWS.includes(m.recipe))
      .reduce((s, m) => s + m.servings, 0);
    return {
      answers: a,
      kind: 'meals' as const,
      total_kobo: shopping.total_kobo,
      full_kobo: full,
      budget_kobo: budgetKobo,
      fits: !budgetKobo || shopping.total_kobo <= budgetKobo,
      changes,
      dropped: [] as string[],
      item_count: shopping.lines.filter((l) => !l.have).length,
      market_count: shopping.lines.filter((l) => l.price_source === 'MARKET').length,
      servings: plates,
      per_serving_kobo: plates ? Math.round(shopping.total_kobo / plates) : 0,
      meals: meals.map((m) => ({
        ...m,
        name: content.recipes.find((r) => r.key === m.recipe)?.name ?? m.recipe,
      })),
      sections: [] as { section: string; count: number; total_kobo: number }[],
      have_options: [...shopping.lines]
        .sort((x, y) => x.name.localeCompare(y.name))
        .map((l) => ({ id: l.key, name: l.name, icon: l.icon, photo: l.photo, section: 'Pantry' })),
      lines: shopping.lines,
      fitted: [] as PricedLine[],
      owned: [] as PricedLine[],
    };
  }
  const all = await pricedItems(q, w, a);
  const owned = all.filter((l) => have.has(l.name));
  const fit = fitBudget(
    all.filter((l) => !have.has(l.name)),
    budgetKobo,
  );
  const fitted = fit.lines as PricedLine[];
  const sections = new Map<string, { section: string; count: number; total_kobo: number }>();
  for (const l of fitted) {
    const s = sections.get(l.section) ?? { section: l.section, count: 0, total_kobo: 0 };
    s.count++;
    s.total_kobo += l.budget_kobo;
    sections.set(l.section, s);
  }
  const people = peopleOf(w, a);
  return {
    answers: a,
    kind: 'items' as const,
    total_kobo: fit.total_kobo,
    full_kobo: fit.full_kobo,
    budget_kobo: budgetKobo,
    fits: fit.fits,
    changes: fit.changes,
    dropped: fit.dropped,
    item_count: fitted.length,
    market_count: fitted.filter((l) => l.price_source === 'MARKET').length,
    servings: 0,
    per_serving_kobo: people ? Math.round(fit.total_kobo / people) : 0,
    meals: [] as (PlannedMeal & { name: string })[],
    sections: [...sections.values()],
    have_options: all.map((l) => ({
      id: l.name,
      name: l.name,
      icon: l.icon,
      photo: l.photo,
      section: l.section,
    })),
    lines: fitted.map((l): Line => ({
      key: l.name,
      name: l.name,
      icon: l.icon,
      photo: l.photo,
      quantity: l.quantity,
      unit: l.unit,
      kobo: l.budget_kobo,
      have: false,
      section: l.section,
      price_source: l.price_source,
      sellers: l.sellers,
    })),
    fitted,
    owned,
  };
}

/** Sets each item's buy-by date from the plan's target date and the plan type's lead times. */
export async function scheduleItems(
  q: Query,
  plan: { id: string; template: string | null; target_date: any },
) {
  const w = plan.template ? wizardFor(plan.template) : undefined;
  const target = plan.target_date
    ? typeof plan.target_date === 'string'
      ? plan.target_date.slice(0, 10)
      : new Date(plan.target_date).toISOString().slice(0, 10)
    : null;
  const items = await q.query('SELECT id,section FROM plan_items WHERE plan_id=$1', [plan.id]);
  for (const i of items)
    await q.query('UPDATE plan_items SET buy_by=$1,reminded_at=NULL WHERE id=$2', [
      buyBy(w, i.section, target),
      i.id,
    ]);
}

/** Writes priced wizard lines into a plan. */
async function insertLines(q: Query, planId: string, lines: PricedLine[], status: string) {
  for (const l of lines)
    await q.query(
      "INSERT INTO plan_items(id,plan_id,section,name,category,keywords,quantity,unit,budget_kobo,priority,source,position,status,icon,photo_url,price_source,market_sellers) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'TEMPLATE',$11,$12,$13,$14,$15,$16)",
      [
        randomUUID(),
        planId,
        l.section,
        l.name,
        l.category,
        l.keywords,
        l.quantity,
        l.unit,
        l.budget_kobo,
        l.priority,
        l.position,
        status,
        l.icon,
        l.photo,
        l.price_source,
        l.sellers,
      ],
    );
}

/** Meal plan items: market prices, pictures and the pantry marked owned. */
async function finishMealItems(q: Query, planId: string, p: Awaited<ReturnType<typeof preview>>) {
  for (const l of p.lines)
    await q.query(
      'UPDATE plan_items SET budget_kobo=$1,price_source=$2,market_sellers=$3,icon=$4,photo_url=$5 WHERE plan_id=$6 AND ingredient_key=$7',
      [l.kobo, l.price_source, l.sellers, l.icon, l.photo, planId, l.key],
    );
  const have = (p.answers.have as string[]) || [];
  if (have.length)
    await q.query(
      "UPDATE plan_items SET status='OWNED' WHERE plan_id=$1 AND ingredient_key=ANY($2) AND status IN ('PLANNED','SAVED')",
      [planId, have],
    );
}

export function createPlannerWizardService(deps: AppDeps) {
  const { db } = deps;
  async function profileOf(q: Query, userId: string): Promise<DietProfile | null> {
    const [p] = await q.query(
      'SELECT allergies,intolerances,avoid,patterns FROM diet_profiles WHERE user_id=$1',
      [userId],
    );
    return (p as DietProfile) ?? null;
  }
  /** The step-by-step questions for a plan type, in the customer's language where translated. */
  async function getWizard(_user: any, input: RequestInput) {
    const key = String(input.params.template);
    const w = wizardFor(key);
    const t = (await plannerContent(db)).templates.find((x) => x.key === key);
    ensure(w && t, 404, 'NO_WIZARD', 'This plan type has no guided questions.');
    const lang = String(input.query.lang || 'en');
    return {
      template: { key: t.key, kind: t.kind, title: t.title, description: t.description },
      meals: !!w.meals,
      steps: translateSteps(w.steps, lang),
      defaults: cleanAnswers(w, {}),
    };
  }
  /** Live estimate while the customer answers: totals, budget fit and the "have" tiles. */
  async function previewPlan(user: any, input: RequestInput) {
    const d = wizardInput.parse(input.body);
    const w = wizardFor(d.template);
    ensure(w, 404, 'NO_WIZARD', 'This plan type has no guided questions.');
    const content = await plannerContent(db);
    const { fitted, owned, ...p } = await preview(
      db,
      w,
      content,
      d.answers,
      d.budget_kobo ?? null,
      await profileOf(db, user.id),
    );
    return p;
  }
  /**
   * Creates the plan from the answers: the fitted item list (things already owned are kept,
   * marked owned), or for a meal plan the meals, their grocery list and the pantry marked owned.
   */
  async function createFromWizard(
    q: Query,
    user: any,
    body: {
      template: string;
      answers?: Answers;
      budget_kobo?: number | null;
      title?: string;
      target_date?: string | null;
    },
  ) {
    const w = wizardFor(body.template)!;
    const content = await plannerContent(q);
    const t = content.templates.find((x) => x.key === body.template);
    ensure(t, 400, 'UNKNOWN_TEMPLATE', 'Choose one of the plan types.');
    const p = await preview(
      q,
      w,
      content,
      body.answers ?? {},
      body.budget_kobo ?? null,
      await profileOf(q, user.id),
    );
    const a = p.answers;
    const id = randomUUID();
    await q.query(
      'INSERT INTO plans(id,user_id,title,kind,template,budget_kobo,people,rooms,tier,target_date,answers) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',
      [
        id,
        user.id,
        body.title || t.title,
        t.kind,
        t.key,
        body.budget_kobo ?? null,
        peopleOf(w, a),
        roomsOf(w, a),
        tierOf(a),
        body.target_date ?? null,
        JSON.stringify(a),
      ],
    );
    if (w.meals) {
      for (const m of p.meals)
        await q.query(
          'INSERT INTO plan_meals(id,plan_id,recipe,day,meal,servings) VALUES($1,$2,$3,$4,$5,$6)',
          [randomUUID(), id, m.recipe, m.day, m.meal, m.servings],
        );
      await rebuildGroceryList(q, { id }, content);
      await finishMealItems(q, id, p);
    } else {
      await insertLines(q, id, p.fitted, 'PLANNED');
      await insertLines(q, id, p.owned, 'OWNED');
    }
    await scheduleItems(q, { id, template: t.key, target_date: body.target_date ?? null });
    return {
      id,
      total_kobo: p.total_kobo,
      full_kobo: p.full_kobo,
      budget_kobo: body.budget_kobo ?? null,
      fits: p.fits,
      changes: p.changes,
      item_count: p.item_count,
      market_count: p.market_count,
      meal_count: p.meals.filter((m) => !SWALLOWS.includes(m.recipe)).length,
    };
  }
  /**
   * Rebuilds a plan from changed answers. Anything the customer acted on stays: items bought,
   * linked to a product, assigned to someone or added by hand. Planned items from the old answers
   * are replaced.
   */
  async function rebuildFromAnswers(
    q: Query,
    user: any,
    plan: any,
    body: { answers: Answers; budget_kobo?: number | null; target_date?: string | null },
  ) {
    const w = wizardFor(plan.template);
    ensure(w, 409, 'NO_WIZARD', 'This plan wasn’t made with the guided questions.');
    const content = await plannerContent(q);
    const budget = body.budget_kobo === undefined ? plan.budget_kobo : body.budget_kobo;
    const target = body.target_date === undefined ? plan.target_date : body.target_date;
    const p = await preview(
      q,
      w,
      content,
      body.answers,
      budget == null ? null : Number(budget),
      await profileOf(q, user.id),
    );
    const a = p.answers;
    await q.query(
      'UPDATE plans SET answers=$1,budget_kobo=$2,target_date=$3,people=$4,rooms=$5,tier=$6,updated_at=now() WHERE id=$7',
      [JSON.stringify(a), budget, target, peopleOf(w, a), roomsOf(w, a), tierOf(a), plan.id],
    );
    if (w.meals) {
      await q.query('DELETE FROM plan_meals WHERE plan_id=$1', [plan.id]);
      for (const m of p.meals)
        await q.query(
          'INSERT INTO plan_meals(id,plan_id,recipe,day,meal,servings) VALUES($1,$2,$3,$4,$5,$6)',
          [randomUUID(), plan.id, m.recipe, m.day, m.meal, m.servings],
        );
      await q.query(
        "UPDATE plan_items SET status='PLANNED' WHERE plan_id=$1 AND source='RECIPE' AND status='OWNED' AND NOT (ingredient_key=ANY($2))",
        [plan.id, (a.have as string[]) || []],
      );
      await rebuildGroceryList(q, plan, content);
      await finishMealItems(q, plan.id, p);
    } else {
      await q.query(
        "DELETE FROM plan_items WHERE plan_id=$1 AND source='TEMPLATE' AND status IN ('PLANNED','OWNED') AND listing_id IS NULL AND assignee_id IS NULL",
        [plan.id],
      );
      const kept = new Set(
        (await q.query('SELECT name FROM plan_items WHERE plan_id=$1', [plan.id])).map(
          (r: any) => r.name,
        ),
      );
      await insertLines(
        q,
        plan.id,
        p.fitted.filter((l) => !kept.has(l.name)),
        'PLANNED',
      );
      await insertLines(
        q,
        plan.id,
        p.owned.filter((l) => !kept.has(l.name)),
        'OWNED',
      );
    }
    await scheduleItems(q, { id: plan.id, template: plan.template, target_date: target });
    return {
      id: plan.id,
      total_kobo: p.total_kobo,
      full_kobo: p.full_kobo,
      budget_kobo: budget == null ? null : Number(budget),
      fits: p.fits,
      changes: p.changes,
      item_count: p.item_count,
      market_count: p.market_count,
      meal_count: p.meals.filter((m) => !SWALLOWS.includes(m.recipe)).length,
    };
  }
  /** Replaces one meal with the next best dish for that slot, then refreshes the grocery list. */
  async function swapMeal(q: Query, user: any, plan: any, mealId: string) {
    const [m] = await q.query('SELECT * FROM plan_meals WHERE id=$1 AND plan_id=$2', [
      mealId,
      plan.id,
    ]);
    ensure(m, 404, 'MEAL_NOT_FOUND', 'That meal was not found.');
    const content = await plannerContent(q);
    const sameDay = await q.query('SELECT recipe FROM plan_meals WHERE plan_id=$1 AND day=$2', [
      plan.id,
      m.day,
    ]);
    const counts = await q.query(
      'SELECT recipe,COUNT(*)::int AS n FROM plan_meals WHERE plan_id=$1 GROUP BY recipe',
      [plan.id],
    );
    const usage = new Map(counts.map((c: any) => [c.recipe, c.n]));
    const pool = SWALLOWS.includes(m.recipe)
      ? content.recipes.filter((r) => SWALLOWS.includes(r.key))
      : mealCandidates(content, plan.answers || {}, await profileOf(q, user.id)).filter((r) =>
          r.meals.includes(m.meal),
        );
    const next = pool
      .filter((r) => r.key !== m.recipe && !sameDay.some((x: any) => x.recipe === r.key))
      .sort(
        (x, y) => (usage.get(x.key) || 0) - (usage.get(y.key) || 0) || x.key.localeCompare(y.key),
      )[0];
    ensure(next, 409, 'NO_ALTERNATIVE', 'There is no other dish that fits this meal.');
    await q.query('UPDATE plan_meals SET recipe=$1 WHERE id=$2', [next.key, m.id]);
    await rebuildGroceryList(q, plan, content);
    return { id: m.id, recipe: next.key, recipe_name: next.name };
  }
  return { getWizard, previewPlan, createFromWizard, rebuildFromAnswers, swapMeal };
}

// ---------- reminders (run by the worker) ----------
const RESTOCK = new Set(['groceries', 'household', 'meal-plan']);

/**
 * Hourly planner reminders:
 * - buy-by: items due within two days, one notification per plan;
 * - restock: grocery, household and meal plans whose period has run out;
 * - price drops: products linked to a plan that got at least 5% cheaper.
 */
export async function plannerReminders(db: Database) {
  await db.transaction(async (q) => {
    const due = await q.query(
      `SELECT i.id,i.name,i.buy_by,p.id AS plan_id,p.title,p.user_id FROM plan_items i JOIN plans p ON p.id=i.plan_id
       WHERE p.status='ACTIVE' AND i.buy_by IS NOT NULL AND i.reminded_at IS NULL AND i.status IN ('PLANNED','SAVED')
         AND i.buy_by<=current_date+2 ORDER BY p.id,i.buy_by LIMIT 500 FOR UPDATE OF i SKIP LOCKED`,
    );
    const byPlan = new Map<string, any[]>();
    for (const r of due) byPlan.set(r.plan_id, [...(byPlan.get(r.plan_id) || []), r]);
    for (const [, rows] of byPlan) {
      const first = rows[0];
      const names = rows.slice(0, 3).map((r: any) => r.name);
      const more = rows.length > 3 ? ` and ${rows.length - 3} more` : '';
      const date = new Date(first.buy_by).toISOString().slice(0, 10);
      await notify(
        q,
        first.user_id,
        'planner',
        `Time to buy for ${first.title}`,
        `${names.join(', ')}${more} should be bought by ${date}.`,
      );
      await q.query('UPDATE plan_items SET reminded_at=now() WHERE id=ANY($1)', [
        rows.map((r: any) => r.id),
      ]);
    }
    const plans = await q.query(
      `SELECT id,user_id,title,template,answers,created_at FROM plans
       WHERE status='ACTIVE' AND repeat_reminded_at IS NULL AND template=ANY($1) FOR UPDATE SKIP LOCKED`,
      [[...RESTOCK]],
    );
    for (const p of plans) {
      const w = wizardFor(p.template);
      const months = w && p.answers?.duration ? answerValue(w, p.answers, 'duration') : 0;
      const days = p.template === 'meal-plan' ? 7 : Math.max(7, Math.round((months || 1) * 30));
      if (Date.now() - new Date(p.created_at).getTime() < days * 86400000) continue;
      await notify(
        q,
        p.user_id,
        'planner',
        'Time to restock?',
        `Your “${p.title}” list should be running low. Open it and tap “Repeat this list”.`,
      );
      await q.query('UPDATE plans SET repeat_reminded_at=now() WHERE id=$1', [p.id]);
    }
    const drops = await q.query(
      `SELECT i.id,i.name,i.linked_price_kobo,v.price_kobo,p.user_id,p.title FROM plan_items i
       JOIN plans p ON p.id=i.plan_id JOIN listing_variants v ON v.id=i.variant_id
       JOIN listings l ON l.id=v.listing_id AND l.status='ACTIVE'
       WHERE p.status='ACTIVE' AND i.status IN ('PLANNED','SAVED') AND i.linked_price_kobo IS NOT NULL
         AND v.price_kobo<=i.linked_price_kobo*0.95 LIMIT 200 FOR UPDATE OF i SKIP LOCKED`,
    );
    for (const d of drops) {
      await notify(
        q,
        d.user_id,
        'planner',
        `Price drop: ${d.name}`,
        `Now ₦${Math.round(Number(d.price_kobo) / 100).toLocaleString('en-NG')} (was ₦${Math.round(Number(d.linked_price_kobo) / 100).toLocaleString('en-NG')}) for your “${d.title}” plan.`,
      );
      await q.query('UPDATE plan_items SET linked_price_kobo=$1 WHERE id=$2', [d.price_kobo, d.id]);
    }
  });
}
