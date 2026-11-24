import { randomInt, randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { Query } from '../database/client.js';
import { ensure } from '../lib/errors.js';
import type { RequestInput } from '../lib/http.js';
import type { AppDeps } from '../types/deps.js';
import { shoppingQuantity, type Ingredient, type Recipe } from '../config/recipes.js';
import { event } from './booking.service.js';
import { verifiedSql } from './business-verification.service.js';
import { unitPrice } from './catalog.service.js';
import { notify } from './communications.service.js';
import { createDeliveriesService, fareFor } from './deliveries.service.js';
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
    const known = Object.entries(content.ingredients).find(([k, x]) =>
      ws.some((w) => k.includes(w) || x.keywords.split(' ').includes(w)),
    );
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

/** Candidate products for one item near the address, best first. */
async function candidates(q: Query, item: WantedItem, lat: number, lng: number, buyerId: string) {
  const ws = item.keywords
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w.length > 2)
    .slice(0, 5);
  if (!ws.length) return [];
  const rows = await q.query(
    `SELECT l.id,l.title,l.unit,l.category,l.image_url,l.seller_id,v.id AS variant_id,v.price_kobo,v.stock,v.min_quantity,v.wholesale_tiers,
       s.business_name,s.area,COALESCE(s.latitude,s.public_latitude) AS lat,COALESCE(s.longitude,s.public_longitude) AS lng,s.fulfilment_pct,
       ${verifiedSql('s')} AS verified,
       (SELECT AVG(r.score)::float8 FROM ratings r WHERE r.seller_id=s.user_id) AS rating,
       (SELECT COUNT(*)::int FROM unnest($1::text[]) x WHERE l.title ~* ('\\m'||x)) AS hits
     FROM listings l JOIN sellers s ON s.user_id=l.seller_id JOIN users u ON u.id=s.user_id
     JOIN listing_variants v ON v.listing_id=l.id AND v.is_primary AND v.active
     WHERE l.status='ACTIVE' AND s.status='APPROVED' AND u.status='ACTIVE' AND u.frozen_at IS NULL
       AND l.delivery_available AND l.seller_id<>$2 AND s.latitude IS NOT NULL AND ${bookableSql('l')}
       AND EXISTS(SELECT 1 FROM unnest($1::text[]) x WHERE l.title ~* ('\\m'||x))
     LIMIT 60`,
    [ws, buyerId],
  );
  return rows
    .map((r: any) => {
      const km = haversineKm(lat, lng, r.lat, r.lng);
      const quantity = Math.max(
        r.min_quantity,
        sameUnit(r.unit, item.unit) ? Math.ceil(item.amount - 1e-9) : 1,
      );
      const score =
        r.hits * 3 +
        (item.category && r.category === item.category ? 2 : 0) +
        (r.verified ? 2 : 0) +
        (r.rating ? Number(r.rating) - 3 : 0) +
        (r.fulfilment_pct != null ? (r.fulfilment_pct - 70) / 15 : 0) -
        km / 3;
      const unit_price = unitPrice(r, quantity);
      // A pack far bigger than needed (a 50 kg bag for 3 onions) drops down the list.
      const ratio = item.est_kobo ? (unit_price * quantity) / item.est_kobo : 1;
      const sized = ratio > 4 ? -8 - Math.min(6, ratio / 10) : 0;
      return { ...r, km, quantity, score: score + sized, unit_price, oversized: ratio > 4 };
    })
    .filter((r: any) => r.km <= RADIUS_KM && r.stock >= r.quantity)
    .sort((a: any, b: any) => b.score - a.score)
    .slice(0, 6);
}

/**
 * The basket: for each item the best product near the address, choosing sellers so the whole
 * list comes from as few shops as possible (one rider per shop), better shops first.
 */
export async function buildBasket(
  q: Query,
  buyerId: string,
  text: string,
  lat: number,
  lng: number,
  servings?: number,
) {
  const content = await plannerContent(q);
  const read = readErrand(text, content, servings);
  const options = new Map<string, any[]>();
  for (const item of read.items)
    options.set(item.key, await candidates(q, item, lat, lng, buyerId));
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
  const sellers = new Map<string, any>();
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
        delivery_kobo: vehicle ? fareFor(vehicle as any, c.km * ROAD_FACTOR) : 0,
      };
      s.subtotal_kobo += c.unit_price * c.quantity;
      sellers.set(c.seller_id, s);
    }
    return {
      key: i.key,
      name: i.name,
      from: i.from,
      needed_quantity: Math.round(i.amount * 100) / 100,
      needed_unit: i.unit,
      listing: c
        ? {
            id: c.id,
            title: c.title,
            unit: c.unit,
            price_kobo: c.unit_price,
            image_url: c.image_url,
            seller_id: c.seller_id,
            business_name: c.business_name,
          }
        : null,
      quantity: c?.quantity ?? 0,
      line_kobo: c ? c.unit_price * c.quantity : 0,
      alternatives: Math.max(0, (options.get(i.key)?.length ?? 0) - 1),
      unit_differs: c ? !sameUnit(c.unit, i.unit) : false,
      oversized: !!c?.oversized,
      extra_trip_kobo: null as number | null,
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
  return {
    text,
    servings: read.servings,
    recipes: read.recipes,
    items,
    sellers: [...sellers.values()],
    missing: items.filter((i) => !i.listing).map((i) => i.name),
    goods_kobo: goods,
    delivery_kobo: delivery,
    total_kobo: goods + delivery,
  };
}

/**
 * After a seller accepts their errand basket: book the rider delivery for the chosen time
 * (pay on delivery, so the customer pays when it arrives). If that isn't possible, the customer
 * is told to arrange delivery from the order.
 */
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
          quantity: z.number().int().min(1).max(10000),
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
      })
      .parse(input.body);
    return await buildBasket(db, user.id, d.text, d.latitude, d.longitude, d.servings);
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
        `SELECT l.*,v.id AS variant_id,v.name AS variant_name,v.price_kobo AS v_price,v.wholesale_tiers,v.stock AS v_stock,v.min_quantity,
           (SELECT commission_bps FROM catalogue_categories WHERE name=l.category) AS category_bps
         FROM listings l JOIN sellers s ON s.user_id=l.seller_id JOIN listing_variants v ON v.listing_id=l.id AND v.is_primary AND v.active
         WHERE l.id=$1 AND l.status='ACTIVE' AND s.status='APPROVED' AND l.delivery_available AND ${bookableSql('l')}`,
        [item.listing_id],
      );
      ensure(
        l,
        409,
        'UNAVAILABLE',
        'One of the products is no longer available. Build the basket again.',
      );
      ensure(l.seller_id !== user.id, 400, 'OWN_LISTING', 'You can’t order your own product.');
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
