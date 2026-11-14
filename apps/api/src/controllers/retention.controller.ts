import type { RequestHandler } from 'express';
import { z } from 'zod';
import { ensure } from '../lib/errors.js';
import { attachVariants } from '../services/catalog.service.js';
import { visibleListing } from '../services/retention.service.js';
import type { AppDeps } from '../types/deps.js';

export function createRetentionController(deps: AppDeps) {
  const { db, config: c, mutate } = deps;

  const getListing: RequestHandler = async (req, res) => {
    const u = res.locals.user;
    const rows = await db.query(
      `SELECT * FROM (${visibleListing} UNION ALL SELECT l.*,(SELECT m.thumbnail_url FROM media m WHERE m.url=l.image_url),s.business_name,s.city,s.area,s.business_type,FALSE FROM listings l JOIN sellers s ON s.user_id=l.seller_id WHERE l.seller_id=$2) x WHERE x.id=$1 LIMIT 1`,
      [req.params.id, u.id],
    );
    ensure(rows[0], 404, 'NOT_FOUND', 'This listing is no longer available.');
    const [listing] = await attachVariants(db, rows, rows[0].seller_id === u.id);
    const [alert] = await db.query(
      'SELECT 1 FROM stock_alerts WHERE buyer_id=$1 AND listing_id=$2',
      [u.id, listing.id],
    );
    res.json({ ...listing, stock_alert: !!alert });
  };
  const listSellerListings: RequestHandler = async (req, res) => {
    const rows = await db.query(
      `${visibleListing} AND l.seller_id=$1 ORDER BY in_stock DESC,l.created_at DESC LIMIT 100`,
      [req.params.id],
    );
    res.json(await attachVariants(db, rows, false));
  };
  const addStockAlert: RequestHandler = async (req, res) =>
    mutate(req, res, async (q, u) => {
      const [l] = await q.query(`${visibleListing} AND l.id=$1`, [req.params.id]);
      ensure(l, 404, 'NOT_FOUND', 'Listing not found.');
      ensure(l.seller_id !== u.id, 400, 'OWN_LISTING', 'You cannot follow your own listing.');
      await q.query(
        'INSERT INTO stock_alerts(buyer_id,listing_id) VALUES($1,$2) ON CONFLICT DO NOTHING',
        [u.id, l.id],
      );
      return { ok: true, stock_alert: true };
    });
  const removeStockAlert: RequestHandler = async (req, res) =>
    mutate(req, res, async (q, u) => {
      await q.query('DELETE FROM stock_alerts WHERE buyer_id=$1 AND listing_id=$2', [
        u.id,
        req.params.id,
      ]);
      return { ok: true, stock_alert: false };
    });
  const getSellerAnalytics: RequestHandler = async (req, res) => {
    const u = res.locals.user;
    const { days } = z
      .object({ days: z.coerce.number().int().min(7).max(365).default(30) })
      .parse(req.query);
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
    res.json({
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
    });
  };
  return { getListing, listSellerListings, addStockAlert, removeStockAlert, getSellerAnalytics };
}
