import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { Database, Query } from '../database/client.js';
import { ensure } from '../lib/errors.js';
import type { RequestInput } from '../lib/http.js';
import type { AppDeps } from '../types/deps.js';
import { audit } from './audit.service.js';
import { verifiedSql } from './business-verification.service.js';
import { notify } from './communications.service.js';
import { haversineKm } from './routing.service.js';
import { bookableSql } from './retention.service.js';

/**
 * Deals and demand:
 * - sales: a seller drops a price for a few days; buyers see "was ₦X"; it ends by itself;
 * - price watches: a buyer follows a listing, a catalogue product or a search and is told when the
 *   lowest price falls (a cut or a sale);
 * - requests: a buyer asks for something no one lists; the best-matched sellers (selling similar
 *   things, verified, well rated, reliable, nearby) are suggested and alerted, and can offer it.
 */

const naira = (kobo: number) => `₦${Math.round(kobo / 100).toLocaleString('en-NG')}`;
/** A cut of at least this share counts as a price drop worth telling watchers about. */
const DROP = 0.03;
/** Fresh produce categories for the fresh offers rail. */
const FRESH = ['Vegetables', 'Fruit', 'Tubers', 'Livestock', 'Grains'];
const STOP = new Set([
  'and',
  'the',
  'for',
  'with',
  'fresh',
  'new',
  'good',
  'buy',
  'want',
  'need',
  'please',
  'some',
]);

/** Search words, with simple singular forms ("peppers" → "pepper"). */
export function words(text: string) {
  const out = new Set<string>();
  for (const w of text.toLowerCase().match(/[a-z0-9]+/g) || []) {
    if (w.length < 3 || STOP.has(w)) continue;
    out.add(w);
    if (w.endsWith('es') && w.length > 4) out.add(w.slice(0, -2));
    if (w.endsWith('s') && w.length > 3) out.add(w.slice(0, -1));
  }
  return [...out].slice(0, 8);
}

/** Lowest current price (kobo) of what a watch follows, among listings buyers can order now. */
async function lowestPrice(
  q: Query,
  w: {
    listing_id?: string | null;
    catalogue_product_id?: string | null;
    query?: string | null;
    user_id?: string;
  },
) {
  const where = w.listing_id
    ? 'l.id=$1'
    : w.catalogue_product_id
      ? 'l.catalogue_product_id=$1'
      : "(SELECT bool_and(l.title ILIKE '%'||x||'%') FROM unnest($1::text[]) x)";
  const arg = w.listing_id ?? w.catalogue_product_id ?? words(w.query || '');
  if (Array.isArray(arg) && !arg.length) return null;
  const [r] = await q.query(
    `SELECT l.id,l.title,l.price_kobo,l.sale_until,l.was_price_kobo,s.business_name FROM listings l JOIN sellers s ON s.user_id=l.seller_id
     WHERE ${where} AND l.status='ACTIVE' AND s.status='APPROVED' AND l.seller_id<>$2 AND ${bookableSql('l')}
     ORDER BY l.price_kobo LIMIT 1`,
    [arg, w.user_id ?? ''],
  );
  return r ?? null;
}

/** Days in the last 30 a listing was priced at exactly this amount (from its price history). */
export async function daysAtPrice(q: Query, listingId: string, price: number) {
  const [r] = await q.query(
    `WITH h AS (
       SELECT price_kobo,GREATEST(from_at,now()-interval '30 days') AS start,
         COALESCE(LEAD(from_at) OVER (ORDER BY from_at,id),now()) AS stop
       FROM listing_price_history WHERE listing_id=$1)
     SELECT COALESCE(SUM(EXTRACT(EPOCH FROM (stop-start)))/86400,0)::float8 AS days FROM h WHERE price_kobo=$2 AND stop>start`,
    [listingId, price],
  );
  return Math.floor(Number(r.days));
}

/** Ends a sale: back to the usual price, deal stock cleared. */
export async function endSale(q: Query, listingId: string) {
  const [l] = await q.query(
    'UPDATE listings SET price_kobo=was_price_kobo,was_price_kobo=NULL,sale_until=NULL,sale_kind=NULL,deal_stock_left=NULL WHERE id=$1 AND was_price_kobo IS NOT NULL RETURNING id,price_kobo',
    [listingId],
  );
  if (l)
    await q.query('UPDATE listing_variants SET price_kobo=$1 WHERE listing_id=$2 AND is_primary', [
      l.price_kobo,
      l.id,
    ]);
}

/**
 * After a seller accepts an order at the deal price: count it against the deal stock and end the
 * deal when none is left (so buyers never see a deal the seller can't honour).
 */
export async function useDealStock(
  q: Query,
  listingId: string,
  unitPriceKobo: number,
  quantity: number,
) {
  const [l] = await q.query(
    'SELECT price_kobo,deal_stock_left,sale_until FROM listings WHERE id=$1 FOR UPDATE',
    [listingId],
  );
  if (!l?.sale_until || l.deal_stock_left == null || Number(l.price_kobo) !== unitPriceKobo) return;
  const left = Math.max(0, l.deal_stock_left - quantity);
  await q.query('UPDATE listings SET deal_stock_left=$1 WHERE id=$2', [left, listingId]);
  if (left === 0) await endSale(q, listingId);
}

/** Every 10 minutes: tell watchers about price drops and sales; end sales that ran out. */
export async function dealsSweep(db: Database) {
  await db.transaction(async (q) => {
    // Sales that ended go back to the usual price.
    const ended = await q.query(
      'SELECT id FROM listings WHERE sale_until<=now() AND was_price_kobo IS NOT NULL',
    );
    for (const l of ended) await endSale(q, l.id);
    const watches = await q.query(
      'SELECT * FROM price_watches WHERE active ORDER BY created_at LIMIT 2000 FOR UPDATE SKIP LOCKED',
    );
    for (const w of watches) {
      const low = await lowestPrice(q, w);
      if (!low) continue;
      const price = Number(low.price_kobo);
      if (w.baseline_kobo == null) {
        await q.query('UPDATE price_watches SET baseline_kobo=$1 WHERE id=$2', [price, w.id]);
        continue;
      }
      if (price > w.baseline_kobo * (1 - DROP)) continue;
      const onSale = low.sale_until && new Date(low.sale_until) > new Date();
      await notify(
        q,
        w.user_id,
        'price_alert',
        onSale ? `On sale: ${w.label}` : `Price drop: ${w.label}`,
        `${low.title} is now ${naira(price)} at ${low.business_name} (was ${naira(onSale && low.was_price_kobo ? Number(low.was_price_kobo) : w.baseline_kobo)})${onSale ? ` until ${new Date(low.sale_until).toLocaleDateString('en-NG')}` : ''}.`,
      );
      await q.query(
        'UPDATE price_watches SET baseline_kobo=$1,last_notified_at=now() WHERE id=$2',
        [price, w.id],
      );
    }
    await q.query(
      "UPDATE product_requests SET status='CLOSED' WHERE status='OPEN' AND expires_at<=now()",
    );
  });
}

export interface SellerSuggestion {
  seller_id: string;
  business_name: string;
  area: string;
  city: string;
  verified: boolean;
  rating: number | null;
  reviews: number;
  fulfilment_pct: number | null;
  sales: number;
  distance_km: number | null;
  examples: string[];
  reason: string;
}

/**
 * Sellers likely to have something: those selling similar items (shared words) or in the same
 * category, ranked so verified, well-rated, reliable, experienced and nearby sellers come first.
 */
export async function suggestSellers(
  q: Query,
  text: string,
  opts: {
    exclude?: string;
    lat?: number;
    lng?: number;
    limit?: number;
    radiusKm?: number;
    /** The kind of thing, when the person chose it (else guessed from the catalogue). */
    category?: string;
  } = {},
): Promise<{ category: string | null; sellers: SellerSuggestion[] }> {
  const w = words(text);
  if (!w.length && !opts.category) return { category: null, sellers: [] };
  // The catalogue tells us what kind of thing it is ("bell peppers" → Vegetables).
  const [cat] = await q.query(
    `SELECT category,COUNT(*)::int AS n FROM catalogue_products
     WHERE active AND EXISTS(SELECT 1 FROM unnest($1::text[]) x WHERE keywords LIKE '%'||x||'%')
     GROUP BY category ORDER BY n DESC LIMIT 1`,
    [w],
  );
  const category: string | null = opts.category || cat?.category || null;
  const rows = await q.query(
    `SELECT s.user_id,s.business_name,s.area,s.city,COALESCE(s.latitude,s.public_latitude) AS lat,COALESCE(s.longitude,s.public_longitude) AS lng,
       s.fulfilment_pct,${verifiedSql('s')} AS verified,
       (SELECT AVG(r.score)::float8 FROM ratings r WHERE r.seller_id=s.user_id) AS rating,
       (SELECT COUNT(*)::int FROM ratings r WHERE r.seller_id=s.user_id) AS reviews,
       (SELECT COUNT(*)::int FROM bookings b WHERE b.seller_id=s.user_id AND b.status='COMPLETED') AS sales,
       (SELECT array_agg(DISTINCT l.title) FROM listings l WHERE l.seller_id=s.user_id AND l.status='ACTIVE' AND l.archived_at IS NULL
          AND EXISTS(SELECT 1 FROM unnest($1::text[]) x WHERE l.title ~* ('\\m'||x))) AS similar,
       EXISTS(SELECT 1 FROM listings l WHERE l.seller_id=s.user_id AND l.status='ACTIVE' AND l.archived_at IS NULL AND l.category=$2) AS same_category
     FROM sellers s JOIN users u ON u.id=s.user_id
     WHERE s.status='APPROVED' AND u.status='ACTIVE' AND u.frozen_at IS NULL AND s.user_id<>$3`,
    [w, category ?? '', opts.exclude ?? ''],
  );
  const scored = rows
    .filter((r: any) => (r.similar?.length ?? 0) > 0 || r.same_category)
    // A chosen location and radius: only sellers within reach of that spot.
    .filter(
      (r: any) =>
        !opts.radiusKm ||
        opts.lat == null ||
        (r.lat != null && haversineKm(opts.lat, opts.lng!, r.lat, r.lng) <= opts.radiusKm),
    )
    .map((r: any) => {
      const distance =
        opts.lat != null && opts.lng != null && r.lat != null
          ? haversineKm(opts.lat, opts.lng, r.lat, r.lng)
          : null;
      const similar: string[] = r.similar || [];
      // Relevance first (similar products, then the same category), then quality within it.
      const score =
        (similar.length ? 100 : r.same_category ? 50 : 0) +
        Math.min(3, similar.length) +
        (r.verified ? 3 : 0) +
        (r.reviews ? Number(r.rating) - 3 : 0) +
        (r.fulfilment_pct != null ? (r.fulfilment_pct - 70) / 10 : 0) +
        Math.min(2, Math.log10(1 + r.sales)) -
        (distance != null ? Math.min(4, distance / 5) : 0);
      const reason = [
        similar.length ? `Sells ${similar.slice(0, 2).join(', ')}` : `Sells ${category}`,
        r.verified ? 'verified' : null,
        r.reviews ? `${Number(r.rating).toFixed(1)}★` : null,
        r.fulfilment_pct != null ? `fulfils ${r.fulfilment_pct}%` : null,
        distance != null ? `${Math.max(1, Math.round(distance))} km away` : null,
      ]
        .filter(Boolean)
        .join(' · ');
      return {
        score,
        s: {
          seller_id: r.user_id,
          business_name: r.business_name,
          area: r.area,
          city: r.city,
          verified: !!r.verified,
          rating: r.reviews ? Math.round(Number(r.rating) * 10) / 10 : null,
          reviews: r.reviews,
          fulfilment_pct: r.fulfilment_pct ?? null,
          sales: r.sales,
          distance_km: distance == null ? null : Math.round(distance * 10) / 10,
          examples: similar.slice(0, 3),
          reason,
        } as SellerSuggestion,
      };
    })
    .sort((a: any, b: any) => b.score - a.score)
    .slice(0, opts.limit ?? 10)
    .map((x: any) => x.s);
  return { category, sellers: scored };
}

/** What sellers are told about a request: "Wanted near Ikeja: 2 pair of Nike sneakers". */
function requestMessage(r: {
  text: string;
  quantity?: number | null;
  unit?: string | null;
  area?: string | null;
  details?: string | null;
  condition?: string | null;
  budget_kobo?: number | null;
  needed_by?: string | null;
}) {
  // "20 crates of eggs", without repeating a unit the buyer already wrote ("crates of eggs").
  const unitInText = r.unit && r.text.toLowerCase().includes(r.unit.toLowerCase());
  const what = r.quantity
    ? `${r.quantity} ${unitInText || !r.unit ? r.text : `${r.unit} of ${r.text}`}`
    : r.text;
  return {
    title: `Wanted${r.area ? ` near ${r.area}` : ''}: ${what}`.slice(0, 120),
    body:
      (r.details ? `Details: ${r.details}. ` : '') +
      (r.condition ? `${r.condition === 'NEW' ? 'New' : 'Used is fine'}. ` : '') +
      (r.budget_kobo ? `Budget ${naira(Number(r.budget_kobo))}. ` : '') +
      (r.needed_by ? `Needed by ${r.needed_by}. ` : ''),
  };
}

/**
 * A seller just listed something: open requests for it (that this seller wasn't alerted about)
 * now reach them, and the person who asked hears it's on Ahia. Keeps a request working for
 * its whole week, not only at the moment it was sent.
 */
export async function alertRequestsForListing(q: Query, listing: any) {
  const title = String(listing.title || '').toLowerCase();
  const rows = await q.query(
    `SELECT r.* ,COALESCE(s.latitude,s.public_latitude) AS slat,COALESCE(s.longitude,s.public_longitude) AS slng,s.business_name
     FROM product_requests r JOIN sellers s ON s.user_id=$1
     WHERE r.status='OPEN' AND r.expires_at>now() AND r.buyer_id<>$1
       AND NOT EXISTS(SELECT 1 FROM product_request_sellers x WHERE x.request_id=r.id AND x.seller_id=$1)
     ORDER BY r.created_at DESC LIMIT 300`,
    [listing.seller_id],
  );
  let alerted = 0;
  for (const r of rows) {
    const w = words(r.text);
    if (!w.length || !w.some((x) => new RegExp(`\\b${x}`).test(title))) continue;
    const reach = r.reach_km ?? (r.latitude == null ? null : Math.max(r.radius_km, 50));
    const km =
      r.latitude != null && r.slat != null
        ? haversineKm(r.latitude, r.longitude, r.slat, r.slng)
        : null;
    if (reach != null && km != null && km > reach) continue;
    await q.query(
      'INSERT INTO product_request_sellers(request_id,seller_id,rank,distance_km,late) VALUES($1,$2,999,$3,TRUE) ON CONFLICT DO NOTHING',
      [r.id, listing.seller_id, km],
    );
    const m = requestMessage({
      ...(r as any),
      budget_kobo: r.budget_kobo,
      needed_by: r.needed_by ? new Date(r.needed_by).toISOString().slice(0, 10) : null,
    });
    await notify(
      q,
      listing.seller_id,
      'request',
      m.title,
      `${m.body}You just listed “${listing.title}”. Open Sell → Buyer requests to quote.`,
    );
    await notify(
      q,
      r.buyer_id,
      'request',
      `Now on Ahia: ${listing.title}`.slice(0, 120),
      `${r.business_name} just listed something that matches your request “${r.text}”. We've asked them to quote; you'll see it in Account → Price alerts & requests.`,
    );
    if (++alerted >= 20) break;
  }
}

export function createDealsService(deps: AppDeps) {
  const { db } = deps;

  // ---------- sales ----------
  /** Put a listing on sale for some days, or end the sale now. */
  async function setSale(q: Query, user: any, input: RequestInput) {
    const d = z
      .union([
        z.object({ end: z.literal(true) }),
        z.object({
          price_kobo: z.number().int().min(100).max(100000000),
          /** TODAY ends at midnight; WEEK runs 7 days; DAYS uses `days`. */
          kind: z.enum(['TODAY', 'WEEK', 'DAYS']).default('DAYS'),
          days: z.number().int().min(1).max(30).default(3),
          /** Units really available at the deal price; the deal ends when they're gone. */
          deal_stock: z.number().int().min(1).max(100000),
        }),
      ])
      .parse(input.body);
    const [l] = await q.query('SELECT * FROM listings WHERE id=$1 AND seller_id=$2 FOR UPDATE', [
      input.params.id,
      user.id,
    ]);
    ensure(l, 404, 'NOT_FOUND', 'Listing not found.');
    let price: number;
    if ('end' in d) {
      ensure(l.was_price_kobo != null, 409, 'NOT_ON_SALE', 'This item isn’t on sale.');
      price = l.was_price_kobo;
      await endSale(q, l.id);
    } else {
      const usual = l.was_price_kobo ?? l.price_kobo;
      ensure(
        d.price_kobo < usual,
        400,
        'NOT_A_SALE',
        `A sale price must be below the usual ${naira(usual)}.`,
      );
      const off = 1 - d.price_kobo / usual;
      ensure(off >= 0.05, 400, 'DEAL_TOO_SMALL', 'A deal must be at least 5% off the usual price.');
      // Genuine deals only: the usual price must be one the item really sold at for a week.
      const days = await daysAtPrice(q, l.id, usual);
      ensure(
        days >= 7,
        409,
        'PRICE_NOT_ESTABLISHED',
        `A deal’s “was” price must be a price you charged for at least 7 of the last 30 days (${naira(usual)} has been your price for ${days} day${days === 1 ? '' : 's'}).`,
      );
      // Accurate stock: the deal quantity must be stock the seller has.
      const [v] = await q.query(
        'SELECT stock FROM listing_variants WHERE listing_id=$1 AND is_primary',
        [l.id],
      );
      ensure(
        l.stock_mode === 'ALWAYS' || d.deal_stock <= Number(v?.stock ?? 0),
        409,
        'DEAL_STOCK',
        `You have ${v?.stock ?? 0} in stock; the deal can’t offer more.`,
      );
      price = d.price_kobo;
      // TODAY ends at midnight in Lagos; WEEK and DAYS run whole days.
      await q.query(
        `UPDATE listings SET price_kobo=$1,was_price_kobo=$2,
           sale_until=CASE WHEN $4::text='TODAY'
             THEN (date_trunc('day', now() AT TIME ZONE 'Africa/Lagos') + interval '1 day') AT TIME ZONE 'Africa/Lagos'
             ELSE now()+make_interval(days=>$3::int) END,
           sale_kind=$4,deal_stock_left=$5,confirmed_at=now(),out_until=NULL WHERE id=$6`,
        [price, usual, d.kind === 'WEEK' ? 7 : d.days, d.kind, d.deal_stock, l.id],
      );
    }
    await q.query('UPDATE listing_variants SET price_kobo=$1 WHERE listing_id=$2 AND is_primary', [
      price,
      l.id,
    ]);
    await audit(q, user.id, 'end' in d ? 'listing.sale_end' : 'listing.sale', l.id, d);
    const [fresh] = await q.query(
      'SELECT id,price_kobo,was_price_kobo,sale_until,sale_kind,deal_stock_left FROM listings WHERE id=$1',
      [l.id],
    );
    return fresh;
  }

  // ---------- price watches ----------
  async function listWatches(user: any, _input: RequestInput) {
    const rows = await db.query(
      'SELECT * FROM price_watches WHERE user_id=$1 AND active ORDER BY created_at DESC LIMIT 100',
      [user.id],
    );
    const out = [];
    for (const w of rows) {
      const low = await lowestPrice(db, w);
      out.push({
        id: w.id,
        label: w.label,
        kind: w.listing_id ? 'LISTING' : w.catalogue_product_id ? 'PRODUCT' : 'SEARCH',
        listing_id: w.listing_id,
        catalogue_product_id: w.catalogue_product_id,
        query: w.query,
        watched_price_kobo: w.baseline_kobo,
        lowest: low
          ? {
              listing_id: low.id,
              title: low.title,
              business_name: low.business_name,
              price_kobo: Number(low.price_kobo),
              on_sale: !!low.sale_until && new Date(low.sale_until) > new Date(),
            }
          : null,
        created_at: w.created_at,
      });
    }
    return out;
  }
  /** Watch a listing, a catalogue product or a search for price drops and sales. */
  async function watchPrice(q: Query, user: any, input: RequestInput) {
    const d = z
      .object({
        listing_id: z.string().max(60).optional(),
        catalogue_product_id: z.string().max(60).optional(),
        query: z.string().trim().min(2).max(100).optional(),
      })
      .parse(input.body);
    ensure(
      [d.listing_id, d.catalogue_product_id, d.query].filter(Boolean).length === 1,
      400,
      'ONE_TARGET',
      'Watch one listing, product or search.',
    );
    let label = d.query ?? '';
    let target: any = { ...d };
    if (d.listing_id) {
      const [l] = await q.query('SELECT title,catalogue_product_id FROM listings WHERE id=$1', [
        d.listing_id,
      ]);
      ensure(l, 404, 'NOT_FOUND', 'Listing not found.');
      label = l.title;
    }
    if (d.catalogue_product_id) {
      const [p] = await q.query('SELECT name FROM catalogue_products WHERE id=$1', [
        d.catalogue_product_id,
      ]);
      ensure(p, 404, 'NOT_FOUND', 'Product not found.');
      label = p.name;
    }
    if (d.query) target = { query: d.query };
    const [count] = await q.query(
      'SELECT COUNT(*)::int AS n FROM price_watches WHERE user_id=$1 AND active',
      [user.id],
    );
    ensure(count.n < 100, 400, 'WATCH_LIMIT', 'You can watch up to 100 prices.');
    const low = await lowestPrice(q, { ...target, user_id: user.id });
    const [w] = await q.query(
      `INSERT INTO price_watches(id,user_id,listing_id,catalogue_product_id,query,label,baseline_kobo) VALUES($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (user_id, COALESCE(listing_id,''), COALESCE(catalogue_product_id,''), COALESCE(lower(query),'')) WHERE active DO UPDATE SET label=EXCLUDED.label
       RETURNING id,label,baseline_kobo`,
      [
        randomUUID(),
        user.id,
        target.listing_id ?? null,
        target.catalogue_product_id ?? null,
        target.query ?? null,
        label,
        low ? Number(low.price_kobo) : null,
      ],
    );
    return { id: w.id, label: w.label, watched_price_kobo: w.baseline_kobo };
  }
  async function unwatchPrice(q: Query, user: any, input: RequestInput) {
    const [w] = await q.query(
      'UPDATE price_watches SET active=FALSE WHERE id=$1 AND user_id=$2 AND active RETURNING id',
      [input.params.id, user.id],
    );
    ensure(w, 404, 'NOT_FOUND', 'Watch not found.');
    return { ok: true as const };
  }

  // ---------- requests ----------
  const geo = z.object({
    lat: z.coerce.number().min(-90).max(90).optional(),
    lng: z.coerce.number().min(-180).max(180).optional(),
  });
  /** Sellers who probably have it (for a search with few or no results). */
  async function suggest(user: any, input: RequestInput) {
    const d = geo.extend({ q: z.string().trim().min(2).max(100) }).parse(input.query);
    return await suggestSellers(db, d.q, { exclude: user.id, lat: d.lat, lng: d.lng });
  }
  /** Ask sellers for something; the best-matched ten are alerted. */
  /**
   * Ask sellers for something: what, how much, by when, a budget, and where. Sellers near that
   * spot who sell it (or similar, or the same kind of thing) are alerted, best first.
   */
  async function createRequest(q: Query, user: any, input: RequestInput) {
    const d = z
      .object({
        text: z.string().trim().min(2).max(200),
        /** Brand, model, size, colour: whatever narrows it down. */
        details: z.string().trim().max(300).optional(),
        condition: z.enum(['NEW', 'USED']).optional(),
        /** The kind of thing (a catalogue category), when the person picked one. */
        category: z.string().trim().max(50).optional(),
        quantity: z.number().positive().max(1000000).optional(),
        unit: z.string().trim().max(30).optional(),
        budget_kobo: z.number().int().min(100).max(10000000000).optional(),
        needed_by: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .optional(),
        latitude: z.number().min(-90).max(90).optional(),
        longitude: z.number().min(-180).max(180).optional(),
        area: z.string().trim().max(120).optional(),
        radius_km: z.number().int().min(1).max(100).default(10),
        /** Search all of Nigeria, not just around the spot. */
        anywhere: z.boolean().default(false),
      })
      .parse(input.body);
    ensure(
      (d.latitude == null) === (d.longitude == null),
      400,
      'INVALID_COORDINATES',
      'Choose a location on the map, or leave it out.',
    );
    const [recent] = await q.query(
      "SELECT COUNT(*)::int AS n FROM product_requests WHERE buyer_id=$1 AND created_at>now()-interval '1 day'",
      [user.id],
    );
    ensure(recent.n < 10, 429, 'TOO_MANY_REQUESTS', 'You can make up to 10 requests a day.');
    const located = d.latitude != null && !d.anywhere;
    const find = (radiusKm?: number) =>
      suggestSellers(q, d.text, {
        exclude: user.id,
        lat: d.latitude,
        lng: d.longitude,
        radiusKm,
        category: d.category,
        limit: 25,
      });
    // Nobody close by sells it: look further (50 km, then all of Nigeria) so the request
    // reaches someone who can help, and say how far it went.
    let reach: number | null = located ? d.radius_km : null;
    let found = await find(reach ?? undefined);
    for (const next of [50, null] as const) {
      if (!located || found.sellers.length > 0 || (next != null && next <= (reach ?? 0))) continue;
      const wider = await find(next ?? undefined);
      if (wider.sellers.length > found.sellers.length) {
        found = wider;
        reach = next;
      }
    }
    const { category, sellers } = found;
    const id = randomUUID();
    await q.query(
      `INSERT INTO product_requests(id,buyer_id,text,category,latitude,longitude,quantity,unit,budget_kobo,needed_by,area,radius_km,details,condition,reach_km)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
      [
        id,
        user.id,
        d.text,
        category,
        d.latitude ?? null,
        d.longitude ?? null,
        d.quantity ?? null,
        d.unit ?? null,
        d.budget_kobo ?? null,
        d.needed_by ?? null,
        d.area ?? null,
        d.radius_km,
        d.details ?? null,
        d.condition ?? null,
        reach,
      ],
    );
    const message = requestMessage(d);
    for (const [i, x] of sellers.entries()) {
      await q.query(
        'INSERT INTO product_request_sellers(request_id,seller_id,rank,distance_km) VALUES($1,$2,$3,$4)',
        [id, x.seller_id, i + 1, x.distance_km],
      );
      await notify(
        q,
        x.seller_id,
        'request',
        message.title,
        `${message.body}${x.distance_km != null ? `About ${Math.max(1, Math.round(x.distance_km))} km from you. ` : ''}Open Sell → Buyer requests to quote.`,
      );
    }
    return {
      id,
      text: d.text,
      category,
      sellers,
      /** km searched; null = all of Nigeria. Larger than asked when too few were close. */
      reach_km: reach,
      widened: located && reach !== d.radius_km,
    };
  }
  async function myRequests(user: any, _input: RequestInput) {
    const rows = await db.query(
      `SELECT r.*,(SELECT COUNT(*)::int FROM product_request_sellers x WHERE x.request_id=r.id) AS sellers_alerted,
         (SELECT json_agg(json_build_object('id',o.id,'note',o.note,'created_at',o.created_at,'listing_id',l.id,'title',l.title,
            'price_kobo',COALESCE(o.price_kobo,l.price_kobo),'listed_price_kobo',l.price_kobo,'quoted',o.price_kobo IS NOT NULL,'available',o.quantity,
            'unit',l.unit,'image_url',l.image_url,'business_name',s.business_name,'seller_id',s.user_id) ORDER BY COALESCE(o.price_kobo,l.price_kobo))
          FROM product_request_offers o JOIN listings l ON l.id=o.listing_id JOIN sellers s ON s.user_id=o.seller_id WHERE o.request_id=r.id) AS offers
       FROM product_requests r WHERE r.buyer_id=$1 ORDER BY r.created_at DESC LIMIT 50`,
      [user.id],
    );
    return rows.map((r: any) => ({
      id: r.id,
      text: r.text,
      category: r.category,
      quantity: r.quantity == null ? null : Number(r.quantity),
      unit: r.unit ?? null,
      budget_kobo: r.budget_kobo ?? null,
      needed_by: r.needed_by ? new Date(r.needed_by).toISOString().slice(0, 10) : null,
      area: r.area ?? null,
      details: r.details ?? null,
      condition: r.condition ?? null,
      reach_km: r.reach_km ?? null,
      status: r.status,
      created_at: r.created_at,
      expires_at: r.expires_at,
      sellers_alerted: r.sellers_alerted,
      offers: (r.offers || []).map((o: any) => ({ ...o, price_kobo: Number(o.price_kobo) })),
    }));
  }
  /** Requests a seller was alerted about and can still answer. */
  async function sellerRequests(user: any, _input: RequestInput) {
    const rows = await db.query(
      `SELECT r.id,r.text,r.category,r.created_at,r.expires_at,r.quantity,r.unit,r.budget_kobo,r.needed_by,r.area,x.distance_km,
         (SELECT o.listing_id FROM product_request_offers o WHERE o.request_id=r.id AND o.seller_id=$1) AS offered_listing_id,
         (SELECT o.price_kobo FROM product_request_offers o WHERE o.request_id=r.id AND o.seller_id=$1) AS quoted_price_kobo
       FROM product_request_sellers x JOIN product_requests r ON r.id=x.request_id
       WHERE x.seller_id=$1 AND r.status='OPEN' AND r.expires_at>now() ORDER BY r.created_at DESC LIMIT 50`,
      [user.id],
    );
    return rows.map((r: any) => ({
      ...r,
      quantity: r.quantity == null ? null : Number(r.quantity),
      needed_by: r.needed_by ? new Date(r.needed_by).toISOString().slice(0, 10) : null,
      distance_km: r.distance_km == null ? null : Math.round(r.distance_km * 10) / 10,
      offered_listing_id: r.offered_listing_id ?? null,
    }));
  }
  /** A seller offers one of their listings for a request; the buyer is told. */
  async function offer(q: Query, user: any, input: RequestInput) {
    const d = z
      .object({
        listing_id: z.string().max(60),
        note: z.string().trim().max(300).optional(),
        /** Price per unit for this buyer (e.g. a bulk price); the buyer can order at it. */
        price_kobo: z.number().int().min(100).max(100000000).optional(),
        /** How many the seller can supply. */
        quantity: z.number().positive().max(1000000).optional(),
      })
      .parse(input.body);
    const [r] = await q.query(
      `SELECT r.* FROM product_requests r JOIN product_request_sellers x ON x.request_id=r.id AND x.seller_id=$2
       WHERE r.id=$1 AND r.status='OPEN' AND r.expires_at>now()`,
      [input.params.id, user.id],
    );
    ensure(r, 404, 'NOT_FOUND', 'This request is closed or wasn’t sent to you.');
    const [l] = await q.query(
      "SELECT id,title,price_kobo FROM listings WHERE id=$1 AND seller_id=$2 AND status='ACTIVE' AND archived_at IS NULL",
      [d.listing_id, user.id],
    );
    ensure(
      l,
      400,
      'LISTING_REQUIRED',
      'Offer one of your active listings (add it first if needed).',
    );
    const [o] = await q.query(
      `INSERT INTO product_request_offers(id,request_id,seller_id,listing_id,note,price_kobo,quantity) VALUES($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT(request_id,seller_id) DO UPDATE SET listing_id=EXCLUDED.listing_id,note=EXCLUDED.note,price_kobo=EXCLUDED.price_kobo,quantity=EXCLUDED.quantity RETURNING id`,
      [randomUUID(), r.id, user.id, l.id, d.note ?? null, d.price_kobo ?? null, d.quantity ?? null],
    );
    const [s] = await q.query('SELECT business_name FROM sellers WHERE user_id=$1', [user.id]);
    await notify(
      q,
      r.buyer_id,
      'request',
      `${s.business_name} has what you asked for`,
      `“${r.text}”: ${l.title} for ${naira(d.price_kobo ?? Number(l.price_kobo))}${d.price_kobo ? ' each (quoted for you)' : ''}${d.quantity ? `, up to ${d.quantity} available` : ''}. See it in Account → Price alerts & requests.`,
    );
    return { id: o.id };
  }
  async function closeRequest(q: Query, user: any, input: RequestInput) {
    const [r] = await q.query(
      "UPDATE product_requests SET status='CLOSED' WHERE id=$1 AND buyer_id=$2 AND status='OPEN' RETURNING id",
      [input.params.id, user.id],
    );
    ensure(r, 404, 'NOT_FOUND', 'Request not found or already closed.');
    return { ok: true as const };
  }
  /**
   * The Offers page: today-only and this-week deals, fresh produce offers and wholesale discounts.
   * Only genuine deals appear: a real "was" price (checked when the sale starts), deal stock left,
   * an approved, active seller and an orderable item.
   */
  async function offers(user: any, _input: RequestInput) {
    const base = `SELECT l.id,l.title,l.category,l.unit,l.price_kobo,l.was_price_kobo,l.sale_until,l.sale_kind,l.deal_stock_left,
         l.image_url,l.catalogue_photo_id IS NOT NULL AS representative_photo,
         (SELECT m.thumbnail_url FROM media m WHERE m.url=l.image_url) AS thumbnail_url,
         s.user_id AS seller_id,s.business_name,s.area,s.city,s.fulfilment_pct,${verifiedSql('s')} AS verified,
         v.wholesale_tiers,v.price_kobo AS base_price_kobo
       FROM listings l JOIN sellers s ON s.user_id=l.seller_id JOIN users u ON u.id=s.user_id
       JOIN listing_variants v ON v.listing_id=l.id AND v.is_primary AND v.active
       WHERE s.status='APPROVED' AND u.status='ACTIVE' AND u.frozen_at IS NULL AND l.status='ACTIVE'
         AND l.seller_id<>$1 AND ${bookableSql('l')}`;
    const sales = await db.query(
      `${base} AND l.sale_until>now() AND l.was_price_kobo IS NOT NULL AND COALESCE(l.deal_stock_left,1)>0 LIMIT 300`,
      [user.id],
    );
    const wholesale = await db.query(
      `${base} AND jsonb_array_length(v.wholesale_tiers)>0 LIMIT 200`,
      [user.id],
    );
    const card = (r: any, extra: Record<string, unknown>) => ({
      id: r.id,
      title: r.title,
      category: r.category,
      unit: r.unit,
      price_kobo: Number(r.price_kobo),
      image_url: r.thumbnail_url || r.image_url,
      representative_photo: r.representative_photo,
      seller_id: r.seller_id,
      business_name: r.business_name,
      area: r.area,
      city: r.city,
      verified: !!r.verified,
      fulfilment_pct: r.fulfilment_pct ?? null,
      ...extra,
    });
    // Verified and reliable sellers first, then the biggest saving.
    const rank = (a: any, b: any) =>
      Number(b.verified) - Number(a.verified) || b.off_pct - a.off_pct;
    const deals = sales.map((r: any) =>
      card(r, {
        was_price_kobo: Number(r.was_price_kobo),
        off_pct: Math.round((1 - Number(r.price_kobo) / Number(r.was_price_kobo)) * 100),
        sale_until: r.sale_until,
        kind: r.sale_kind,
        left: r.deal_stock_left,
      }),
    );
    const soon = (d: any) =>
      d.kind === 'TODAY' || new Date(d.sale_until).getTime() - Date.now() < 24 * 3600_000;
    return {
      today: deals.filter(soon).sort(rank).slice(0, 30),
      week: deals
        .filter((d: any) => !soon(d))
        .sort(rank)
        .slice(0, 30),
      fresh: deals
        .filter((d: any) => FRESH.includes(d.category))
        .sort(rank)
        .slice(0, 30),
      wholesale: wholesale
        .map((r: any) => {
          const tiers = [...(r.wholesale_tiers || [])].sort(
            (a: any, b: any) => b.min_quantity - a.min_quantity,
          );
          const best = tiers[0];
          return card(r, {
            min_quantity: best.min_quantity,
            tier_price_kobo: best.price_kobo,
            off_pct: Math.round((1 - best.price_kobo / Number(r.base_price_kobo)) * 100),
          });
        })
        .filter((w: any) => w.off_pct > 0)
        .sort(rank)
        .slice(0, 30),
    };
  }
  return {
    offers,
    setSale,
    listWatches,
    watchPrice,
    unwatchPrice,
    suggest,
    createRequest,
    myRequests,
    sellerRequests,
    offer,
    closeRequest,
  };
}
