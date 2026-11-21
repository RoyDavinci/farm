import { randomInt, randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { Query } from '../database/client.js';
import type { AppDeps } from '../types/deps.js';
import type { RequestInput } from '../lib/http.js';
import { ensure } from '../lib/errors.js';
import { audit } from './audit.service.js';
import { notify } from './communications.service.js';
import { ledger, lockedBalance } from './ledger.service.js';
import {
  checkRider,
  riderFree,
  requireServiceArea,
  requireCurrentDriverDocuments,
} from './riders.service.js';
import { haversineKm, createRouting } from './routing.service.js';
import { regionalFare, loadInput } from './delivery-operations.service.js';
const point = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
});
export const parcelQuoteInput = z
  .object({
    pickup: point,
    dropoff: point,
    state: z.string().trim().min(2).max(100),
    city: z.string().trim().min(2).max(100),
    vehicle_type: z.string().min(2).max(30),
  })
  .extend(loadInput.shape);
export const parcelInput = parcelQuoteInput.extend({
  description: z.string().trim().min(10).max(1000),
  pickup_address: z.string().trim().min(8).max(500),
  dropoff_address: z.string().trim().min(8).max(500),
  driver_id: z.uuid(),
  expected_fare_kobo: z.number().int().positive(),
  lawful_goods_confirmed: z.literal(true),
});
export function createParcelsService(deps: AppDeps) {
  const { db, config } = deps,
    routing = createRouting(config, deps.redis);
  async function quote(u: any, i: RequestInput, q: Query = db) {
    const d = parcelQuoteInput.parse(i.body);
    const [v] = await q.query('SELECT * FROM vehicle_types WHERE code=$1 AND active', [
      d.vehicle_type,
    ]);
    ensure(v, 400, 'INVALID_VEHICLE', 'Choose an active vehicle.');
    const { km, method } = await routing.drivingDistance(d.pickup, d.dropoff);
    ensure(
      km <= v.max_km,
      400,
      'TOO_FAR',
      'This parcel route is outside the vehicle service range.',
    );
    const fallback = Math.max(
      v.min_fare_kobo,
      Math.ceil((v.base_fare_kobo + km * v.per_km_kobo) / 5000) * 5000,
    );
    return {
      ...(await regionalFare(q, d, d.vehicle_type, km, d, fallback)),
      distance_km: km,
      distance_method: method,
      vehicle_type: v.code,
    };
  }
  function view(r: any, u: any) {
    const {
      pickup_pin,
      delivery_pin,
      pin_failures,
      pin_locked_until,
      driver_latitude,
      driver_longitude,
      location_at,
      ...safe
    } = r;
    if (u.id === r.buyer_id && ['REQUESTED', 'ACCEPTED', 'PICKED_UP'].includes(r.status)) {
      safe.pickup_pin = pickup_pin;
      safe.delivery_pin = delivery_pin;
    }
    if (['ACCEPTED', 'PICKED_UP'].includes(r.status) && !r.review_open && location_at) {
      safe.tracking = {
        latitude: driver_latitude,
        longitude: driver_longitude,
        updated_at: location_at,
      };
    }
    return safe;
  }
  async function mine(u: any) {
    return (
      await db.query(
        'SELECT p.*,u.name AS driver_name FROM parcel_jobs p JOIN users u ON u.id=p.driver_id WHERE buyer_id=$1 OR driver_id=$1 ORDER BY created_at DESC LIMIT 100',
        [u.id],
      )
    ).map((r) => view(r, u));
  }
  async function create(q: Query, u: any, i: RequestInput) {
    ensure(
      config.demo,
      409,
      'PARCEL_PILOT_REQUIRED',
      'Independent parcel delivery is available for simulation review before the operating pilot is approved.',
    );
    const d = parcelInput.parse(i.body);
    const price = await quote(u, i, q);
    ensure(
      price.fare_kobo === d.expected_fare_kobo,
      409,
      'FARE_CHANGED',
      'Review the updated parcel fare.',
    );
    const rider = await checkRider(q, d.driver_id, u.id, d.vehicle_type);
    requireServiceArea(rider, d);
    await riderFree(q, rider.user_id);
    const [settings] = await q.query(
      'SELECT delivery_radius_km,delivery_commission_bps FROM settings WHERE id=1',
    );
    ensure(
      haversineKm(rider.latitude, rider.longitude, d.pickup.latitude, d.pickup.longitude) <=
        settings.delivery_radius_km,
      409,
      'RIDER_TOO_FAR',
      'Select a rider near the pickup.',
    );
    ensure(
      (await lockedBalance(q, u.id)) >= price.fare_kobo,
      409,
      'INSUFFICIENT_BALANCE',
      'Add money to your wallet to pay the parcel fare.',
    );
    const id = randomUUID();
    await ledger(q, id, [
      { account: 'wallet', owner: u.id, amount: -price.fare_kobo },
      { account: 'parcel_escrow', owner: id, amount: price.fare_kobo },
    ]);
    await q.query(
      'INSERT INTO parcel_jobs(id,buyer_id,driver_id,vehicle_type,description,pickup_address,pickup_latitude,pickup_longitude,dropoff_address,dropoff_latitude,dropoff_longitude,fare_kobo,commission_bps,distance_km,pricing,pickup_pin,delivery_pin) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)',
      [
        id,
        u.id,
        d.driver_id,
        d.vehicle_type,
        d.description,
        d.pickup_address,
        d.pickup.latitude,
        d.pickup.longitude,
        d.dropoff_address,
        d.dropoff.latitude,
        d.dropoff.longitude,
        price.fare_kobo,
        settings.delivery_commission_bps,
        price.distance_km,
        JSON.stringify(price.pricing),
        String(randomInt(100000, 1000000)),
        String(randomInt(100000, 1000000)),
      ],
    );
    await audit(q, u.id, 'parcel.request', id);
    await notify(
      q,
      d.driver_id,
      'delivery',
      'Parcel delivery invitation',
      'Open Drive to review the parcel, route and expected earnings.',
    );
    return { id };
  }
  async function action(q: Query, u: any, i: RequestInput) {
    ensure(
      config.demo,
      409,
      'PARCEL_PILOT_REQUIRED',
      'Parcel actions remain in development simulation until the pilot is approved.',
    );
    const d = z
      .object({
        action: z.enum(['accept', 'pickup', 'deliver', 'cancel', 'report']),
        pin: z
          .string()
          .regex(/^\d{6}$/)
          .optional(),
        reason: z.string().trim().max(2000).optional(),
      })
      .parse(i.body);
    const [p] = await q.query('SELECT * FROM parcel_jobs WHERE id=$1 FOR UPDATE', [i.params.id]);
    ensure(
      p && [p.buyer_id, p.driver_id].includes(u.id),
      404,
      'NOT_FOUND',
      'Parcel job not found.',
    );
    if (d.action === 'report') {
      ensure(d.reason && d.reason.length >= 10, 400, 'REASON_REQUIRED', 'Describe the issue.');
      await q.query(
        'UPDATE parcel_jobs SET review_open=true,review_note=$1,updated_at=now() WHERE id=$2',
        [d.reason, p.id],
      );
      await audit(q, u.id, 'parcel.report', p.id, { reason: d.reason });
      return { ok: true };
    }
    ensure(
      !p.review_open,
      409,
      'SUPPORT_REVIEW',
      'Support must clear this parcel issue before continuing.',
    );
    if (d.action === 'cancel') {
      ensure(
        ['REQUESTED', 'ACCEPTED'].includes(p.status) &&
          (u.id === p.buyer_id || p.status === 'REQUESTED'),
        409,
        'INVALID_TRANSITION',
        'Contact support after collection.',
      );
      await ledger(q, p.id, [
        { account: 'parcel_escrow', owner: p.id, amount: -p.fare_kobo },
        { account: 'wallet', owner: p.buyer_id, amount: p.fare_kobo },
      ]);
      await q.query("UPDATE parcel_jobs SET status='CANCELLED',updated_at=now() WHERE id=$1", [
        p.id,
      ]);
    } else {
      ensure(u.id === p.driver_id, 403, 'FORBIDDEN', 'Assigned parcel rider only.');
      const [driver] = await q.query(
        "SELECT * FROM drivers WHERE user_id=$1 AND status='APPROVED'",
        [u.id],
      );
      ensure(driver, 403, 'DRIVER_UNAVAILABLE', 'Approved rider access required.');
      requireCurrentDriverDocuments(driver);
      if (d.action === 'accept') {
        ensure(
          p.status === 'REQUESTED',
          409,
          'INVALID_TRANSITION',
          'This parcel is no longer awaiting acceptance.',
        );
        await riderFree(q, u.id);
        await q.query("UPDATE parcel_jobs SET status='ACCEPTED',updated_at=now() WHERE id=$1", [
          p.id,
        ]);
      } else {
        ensure(
          p.status === (d.action === 'pickup' ? 'ACCEPTED' : 'PICKED_UP'),
          409,
          'INVALID_TRANSITION',
          'Complete the preceding parcel step.',
        );
        ensure(
          !p.pin_locked_until || new Date(p.pin_locked_until).getTime() <= Date.now(),
          429,
          'PIN_LOCKED',
          'Try again after the PIN lock expires.',
        );
        if (d.pin !== (d.action === 'pickup' ? p.pickup_pin : p.delivery_pin)) {
          await q.query(
            "UPDATE parcel_jobs SET pin_failures=pin_failures+1,pin_locked_until=CASE WHEN (pin_failures+1)%5=0 THEN now()+interval '15 minutes' ELSE NULL END WHERE id=$1",
            [p.id],
          );
          return { error: { status: 400, code: 'INVALID_PIN', message: 'Incorrect parcel PIN.' } };
        }
        if (d.action === 'pickup')
          await q.query(
            "UPDATE parcel_jobs SET status='PICKED_UP',pin_failures=0,updated_at=now() WHERE id=$1",
            [p.id],
          );
        else {
          const driverShare = Math.round((p.fare_kobo * (10000 - p.commission_bps)) / 10000);
          await ledger(q, p.id, [
            { account: 'parcel_escrow', owner: p.id, amount: -p.fare_kobo },
            { account: 'seller_payable', owner: u.id, amount: driverShare },
            { account: 'platform_revenue', amount: p.fare_kobo - driverShare },
          ]);
          await q.query(
            "UPDATE parcel_jobs SET status='DELIVERED',pin_failures=0,updated_at=now() WHERE id=$1",
            [p.id],
          );
        }
      }
    }
    await audit(q, u.id, `parcel.${d.action}`, p.id);
    await notify(
      q,
      p.buyer_id,
      'delivery',
      'Parcel progress updated',
      d.action === 'deliver' ? 'Your parcel delivery is complete.' : `Parcel ${d.action} recorded.`,
    );
    return { ok: true };
  }
  async function list() {
    return (await db.query('SELECT * FROM parcel_jobs ORDER BY created_at DESC LIMIT 200')).map(
      ({ pickup_pin, delivery_pin, pin_failures, pin_locked_until, ...r }) => r,
    );
  }
  async function review(q: Query, u: any, i: RequestInput) {
    const d = z
      .object({ resolution: z.string().trim().min(10).max(2000), release_pause: z.boolean() })
      .parse(i.body);
    const [p] = await q.query(
      'UPDATE parcel_jobs SET review_open=NOT $1,review_note=$2,updated_at=now() WHERE id=$3 RETURNING id,buyer_id,driver_id',
      [d.release_pause, d.resolution, i.params.id],
    );
    ensure(p, 404, 'NOT_FOUND', 'Parcel job not found.');
    await audit(q, u.id, 'parcel.review', p.id, d);
    for (const uid of [p.buyer_id, p.driver_id])
      await notify(q, uid, 'delivery', 'Parcel support review', d.resolution);
    return { ok: true };
  }
  return { quote, mine, create, action, list, review };
}
