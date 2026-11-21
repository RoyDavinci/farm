import { createShoppingMediaService } from './shopping-media.service.js';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { Database, Query } from '../database/client.js';
import type { AppDeps } from '../types/deps.js';
import type { RequestInput } from '../lib/http.js';
import { ensure } from '../lib/errors.js';
import { canAccess } from './staff.service.js';
import { audit } from './audit.service.js';
import { notify } from './communications.service.js';
import { fareFor, pin, point } from './deliveries.service.js';
import { balance, ledger, lockedBalance } from './ledger.service.js';
import { checkRider, requireNearby, riderFree } from './riders.service.js';
import { createRouting } from './routing.service.js';

export const shoppingQuoteInput = z.object({ rider_id: z.uuid(), source: point, dropoff: point });
export const shoppingInput = shoppingQuoteInput.extend({
  items: z.string().trim().min(5).max(3000),
  source_name: z.string().trim().min(2).max(150),
  source_address: z.string().trim().min(8).max(500),
  dropoff_address: z.string().trim().min(8).max(500),
  goods_budget_kobo: z.number().int().min(100).max(100000000),
  expected_delivery_fee_kobo: z.number().int().min(0).max(100000000),
  payment_mode: z.enum(['REIMBURSE', 'ADVANCE']),
});
const named = `SELECT r.*,b.name AS buyer_name,u.name AS rider_name,v.name AS vehicle_name
  FROM shopping_requests r JOIN users b ON b.id=r.buyer_id JOIN users u ON u.id=r.rider_id
  JOIN drivers d ON d.user_id=r.rider_id JOIN vehicle_types v ON v.code=d.vehicle_type`;
function safe(row: any, user: any) {
  const {
    delivery_pin,
    pin_failures,
    pin_locked_until,
    receipt_photos,
    rider_latitude,
    rider_longitude,
    rider_location_at,
    ...view
  } = row;
  if (row.buyer_id === user.id && row.status === 'PURCHASED' && !row.review_open)
    view.delivery_pin = delivery_pin;
  return view;
}
async function alertParties(q: Query, row: any, actor: string | null, title: string, body: string) {
  for (const uid of [row.buyer_id, row.rider_id])
    if (uid !== actor) await notify(q, uid, 'shopping', title, body);
}
export async function expireShoppingRequests(db: Database) {
  await db.transaction(async (q) => {
    const rows = await q.query(
      "SELECT * FROM shopping_requests WHERE status IN ('REQUESTED','ACCEPTED') AND created_at<now()-interval '24 hours' ORDER BY id FOR UPDATE SKIP LOCKED LIMIT 50",
    );
    for (const row of rows) {
      await q.query(
        "UPDATE shopping_requests SET status='CANCELLED',review_note='Expired before funding',updated_at=now() WHERE id=$1",
        [row.id],
      );
      await alertParties(
        q,
        row,
        null,
        'Shopping request expired',
        'This request was not funded within 24 hours. No money was taken.',
      );
    }
  });
}

export function createShoppingService(deps: AppDeps) {
  const { db, config } = deps;
  const routing = createRouting(config, deps.redis);
  const media = createShoppingMediaService(deps);
  async function quote(user: any, input: RequestInput) {
    const d = shoppingQuoteInput.parse(input.body);
    const rider = await checkRider(db, d.rider_id, user.id);
    await riderFree(db, rider.user_id);
    const [settings] = await db.query('SELECT * FROM settings WHERE id=1');
    requireNearby(rider, d.dropoff, settings.delivery_radius_km);
    const [vehicle] = await db.query<any>('SELECT * FROM vehicle_types WHERE code=$1 AND active', [
      rider.vehicle_type,
    ]);
    ensure(vehicle, 409, 'VEHICLE_UNAVAILABLE', 'This vehicle is not available.');
    const route = await routing.drivingDistance(d.source, d.dropoff);
    ensure(
      route.km <= vehicle.max_km,
      400,
      'TOO_FAR',
      'This trip exceeds the vehicle service distance.',
    );
    return {
      delivery_fee_kobo: fareFor(vehicle, route.km),
      distance_km: route.km,
      vehicle_name: vehicle.name,
      rider_name: rider.name,
    };
  }
  async function create(
    q: Query,
    user: any,
    input: RequestInput,
    estimate: Awaited<ReturnType<typeof quote>>,
  ) {
    const d = shoppingInput.parse(input.body);
    await checkRider(q, d.rider_id, user.id);
    await riderFree(q, d.rider_id);
    ensure(
      estimate.delivery_fee_kobo === d.expected_delivery_fee_kobo,
      409,
      'FARE_CHANGED',
      'Review the updated delivery estimate.',
    );
    const [settings] = await q.query('SELECT delivery_commission_bps FROM settings WHERE id=1');
    const [row] = await q.query(
      `INSERT INTO shopping_requests(id,buyer_id,rider_id,items,source_name,source_address,source_latitude,source_longitude,dropoff_address,dropoff_latitude,dropoff_longitude,goods_budget_kobo,delivery_fee_kobo,commission_bps,payment_mode,delivery_pin)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING *`,
      [
        randomUUID(),
        user.id,
        d.rider_id,
        d.items,
        d.source_name,
        d.source_address,
        d.source.latitude,
        d.source.longitude,
        d.dropoff_address,
        d.dropoff.latitude,
        d.dropoff.longitude,
        d.goods_budget_kobo,
        estimate.delivery_fee_kobo,
        settings.delivery_commission_bps,
        d.payment_mode,
        pin(),
      ],
    );
    await audit(q, user.id, 'shopping.request', row.id, {
      goods_budget_kobo: d.goods_budget_kobo,
      payment_mode: d.payment_mode,
    });
    await alertParties(
      q,
      row,
      user.id,
      'Shopping request received',
      `${user.name} needs goods from ${d.source_name}. Review the goods budget and separate delivery fee, then agree the payment arrangement.`,
    );
    return safe(row, user);
  }
  async function mine(user: any, input: RequestInput) {
    return (
      await db.query(
        `${named} WHERE r.buyer_id=$1 OR r.rider_id=$1 ORDER BY r.created_at DESC LIMIT 100`,
        [user.id],
      )
    ).map((r) => safe(r, user));
  }
  async function detail(user: any, input: RequestInput) {
    const [row] = await db.query(
      `${named} WHERE r.id=$1 AND (r.buyer_id=$2 OR r.rider_id=$2 OR $3::boolean)`,
      [input.params.id, user.id, !!user.admin && canAccess(user.staff_role, 'shopping')],
    );
    ensure(row, 404, 'NOT_FOUND', 'Shopping request not found.');
    return {
      ...safe(row, user),
      receipt_photos: await media.photos(row),
      tracking:
        ['SHOPPING', 'PURCHASED'].includes(row.status) && !row.review_open && row.rider_location_at
          ? {
              latitude: row.rider_latitude,
              longitude: row.rider_longitude,
              updated_at: row.rider_location_at,
            }
          : null,
      advance_available_kobo:
        row.rider_id === user.id ? await balance(db, row.id, 'shopping_advance') : 0,
      advance_payouts:
        row.rider_id === user.id
          ? await db.query(
              'SELECT id,amount_kobo,fee_kobo,status,failure_reason,recovery_error FROM payouts WHERE shopping_request_id=$1 ORDER BY created_at DESC',
              [row.id],
            )
          : [],
      messages: await db.query(
        'SELECT * FROM (SELECT m.id,m.sender_id,u.name AS sender_name,m.body,m.created_at FROM shopping_messages m JOIN users u ON u.id=m.sender_id WHERE m.request_id=$1 ORDER BY m.created_at DESC,m.id DESC LIMIT 200) recent ORDER BY created_at,id',
        [row.id],
      ),
    };
  }
  async function load(q: Query, user: any, id: string) {
    const [row] = await q.query('SELECT * FROM shopping_requests WHERE id=$1 FOR UPDATE', [id]);
    ensure(
      row && [row.buyer_id, row.rider_id].includes(user.id),
      404,
      'NOT_FOUND',
      'Shopping request not found.',
    );
    return row;
  }
  async function message(q: Query, user: any, input: RequestInput) {
    const row = await load(q, user, input.params.id);
    const d = z.object({ body: z.string().trim().min(1).max(2000) }).parse(input.body);
    const [blocked] = await q.query(
      'SELECT 1 FROM user_blocks WHERE (blocker_id=$1 AND blocked_id=$2) OR (blocker_id=$2 AND blocked_id=$1)',
      [row.buyer_id, row.rider_id],
    );
    ensure(!blocked, 403, 'PARTICIPANT_BLOCKED', 'This conversation is blocked.');
    const [saved] = await q.query(
      'INSERT INTO shopping_messages(id,request_id,sender_id,body) VALUES($1,$2,$3,$4) RETURNING *',
      [randomUUID(), row.id, user.id, d.body],
    );
    await alertParties(
      q,
      row,
      user.id,
      'Shopping request message',
      'You have a new message on your shopping request.',
    );
    return saved;
  }
  async function noPendingAdvance(q: Query, row: any) {
    const [pending] = await q.query(
      "SELECT id FROM payouts WHERE shopping_request_id=$1 AND status IN ('REQUESTED','PROCESSING')",
      [row.id],
    );
    ensure(
      !pending,
      409,
      'ADVANCE_PAYOUT_PENDING',
      'Wait for the advance payout to settle or cancel an unapproved payout first.',
    );
  }
  async function act(q: Query, user: any, input: RequestInput) {
    const row = await load(q, user, input.params.id);
    const action = z
      .enum(['offer', 'fund', 'purchase', 'deliver', 'cancel', 'return-advance', 'review'])
      .parse(input.params.action);
    const buyer = row.buyer_id === user.id;
    const budget = Number(row.goods_budget_kobo),
      fee = Number(row.delivery_fee_kobo);
    if (action === 'review') {
      ensure(
        !['CANCELLED', 'DELIVERED'].includes(row.status),
        409,
        'ALREADY_CLOSED',
        'This request is already closed.',
      );
      const { reason } = z.object({ reason: z.string().trim().min(5).max(1000) }).parse(input.body);
      await q.query(
        'UPDATE shopping_requests SET review_open=TRUE,review_note=$1,updated_at=now() WHERE id=$2',
        [reason, row.id],
      );
    } else {
      ensure(
        !row.review_open || action === 'return-advance',
        409,
        'SUPPORT_REVIEW',
        'Support is reviewing this request. Funds remain accounted for until the case is resolved.',
      );
      if (action === 'offer') {
        ensure(
          !buyer && ['REQUESTED', 'ACCEPTED'].includes(row.status),
          403,
          'INVALID_TRANSITION',
          'Only the selected rider may agree terms before funding.',
        );
        ensure(
          Date.now() - new Date(row.created_at).getTime() < 86400000,
          409,
          'REQUEST_EXPIRED',
          'Send a new shopping request.',
        );
        await checkRider(q, user.id, row.buyer_id);
        await riderFree(q, user.id, row.id);
        const d = z
          .object({
            delivery_fee_kobo: z.number().int().min(0).max(100000000),
            payment_mode: z.enum(['REIMBURSE', 'ADVANCE']),
          })
          .parse(input.body);
        await q.query(
          "UPDATE shopping_requests SET status='ACCEPTED',delivery_fee_kobo=$1,payment_mode=$2,quote_version=quote_version+1,updated_at=now() WHERE id=$3",
          [d.delivery_fee_kobo, d.payment_mode, row.id],
        );
      } else if (action === 'fund') {
        ensure(
          buyer && row.status === 'ACCEPTED',
          409,
          'INVALID_TRANSITION',
          'The selected rider must agree the terms first.',
        );
        ensure(
          Date.now() - new Date(row.created_at).getTime() < 86400000,
          409,
          'REQUEST_EXPIRED',
          'Send a new shopping request.',
        );
        ensure(
          config.demo || config.payments,
          503,
          'PAYMENTS_DISABLED',
          'Wallet payments are not enabled.',
        );
        const { quote_version } = z
          .object({ quote_version: z.number().int().positive() })
          .parse(input.body);
        ensure(
          quote_version === row.quote_version,
          409,
          'TERMS_CHANGED',
          'Review the latest delivery fee and payment arrangement before funding.',
        );
        const [rider] = await q.query(
          "SELECT 1 FROM drivers d JOIN users u ON u.id=d.user_id WHERE d.user_id=$1 AND d.status='APPROVED' AND u.status='ACTIVE'",
          [row.rider_id],
        );
        ensure(
          rider,
          409,
          'RIDER_UNAVAILABLE',
          'This rider is no longer approved. Cancel and choose another rider.',
        );
        ensure(
          (await lockedBalance(q, user.id)) >= budget + fee,
          409,
          'INSUFFICIENT_BALANCE',
          'Add money for the goods budget and separate delivery fee.',
        );
        await ledger(q, row.id, [
          { account: 'wallet', owner: user.id, amount: -budget - fee },
          { account: 'shopping_escrow', owner: row.id, amount: budget + fee },
        ]);
        if (row.payment_mode === 'ADVANCE')
          await ledger(q, row.id, [
            { account: 'shopping_escrow', owner: row.id, amount: -budget },
            { account: 'shopping_advance', owner: row.id, amount: budget },
          ]);
        await q.query(
          "UPDATE shopping_requests SET status='SHOPPING',funded_at=now(),updated_at=now() WHERE id=$1",
          [row.id],
        );
      } else if (action === 'purchase') {
        ensure(
          !buyer && row.status === 'SHOPPING',
          409,
          'INVALID_TRANSITION',
          'Only the rider can record a funded purchase.',
        );
        const d = z
          .object({
            actual_goods_kobo: z.number().int().min(100),
            receipt_note: z.string().trim().min(5).max(3000),
          })
          .parse(input.body);
        ensure(
          d.actual_goods_kobo <= budget,
          409,
          'BUDGET_EXCEEDED',
          'The goods cost exceeds the buyer’s spending limit. Discuss alternatives; do not exceed it.',
        );
        let reimbursement = d.actual_goods_kobo;
        if (row.payment_mode === 'ADVANCE') {
          await noPendingAdvance(q, row);
          const remaining = await lockedBalance(q, row.id, 'shopping_advance');
          const paidOut = budget - remaining;
          const toReturn = Math.max(0, paidOut - d.actual_goods_kobo);
          if (toReturn)
            ensure(
              (await lockedBalance(q, user.id)) >= toReturn,
              409,
              'RETURN_UNUSED_ADVANCE',
              `Add ₦${toReturn / 100} to your shopping wallet to return the unused advance. No extra money will be taken from the buyer.`,
            );
          if (remaining || toReturn)
            await ledger(q, row.id, [
              ...(remaining
                ? [{ account: 'shopping_advance', owner: row.id, amount: -remaining }]
                : []),
              ...(toReturn ? [{ account: 'wallet', owner: user.id, amount: -toReturn }] : []),
              { account: 'shopping_escrow', owner: row.id, amount: remaining + toReturn },
            ]);
          reimbursement = Math.max(0, d.actual_goods_kobo - paidOut);
        }
        await q.query(
          "UPDATE shopping_requests SET status='PURCHASED',actual_goods_kobo=$1,reimbursement_kobo=$2,receipt_note=$3,purchased_at=now(),updated_at=now() WHERE id=$4",
          [d.actual_goods_kobo, reimbursement, d.receipt_note, row.id],
        );
      } else if (action === 'deliver') {
        ensure(
          !buyer && row.status === 'PURCHASED',
          409,
          'INVALID_TRANSITION',
          'Only the rider may confirm purchased goods as delivered.',
        );
        const d = z.object({ pin: z.string().regex(/^\d{6}$/) }).parse(input.body);
        ensure(
          !row.pin_locked_until || new Date(row.pin_locked_until).getTime() <= Date.now(),
          429,
          'PIN_LOCKED',
          'Too many incorrect PINs. Try again in 15 minutes.',
        );
        if (d.pin !== row.delivery_pin) {
          const failures = row.pin_failures + 1;
          await q.query(
            'UPDATE shopping_requests SET pin_failures=$1,pin_locked_until=$2 WHERE id=$3',
            [failures, failures % 5 === 0 ? new Date(Date.now() + 900000) : null, row.id],
          );
          return {
            error: { status: 400, code: 'INVALID_PIN', message: 'That delivery PIN is incorrect.' },
          };
        }
        const unused = budget - Number(row.actual_goods_kobo),
          reimbursement = Number(row.reimbursement_kobo);
        const commission = Math.round((fee * row.commission_bps) / 10000);
        await ledger(q, row.id, [
          { account: 'shopping_escrow', owner: row.id, amount: -unused - reimbursement - fee },
          { account: 'wallet', owner: row.buyer_id, amount: unused },
          {
            account: 'seller_payable',
            owner: row.rider_id,
            amount: reimbursement + fee - commission,
          },
          { account: 'platform_revenue', amount: commission },
        ]);
        await q.query(
          "UPDATE shopping_requests SET status='DELIVERED',delivered_at=now(),updated_at=now() WHERE id=$1",
          [row.id],
        );
      } else if (action === 'cancel' || action === 'return-advance') {
        ensure(
          ['REQUESTED', 'ACCEPTED', 'SHOPPING'].includes(row.status),
          409,
          'INVALID_TRANSITION',
          'Purchased goods require support review.',
        );
        if (row.status === 'SHOPPING') {
          if (row.payment_mode === 'ADVANCE') {
            await noPendingAdvance(q, row);
            const remaining = await lockedBalance(q, row.id, 'shopping_advance');
            const returned = budget - remaining;
            ensure(
              returned === 0 || (!buyer && action === 'return-advance'),
              409,
              'ADVANCE_RELEASED',
              'The rider must return the released advance before cancellation. Ask support for help.',
            );
            if (returned)
              ensure(
                (await lockedBalance(q, user.id)) >= returned,
                409,
                'ADVANCE_RETURN_REQUIRED',
                `Add ₦${returned / 100} to your wallet to return the full outstanding advance.`,
              );
            await ledger(q, row.id, [
              ...(remaining
                ? [{ account: 'shopping_advance', owner: row.id, amount: -remaining }]
                : []),
              ...(returned ? [{ account: 'wallet', owner: user.id, amount: -returned }] : []),
              { account: 'shopping_escrow', owner: row.id, amount: budget },
            ]);
          }
          await ledger(q, row.id, [
            { account: 'shopping_escrow', owner: row.id, amount: -budget - fee },
            { account: 'wallet', owner: row.buyer_id, amount: budget + fee },
          ]);
        }
        await q.query(
          "UPDATE shopping_requests SET status='CANCELLED',review_open=FALSE,updated_at=now() WHERE id=$1",
          [row.id],
        );
      }
    }
    await audit(q, user.id, `shopping.${action}`, row.id);
    const [fresh] = await q.query('SELECT * FROM shopping_requests WHERE id=$1', [row.id]);
    await alertParties(
      q,
      fresh,
      user.id,
      'Shopping request updated',
      `The request is now ${fresh.status.toLowerCase()}. Open Riders for the latest details.`,
    );
    return safe(fresh, user);
  }
  async function adminList(user: any, input: RequestInput) {
    return (await db.query(`${named} ORDER BY r.review_open DESC,r.created_at DESC LIMIT 200`)).map(
      (r) => safe(r, user),
    );
  }
  async function review(q: Query, user: any, input: RequestInput) {
    const d = z
      .object({ reason: z.string().trim().min(5).max(1000), pause: z.boolean() })
      .parse(input.body);
    const [row] = await q.query(
      'UPDATE shopping_requests SET review_open=$1,review_note=$2,updated_at=now() WHERE id=$3 RETURNING *',
      [d.pause, d.reason, input.params.id],
    );
    ensure(row, 404, 'NOT_FOUND', 'Shopping request not found.');
    await audit(q, user.id, 'shopping.review', row.id, d);
    await alertParties(q, row, user.id, 'Shopping support review', d.reason);
    return safe(row, user);
  }
  return { quote, create, mine, detail, message, act, adminList, review };
}
