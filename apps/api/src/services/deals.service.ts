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

/** Every 10 minutes: tell watchers about price drops and sales; end sales that ran out. */
export async function dealsSweep(db: Database) {
  await db.transaction(async (q) => {
    // Sales that ended go back to the usual price.
    const ended = await q.query(
      'UPDATE listings SET price_kobo=was_price_kobo,was_price_kobo=NULL,sale_until=NULL WHERE sale_until<=now() AND was_price_kobo IS NOT NULL RETURNING id,price_kobo',
    );
    for (const l of ended)
      await q.query(
        'UPDATE listing_variants SET price_kobo=$1 WHERE listing_id=$2 AND is_primary',
        [l.price_kobo, l.id],
      );
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
  opts: { exclude?: string; lat?: number; lng?: number; limit?: number } = {},
): Promise<{ category: string | null; sellers: SellerSuggestion[] }> {
  const w = words(text);
  if (!w.length) return { category: null, sellers: [] };
  // The catalogue tells us what kind of thing it is ("bell peppers" → Vegetables).
  const [cat] = await q.query(
    `SELECT category,COUNT(*)::int AS n FROM catalogue_products
     WHERE active AND EXISTS(SELECT 1 FROM unnest($1::text[]) x WHERE keywords LIKE '%'||x||'%')
     GROUP BY category ORDER BY n DESC LIMIT 1`,
    [w],
  );
  const category: string | null = cat?.category ?? null;
  const rows = await q.query(
    `SELECT s.user_id,s.business_name,s.area,s.city,s.public_latitude AS lat,s.public_longitude AS lng,
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
          days: z.number().int().min(1).max(30),
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
      await q.query(
        'UPDATE listings SET price_kobo=$1,was_price_kobo=NULL,sale_until=NULL WHERE id=$2',
        [price, l.id],
      );
    } else {
      const usual = l.was_price_kobo ?? l.price_kobo;
      ensure(
        d.price_kobo < usual,
        400,
        'NOT_A_SALE',
        `A sale price must be below the usual ${naira(usual)}.`,
      );
      price = d.price_kobo;
      await q.query(
        'UPDATE listings SET price_kobo=$1,was_price_kobo=$2,sale_until=now()+make_interval(days=>$3),confirmed_at=now() WHERE id=$4',
        [price, usual, d.days, l.id],
      );
    }
    await q.query('UPDATE listing_variants SET price_kobo=$1 WHERE listing_id=$2 AND is_primary', [
      price,
      l.id,
    ]);
    await audit(q, user.id, 'end' in d ? 'listing.sale_end' : 'listing.sale', l.id, d);
    const [fresh] = await q.query(
      'SELECT id,price_kobo,was_price_kobo,sale_until FROM listings WHERE id=$1',
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
  async function createRequest(q: Query, user: any, input: RequestInput) {
    const d = z
      .object({
        text: z.string().trim().min(2).max(200),
        latitude: z.number().min(-90).max(90).optional(),
        longitude: z.number().min(-180).max(180).optional(),
      })
      .parse(input.body);
    const [recent] = await q.query(
      "SELECT COUNT(*)::int AS n FROM product_requests WHERE buyer_id=$1 AND created_at>now()-interval '1 day'",
      [user.id],
    );
    ensure(recent.n < 10, 429, 'TOO_MANY_REQUESTS', 'You can make up to 10 requests a day.');
    const { category, sellers } = await suggestSellers(q, d.text, {
      exclude: user.id,
      lat: d.latitude,
      lng: d.longitude,
    });
    const id = randomUUID();
    await q.query(
      'INSERT INTO product_requests(id,buyer_id,text,category,latitude,longitude) VALUES($1,$2,$3,$4,$5,$6)',
      [id, user.id, d.text, category, d.latitude ?? null, d.longitude ?? null],
    );
    for (const [i, s] of sellers.entries()) {
      await q.query(
        'INSERT INTO product_request_sellers(request_id,seller_id,rank) VALUES($1,$2,$3)',
        [id, s.seller_id, i + 1],
      );
      await notify(
        q,
        s.seller_id,
        'request',
        'A buyer is looking for something you might have',
        `“${d.text}”. If you have it, open Sell → Buyer requests and offer it.`,
      );
    }
    return { id, text: d.text, category, sellers };
  }
  async function myRequests(user: any, _input: RequestInput) {
    const rows = await db.query(
      `SELECT r.*,(SELECT COUNT(*)::int FROM product_request_sellers x WHERE x.request_id=r.id) AS sellers_alerted,
         (SELECT json_agg(json_build_object('id',o.id,'note',o.note,'created_at',o.created_at,'listing_id',l.id,'title',l.title,
            'price_kobo',l.price_kobo,'unit',l.unit,'image_url',l.image_url,'business_name',s.business_name,'seller_id',s.user_id) ORDER BY o.created_at)
          FROM product_request_offers o JOIN listings l ON l.id=o.listing_id JOIN sellers s ON s.user_id=o.seller_id WHERE o.request_id=r.id) AS offers
       FROM product_requests r WHERE r.buyer_id=$1 ORDER BY r.created_at DESC LIMIT 50`,
      [user.id],
    );
    return rows.map((r: any) => ({
      id: r.id,
      text: r.text,
      category: r.category,
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
      `SELECT r.id,r.text,r.category,r.created_at,r.expires_at,
         (SELECT o.listing_id FROM product_request_offers o WHERE o.request_id=r.id AND o.seller_id=$1) AS offered_listing_id
       FROM product_request_sellers x JOIN product_requests r ON r.id=x.request_id
       WHERE x.seller_id=$1 AND r.status='OPEN' AND r.expires_at>now() ORDER BY r.created_at DESC LIMIT 50`,
      [user.id],
    );
    return rows.map((r: any) => ({ ...r, offered_listing_id: r.offered_listing_id ?? null }));
  }
  /** A seller offers one of their listings for a request; the buyer is told. */
  async function offer(q: Query, user: any, input: RequestInput) {
    const d = z
      .object({ listing_id: z.string().max(60), note: z.string().trim().max(300).optional() })
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
      `INSERT INTO product_request_offers(id,request_id,seller_id,listing_id,note) VALUES($1,$2,$3,$4,$5)
       ON CONFLICT(request_id,seller_id) DO UPDATE SET listing_id=EXCLUDED.listing_id,note=EXCLUDED.note RETURNING id`,
      [randomUUID(), r.id, user.id, l.id, d.note ?? null],
    );
    const [s] = await q.query('SELECT business_name FROM sellers WHERE user_id=$1', [user.id]);
    await notify(
      q,
      r.buyer_id,
      'request',
      `${s.business_name} has what you asked for`,
      `“${r.text}”: ${l.title} for ${naira(Number(l.price_kobo))}. See it in Buyer requests.`,
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
  return {
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
