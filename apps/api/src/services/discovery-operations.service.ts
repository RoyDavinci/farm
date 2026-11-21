import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { Query, Database } from '../database/client.js';
import type { AppDeps } from '../types/deps.js';
import type { RequestInput } from '../lib/http.js';
import { ensure } from '../lib/errors.js';
import { audit } from './audit.service.js';
import { notify } from './communications.service.js';
import { bookableSql } from './retention.service.js';
import { createBookingsService } from './booking.service.js';
export const discoveryPreferenceInput = z.object({
  categories: z.array(z.string().trim().min(2).max(50)).max(20),
  digest_enabled: z.boolean(),
  digest_frequency: z.enum(['DAILY', 'WEEKLY']),
  state: z.string().trim().max(100),
  lga: z.string().trim().max(100),
});
export async function discoveryEvent(
  q: Query,
  uid: string,
  kind: 'SEARCH' | 'CONTACT' | 'BOOKING',
  listing?: string,
  category?: string,
) {
  await q.query(
    "INSERT INTO marketplace_events(id,user_id,kind,listing_id,category) SELECT $1,$2,$3,$4,$5 WHERE $3='BOOKING' OR NOT EXISTS(SELECT 1 FROM marketplace_events WHERE user_id=$2 AND kind=$3 AND listing_id IS NOT DISTINCT FROM $4 AND created_at>now()-interval '5 minutes')",
    [randomUUID(), uid, kind, listing || null, category || null],
  );
}
export async function discoveryMaintenance(db: Database) {
  await db.transaction(async (q) => {
    const interests = await q.query(
      `SELECT p.*,l.title FROM preorder_interests p JOIN listings l ON l.id=p.listing_id JOIN sellers s ON s.user_id=l.seller_id WHERE p.status='WAITING' AND (l.available_from IS NULL OR l.available_from<=now()) AND l.status='ACTIVE' AND s.status='APPROVED' AND ${bookableSql('l')} ORDER BY p.id LIMIT 100 FOR UPDATE OF p SKIP LOCKED`,
    );
    for (const p of interests) {
      await q.query(
        "UPDATE preorder_interests SET status='AVAILABLE',notified_at=now() WHERE id=$1",
        [p.id],
      );
      await notify(
        q,
        p.buyer_id,
        'stock',
        'Your requested product is available',
        `${p.title} is available. Open your interest request, review the current price and confirm a booking.`,
      );
    }
    const prefs = await q.query(
      "SELECT p.* FROM discovery_preferences p JOIN notification_preferences n ON n.user_id=p.user_id JOIN users u ON u.id=p.user_id WHERE p.digest_enabled AND n.marketing_enabled AND u.status='ACTIVE' AND (p.last_digest_at IS NULL OR p.last_digest_at<now()-CASE WHEN p.digest_frequency='DAILY' THEN interval '1 day' ELSE interval '7 days' END) ORDER BY p.user_id LIMIT 50 FOR UPDATE OF p SKIP LOCKED",
    );
    for (const p of prefs) {
      const products = await q.query(
        `SELECT l.title FROM listings l JOIN sellers s ON s.user_id=l.seller_id WHERE l.status='ACTIVE' AND s.status='APPROVED' AND EXISTS(SELECT 1 FROM users u WHERE u.id=s.user_id AND u.status='ACTIVE') AND ${bookableSql('l')} AND (jsonb_array_length($1::jsonb)=0 OR $1::jsonb ? l.category) AND lower(s.state)=lower($2) AND lower(s.lga)=lower($3) AND l.seller_id<>$4 AND NOT EXISTS(SELECT 1 FROM user_blocks WHERE (blocker_id=$4 AND blocked_id=s.user_id) OR (blocked_id=$4 AND blocker_id=s.user_id)) AND NOT EXISTS(SELECT 1 FROM local_status_mutes WHERE user_id=$4 AND ((kind='SELLER' AND target=s.user_id) OR (kind='CATEGORY' AND target=l.category))) ORDER BY l.created_at DESC LIMIT 3`,
        [JSON.stringify(p.categories), p.state, p.lga, p.user_id],
      );
      await q.query('UPDATE discovery_preferences SET last_digest_at=now() WHERE user_id=$1', [
        p.user_id,
      ]);
      if (products.length)
        await notify(
          q,
          p.user_id,
          'local_digest',
          'Your local market summary',
          products.map((l) => l.title).join(' · '),
        );
    }
    await q.query("DELETE FROM marketplace_events WHERE created_at<now()-interval '90 days'");
  });
}
export function createDiscoveryOperationsService(deps: AppDeps) {
  const { db, config } = deps;
  async function preferences(u: any) {
    return (
      (
        await db.query(
          'SELECT categories,digest_enabled,digest_frequency,state,lga FROM discovery_preferences WHERE user_id=$1',
          [u.id],
        )
      )[0] || {
        categories: [],
        digest_enabled: false,
        digest_frequency: 'WEEKLY',
        state: '',
        lga: '',
      }
    );
  }
  async function savePreferences(q: Query, u: any, i: RequestInput) {
    const d = discoveryPreferenceInput.parse(i.body);
    ensure(
      !d.digest_enabled || (d.state && d.lga),
      400,
      'AREA_REQUIRED',
      'Choose a state and LGA for summaries.',
    );
    for (const category of d.categories) {
      const [c] = await q.query('SELECT active FROM catalogue_categories WHERE name=$1', [
        category,
      ]);
      ensure(c?.active, 400, 'CATEGORY_UNAVAILABLE', 'Choose active categories.');
    }
    await q.query(
      'INSERT INTO discovery_preferences(user_id,categories,digest_enabled,digest_frequency,state,lga) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(user_id) DO UPDATE SET categories=$2,digest_enabled=$3,digest_frequency=$4,state=$5,lga=$6',
      [u.id, JSON.stringify(d.categories), d.digest_enabled, d.digest_frequency, d.state, d.lga],
    );
    await audit(q, u.id, 'discovery.preferences', u.id, { digest_enabled: d.digest_enabled });
    return { ok: true };
  }
  async function interests(u: any) {
    return db.query(
      'SELECT p.*,l.title,l.price_kobo,l.available_from,l.preorder_advance_allowed FROM preorder_interests p JOIN listings l ON l.id=p.listing_id WHERE p.buyer_id=$1 ORDER BY p.created_at DESC LIMIT 100',
      [u.id],
    );
  }
  async function registerInterest(q: Query, u: any, i: RequestInput) {
    const { quantity } = z.object({ quantity: z.number().int().min(1).max(100000) }).parse(i.body);
    const [l] = await q.query(
      "SELECT l.id FROM listings l JOIN sellers s ON s.user_id=l.seller_id WHERE l.id=$1 AND l.seller_id<>$2 AND l.status='ACTIVE' AND l.archived_at IS NULL AND s.status='APPROVED'",
      [i.params.id, u.id],
    );
    ensure(l, 404, 'NOT_FOUND', 'Product not found.');
    const [existing] = await q.query(
      'SELECT status FROM preorder_interests WHERE buyer_id=$1 AND listing_id=$2 FOR UPDATE',
      [u.id, l.id],
    );
    ensure(
      existing?.status !== 'CONFIRMED',
      409,
      'ALREADY_CONFIRMED',
      'This interest already has a booking.',
    );
    await q.query(
      "INSERT INTO preorder_interests(id,buyer_id,listing_id,quantity) VALUES($1,$2,$3,$4) ON CONFLICT(buyer_id,listing_id) DO UPDATE SET quantity=$4,status='WAITING',notified_at=NULL",
      [randomUUID(), u.id, l.id, quantity],
    );
    return { ok: true };
  }
  async function confirmInterest(q: Query, u: any, i: RequestInput) {
    const [p] = await q.query(
      'SELECT * FROM preorder_interests WHERE id=$1 AND buyer_id=$2 FOR UPDATE',
      [i.params.id, u.id],
    );
    ensure(
      p && ['WAITING', 'AVAILABLE'].includes(p.status),
      409,
      'INTEREST_UNAVAILABLE',
      'Choose an unconverted interest request.',
    );
    const b = await createBookingsService(deps).createBooking(q, u, {
      ...i,
      body: { listing_id: p.listing_id, quantity: p.quantity },
    });
    await q.query("UPDATE preorder_interests SET status='CONFIRMED',booking_id=$1 WHERE id=$2", [
      b.id,
      p.id,
    ]);
    return { id: b.id };
  }
  async function cancelInterest(q: Query, u: any, i: RequestInput) {
    const [p] = await q.query(
      "UPDATE preorder_interests SET status='CANCELLED' WHERE id=$1 AND buyer_id=$2 AND status IN ('WAITING','AVAILABLE') RETURNING id",
      [i.params.id, u.id],
    );
    ensure(p, 404, 'NOT_FOUND', 'Open interest request not found.');
    return { ok: true };
  }
  async function advancePreference(q: Query, u: any, i: RequestInput) {
    const { allowed } = z.object({ allowed: z.boolean() }).parse(i.body);
    ensure(
      !allowed || config.demo,
      409,
      'POLICY_REVIEW_REQUIRED',
      'Advance payment can only be previewed in simulation until the provider arrangement is approved.',
    );
    const [l] = await q.query(
      'UPDATE listings SET preorder_advance_allowed=$1 WHERE id=$2 AND seller_id=$3 RETURNING id',
      [allowed, i.params.id, u.id],
    );
    ensure(l, 404, 'NOT_FOUND', 'Listing not found.');
    await audit(q, u.id, 'preorder.advance', l.id, { allowed });
    return { ok: true };
  }
  async function metrics() {
    const [funnel] = await db.query(
      `WITH recent AS (SELECT * FROM marketplace_events WHERE created_at>now()-interval '30 days'),searchers AS(SELECT DISTINCT user_id FROM recent WHERE kind='SEARCH') SELECT (SELECT COUNT(*)::int FROM recent WHERE kind='SEARCH') AS search_events,(SELECT COUNT(*)::int FROM searchers) AS searching_buyers,(SELECT COUNT(DISTINCT user_id)::int FROM recent WHERE kind='CONTACT') AS contacting_buyers,(SELECT COUNT(DISTINCT buyer_id)::int FROM bookings WHERE created_at>now()-interval '30 days') AS booking_buyers,(SELECT COUNT(DISTINCT b.buyer_id)::int FROM bookings b JOIN searchers s ON s.user_id=b.buyer_id WHERE b.created_at>now()-interval '30 days') AS searchers_who_booked`,
    );
    const [orders] = await db.query(
      `SELECT COUNT(*)::int AS requested,COUNT(*) FILTER(WHERE status IN ('ACCEPTED','READY_FOR_PICKUP','COMPLETED'))::int AS accepted_or_completed,COUNT(*) FILTER(WHERE status='COMPLETED')::int AS completed,COUNT(*) FILTER(WHERE status IN ('CANCELLED','EXPIRED','DECLINED'))::int AS cancelled_or_declined,(SELECT COUNT(*)::int FROM disputes WHERE created_at>now()-interval '30 days') AS disputes,(SELECT COUNT(*)::int FROM (SELECT buyer_id FROM bookings WHERE status='COMPLETED' AND created_at>now()-interval '30 days' GROUP BY buyer_id HAVING COUNT(*)>1) r) AS repeat_buyers FROM bookings WHERE created_at>now()-interval '30 days'`,
    );
    const [network] = await db.query(
      `SELECT COUNT(*)::int AS deliveries,COUNT(*) FILTER(WHERE driver_id IS NOT NULL)::int AS accepted_deliveries,COUNT(*) FILTER(WHERE status='DELIVERED')::int AS completed_deliveries,COUNT(DISTINCT driver_id) FILTER(WHERE status='DELIVERED')::int AS working_drivers,COUNT(*) FILTER(WHERE scheduled_at IS NOT NULL)::int AS scheduled_deliveries,COUNT(*) FILTER(WHERE scheduled_at IS NOT NULL AND status='DELIVERED' AND delivered_at<=scheduled_at+interval '30 minutes')::int AS completed_within_scheduled_grace,(SELECT COUNT(*)::int FROM drivers WHERE status='APPROVED') AS approved_drivers,(SELECT COUNT(*)::int FROM drivers WHERE status='APPROVED' AND online) AS online_drivers,(SELECT COUNT(DISTINCT driver_id)::int FROM deliveries WHERE status IN ('ASSIGNED','PICKED_UP')) AS currently_busy_drivers FROM deliveries WHERE created_at>now()-interval '30 days'`,
    );
    const [supply] = await db.query(
      `SELECT COUNT(DISTINCT seller_id)::int AS active_sellers,COUNT(*)::int AS available_listings,COUNT(*) FILTER(WHERE confirmed_at>now()-interval '7 days')::int AS recently_confirmed FROM listings l JOIN sellers s ON s.user_id=l.seller_id WHERE l.status='ACTIVE' AND s.status='APPROVED' AND ${bookableSql('l')}`,
    );
    const [status] = await db.query(
      "SELECT COUNT(DISTINCT seller_id)::int AS publishers,(SELECT COALESCE(SUM(views),0)::int FROM local_status_events) AS views,(SELECT COALESCE(SUM(clicks),0)::int FROM local_status_events) AS product_clicks,(SELECT COUNT(*)::int FROM status_clicks WHERE conversation_id IS NOT NULL) AS attributed_enquiries FROM local_statuses WHERE created_at>now()-interval '30 days'",
    );
    return {
      window_days: 30,
      funnel,
      orders,
      network,
      supply,
      status,
      notes: [
        'Search events are deduplicated per buyer within five minutes. Searcher-to-booking overlap is an association, not causal attribution.',
        'Driver activity and current busy/online counts are proxies, not measured driving-time utilisation.',
        'Scheduled timeliness uses a displayed 30-minute reporting grace; it is not a delivery guarantee.',
        'Status view/click/enquiry totals are lifetime aggregates; publishers use the 30-day window.',
      ],
    };
  }
  return {
    preferences,
    savePreferences,
    interests,
    registerInterest,
    confirmInterest,
    cancelInterest,
    advancePreference,
    metrics,
  };
}
