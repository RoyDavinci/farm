import { z } from 'zod';
import type { Query } from '../database/client.js';
import { ensure } from '../lib/errors.js';
import type { RequestInput } from '../lib/http.js';
import type { AppDeps } from '../types/deps.js';
import { attachVariants } from './catalog.service.js';
import { notify } from './communications.service.js';

/** SQL: listing alias is bookable now from stock, or open for pre-orders before its harvest date. */
export const bookableSql = (a = 'l') =>
  `(${a}.archived_at IS NULL AND (${a}.out_until IS NULL OR ${a}.out_until<=now()) AND NOT EXISTS(SELECT 1 FROM catalogue_categories cc WHERE cc.name=${a}.category AND (NOT cc.active OR EXISTS(SELECT 1 FROM jsonb_array_elements_text(cc.prohibited_terms) term WHERE strpos(lower(${a}.title || ' ' || ${a}.description),lower(term))>0))) AND (COALESCE((SELECT (approved->>'stock_stale_days')::int FROM marketplace_policies WHERE id=1),0)=0 OR ${a}.stock_mode='ALWAYS' OR ${a}.confirmed_at>now()-COALESCE((SELECT (approved->>'stock_stale_days')::int FROM marketplace_policies WHERE id=1),0)*interval '1 day') AND (EXISTS(SELECT 1 FROM listing_variants av WHERE av.listing_id=${a}.id AND av.active AND av.stock>=av.min_quantity) OR (${a}.available_from>now() AND ${a}.preorder_capacity>0 AND EXISTS(SELECT 1 FROM listing_variants pv WHERE pv.listing_id=${a}.id AND pv.active))))`;

export const visibleListing = `SELECT l.*,(SELECT m.thumbnail_url FROM media m WHERE m.url=l.image_url) AS thumbnail_url,
  s.business_name,s.city,s.area,s.business_type,s.fulfilment_pct,s.fulfilment_orders,
  l.catalogue_photo_id IS NOT NULL AS representative_photo,
  ${bookableSql('l')} AS in_stock
  FROM listings l JOIN sellers s ON s.user_id=l.seller_id
  WHERE s.status='APPROVED' AND l.status='ACTIVE' AND NOT EXISTS(SELECT 1 FROM catalogue_categories cc WHERE cc.name=l.category AND (NOT cc.active OR EXISTS(SELECT 1 FROM jsonb_array_elements_text(cc.prohibited_terms) term WHERE strpos(lower(l.title || ' ' || l.description),lower(term))>0))) AND EXISTS(SELECT 1 FROM users su WHERE su.id=s.user_id AND su.status='ACTIVE')`;

/** A listing is bookable when it is active and at least one active option has its minimum in stock. */
export async function listingAvailable(q: Query, listingId: string) {
  const [row] = await q.query(
    `SELECT (l.status='ACTIVE' AND ${bookableSql('l')}) AS ok FROM listings l WHERE l.id=$1`,
    [listingId],
  );
  return !!row?.ok;
}

/** Tells waiting buyers a listing is bookable again. Each alert fires once, then is removed. */
export async function notifyIfRestocked(q: Query, listingId: string, wasAvailable: boolean) {
  if (wasAvailable || !(await listingAvailable(q, listingId))) return;
  const [l] = await q.query(
    'SELECT l.title,l.category,s.business_name FROM listings l JOIN sellers s ON s.user_id=l.seller_id WHERE l.id=$1',
    [listingId],
  );
  const waiting = await q.query<{ buyer_id: string }>(
    'DELETE FROM stock_alerts WHERE listing_id=$1 RETURNING buyer_id',
    [listingId],
  );
  for (const w of waiting)
    await notify(
      q,
      w.buyer_id,
      'stock',
      'Back in stock',
      `${l.title} from ${l.business_name} is available to book again.`,
    );
}

/** Lets buyers who favourited a seller know about a newly published listing. */
export async function announceNewListing(q: Query, listing: Record<string, any>) {
  if (!(await listingAvailable(q, listing.id))) return;
  const [l] = await q.query(
    'SELECT l.title,l.category,s.business_name FROM listings l JOIN sellers s ON s.user_id=l.seller_id WHERE l.id=$1',
    [listing.id],
  );
  const fans = await q.query<{ buyer_id: string }>(
    `UPDATE notification_preferences p SET last_marketing_at=now()
     WHERE p.marketing_enabled AND (p.last_marketing_at IS NULL OR p.last_marketing_at<now()-interval '24 hours')
       AND EXISTS(SELECT 1 FROM favourites f WHERE f.buyer_id=p.user_id AND f.seller_id=$1)
       AND NOT EXISTS(SELECT 1 FROM user_blocks WHERE (blocker_id=p.user_id AND blocked_id=$1) OR (blocked_id=p.user_id AND blocker_id=$1))
       AND NOT EXISTS(SELECT 1 FROM local_status_mutes m WHERE m.user_id=p.user_id AND ((m.kind='SELLER' AND m.target=$1) OR (m.kind='CATEGORY' AND m.target=$2)))
     RETURNING p.user_id AS buyer_id`,
    [listing.seller_id, l.category],
  );
  for (const f of fans)
    await notify(
      q,
      f.buyer_id,
      'marketing',
      `New from ${l.business_name}`,
      `${l.title} is now available from a seller you follow.`,
    );
}

/** Business logic for retention requests. HTTP-free: callers pass plain input. */
export function createRetentionService(deps: AppDeps) {
  const { db } = deps;
  async function getListing(user: any, input: RequestInput) {
    const u = user;
    const rows = await db.query(
      `SELECT * FROM (${visibleListing} UNION ALL SELECT l.*,(SELECT m.thumbnail_url FROM media m WHERE m.url=l.image_url),s.business_name,s.city,s.area,s.business_type,s.fulfilment_pct,s.fulfilment_orders,l.catalogue_photo_id IS NOT NULL,FALSE FROM listings l JOIN sellers s ON s.user_id=l.seller_id WHERE l.seller_id=$2) x WHERE x.id=$1 LIMIT 1`,
      [input.params.id, u.id],
    );
    ensure(rows[0], 404, 'NOT_FOUND', 'This listing is no longer available.');
    const [listing] = await attachVariants(db, rows, rows[0].seller_id === u.id);
    const [alert] = await db.query(
      'SELECT 1 FROM stock_alerts WHERE buyer_id=$1 AND listing_id=$2',
      [u.id, listing.id],
    );
    return { ...listing, stock_alert: !!alert };
  }
  async function listSellerListings(user: any, input: RequestInput) {
    const rows = await db.query(
      `${visibleListing} AND l.seller_id=$1 ORDER BY in_stock DESC,l.created_at DESC LIMIT 100`,
      [input.params.id],
    );
    return await attachVariants(db, rows, false);
  }
  async function addStockAlert(q: Query, u: any, input: RequestInput) {
    const [l] = await q.query(`${visibleListing} AND l.id=$1`, [input.params.id]);
    ensure(l, 404, 'NOT_FOUND', 'Listing not found.');
    ensure(l.seller_id !== u.id, 400, 'OWN_LISTING', 'You cannot follow your own listing.');
    await q.query(
      'INSERT INTO stock_alerts(buyer_id,listing_id) VALUES($1,$2) ON CONFLICT DO NOTHING',
      [u.id, l.id],
    );
    return { ok: true, stock_alert: true };
  }
  async function removeStockAlert(q: Query, u: any, input: RequestInput) {
    await q.query('DELETE FROM stock_alerts WHERE buyer_id=$1 AND listing_id=$2', [
      u.id,
      input.params.id,
    ]);
    return { ok: true, stock_alert: false };
  }
  async function getSellerAnalytics(user: any, input: RequestInput) {
    const u = user;
    const { days } = z
      .object({ days: z.coerce.number().int().min(7).max(365).default(30) })
      .parse(input.query);
    const [seller] = await db.query('SELECT user_id FROM sellers WHERE user_id=$1', [u.id]);
    ensure(seller, 403, 'SELLER_REQUIRED', 'Analytics are available to sellers.');
    const since = new Date(Date.now() - days * 86400000);
    // Sales are dated by pickup confirmation, not by the original request.
    const completed = `SELECT b.*,e.created_at AS completed_at FROM bookings b JOIN events e ON e.booking_id=b.id AND e.to_status='COMPLETED' WHERE b.seller_id=$1 AND e.created_at>=$2`;
    const [totals] = await db.query(
      `SELECT COUNT(*)::int AS orders,COALESCE(SUM(total_kobo),0)::bigint AS gross_kobo,COALESCE(SUM(total_kobo-commission_kobo),0)::bigint AS net_kobo,COUNT(DISTINCT buyer_id)::int AS buyers FROM (${completed}) c`,
      [u.id, since],
    );
    const [repeat] = await db.query(
      "SELECT COUNT(*)::int AS n FROM (SELECT buyer_id FROM bookings WHERE seller_id=$1 AND status='COMPLETED' GROUP BY buyer_id HAVING COUNT(*)>1) r",
      [u.id],
    );
    const statuses = await db.query(
      'SELECT status,COUNT(*)::int AS n FROM bookings WHERE seller_id=$1 AND created_at>=$2 GROUP BY status',
      [u.id, since],
    );
    const [responses] = await db.query(
      "SELECT COUNT(*) FILTER(WHERE e.to_status IN ('ACCEPTED','COUNTERED'))::int AS accepted,COUNT(*) FILTER(WHERE e.to_status='DECLINED' AND e.actor_id=$1)::int AS declined FROM events e JOIN bookings b ON b.id=e.booking_id WHERE b.seller_id=$1 AND e.created_at>=$2 AND e.from_status='REQUESTED'",
      [u.id, since],
    );
    const daily = await db.query(
      `SELECT to_char(d,'YYYY-MM-DD') AS day,COALESCE(SUM(c.total_kobo),0)::bigint AS gross_kobo,COUNT(c.id)::int AS orders
       FROM generate_series(date_trunc('day',$2::timestamptz),date_trunc('day',now()),interval '1 day') d
       LEFT JOIN (${completed}) c ON date_trunc('day',c.completed_at)=d GROUP BY d ORDER BY d`,
      [u.id, since],
    );
    const top = await db.query(
      `SELECT listing_id,title,COUNT(*)::int AS orders,SUM(quantity)::int AS quantity,SUM(total_kobo)::bigint AS gross_kobo FROM (${completed}) c GROUP BY listing_id,title ORDER BY gross_kobo DESC LIMIT 5`,
      [u.id, since],
    );
    const [rating] = await db.query(
      'SELECT ROUND(AVG(score),1)::float AS avg,COUNT(*)::int AS count FROM ratings WHERE seller_id=$1',
      [u.id],
    );
    const [followers] = await db.query(
      'SELECT COUNT(*)::int AS n FROM favourites WHERE seller_id=$1',
      [u.id],
    );
    const lowStock = await db.query(
      "SELECT l.id,l.title,v.name AS variant,v.stock,v.unit FROM listing_variants v JOIN listings l ON l.id=v.listing_id WHERE l.seller_id=$1 AND l.status='ACTIVE' AND v.active AND v.stock<GREATEST(v.min_quantity*3,5) ORDER BY v.stock LIMIT 10",
      [u.id],
    );
    const decided = responses.accepted + responses.declined;
    return {
      days,
      orders: totals.orders,
      gross_kobo: Number(totals.gross_kobo),
      net_kobo: Number(totals.net_kobo),
      average_order_kobo: totals.orders ? Math.round(Number(totals.gross_kobo) / totals.orders) : 0,
      buyers: totals.buyers,
      repeat_buyers: repeat.n,
      acceptance_rate: decided ? responses.accepted / decided : null,
      statuses: Object.fromEntries(statuses.map((s) => [s.status, s.n])),
      daily: daily.map((d) => ({ ...d, gross_kobo: Number(d.gross_kobo) })),
      top_listings: top.map((t) => ({ ...t, gross_kobo: Number(t.gross_kobo) })),
      rating,
      followers: followers.n,
      low_stock: lowStock,
    };
  }
  return { getListing, listSellerListings, addStockAlert, removeStockAlert, getSellerAnalytics };
}
