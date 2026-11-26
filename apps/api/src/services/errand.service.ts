import { randomInt, randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { Query } from '../database/client.js';
import { ensure } from '../lib/errors.js';
import type { RequestInput } from '../lib/http.js';
import type { AppDeps } from '../types/deps.js';
import {
  allergenNames,
  dietPatterns,
  shoppingQuantity,
  type Allergen,
  type DietProfile,
  type Ingredient,
  type Recipe,
} from '../config/recipes.js';
import { event } from './booking.service.js';
import { verifiedSql } from './business-verification.service.js';
import { unitPrice } from './catalog.service.js';
import { notify } from './communications.service.js';
import { createDeliveriesService, fareFor, stopFare } from './deliveries.service.js';
import { plannerContent, type PlannerContent } from './planner-content.service.js';
import { bookableSql } from './retention.service.js';
import { ensureNotFrozen } from './risk.service.js';
import { haversineKm, ROAD_FACTOR } from './routing.service.js';

/**
 * "Buy it and bring it": the customer types what they want ("I want to make egusi for 6",
 * "2 crates of eggs and 5kg rice"), Ahia works out the shopping list from its recipe library,
 * finds sellers near the delivery address who can supply it (as few shops as possible, best
 * first), and each seller's basket is delivered at the time the customer picks. Sellers confirm
 * their basket; a rider delivery is booked for them automatically.
 */

/** Sellers further than this from the delivery address aren't used. */
const RADIUS_KM = 15;
/** Earliest delivery: time for sellers to confirm and a rider to collect. */
const MIN_LEAD_MINUTES = 90;
const SWALLOWS = ['eba-garri', 'semo-swallow'];
const SOUPS = ['egusi-soup', 'efo-riro', 'okra-soup', 'ogbono-soup'];
const GENERIC = new Set([
  'soup',
  'with',
  'and',
  'the',
  'sauce',
  'nigerian',
  'fresh',
  'swallow',
  'make',
  'cook',
  'want',
  'some',
  'for',
  'people',
]);

const tokens = (s: string) =>
  (s.toLowerCase().match(/[a-z]+/g) || []).filter((w) => w.length > 2 && !GENERIC.has(w));

export interface WantedItem {
  key: string;
  name: string;
  keywords: string;
  category: string | null;
  unit: string;
  amount: number;
  from: string;
  /** What the amount needed should roughly cost (recipe ingredients only), to spot oversized packs. */
  est_kobo?: number | null;
  /** Typed by the person and not a known ingredient ("phone charger"): every word must match. */
  free?: boolean;
}

/**
 * Reads a request into recipes and items. Recipes are matched by their distinctive words
 * ("egusi", "jollof", "akara"); quantities like "2 crates of eggs" or "5kg rice" become items;
 * servings come from "for 6" / "6 people" (default 4). Soups come with a swallow.
 */
export function readErrand(text: string, content: PlannerContent, servingsGiven?: number) {
  const t = text.toLowerCase();
  const serv =
    t.match(/\bfor\s+(\d{1,3})\b/) || t.match(/\b(\d{1,3})\s*(?:people|persons|pple|guests)\b/);
  const servings = Math.min(500, Math.max(1, servingsGiven ?? (serv ? Number(serv[1]) : 4)));
  const words = new Set(tokens(t));
  const recipes: Recipe[] = [];
  for (const r of content.recipes) {
    if (SWALLOWS.includes(r.key)) continue;
    const own = [
      ...new Set([
        ...tokens(r.name),
        ...r.key.split('-').filter((w) => w.length > 2 && !GENERIC.has(w)),
      ]),
    ];
    // A recipe matches when its most distinctive word is there ("egusi", "jollof", "moi").
    const hits = own.filter((w) => words.has(w));
    if (
      hits.length &&
      hits.some(
        (w) => !['rice', 'beans', 'yam', 'plantain', 'egg', 'eggs', 'chicken', 'beef'].includes(w),
      )
    )
      recipes.push(r);
  }
  const wanted = new Map<string, WantedItem>();
  const add = (key: string, x: Ingredient, amount: number, from: string) => {
    const prev = wanted.get(key);
    wanted.set(key, {
      key,
      name: x.name,
      keywords: x.keywords,
      category: x.category,
      unit: x.unit,
      amount: (prev?.amount ?? 0) + amount,
      from: prev ? `${prev.from}, ${from}` : from,
    });
  };
  for (const r of recipes) {
    for (const [k, per] of Object.entries(r.per_serving)) {
      const x = content.ingredients[k];
      if (x) add(k, x, per * servings, r.name);
    }
    if (SOUPS.includes(r.key)) {
      const eba = content.recipes.find((x) => x.key === 'eba-garri');
      for (const [k, per] of Object.entries(eba?.per_serving || {})) {
        const x = content.ingredients[k];
        if (x) add(k, x, per * servings, 'Eba (swallow)');
      }
    }
  }
  // Explicit items: "2 crates of eggs", "5kg rice", "tomatoes".
  const covered = new Set(recipes.flatMap((r) => [...tokens(r.name), ...r.key.split('-')]));
  for (const part of t.split(/,|\band\b|\bplus\b|\n|;/)) {
    const m = part.match(
      /(\d+(?:\.\d+)?)\s*(kg|kilos?|crates?|bags?|pieces?|tubers?|bunch(?:es)?|litres?|packs?|cartons?|tins?|bottles?|baskets?)?\s*(?:of\s+)?([a-z][a-z\s]+)/,
    );
    const name = (m ? m[3] : part)
      .replace(/\b(i|want|to|make|cook|buy|get|me|please|some|for|people|persons)\b/g, ' ')
      .trim();
    const ws = tokens(name);
    if (!ws.length || ws.every((w) => covered.has(w))) continue;
    // Known ingredient? Use its details; otherwise search by the words given.
    // A known ingredient only when every word typed fits it: "milk" is milk, but "groundnut
    // oil" is neither groundnuts nor vegetable oil.
    const typed = ws.filter((w) => !DESCRIPTORS.has(w));
    const known = Object.entries(content.ingredients).find(([k, x]) => {
      const own = new Set([...k.split('_'), ...x.keywords.split(' '), ...tokens(x.name)]);
      return typed.length > 0 && typed.every((w) => own.has(w) || own.has(w.replace(/s$/, '')));
    });
    const amount = m ? Number(m[1]) : 1;
    const unit = m?.[2]?.replace(/(ch|x)es$/, '$1').replace(/s$/, '') ?? known?.[1].unit ?? 'piece';
    if (known) {
      const [k, x] = known;
      wanted.set(`item-${k}`, {
        key: `item-${k}`,
        name: x.name,
        keywords: x.keywords,
        category: x.category,
        unit,
        amount,
        from: 'You asked',
      });
    } else {
      const label = name.replace(/\s+/g, ' ');
      wanted.set(`item-${ws.join('-')}`, {
        key: `item-${ws.join('-')}`,
        name: label.charAt(0).toUpperCase() + label.slice(1),
        keywords: ws.join(' '),
        category: null,
        unit,
        amount,
        from: 'You asked',
        free: true,
      });
    }
  }
  // Round to amounts people buy, and note what that should roughly cost.
  for (const w of wanted.values()) {
    const x = content.ingredients[w.key];
    if (x) {
      w.amount = shoppingQuantity(w.key, w.amount, content.ingredients);
      w.est_kobo = Math.round(w.amount * x.price * 100);
    }
  }
  return {
    servings,
    recipes: recipes.map((r) => ({ key: r.key, name: r.name })),
    items: [...wanted.values()],
  };
}

const singular = (u: string) =>
  u
    .toLowerCase()
    .replace(/(ch|x)es$/, '$1')
    .replace(/s$/, '');
const sameUnit = (a: string, b: string) => singular(a) === singular(b);
/** Units a market seller weighs or measures out, so a part of one can be bought. */
const isLoose = (u: string) => ['kg', 'kilo', 'litre', 'liter'].includes(singular(u));
/** Words that describe a thing rather than name it ("size 3 diapers", "big pack"). */
const DESCRIPTORS = new Set([
  'size',
  'pack',
  'packs',
  'big',
  'small',
  'large',
  'medium',
  'new',
  'original',
  'quality',
  'brand',
  'good',
  'nice',
  'cheap',
  'piece',
  'pieces',
  'tin',
  'tins',
  'bottle',
  'bottles',
]);
/** Words many unrelated products share; never enough on their own to call it a match. */
const WEAK = new Set([
  'pepper',
  'oil',
  'fish',
  'spice',
  'meat',
  'leaves',
  'leaf',
  'seeds',
  'seed',
  'soup',
  'dried',
  'cow',
  'skin',
  'ground',
  'powder',
  'fresh',
  'cubes',
]);

/** Candidate products for one item near the address, best first. */
async function candidates(q: Query, item: WantedItem, lat: number, lng: number, buyerId: string) {
  const all = item.keywords
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w.length > 2)
    .slice(0, 5);
  if (!all.length) return [];
  // Shared words ("pepper", "oil", "fish") alone would match pepper soup spice for scotch
  // bonnet, or vegetable oil for palm oil. Match on the item's own words; when it has none
  // ("pepper soup spice"), every word must be in the product name.
  const strong = all.filter((w) => !WEAK.has(w));
  // whole=true: a whole word only ("wipes" never matches "wiper"); otherwise a word start.
  const search = (ws: string[], need: number, whole = false): Promise<any[]> =>
    q.query(
      `SELECT * FROM (SELECT l.id,l.title,v.unit,l.category,l.image_url,l.seller_id,v.id AS variant_id,v.name AS variant_name,v.is_primary,v.price_kobo,v.stock,v.min_quantity,v.wholesale_tiers,
       s.business_name,s.area,COALESCE(s.latitude,s.public_latitude) AS lat,COALESCE(s.longitude,s.public_longitude) AS lng,s.fulfilment_pct,
       ${verifiedSql('s')} AS verified,
       (SELECT AVG(r.score)::float8 FROM ratings r WHERE r.seller_id=s.user_id) AS rating,
       (SELECT COUNT(*)::int FROM unnest($1::text[]) x WHERE l.title ~* ('\\m'||x||$4)) AS hits
     FROM listings l JOIN sellers s ON s.user_id=l.seller_id JOIN users u ON u.id=s.user_id
     JOIN listing_variants v ON v.listing_id=l.id AND v.active
     WHERE l.status='ACTIVE' AND s.status='APPROVED' AND u.status='ACTIVE' AND u.frozen_at IS NULL
       AND l.delivery_available AND l.seller_id<>$2 AND s.latitude IS NOT NULL AND ${bookableSql('l')}
       AND EXISTS(SELECT 1 FROM unnest($1::text[]) x WHERE l.title ~* ('\\m'||x||$4))) m
     WHERE m.hits >= $3
     LIMIT 200`,
      [ws, buyerId, need, whole ? '(s|es)?\\M' : ''],
    );
  let rows: any[];
  let similar = false;
  if (item.free) {
    // Typed by the person ("phone charger"): every word that names the thing must match, so a
    // phone isn't offered for a charger. Nothing? The closest by its last word, marked similar.
    const required = [
      ...new Set(
        all.filter((w) => !DESCRIPTORS.has(w)).map((w) => (w.length > 4 ? w.replace(/s$/, '') : w)),
      ),
    ];
    const ws = required.length ? required : all;
    rows = await search(ws, ws.length);
    if (!rows.length && ws.length > 1) {
      rows = await search([ws[ws.length - 1]], 1, true);
      similar = rows.length > 0;
    }
  } else {
    // Shared words ("pepper", "oil", "fish") alone would match pepper soup spice for scotch
    // bonnet, or vegetable oil for palm oil. Match on the item's own words; when it has none
    // ("pepper soup spice"), every word must be in the product name.
    const ws = strong.length ? strong : all;
    rows = await search(ws, strong.length ? 1 : all.length);
  }
  const picked = rows
    .map((r: any) => {
      const km = haversineKm(lat, lng, r.lat, r.lng);
      const quantity = Math.max(
        r.min_quantity,
        sameUnit(r.unit, item.unit) ? Math.ceil(item.amount - 1e-9) : 1,
      );
      // Loose goods sold by the kg or litre: buy the portion needed (a cup of crayfish),
      // not a whole kilo, like at the market.
      const portion =
        quantity === 1 && sameUnit(r.unit, item.unit) && isLoose(r.unit) && item.amount < 1
          ? Math.round(item.amount * 100) / 100
          : null;
      const score =
        r.hits * 3 +
        (item.category && r.category === item.category ? 2 : 0) +
        (r.verified ? 2 : 0) +
        (r.rating ? Number(r.rating) - 3 : 0) +
        (r.fulfilment_pct != null ? (r.fulfilment_pct - 70) / 15 : 0) -
        km / 3;
      const unit_price = unitPrice(r, quantity);
      // A pack far bigger than needed (a 50 kg bag for 3 onions) drops down the list.
      const cost = portion ? Math.round(unit_price * portion) : unit_price * quantity;
      const ratio = item.est_kobo ? cost / item.est_kobo : 1;
      const sized = ratio > 4 ? -8 - Math.min(6, ratio / 10) : 0;
      return {
        ...r,
        similar,
        km,
        quantity,
        portion,
        score: score + sized,
        unit_price,
        oversized: ratio > 4,
      };
    })
    .filter((r: any) => r.km <= RADIUS_KM && r.stock >= r.quantity)
    .reduce((best: Map<string, any>, r: any) => {
      // Each product once, in its best size: the option in the unit needed (a single cube,
      // a bunch, by the kg) before others, then the cheapest for this amount.
      const cost = (x: any) =>
        x.portion ? Math.round(x.unit_price * x.portion) : x.unit_price * x.quantity;
      const fit = (x: any) => (sameUnit(x.unit, item.unit) ? 0 : 1);
      const prev = best.get(r.id);
      if (!prev || fit(r) < fit(prev) || (fit(r) === fit(prev) && cost(r) < cost(prev)))
        best.set(r.id, r);
      return best;
    }, new Map<string, any>());
  return [...picked.values()].sort((a: any, b: any) => b.score - a.score).slice(0, 6);
}

/**
 * Checks one shopping item against the person's diet profile and anything they said to leave
 * out. AVOID: contains a recorded allergen, an avoided food or something their diet rules out
 * (left out of the basket). CAUTION: may contain an allergen, or an intolerance (kept, flagged).
 * A planning aid only: brands differ, so it never claims an item is safe.
 */
export function dietFlag(
  item: WantedItem,
  x: Ingredient | undefined,
  profile: DietProfile | null,
  avoid: string[],
): { status: 'AVOID' | 'CAUTION'; reason: string } | null {
  const label = (a: string) => allergenNames[a as Allergen] || a;
  const text = `${item.name} ${item.keywords}`.toLowerCase();
  const words = [...avoid, ...(profile?.avoid ?? [])].map((w) => w.trim().toLowerCase());
  const hit = words.find((w) => w.length > 2 && text.includes(w));
  if (hit) return { status: 'AVOID', reason: `You said no ${hit}` };
  if (!x || !profile) return null;
  for (const a of profile.allergies)
    if (x.allergens?.includes(a as Allergen))
      return { status: 'AVOID', reason: `Contains ${label(a)} (your allergy)` };
  for (const p of profile.patterns)
    for (const tag of dietPatterns[p]?.excludes || [])
      if (x.tags?.includes(tag))
        return { status: 'AVOID', reason: `Not ${dietPatterns[p].label.toLowerCase()}` };
  for (const a of profile.allergies)
    if (x.may?.includes(a as Allergen))
      return { status: 'CAUTION', reason: `May contain ${label(a)}: check the brand` };
  for (const a of profile.intolerances)
    if (x.allergens?.includes(a as Allergen) || x.may?.includes(a as Allergen))
      return { status: 'CAUTION', reason: `Contains or may contain ${label(a)} (intolerance)` };
  return null;
}

export interface BasketOptions {
  servings?: number;
  /** Most the person wants to spend, goods and delivery together. */
  budgetKobo?: number;
  /** Foods to leave out ("pepper", "crayfish"), on top of their saved diet profile. */
  avoid?: string[];
  profile?: DietProfile | null;
}

/**
 * The basket: for each item the best product near the address, choosing sellers so the whole
 * list comes from as few shops as possible (one rider per shop), better shops first. Items the
 * person can't eat are left out. With a budget, cheaper products (preferably from shops already
 * in the basket) replace pricier ones until it fits, and if it still doesn't, the reply says
 * how many people it would feed within the budget.
 */
export async function buildBasket(
  q: Query,
  buyerId: string,
  text: string,
  lat: number,
  lng: number,
  opts: BasketOptions = {},
) {
  const content = await plannerContent(q);
  const read = readErrand(text, content, opts.servings);
  const ingredientOf = (key: string) => content.ingredients[key.replace(/^item-/, '')];
  const diet = new Map(
    read.items.map((i) => [
      i.key,
      dietFlag(i, ingredientOf(i.key), opts.profile ?? null, opts.avoid ?? []),
    ]),
  );
  const options = new Map<string, any[]>();
  for (const item of read.items)
    options.set(
      item.key,
      diet.get(item.key)?.status === 'AVOID' ? [] : await candidates(q, item, lat, lng, buyerId),
    );
  // Greedy set cover: the shop that covers most remaining items (ties: better shop) goes first.
  const remaining = new Set(read.items.filter((i) => options.get(i.key)!.length).map((i) => i.key));
  const pick = new Map<string, any>();
  while (remaining.size) {
    const bySeller = new Map<string, { n: number; score: number }>();
    for (const key of remaining)
      for (const c of options.get(key)!) {
        const x = bySeller.get(c.seller_id) ?? { n: 0, score: 0 };
        x.n++;
        x.score += c.score;
        bySeller.set(c.seller_id, x);
      }
    const [seller] = [...bySeller.entries()].sort(
      (a, b) => b[1].n - a[1].n || b[1].score - a[1].score,
    )[0];
    for (const key of [...remaining]) {
      const c = options.get(key)!.find((o) => o.seller_id === seller);
      if (c) {
        pick.set(key, c);
        remaining.delete(key);
      }
    }
  }
  const [vehicle] = await q.query("SELECT * FROM vehicle_types WHERE code='motorcycle' AND active");
  const fare = (c: any) => (vehicle ? fareFor(vehicle as any, c.km * ROAD_FACTOR) : 0);
  const line = (c: any) =>
    c.portion ? Math.round(c.unit_price * c.portion) : c.unit_price * c.quantity;
  // One rider for the whole errand: the dearest trip at its normal fare, every other shop as an
  // extra stop (stop fee + distance from the nearest shop already on the trip).
  const tripFares = (p: Map<string, any> = pick) => {
    const shops = new Map<string, any>();
    for (const c of p.values()) shops.set(c.seller_id, c);
    const order = [...shops.values()].sort((a, b) => fare(b) - fare(a));
    const out = new Map<string, number>();
    order.forEach((c, n) => {
      if (!n || !vehicle) return out.set(c.seller_id, fare(c));
      const near = Math.min(
        ...order.slice(0, n).map((o) => haversineKm(o.lat, o.lng, c.lat, c.lng) * ROAD_FACTOR),
      );
      out.set(c.seller_id, stopFare(vehicle as any, near, fare(c)));
    });
    return out;
  };
  const totalOf = (p: Map<string, any> = pick) => {
    let goods = 0;
    for (const c of p.values()) goods += line(c);
    return goods + [...tripFares(p).values()].reduce((s, f) => s + f, 0);
  };
  const budget = opts.budgetKobo ?? null;
  let swapped = 0;
  // Cheapest sensible basket, counting each shop's rider trip:
  //  - a cheaper product from a shop already in the basket (a bottle of palm oil vs a cup),
  //  - moving a shop's few items to shops already coming, to save its whole trip,
  //  - and, only when over the budget, a cheaper shop not yet in the basket.
  const improve = (allowNewShops: boolean) => {
    for (let round = 0; round < 40; round++) {
      const now = totalOf();
      const inBasket = new Set([...pick.values()].map((c) => c.seller_id));
      let best: Map<string, any> | null = null;
      let bestTotal = now;
      const consider = (trial: Map<string, any>) => {
        const t = totalOf(trial);
        if (t < bestTotal) {
          best = trial;
          bestTotal = t;
        }
      };
      for (const [key, current] of pick)
        for (const o of options.get(key)!) {
          if (o.id === current.id || (!allowNewShops && !inBasket.has(o.seller_id))) continue;
          consider(new Map(pick).set(key, o));
        }
      for (const shop of inBasket) {
        const trial = new Map(pick);
        let ok = true;
        for (const [key, c] of pick) {
          if (c.seller_id !== shop) continue;
          const alt = options
            .get(key)!
            .filter((o) => o.seller_id !== shop && inBasket.has(o.seller_id))
            .sort((x, y) => line(x) - line(y))[0];
          if (!alt) ok = false;
          else trial.set(key, alt);
        }
        if (ok) consider(trial);
      }
      if (!best) break;
      for (const [key, c] of best as Map<string, any>) {
        if (allowNewShops && pick.get(key)?.id !== c.id) swapped++;
        pick.set(key, c);
      }
    }
  };
  improve(false);
  if (budget && totalOf() > budget) improve(true);
  const sellers = new Map<string, any>();
  const trip = tripFares();
  const items = read.items.map((i) => {
    const c = pick.get(i.key);
    if (c) {
      const s = sellers.get(c.seller_id) ?? {
        seller_id: c.seller_id,
        business_name: c.business_name,
        area: c.area,
        verified: !!c.verified,
        rating: c.rating ? Math.round(Number(c.rating) * 10) / 10 : null,
        distance_km: Math.round(c.km * 10) / 10,
        subtotal_kobo: 0,
        delivery_kobo: trip.get(c.seller_id) ?? fare(c),
      };
      s.subtotal_kobo += line(c);
      sellers.set(c.seller_id, s);
    }
    const flag = diet.get(i.key) ?? null;
    return {
      key: i.key,
      name: i.name,
      from: i.from,
      needed_quantity: Math.round(i.amount * 100) / 100,
      needed_unit: i.unit,
      listing: c
        ? {
            id: c.id,
            variant_id: c.variant_id as string,
            title:
              c.variant_name && c.variant_name !== 'Standard' && !c.is_primary
                ? `${c.title} · ${c.variant_name}`
                : c.title,
            unit: c.unit,
            price_kobo: c.unit_price,
            image_url: c.image_url,
            seller_id: c.seller_id,
            business_name: c.business_name,
          }
        : null,
      quantity: c?.quantity ?? 0,
      /** Part of one unit (0.1 = 100 g of a per-kg product), or null for whole units. */
      portion: (c?.portion ?? null) as number | null,
      line_kobo: c ? line(c) : 0,
      alternatives: Math.max(0, (options.get(i.key)?.length ?? 0) - 1),
      unit_differs: c ? !sameUnit(c.unit, i.unit) : false,
      oversized: !!c?.oversized,
      /** Not exactly what was asked for, but the closest product nearby: check it. */
      similar: !!c?.similar,
      extra_trip_kobo: null as number | null,
      diet: flag,
    };
  });
  // A shop supplying just one cheap item adds a whole rider trip: suggest leaving it out.
  if (sellers.size > 2)
    for (const [id, shop] of sellers) {
      const mine = items.filter((i) => i.listing?.seller_id === id);
      if (mine.length === 1 && mine[0].line_kobo < 300000 && shop.delivery_kobo > mine[0].line_kobo)
        mine[0].extra_trip_kobo = shop.delivery_kobo;
    }
  const goods = items.reduce((s, i) => s + i.line_kobo, 0);
  const delivery = [...sellers.values()].reduce((s, x) => s + x.delivery_kobo, 0);
  const total = goods + delivery;
  return {
    text,
    servings: read.servings,
    recipes: read.recipes,
    items,
    sellers: [...sellers.values()],
    missing: items.filter((i) => !i.listing && i.diet?.status !== 'AVOID').map((i) => i.name),
    goods_kobo: goods,
    delivery_kobo: delivery,
    total_kobo: total,
    budget: budget
      ? {
          budget_kobo: budget,
          over_by_kobo: Math.max(0, total - budget),
          cheaper_swaps: swapped,
          // Recipe quantities scale with people; delivery doesn't.
          fits_servings:
            total > budget && read.recipes.length && goods > 0
              ? Math.max(0, Math.floor((read.servings * (budget - delivery)) / goods))
              : null,
        }
      : null,
  };
}

/**
 * After a seller accepts their errand basket: book the rider delivery for the chosen time
 * (pay on delivery, so the customer pays when it arrives). If that isn't possible, the customer
 * is told to arrange delivery from the order.
 */
/**
 * A second (third…) shop of the same errand rides along on the first shop's delivery: one rider,
 * priced as an extra stop. Only pay-on-delivery fares are re-priced (nothing was charged yet).
 */
async function joinErrandTrip(q: Query, b: any) {
  const [mine] = await q.query(
    "SELECT * FROM deliveries WHERE booking_id=$1 AND status='OPEN' FOR UPDATE",
    [b.id],
  );
  if (!mine || !mine.pay_on_delivery || mine.fare_paid) return;
  const [lead] = await q.query(
    `SELECT d.* FROM deliveries d JOIN bookings ob ON ob.id=d.booking_id
     WHERE ob.errand_id=$1 AND d.id<>$2 AND d.trip_lead_id IS NULL AND d.status IN ('OPEN','ASSIGNED')
       AND d.vehicle_type=$3
     ORDER BY d.created_at LIMIT 1 FOR UPDATE`,
    [b.errand_id, mine.id, mine.vehicle_type],
  );
  if (!lead) return;
  const [v] = await q.query('SELECT * FROM vehicle_types WHERE code=$1', [mine.vehicle_type]);
  const km =
    haversineKm(
      lead.pickup_latitude,
      lead.pickup_longitude,
      mine.pickup_latitude,
      mine.pickup_longitude,
    ) * ROAD_FACTOR;
  const fare = stopFare(v as any, km, Number(mine.fare_kobo));
  await q.query('UPDATE deliveries SET trip_lead_id=$1,fare_kobo=$2 WHERE id=$3', [
    lead.id,
    fare,
    mine.id,
  ]);
  if (lead.status === 'ASSIGNED') {
    await q.query(
      "UPDATE deliveries SET status='ASSIGNED',driver_id=$1,assigned_at=now() WHERE id=$2",
      [lead.driver_id, mine.id],
    );
    await notify(
      q,
      lead.driver_id,
      'delivery',
      'Extra pickup on your trip',
      `${b.title}: one more shop for the same customer, on the same trip (+₦${Math.round(fare / 100).toLocaleString()}).`,
      { booking: b.id, link: 'drive' },
    );
  }
}

export async function scheduleErrandDelivery(deps: AppDeps, q: Query, b: any) {
  const [e] = await q.query('SELECT * FROM errands WHERE id=$1', [b.errand_id]);
  if (!e) return;
  const deliveries = createDeliveriesService(deps);
  await q.query('SAVEPOINT errand_delivery');
  try {
    await deliveries.requestDelivery(
      q,
      { id: e.buyer_id },
      {
        params: { id: b.id },
        body: {
          vehicle_type: 'motorcycle',
          dropoff: { latitude: e.dropoff_latitude, longitude: e.dropoff_longitude },
          dropoff_address: e.dropoff_address,
          pay_on_delivery: !b.paid,
          expected_fare_kobo: 1,
        },
        query: {},
      } as unknown as RequestInput,
      { acceptFare: true },
    );
    await joinErrandTrip(q, b);
    // Riders can take the job from 15 minutes before this; aim to arrive on time.
    await q.query(
      "UPDATE deliveries SET scheduled_at=GREATEST(now(),$1::timestamptz-interval '40 minutes') WHERE booking_id=$2 AND status='OPEN'",
      [e.deliver_at, b.id],
    );
    await q.query('RELEASE SAVEPOINT errand_delivery');
  } catch (err: any) {
    await q.query('ROLLBACK TO SAVEPOINT errand_delivery');
    await notify(
      q,
      e.buyer_id,
      'delivery',
      'Arrange delivery for your basket',
      `The seller confirmed, but we couldn’t book a rider automatically (${err?.message ?? 'unknown reason'}). Open the order to arrange delivery.`,
      b.id,
    );
  }
}

export function createErrandService(deps: AppDeps) {
  const { db } = deps;
  const placeInput = z.object({
    text: z.string().trim().min(2).max(300),
    servings: z.number().int().min(1).max(500).optional(),
    dropoff: z.object({
      latitude: z.number().min(-90).max(90),
      longitude: z.number().min(-180).max(180),
    }),
    dropoff_address: z.string().trim().min(8).max(500),
    deliver_at: z.iso.datetime({ offset: true }),
    note: z.string().trim().max(300).optional(),
    items: z
      .array(
        z.object({
          listing_id: z.uuid(),
          /** The size option chosen (a single cube); the main option when left out. */
          variant_id: z.uuid().optional(),
          quantity: z.number().int().min(1).max(10000),
          /** Buy part of one kg/litre (0.1 = 100 g); quantity must then be 1. */
          portion: z.number().min(0.05).max(0.99).optional(),
          needed: z.string().max(80).optional(),
        }),
      )
      .min(1)
      .max(40),
  });

  /** Read the request and propose a basket from nearby sellers. */
  async function planErrand(user: any, input: RequestInput) {
    const d = z
      .object({
        text: z.string().trim().min(2).max(300),
        servings: z.number().int().min(1).max(500).optional(),
        latitude: z.number().min(-90).max(90),
        longitude: z.number().min(-180).max(180),
        budget_kobo: z.number().int().min(10000).max(10000000000).optional(),
        avoid: z.array(z.string().trim().min(2).max(40)).max(15).optional(),
      })
      .parse(input.body);
    const [profile] = await db.query(
      'SELECT allergies,intolerances,avoid,patterns FROM diet_profiles WHERE user_id=$1',
      [user.id],
    );
    return await buildBasket(db, user.id, d.text, d.latitude, d.longitude, {
      servings: d.servings,
      budgetKobo: d.budget_kobo,
      avoid: d.avoid,
      profile: (profile as DietProfile) ?? null,
    });
  }
  /** Ideas to start from (the recipe library). */
  async function errandIdeas(_user: any, _input: RequestInput) {
    const content = await plannerContent(db);
    return content.recipes
      .filter((r) => !SWALLOWS.includes(r.key))
      .map((r) => ({
        key: r.key,
        name: r.name,
        prompt: `I want to make ${r.name.toLowerCase()} for 4`,
      }));
  }
  /** Place the errand: one basket order per seller, each delivered at the chosen time. */
  async function placeErrand(q: Query, user: any, input: RequestInput) {
    const d = placeInput.parse(input.body);
    await ensureNotFrozen(q, user.id);
    const at = new Date(d.deliver_at).getTime();
    ensure(
      at >= Date.now() + MIN_LEAD_MINUTES * 60000 && at <= Date.now() + 7 * 86400000,
      400,
      'INVALID_TIME',
      'Choose a delivery time at least 90 minutes from now and within the next 7 days.',
    );
    const [settings] = await q.query('SELECT commission_bps,monetisation FROM settings WHERE id=1');
    const lines: any[] = [];
    for (const item of d.items) {
      const [l] = await q.query(
        `SELECT l.*,v.id AS variant_id,v.name AS variant_name,v.is_primary,v.unit AS v_unit,v.price_kobo AS v_price,v.wholesale_tiers,v.stock AS v_stock,v.min_quantity,
           (SELECT commission_bps FROM catalogue_categories WHERE name=l.category) AS category_bps
         FROM listings l JOIN sellers s ON s.user_id=l.seller_id JOIN listing_variants v ON v.listing_id=l.id AND v.active
           AND (CASE WHEN $2::text IS NULL THEN v.is_primary ELSE v.id=$2 END)
         WHERE l.id=$1 AND l.status='ACTIVE' AND s.status='APPROVED' AND l.delivery_available AND ${bookableSql('l')}`,
        [item.listing_id, item.variant_id ?? null],
      );
      ensure(
        l,
        409,
        'UNAVAILABLE',
        'One of the products is no longer available. Build the basket again.',
      );
      ensure(l.seller_id !== user.id, 400, 'OWN_LISTING', 'You can’t order your own product.');
      // The chosen size option's unit and name ("Seasoning cubes · 1 cube").
      l.unit = l.v_unit;
      if (!l.is_primary && l.variant_name) l.title = `${l.title} · ${l.variant_name}`.slice(0, 120);
      ensure(
        l.v_stock >= item.quantity && item.quantity >= l.min_quantity,
        409,
        'OUT_OF_STOCK',
        `${l.title}: not enough stock.`,
      );
      const price = unitPrice(
        { price_kobo: l.v_price, wholesale_tiers: l.wholesale_tiers || [] },
        item.quantity,
      );
      if (item.portion) {
        ensure(
          item.quantity === 1 && isLoose(l.unit),
          400,
          'PORTION_NOT_ALLOWED',
          `${l.title} is sold per ${l.unit}, so it can’t be bought as a part.`,
        );
        // One unit is set aside; the line costs the portion. The seller weighs it out.
        lines.push({
          ...item,
          l: { ...l, unit: `${Math.round(item.portion * 100) / 100} ${l.unit}` },
          price: Math.max(100, Math.round(price * item.portion)),
          bps:
            settings.monetisation?.transaction_commission === false
              ? 0
              : Number(l.category_bps ?? settings.commission_bps),
        });
        continue;
      }
      const bps =
        settings.monetisation?.transaction_commission === false
          ? 0
          : Number(l.category_bps ?? settings.commission_bps);
      lines.push({ ...item, l, price, bps });
    }
    const errandId = randomUUID();
    await q.query(
      `INSERT INTO errands(id,buyer_id,text,servings,dropoff_latitude,dropoff_longitude,dropoff_address,deliver_at,note)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [
        errandId,
        user.id,
        d.text,
        d.servings ?? null,
        d.dropoff.latitude,
        d.dropoff.longitude,
        d.dropoff_address,
        d.deliver_at,
        d.note ?? null,
      ],
    );
    const bySeller = new Map<string, any[]>();
    for (const x of lines) bySeller.set(x.l.seller_id, [...(bySeller.get(x.l.seller_id) || []), x]);
    const when = new Date(d.deliver_at).toLocaleString('en-NG', {
      timeZone: 'Africa/Lagos',
      weekday: 'short',
      hour: 'numeric',
      minute: '2-digit',
    });
    const orders = [];
    for (const [sellerId, group] of bySeller) {
      const total = group.reduce((s, x) => s + x.price * x.quantity, 0);
      ensure(total <= 100000000, 400, 'ORDER_LIMIT', 'A seller’s basket can’t exceed ₦1,000,000.');
      const commission = group.reduce(
        (s, x) => s + Math.round((x.price * x.quantity * x.bps) / 10000),
        0,
      );
      const first = group[0];
      const id = randomUUID();
      const title = `Basket: ${group
        .map((x: any) => x.l.title)
        .slice(0, 3)
        .join(', ')}${group.length > 3 ? ` +${group.length - 3} more` : ''}`.slice(0, 120);
      const [b] = await q.query(
        `INSERT INTO bookings(id,buyer_id,seller_id,listing_id,title,unit,quantity,price_kobo,total_kobo,commission_bps,commission_kobo,pickup_code,errand_id,variant_id,variant_name,delivery_available)
         VALUES($1,$2,$3,$4,$5,'basket',1,$6,$6,$7,$8,$9,$10,$11,'Basket',TRUE) RETURNING *`,
        [
          id,
          user.id,
          sellerId,
          first.l.id,
          title,
          total,
          total ? Math.round((commission * 10000) / total) : 0,
          commission,
          String(randomInt(100000, 1000000)),
          errandId,
          first.l.variant_id,
        ],
      );
      for (const x of group)
        await q.query(
          'INSERT INTO booking_lines(id,booking_id,listing_id,variant_id,title,unit,quantity,price_kobo,needed) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',
          [
            randomUUID(),
            id,
            x.l.id,
            x.l.variant_id,
            x.l.title,
            x.l.unit,
            x.quantity,
            x.price,
            x.needed ?? null,
          ],
        );
      await event(
        q,
        { ...b, status: null },
        'REQUESTED',
        user.id,
        `Basket of ${group.length} item${group.length === 1 ? '' : 's'} for delivery ${when} to ${d.dropoff_address}. Confirm and a rider will collect.`,
      );
      orders.push({ booking_id: id, seller_id: sellerId, items: group.length, total_kobo: total });
    }
    return { errand_id: errandId, deliver_at: d.deliver_at, orders };
  }
  return { planErrand, errandIdeas, placeErrand };
}
