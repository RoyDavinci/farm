import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { Query, Database } from '../database/client.js';
import type { RequestInput } from '../lib/http.js';
import type { AppDeps } from '../types/deps.js';
import { ensure } from '../lib/errors.js';
import { audit } from './audit.service.js';
import { ledger, lockedBalance } from './ledger.service.js';
import { bookableSql } from './retention.service.js';
export const boostInput = z
  .object({
    hours: z.number().int().min(1).max(72),
    targets: z
      .array(
        z.object({
          state: z.string().trim().min(2).max(100),
          kind: z.enum(['LGA', 'CITY']),
          name: z.string().trim().min(2).max(100),
        }),
      )
      .min(1)
      .max(5),
  })
  .superRefine((v, ctx) => {
    const keys = v.targets.map((t) => `${t.state}:${t.kind}:${t.name}`.toLowerCase());
    if (new Set(keys).size !== keys.length)
      ctx.addIssue({ code: 'custom', message: 'Choose distinct target areas.' });
  });
export const campaignReady = `st.status='ACTIVE' AND st.expires_at>now() AND l.status='ACTIVE' AND ${bookableSql('l')} AND s.status='APPROVED' AND u.status='ACTIVE'`;
export async function settleBoost(
  q: Query,
  row: any,
  actor: string | null,
  reason: string,
  terminal = 'CANCELLED',
) {
  const pending = row.status === 'PENDING';
  ensure(
    pending || row.status === 'ACTIVE',
    409,
    'BOOST_CLOSED',
    'This campaign is already closed.',
  );
  const remaining = row.ends_at ? Math.max(0, new Date(row.ends_at).getTime() - Date.now()) : 0;
  const refund = pending
    ? row.fee_kobo
    : Math.min(row.fee_kobo, Math.floor((row.fee_kobo * remaining) / (row.hours * 3600000)));
  if (refund)
    await ledger(q, row.id, [
      {
        account: pending ? 'boost_escrow' : 'platform_revenue',
        ...(pending ? { owner: row.id } : {}),
        amount: -refund,
      },
      { account: 'seller_payable', owner: row.seller_id, amount: refund },
    ]);
  await q.query(
    'UPDATE status_boosts SET status=$1,refund_kobo=$2,reason=$3,ends_at=CASE WHEN starts_at IS NULL THEN NULL ELSE LEAST(ends_at,now()) END WHERE id=$4',
    [terminal, refund, reason, row.id],
  );
  await audit(q, actor, 'status_boost.stop', row.id, {
    reason,
    refund_kobo: refund,
    status: terminal,
  });
  return { ok: true, refund_kobo: refund };
}
export async function stopStatusBoosts(q: Query, statusId: string, actor: string, reason: string) {
  const rows = await q.query(
    "SELECT * FROM status_boosts WHERE status_id=$1 AND status IN ('PENDING','ACTIVE') ORDER BY id FOR UPDATE",
    [statusId],
  );
  for (const row of rows) await settleBoost(q, row, actor, reason);
}
export async function recoverStatusBoosts(db: Database) {
  await db.transaction(async (q) => {
    const rows =
      await q.query(`SELECT b.* FROM status_boosts b JOIN local_statuses st ON st.id=b.status_id JOIN listings l ON l.id=st.listing_id JOIN sellers s ON s.user_id=st.seller_id JOIN users u ON u.id=s.user_id
   WHERE b.status IN ('PENDING','ACTIVE') AND (NOT (${campaignReady}) OR (b.status='ACTIVE' AND b.ends_at<=now())) ORDER BY b.id LIMIT 50 FOR UPDATE OF b SKIP LOCKED`);
    for (const row of rows)
      await settleBoost(
        q,
        row,
        null,
        'Campaign ended or its status/product became unavailable.',
        row.status === 'ACTIVE' && new Date(row.ends_at).getTime() <= Date.now()
          ? 'COMPLETED'
          : 'CANCELLED',
      );
    await q.query(
      "DELETE FROM status_clicks WHERE booking_id IS NULL AND conversation_id IS NULL AND expires_at<now()-interval '7 days'",
    );
  });
}
export function createStatusBoostService({ db, config }: AppDeps) {
  async function price(q: Query, user: any, input: RequestInput) {
    const d = boostInput.parse(input.body);
    const [st] = await q.query(
      `SELECT st.* FROM local_statuses st JOIN listings l ON l.id=st.listing_id JOIN sellers s ON s.user_id=st.seller_id JOIN users u ON u.id=s.user_id WHERE st.id=$1 AND st.seller_id=$2 AND ${campaignReady}`,
      [input.params.id, user.id],
    );
    ensure(st, 409, 'STATUS_UNAVAILABLE', 'Choose your active status with an available product.');
    ensure(
      new Date(st.expires_at).getTime() >= Date.now() + d.hours * 3600000,
      409,
      'STATUS_ENDS_TOO_SOON',
      'Choose fewer hours so the campaign fits within the status lifetime.',
    );
    const [settings] = await q.query('SELECT status_boost_hourly_kobo FROM settings WHERE id=1');
    ensure(
      d.hours * d.targets.length * settings.status_boost_hourly_kobo <= 100000000,
      400,
      'CAMPAIGN_LIMIT',
      'Campaign budget exceeds the current limit.',
    );
    return {
      hours: d.hours,
      targets: d.targets,
      fee_kobo: d.hours * d.targets.length * settings.status_boost_hourly_kobo,
      hourly_kobo: settings.status_boost_hourly_kobo,
      status_expires_at: st.expires_at,
    };
  }
  async function quote(user: any, input: RequestInput) {
    return price(db, user, input);
  }
  async function create(q: Query, user: any, input: RequestInput) {
    ensure(
      config.demo || config.payments,
      503,
      'PAYMENTS_DISABLED',
      'Paid campaigns are not enabled.',
    );
    await q.query('SELECT id FROM local_statuses WHERE id=$1 FOR UPDATE', [input.params.id]);
    const offer = await price(q, user, input),
      { expected_fee_kobo } = z
        .object({ expected_fee_kobo: z.number().int().min(0) })
        .parse(input.body);
    ensure(
      offer.fee_kobo === expected_fee_kobo,
      409,
      'BOOST_PRICE_CHANGED',
      'Review the latest campaign price before confirming.',
    );
    const [running] = await q.query(
      "SELECT id FROM status_boosts WHERE status_id=$1 AND status IN ('PENDING','ACTIVE')",
      [input.params.id],
    );
    ensure(!running, 409, 'BOOST_RUNNING', 'This status already has a pending or active campaign.');
    ensure(
      (await lockedBalance(q, user.id, 'seller_payable')) >= offer.fee_kobo,
      409,
      'INSUFFICIENT_PROCEEDS',
      'This campaign is paid from available seller earnings.',
    );
    const id = randomUUID();
    await q.query(
      'INSERT INTO status_boosts(id,status_id,seller_id,hours,fee_kobo,targets) VALUES($1,$2,$3,$4,$5,$6::jsonb)',
      [id, input.params.id, user.id, offer.hours, offer.fee_kobo, JSON.stringify(offer.targets)],
    );
    if (offer.fee_kobo)
      await ledger(q, id, [
        { account: 'seller_payable', owner: user.id, amount: -offer.fee_kobo },
        { account: 'boost_escrow', owner: id, amount: offer.fee_kobo },
      ]);
    await audit(q, user.id, 'status_boost.request', id, {
      fee_kobo: offer.fee_kobo,
      targets: offer.targets,
    });
    return { id, status: 'PENDING', fee_kobo: offer.fee_kobo };
  }
  async function mine(user: any) {
    return list(user.id);
  }
  async function list(sellerId?: string) {
    return db.query(
      `SELECT b.*,l.title,s.business_name,st.media_type,st.media_url,st.thumbnail_url,st.caption,st.expires_at AS status_expires_at,
 COALESCE((SELECT SUM(views)::int FROM local_status_events WHERE campaign_key=b.id),0) AS views,
 COALESCE((SELECT SUM(clicks)::int FROM local_status_events WHERE campaign_key=b.id),0) AS product_clicks,
 (SELECT COUNT(*)::int FROM status_clicks WHERE campaign_id=b.id AND booking_id IS NOT NULL) AS bookings,
 (SELECT COUNT(*)::int FROM status_clicks c JOIN bookings bk ON bk.id=c.booking_id WHERE c.campaign_id=b.id AND bk.status='COMPLETED') AS completed_bookings
 FROM status_boosts b JOIN local_statuses st ON st.id=b.status_id JOIN listings l ON l.id=st.listing_id JOIN sellers s ON s.user_id=b.seller_id WHERE ($1::text IS NULL OR b.seller_id=$1) ORDER BY (b.status='PENDING') DESC,b.created_at DESC LIMIT 200`,
      [sellerId ?? null],
    );
  }
  async function cancel(q: Query, user: any, input: RequestInput) {
    const [row] = await q.query(
      'SELECT * FROM status_boosts WHERE id=$1 AND seller_id=$2 FOR UPDATE',
      [input.params.id, user.id],
    );
    ensure(row, 404, 'NOT_FOUND', 'Campaign not found.');
    return settleBoost(q, row, user.id, 'Seller cancelled the campaign.');
  }
  async function review(q: Query, user: any, input: RequestInput) {
    const d = z
      .object({
        action: z.enum(['approve', 'reject', 'stop']),
        reason: z.string().trim().min(5).max(1000),
      })
      .parse(input.body);
    // Status first, then campaign, matches publication/removal lock order.
    const [ref] = await q.query('SELECT status_id FROM status_boosts WHERE id=$1', [
      input.params.id,
    ]);
    ensure(ref, 404, 'NOT_FOUND', 'Campaign not found.');
    await q.query('SELECT id FROM local_statuses WHERE id=$1 FOR UPDATE', [ref.status_id]);
    const [row] = await q.query('SELECT * FROM status_boosts WHERE id=$1 FOR UPDATE', [
      input.params.id,
    ]);
    if (d.action === 'reject')
      ensure(
        row.status === 'PENDING',
        409,
        'INVALID_TRANSITION',
        'Only pending campaigns may be rejected.',
      );
    if (d.action === 'stop')
      ensure(
        row.status === 'ACTIVE',
        409,
        'INVALID_TRANSITION',
        'Only active campaigns may be stopped.',
      );
    if (d.action !== 'approve')
      return settleBoost(
        q,
        row,
        user.id,
        d.reason,
        d.action === 'reject' ? 'REJECTED' : 'CANCELLED',
      );
    ensure(
      row.status === 'PENDING',
      409,
      'INVALID_TRANSITION',
      'Only a pending campaign may be approved.',
    );
    await price(
      q,
      { id: row.seller_id },
      { ...input, params: { id: row.status_id }, body: { hours: row.hours, targets: row.targets } },
    );
    if (row.fee_kobo)
      await ledger(q, row.id, [
        { account: 'boost_escrow', owner: row.id, amount: -row.fee_kobo },
        { account: 'platform_revenue', amount: row.fee_kobo },
      ]);
    await q.query(
      "UPDATE status_boosts SET status='ACTIVE',starts_at=now(),ends_at=now()+hours*interval '1 hour',reason=$1,reviewed_by=$2 WHERE id=$3",
      [d.reason, user.id, row.id],
    );
    await audit(q, user.id, 'status_boost.approve', row.id, { reason: d.reason });
    return { ok: true, refund_kobo: 0 };
  }
  return { quote, create, mine, list, cancel, review };
}
