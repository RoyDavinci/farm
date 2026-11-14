import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { Query } from '../database/client.js';
import { AppError, ensure } from '../lib/errors.js';
import type { RequestInput } from '../lib/http.js';
import type { AppDeps } from '../types/deps.js';
import { parsePage } from '../validators/common.validators.js';
import { audit } from './audit.service.js';
import { expireReservations, readBookings as readBookingsFor } from './booking.service.js';
import { notify } from './communications.service.js';
import { verifyFunding as verifyFundingWith } from './funding.service.js';
import { balance } from './ledger.service.js';
import { paymentService, type Provider } from './payment-provider.service.js';

/** Business logic for admin requests. HTTP-free: callers pass plain input. */
export function createAdminService(deps: AppDeps) {
  const { db, config: c } = deps;
  const payments = paymentService(c);
  const verifyFunding = (ref: string, provider?: Provider) =>
    verifyFundingWith(db, payments, ref, provider);
  const readBookings = (u: any, bookingId?: string) => readBookingsFor(db, u, bookingId);
  const page = parsePage;
  const id = () => randomUUID();
  async function getReconciliation(user: any, input: RequestInput) {
    return {
      funding: await db.query(
        'SELECT f.id,f.provider,f.amount_kobo,f.status,f.created_at,u.name AS payer_name FROM funding f JOIN users u ON u.id=f.user_id ORDER BY f.created_at DESC LIMIT 100',
      ),
      exceptions: await db.query(
        'SELECT * FROM reconciliation_exceptions ORDER BY created_at DESC LIMIT 100',
      ),
    };
  }
  async function recheckFunding(user: any, input: RequestInput) {
    const { id: ref } = input.params;
    try {
      await verifyFunding(ref as string);
      await db.transaction(async (q) => {
        await q.query(
          "UPDATE reconciliation_exceptions SET status='RESOLVED',resolution='Payment verified with provider' WHERE funding_id=$1",
          [ref],
        );
        await audit(q, user.id, 'funding.recheck', ref as string);
      });
      return { ok: true };
    } catch (error) {
      const [f] = await db.query('SELECT id FROM funding WHERE id=$1', [ref]);
      if (f)
        await db.query(
          "INSERT INTO reconciliation_exceptions(id,funding_id,reason) VALUES($1,$2,$3) ON CONFLICT(funding_id) DO UPDATE SET reason=$3,status='OPEN'",
          [id(), ref, error instanceof AppError ? error.code : 'PROVIDER_ERROR'],
        );
      throw error;
    }
  }
  async function getOverview(user: any, input: RequestInput) {
    const [sellers] = await db.query(
      "SELECT COUNT(*)::int AS total, COUNT(*) FILTER(WHERE status='PENDING')::int AS pending, COUNT(*) FILTER(WHERE status='APPROVED')::int AS approved FROM sellers",
    );
    const [orders] = await db.query(
      "SELECT COUNT(*)::int AS total, COUNT(*) FILTER(WHERE status='COMPLETED')::int AS completed, COUNT(*) FILTER(WHERE status IN ('ACCEPTED','READY_FOR_PICKUP'))::int AS active, COALESCE(SUM(total_kobo) FILTER(WHERE status='COMPLETED'),0)::text AS volume FROM bookings",
    );
    return {
      sellers,
      orders,
      revenue_kobo:
        (await balance(db, '', 'platform_revenue')) ||
        Number(
          (
            await db.query(
              "SELECT COALESCE(SUM(amount_kobo),0) AS n FROM ledger WHERE account='platform_revenue'",
            )
          )[0].n,
        ),
    };
  }
  async function listSellers(user: any, input: RequestInput) {
    return await db.query(
      'SELECT s.*,u.name,u.email,u.phone FROM sellers s JOIN users u ON u.id=s.user_id ORDER BY s.created_at DESC LIMIT 100',
    );
  }
  async function reviewSeller(q: Query, u: any, input: RequestInput) {
    const d = z
      .object({
        status: z.enum(['APPROVED', 'REJECTED', 'SUSPENDED']),
        reason: z.string().trim().min(3).max(500),
      })
      .parse(input.body);
    const [s] = await q.query(
      'UPDATE sellers SET status=$1,reason=$2 WHERE user_id=$3 RETURNING *',
      [d.status, d.reason, input.params.id],
    );
    ensure(s, 404, 'NOT_FOUND', 'Seller not found.');
    await audit(q, u.id, 'seller.review', s.user_id, d);
    await notify(
      q,
      s.user_id,
      'verification',
      `Seller application ${d.status.toLowerCase()}`,
      d.reason,
    );
    return s;
  }
  async function listBookings(user: any, input: RequestInput) {
    await expireReservations(db);
    return await readBookings(user);
  }
  async function listListings(user: any, input: RequestInput) {
    return await db.query(
      'SELECT l.*,(SELECT m.thumbnail_url FROM media m WHERE m.url=l.image_url) AS thumbnail_url,s.business_name,s.city,s.area,s.business_type FROM listings l JOIN sellers s ON s.user_id=l.seller_id ORDER BY l.created_at DESC LIMIT 100',
    );
  }
  async function moderateListing(q: Query, u: any, input: RequestInput) {
    const d = z
      .object({
        status: z.enum(['ACTIVE', 'PAUSED']),
        reason: z.string().trim().min(3).max(500),
      })
      .parse(input.body);
    const [l] = await q.query('UPDATE listings SET status=$1 WHERE id=$2 RETURNING *', [
      d.status,
      input.params.id,
    ]);
    ensure(l, 404, 'NOT_FOUND', 'Listing not found.');
    await audit(q, u.id, 'listing.moderate', l.id, d);
    return l;
  }
  async function updateSettings(q: Query, u: any, input: RequestInput) {
    const d = z
      .object({
        reservation_hours: z.number().int().min(1).max(720),
        commission_bps: z.number().int().min(0).max(3000),
        payout_min_kobo: z.number().int().min(100).max(100000000).optional(),
        payout_fee_kobo: z.number().int().min(0).max(1000000).optional(),
        promotion_daily_kobo: z.number().int().min(0).max(10000000).optional(),
        delivery_commission_bps: z.number().int().min(0).max(5000).optional(),
        delivery_radius_km: z.number().int().min(1).max(200).optional(),
        pay_on_delivery_enabled: z.boolean().optional(),
      })
      .parse(input.body);
    const [s] = await q.query(
      'UPDATE settings SET reservation_hours=$1,commission_bps=$2,payout_min_kobo=COALESCE($3,payout_min_kobo),payout_fee_kobo=COALESCE($4,payout_fee_kobo) WHERE id=1 RETURNING *',
      [d.reservation_hours, d.commission_bps, d.payout_min_kobo ?? null, d.payout_fee_kobo ?? null],
    );
    const [extra] = await q.query(
      'UPDATE settings SET promotion_daily_kobo=COALESCE($1,promotion_daily_kobo),delivery_commission_bps=COALESCE($2,delivery_commission_bps),delivery_radius_km=COALESCE($3,delivery_radius_km),pay_on_delivery_enabled=COALESCE($4,pay_on_delivery_enabled) WHERE id=1 RETURNING *',
      [
        d.promotion_daily_kobo ?? null,
        d.delivery_commission_bps ?? null,
        d.delivery_radius_km ?? null,
        d.pay_on_delivery_enabled ?? null,
      ],
    );
    Object.assign(s, extra);
    await audit(q, u.id, 'settings.update', '1', d);
    return s;
  }
  async function listAudit(user: any, input: RequestInput) {
    const p = page(input);
    return await db.query(
      'SELECT a.*,a.created_at::text AS cursor,u.name AS actor_name FROM audit a LEFT JOIN users u ON u.id=a.actor_id WHERE ($1::timestamptz IS NULL OR (a.created_at,a.id)<($1,$3)) ORDER BY a.created_at DESC,a.id DESC LIMIT $2',
      [p.before ?? null, p.limit, p.before_id],
    );
  }
  async function listLedger(user: any, input: RequestInput) {
    const p = page(input);
    return await db.query(
      'SELECT *,created_at::text AS cursor FROM ledger WHERE ($1::timestamptz IS NULL OR (created_at,id)<($1,$3)) ORDER BY created_at DESC,id DESC LIMIT $2',
      [p.before ?? null, p.limit, p.before_id],
    );
  }
  return {
    getReconciliation,
    recheckFunding,
    getOverview,
    listSellers,
    reviewSeller,
    listBookings,
    listListings,
    moderateListing,
    updateSettings,
    listAudit,
    listLedger,
  };
}
