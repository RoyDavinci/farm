import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { Query } from '../database/client.js';
import { ensure } from '../lib/errors.js';
import type { RequestInput } from '../lib/http.js';
import type { AppDeps } from '../types/deps.js';
import { audit } from './audit.service.js';
import { monetisation } from './revenue.service.js';
import { notify } from './communications.service.js';
import { ledger, lockedBalance } from './ledger.service.js';
/** SQL condition: listing alias `l` has a running sponsored placement. */
export const activePromotion =
  "EXISTS(SELECT 1 FROM promotions p WHERE p.listing_id=l.id AND p.status='ACTIVE' AND p.starts_at<=now() AND p.ends_at>now())";

/** Business logic for promotions requests. HTTP-free: callers pass plain input. */
export function createPromotionsService(deps: AppDeps) {
  const { db } = deps;
  async function listMyPromotions(user: any, input: RequestInput) {
    return await db.query(
      "SELECT p.*,l.title,(p.status='ACTIVE' AND p.ends_at>now()) AS running FROM promotions p JOIN listings l ON l.id=p.listing_id WHERE p.seller_id=$1 ORDER BY p.created_at DESC LIMIT 50",
      [user.id],
    );
  }
  async function promoteListing(q: Query, u: any, input: RequestInput) {
    const d = z
      .object({
        days: z.number().int().min(1).max(60).optional(),
        package_id: z.string().max(64).optional(),
      })
      .refine((x) => x.days || x.package_id, { message: 'Choose a promotion package.' })
      .parse(input.body);
    ensure(
      (await monetisation(q)).sponsored_products,
      409,
      'FEATURE_PAUSED',
      'Sponsored listings are paused right now.',
    );
    const [s] = await q.query('SELECT status FROM sellers WHERE user_id=$1', [u.id]);
    ensure(s?.status === 'APPROVED', 403, 'SELLER_NOT_APPROVED', 'Approved sellers only.');
    const [l] = await q.query('SELECT * FROM listings WHERE id=$1 AND seller_id=$2 FOR UPDATE', [
      input.params.id,
      u.id,
    ]);
    ensure(l, 404, 'NOT_FOUND', 'Listing not found.');
    ensure(
      l.status === 'ACTIVE',
      409,
      'LISTING_PAUSED',
      'Activate this listing before promoting it.',
    );
    const [running] = await q.query(
      "SELECT id FROM promotions WHERE listing_id=$1 AND status='ACTIVE' AND ends_at>now()",
      [l.id],
    );
    ensure(!running, 409, 'ALREADY_PROMOTED', 'This listing is already sponsored.');
    // A fixed package sets the days and price; otherwise the daily rate applies.
    const [pkg] = d.package_id
      ? await q.query(
          "SELECT * FROM promotion_packages WHERE id=$1 AND kind='PRODUCT' AND active",
          [d.package_id],
        )
      : [];
    ensure(!d.package_id || pkg, 400, 'UNKNOWN_PACKAGE', 'Choose one of the promotion packages.');
    const [settings] = await q.query('SELECT promotion_daily_kobo FROM settings WHERE id=1');
    const days: number = pkg ? pkg.days : d.days!;
    const fee = pkg ? Number(pkg.price_kobo) : days * settings.promotion_daily_kobo;
    ensure(
      (await lockedBalance(q, u.id, 'seller_payable')) >= fee,
      409,
      'INSUFFICIENT_PROCEEDS',
      `Sponsoring for ${days} days costs ₦${(fee / 100).toLocaleString()}, paid from your seller proceeds.`,
    );
    const id = randomUUID();
    const [promotion] = await q.query(
      "INSERT INTO promotions(id,listing_id,seller_id,days,fee_kobo,ends_at,package_id) VALUES($1,$2,$3,$4,$5,now()+($4::int*interval '1 day'),$6) RETURNING *",
      [id, l.id, u.id, days, fee, pkg?.id ?? null],
    );
    if (fee)
      await ledger(q, id, [
        { account: 'seller_payable', owner: u.id, amount: -fee },
        { account: 'platform_revenue', amount: fee },
      ]);
    await audit(q, u.id, 'promotion.create', id, {
      listing_id: l.id,
      days,
      fee,
      package: pkg?.id ?? null,
    });
    return promotion;
  }
  return { listMyPromotions, promoteListing };
}

/** Business logic for adminpromotions requests. HTTP-free: callers pass plain input. */
export function createAdminPromotionsService(deps: AppDeps) {
  const { db } = deps;
  async function listPromotions(user: any, input: RequestInput) {
    return await db.query(
      "SELECT p.*,l.title,s.business_name,(p.status='ACTIVE' AND p.ends_at>now()) AS running FROM promotions p JOIN listings l ON l.id=p.listing_id JOIN sellers s ON s.user_id=p.seller_id ORDER BY running DESC,p.created_at DESC LIMIT 200",
    );
  }
  async function cancelPromotion(q: Query, u: any, input: RequestInput) {
    const d = z.object({ reason: z.string().trim().min(3).max(500) }).parse(input.body);
    const [p] = await q.query('SELECT * FROM promotions WHERE id=$1 FOR UPDATE', [input.params.id]);
    ensure(p, 404, 'NOT_FOUND', 'Promotion not found.');
    ensure(
      p.status === 'ACTIVE' && new Date(p.ends_at).getTime() > Date.now(),
      409,
      'INVALID_TRANSITION',
      'Only running promotions can be cancelled.',
    );
    // Refund whole unused days.
    const unusedDays = Math.floor((new Date(p.ends_at).getTime() - Date.now()) / 86400000);
    const refund = Math.min(
      Number(p.fee_kobo),
      Math.round((Number(p.fee_kobo) / p.days) * unusedDays),
    );
    if (refund)
      await ledger(q, p.id, [
        { account: 'platform_revenue', amount: -refund },
        { account: 'seller_payable', owner: p.seller_id, amount: refund },
      ]);
    const [updated] = await q.query(
      "UPDATE promotions SET status='CANCELLED',cancel_reason=$1,refund_kobo=$2,ends_at=LEAST(ends_at,now()) WHERE id=$3 RETURNING *",
      [d.reason, refund, p.id],
    );
    await audit(q, u.id, 'promotion.cancel', p.id, { ...d, refund });
    await notify(
      q,
      p.seller_id,
      'promotion',
      'Sponsored listing stopped',
      `${d.reason}${refund ? ` ₦${(refund / 100).toLocaleString()} for unused days was returned to your proceeds.` : ''}`,
    );
    return updated;
  }
  return { listPromotions, cancelPromotion };
}
