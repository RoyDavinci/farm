import { randomInt, randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { Query } from '../database/client.js';
import type { AppDeps } from '../types/deps.js';
import type { RequestInput } from '../lib/http.js';
import { ensure } from '../lib/errors.js';
import { audit } from './audit.service.js';
import { notify } from './communications.service.js';
import { ledger } from './ledger.service.js';
import { checkRider, riderFree } from './riders.service.js';
export const returnJourneyInput = z
  .object({
    dispute_id: z.uuid(),
    driver_id: z.uuid(),
    pickup_address: z.string().trim().min(8).max(500),
    pickup_latitude: z.number().min(-90).max(90),
    pickup_longitude: z.number().min(-180).max(180),
    fee_kobo: z.number().int().min(100).max(100000000),
    driver_kobo: z.number().int().min(0).max(100000000),
    payer: z.enum(['BUYER', 'SELLER', 'PLATFORM']),
    reason: z.string().trim().min(10).max(2000),
  })
  .refine(
    (d) => d.driver_kobo <= d.fee_kobo,
    'Driver compensation cannot exceed the reviewed return fee.',
  );
function safeReturn(r: any, u: any) {
  const { pickup_pin, return_pin, pin_failures, pin_locked_until, ...safe } = r;
  if (!['RETURNED', 'CANCELLED'].includes(r.status)) {
    if (u.id === r.buyer_id) safe.pickup_pin = pickup_pin;
    if (u.id === r.seller_id) safe.return_pin = return_pin;
  }
  return safe;
}
export function createReturnsOperationsService({ db, config }: AppDeps) {
  async function mine(u: any) {
    return (
      await db.query(
        'SELECT * FROM return_journeys WHERE buyer_id=$1 OR seller_id=$1 OR driver_id=$1 ORDER BY created_at DESC LIMIT 100',
        [u.id],
      )
    ).map((r) => safeReturn(r, u));
  }
  async function list() {
    const rows = await db.query(
      'SELECT r.*,b.title FROM return_journeys r JOIN disputes d ON d.id=r.dispute_id JOIN bookings b ON b.id=d.booking_id ORDER BY r.created_at DESC LIMIT 200',
    );
    return rows.map(({ pickup_pin, return_pin, ...r }) => r);
  }
  async function create(q: Query, u: any, i: RequestInput) {
    ensure(
      config.demo,
      409,
      'POLICY_REVIEW_REQUIRED',
      'Return charge allocation is available in simulation; live payer/liability rules need approval.',
    );
    const v = returnJourneyInput.parse(i.body);
    const [ref] = await q.query('SELECT booking_id FROM disputes WHERE id=$1', [v.dispute_id]);
    ensure(ref, 404, 'NOT_FOUND', 'Case not found.');
    const [b] = await q.query('SELECT * FROM bookings WHERE id=$1 FOR UPDATE', [ref.booking_id]);
    const [d] = await q.query('SELECT * FROM disputes WHERE id=$1 FOR UPDATE', [v.dispute_id]);
    ensure(
      d.status === 'OPEN' && d.return_status === 'REQUIRED',
      409,
      'RETURN_NOT_REQUIRED',
      'Support must require a return on this open case first.',
    );
    ensure(
      b.pickup_latitude != null && b.pickup_longitude != null && b.pickup_address_snapshot,
      409,
      'PICKUP_MISSING',
      'Original seller pickup details are unavailable.',
    );
    ensure(
      v.driver_id !== b.seller_id && v.driver_id !== b.buyer_id,
      400,
      'CONFLICT',
      'Choose an independent rider.',
    );
    await checkRider(q, v.driver_id, b.buyer_id);
    await riderFree(q, v.driver_id);
    const id = randomUUID(),
      account =
        v.payer === 'BUYER'
          ? 'wallet'
          : v.payer === 'SELLER'
            ? 'seller_payable'
            : 'platform_revenue',
      owner = v.payer === 'BUYER' ? b.buyer_id : v.payer === 'SELLER' ? b.seller_id : null;
    await ledger(q, id, [
      { account, owner: owner || undefined, amount: -v.fee_kobo },
      { account: 'return_escrow', owner: id, amount: v.fee_kobo },
    ]);
    await q.query(
      'INSERT INTO return_journeys(id,dispute_id,buyer_id,seller_id,driver_id,pickup_address,pickup_latitude,pickup_longitude,dropoff_address,dropoff_latitude,dropoff_longitude,fee_kobo,driver_kobo,payer_account,payer_id,pickup_pin,return_pin,reason,reviewed_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)',
      [
        id,
        d.id,
        b.buyer_id,
        b.seller_id,
        v.driver_id,
        v.pickup_address,
        v.pickup_latitude,
        v.pickup_longitude,
        b.pickup_address_snapshot,
        b.pickup_latitude,
        b.pickup_longitude,
        v.fee_kobo,
        v.driver_kobo,
        account,
        owner,
        String(randomInt(100000, 1000000)),
        String(randomInt(100000, 1000000)),
        v.reason,
        u.id,
      ],
    );
    await audit(q, u.id, 'return.arrange', id, {
      payer: v.payer,
      fee_kobo: v.fee_kobo,
      driver_kobo: v.driver_kobo,
      reason: v.reason,
    });
    for (const uid of [b.buyer_id, b.seller_id, v.driver_id])
      await notify(
        q,
        uid,
        'dispute',
        'Return transport arranged',
        'Reviewed return transport is ready. Open return journeys for instructions.',
        b.id,
      );
    return { id };
  }
  async function action(q: Query, u: any, i: RequestInput) {
    ensure(
      config.demo,
      409,
      'POLICY_REVIEW_REQUIRED',
      'Return financial actions remain in development review until approval.',
    );
    const { action, pin } = z
      .object({
        action: z.enum(['accept', 'pickup', 'complete', 'cancel']),
        pin: z
          .string()
          .regex(/^\d{6}$/)
          .optional(),
      })
      .parse(i.body);
    const [ref] = await q.query('SELECT dispute_id FROM return_journeys WHERE id=$1', [
      i.params.id,
    ]);
    ensure(ref, 404, 'NOT_FOUND', 'Return journey not found.');
    const [d] = await q.query('SELECT * FROM disputes WHERE id=$1 FOR UPDATE', [ref.dispute_id]);
    const [r] = await q.query('SELECT * FROM return_journeys WHERE id=$1 FOR UPDATE', [
      i.params.id,
    ]);
    ensure(
      [r.driver_id, r.buyer_id, r.seller_id].includes(u.id),
      404,
      'NOT_FOUND',
      'Return journey not found.',
    );
    if (action === 'cancel') {
      ensure(
        ['ASSIGNED', 'ACCEPTED'].includes(r.status) &&
          (u.id === r.driver_id || u.id === r.buyer_id),
        409,
        'INVALID_TRANSITION',
        'An uncollected return can be cancelled by the buyer or assigned rider.',
      );
      await ledger(q, r.id, [
        { account: 'return_escrow', owner: r.id, amount: -r.fee_kobo },
        { account: r.payer_account, owner: r.payer_id || undefined, amount: r.fee_kobo },
      ]);
      await q.query("UPDATE return_journeys SET status='CANCELLED',updated_at=now() WHERE id=$1", [
        r.id,
      ]);
    } else {
      ensure(r.driver_id === u.id, 403, 'FORBIDDEN', 'Assigned return rider only.');
      ensure(
        d.status === 'OPEN',
        409,
        'CASE_CLOSED',
        'Support must reopen the case before moving returned goods.',
      );
      if (action === 'accept') {
        ensure(
          r.status === 'ASSIGNED',
          409,
          'INVALID_TRANSITION',
          'This return invitation is no longer pending.',
        );
        await riderFree(q, u.id);
        await q.query("UPDATE return_journeys SET status='ACCEPTED',updated_at=now() WHERE id=$1", [
          r.id,
        ]);
      } else {
        ensure(
          r.status === (action === 'pickup' ? 'ACCEPTED' : 'PICKED_UP'),
          409,
          'INVALID_TRANSITION',
          'Complete the previous return step first.',
        );
        ensure(
          !r.pin_locked_until || new Date(r.pin_locked_until).getTime() <= Date.now(),
          429,
          'PIN_LOCKED',
          'Try again after the PIN lock expires.',
        );
        if (pin !== (action === 'pickup' ? r.pickup_pin : r.return_pin)) {
          await q.query(
            "UPDATE return_journeys SET pin_failures=pin_failures+1,pin_locked_until=CASE WHEN (pin_failures+1)%5=0 THEN now()+interval '15 minutes' ELSE NULL END WHERE id=$1",
            [r.id],
          );
          return { error: { status: 400, code: 'INVALID_PIN', message: 'Incorrect return PIN.' } };
        }
        if (action === 'pickup')
          await q.query(
            "UPDATE return_journeys SET status='PICKED_UP',updated_at=now(),pin_failures=0 WHERE id=$1",
            [r.id],
          );
        else {
          await ledger(q, r.id, [
            { account: 'return_escrow', owner: r.id, amount: -r.fee_kobo },
            { account: 'seller_payable', owner: u.id, amount: r.driver_kobo },
            { account: 'platform_revenue', amount: r.fee_kobo - r.driver_kobo },
          ]);
          await q.query(
            "UPDATE return_journeys SET status='RETURNED',updated_at=now(),pin_failures=0 WHERE id=$1",
            [r.id],
          );
          await q.query("UPDATE disputes SET return_status='RECEIVED' WHERE id=$1", [d.id]);
        }
      }
    }
    await audit(q, u.id, `return.${action}`, r.id);
    return { ok: true };
  }
  async function appeals(u: any) {
    return db.query(
      'SELECT a.* FROM dispute_appeals a JOIN disputes d ON d.id=a.dispute_id JOIN bookings b ON b.id=d.booking_id WHERE b.buyer_id=$1 OR b.seller_id=$1 ORDER BY a.created_at DESC LIMIT 100',
      [u.id],
    );
  }
  async function appeal(q: Query, u: any, i: RequestInput) {
    const { reason } = z.object({ reason: z.string().trim().min(10).max(4000) }).parse(i.body);
    const [d] = await q.query(
      'SELECT d.*,b.buyer_id,b.seller_id FROM disputes d JOIN bookings b ON b.id=d.booking_id WHERE d.id=$1 FOR UPDATE OF d',
      [i.params.id],
    );
    ensure(
      d && [d.buyer_id, d.seller_id].includes(u.id) && d.status === 'RESOLVED',
      404,
      'NOT_FOUND',
      'Resolved case not found.',
    );
    const [p] = await q.query('SELECT draft FROM marketplace_policies WHERE id=1');
    const days = Number(p.draft.appeal_days || 7);
    ensure(
      d.resolved_at && new Date(d.resolved_at).getTime() + days * 86400000 > Date.now(),
      409,
      'APPEAL_WINDOW_CLOSED',
      `Appeals must be filed within the proposed ${days}-day review window.`,
    );
    const id = randomUUID();
    await q.query(
      'INSERT INTO dispute_appeals(id,dispute_id,appellant_id,reason) VALUES($1,$2,$3,$4)',
      [id, d.id, u.id, reason],
    );
    await audit(q, u.id, 'dispute.appeal', d.id);
    return { id };
  }
  async function listAppeals() {
    return db.query('SELECT * FROM dispute_appeals ORDER BY created_at DESC LIMIT 200');
  }
  async function reviewAppeal(q: Query, u: any, i: RequestInput) {
    const { status, resolution } = z
      .object({
        status: z.enum(['UPHELD', 'DENIED']),
        resolution: z.string().trim().min(10).max(4000),
      })
      .parse(i.body);
    const [a] = await q.query(
      "UPDATE dispute_appeals SET status=$1,resolution=$2,reviewer_id=$3 WHERE id=$4 AND status='OPEN' RETURNING *",
      [status, resolution, u.id, i.params.id],
    );
    ensure(a, 404, 'NOT_FOUND', 'Open appeal not found.');
    ensure(
      a.appellant_id !== u.id,
      403,
      'CONFLICT',
      'Another staff member must review this appeal.',
    );
    await audit(q, u.id, 'dispute.appeal_review', a.dispute_id, { status, resolution });
    await notify(q, a.appellant_id, 'dispute', 'Appeal reviewed', resolution);
    return { ok: true };
  }
  return { mine, list, create, action, appeals, appeal, listAppeals, reviewAppeal };
}
