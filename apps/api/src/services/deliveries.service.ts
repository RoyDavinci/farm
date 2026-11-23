import { regionalFare, loadInput } from './delivery-operations.service.js';
import {
  checkRider,
  riderFree,
  requireNearby,
  requireServiceArea,
  requireCurrentDriverDocuments,
} from './riders.service.js';
import { randomInt, randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { Query } from '../database/client.js';
import { ensure } from '../lib/errors.js';
import type { RequestInput } from '../lib/http.js';
import type { AppDeps } from '../types/deps.js';
import { audit } from './audit.service.js';
import { requirePhotoVerification } from './verification.service.js';
import { event } from './booking.service.js';
import { notify } from './communications.service.js';
import { ledger, lockedBalance } from './ledger.service.js';

import { createRouting, haversineKm } from './routing.service.js';
export { haversineKm, ROAD_FACTOR } from './routing.service.js';

export function fareFor(
  v: { base_fare_kobo: number; per_km_kobo: number; min_fare_kobo: number },
  km: number,
) {
  const raw = v.base_fare_kobo + Math.ceil(km * v.per_km_kobo);
  // Round up to the nearest ₦50 so cash-like amounts are easy to read.
  return Math.max(v.min_fare_kobo, Math.ceil(raw / 5000) * 5000);
}

export const point = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
});
export const pin = () => String(randomInt(100000, 1000000));

/**
 * Gives a rider back the item price they put into escrow when the goods never left the seller.
 * Once the buyer has paid (they reimbursed the rider), the escrow is the buyer's and stays with the
 * booking, which refunds it to the buyer if the booking itself is cancelled.
 */
export async function returnRiderFront(q: Query, d: any) {
  const fronted = Number(d.rider_fronted_kobo || 0);
  if (!fronted || d.seller_released_at) return;
  const [b] = await q.query('SELECT paid FROM bookings WHERE id=$1', [d.booking_id]);
  if (!b.paid)
    await ledger(q, d.id, [
      { account: 'escrow', owner: d.booking_id, amount: -fronted },
      { account: 'wallet', owner: d.driver_id, amount: fronted },
    ]);
  await q.query(
    'UPDATE deliveries SET rider_fronted_kobo=0,rider_checked_at=NULL,rider_check_note=NULL WHERE id=$1',
    [d.id],
  );
}

/** Cancels an unfinished delivery and refunds a prepaid fare. Used by booking release/expiry. */
export async function cancelDelivery(q: Query, d: any, reason: string, actor: string | null) {
  if (!['OPEN', 'ASSIGNED'].includes(d.status)) return;
  await returnRiderFront(q, d);
  if (d.fare_paid)
    await ledger(q, d.id, [
      { account: 'delivery_escrow', owner: d.id, amount: -Number(d.fare_kobo) },
      { account: 'wallet', owner: d.buyer_id, amount: Number(d.fare_kobo) },
    ]);
  await q.query(
    "UPDATE deliveries SET status='CANCELLED',cancel_reason=$1,fare_paid=FALSE WHERE id=$2",
    [reason, d.id],
  );
  await audit(q, actor, 'delivery.cancel', d.id, { reason });
  if (d.driver_id && d.driver_id !== actor)
    await notify(q, d.driver_id, 'delivery', 'Delivery cancelled', reason, d.booking_id);
}

/** Business logic for deliveries requests. HTTP-free: callers pass plain input. */
/** Moves a booking's escrow to the seller's earnings, less the platform commission. */
async function releaseToSeller(q: Query, b: any) {
  await ledger(q, b.id, [
    { account: 'escrow', owner: b.id, amount: -Number(b.total_kobo) },
    {
      account: 'seller_payable',
      owner: b.seller_id,
      amount: Number(b.total_kobo) - Number(b.commission_kobo),
    },
    { account: 'platform_revenue', amount: Number(b.commission_kobo) },
  ]);
}

export function createDeliveriesService(deps: AppDeps) {
  const { db } = deps;
  const routing = createRouting(deps.config, deps.redis);
  async function quote(
    q: Query,
    b: any,
    vehicle: string,
    drop: z.infer<typeof point>,
    load = loadInput.parse({}),
  ) {
    const [s] = await q.query<{
      latitude: number;
      longitude: number;
      state: string;
      city: string;
      lga: string;
      area: string;
    }>('SELECT latitude,longitude,state,city,lga,area FROM sellers WHERE user_id=$1', [
      b.seller_id,
    ]);
    ensure(
      s?.latitude != null,
      409,
      'PICKUP_LOCATION_MISSING',
      'This seller has not set a map pin, so delivery is unavailable. Collect in person instead.',
    );
    const [v] = await q.query<any>('SELECT * FROM vehicle_types WHERE code=$1 AND active', [
      vehicle,
    ]);
    ensure(v, 400, 'INVALID_VEHICLE', 'Choose an available vehicle type.');
    const pickup = {
      ...s,
      latitude: b.pickup_latitude ?? s.latitude,
      longitude: b.pickup_longitude ?? s.longitude,
    };
    const { km, method } = await routing.drivingDistance(pickup, drop);
    ensure(km <= v.max_km, 400, 'TOO_FAR', `${v.name} delivery covers up to ${v.max_km} km.`);
    return {
      pickup,
      vehicle: v,
      distance_km: km,
      distance_method: method,
      ...(await regionalFare(q, s, vehicle, km, load, fareFor(v, km))),
    };
  }
  async function buyerBooking(q: Query, id: string, uid: string, lock = false) {
    const [b] = await q.query(`SELECT * FROM bookings WHERE id=$1${lock ? ' FOR UPDATE' : ''}`, [
      id,
    ]);
    ensure(b && b.buyer_id === uid, 404, 'NOT_FOUND', 'Booking not found.');
    ensure(b.delivery_available, 409, 'DELIVERY_UNAVAILABLE', 'This booking is collection-only.');
    ensure(
      ['ACCEPTED', 'READY_FOR_PICKUP'].includes(b.status),
      409,
      'INVALID_TRANSITION',
      'Delivery can be arranged once the seller has accepted the booking.',
    );
    return b;
  }
  const view = (d: any, u: any) => {
    const { pickup_pin, delivery_pin, pin_failures, pin_locked_until, ...safe } = d;
    if (u.id === d.driver_id && ['ASSIGNED'].includes(d.status)) safe.pickup_pin = pickup_pin;
    // The buyer's PIN is only useful once everything is paid; it completes the order.
    if (
      u.id === d.buyer_id &&
      ['ASSIGNED', 'PICKED_UP'].includes(d.status) &&
      d.fare_paid &&
      d.booking_paid
    )
      safe.delivery_pin = delivery_pin;
    return safe;
  };
  const withParty = `SELECT d.*,b.paid AS booking_paid,b.title,b.quantity,b.unit,b.total_kobo,
    s.business_name,COALESCE(b.pickup_address_snapshot,s.address) AS pickup_address,buyer.name AS buyer_name,buyer.phone AS buyer_phone,
    du.name AS driver_name,du.phone AS driver_phone,dr.plate_number,vt.name AS vehicle_name
    FROM deliveries d JOIN bookings b ON b.id=d.booking_id JOIN sellers s ON s.user_id=d.seller_id
    JOIN users buyer ON buyer.id=d.buyer_id LEFT JOIN users du ON du.id=d.driver_id
    LEFT JOIN drivers dr ON dr.user_id=d.driver_id JOIN vehicle_types vt ON vt.code=d.vehicle_type`;
  // ---- Driver side ----
  async function getDeliveryOptions(user: any, input: RequestInput) {
    const [s] = await db.query(
      'SELECT pay_on_delivery_enabled,delivery_radius_km FROM settings WHERE id=1',
    );
    return {
      vehicle_types: await db.query(
        'SELECT code,name,base_fare_kobo,per_km_kobo,min_fare_kobo,max_km FROM vehicle_types WHERE active ORDER BY sort',
      ),
      // Pay on Delivery charges a stored balance at the door, so it needs the wallet feature.
      pay_on_delivery: s.pay_on_delivery_enabled && deps.config.features.wallet,
    };
  }
  async function quoteDelivery(user: any, input: RequestInput) {
    const d = z
      .object({ vehicle_type: z.string().max(30), dropoff: point })
      .extend(loadInput.shape)
      .parse(input.body);
    const b = await buyerBooking(db, input.params.id as string, user.id);
    const { distance_km, distance_method, fare_kobo, vehicle, pricing } = await quote(
      db,
      b,
      d.vehicle_type,
      d.dropoff,
      d,
    );
    return {
      distance_km,
      distance_method,
      fare_kobo,
      vehicle_type: vehicle.code,
      vehicle_name: vehicle.name,
      pricing,
    };
  }
  async function requestDelivery(q: Query, u: any, input: RequestInput) {
    const d = z
      .object({
        vehicle_type: z.string().max(30),
        dropoff: point,
        dropoff_address: z.string().trim().min(8).max(500),
        pay_on_delivery: z.boolean().default(false),
        expected_fare_kobo: z.number().int().positive(),
        requested_driver_id: z.uuid().optional(),
        ...loadInput.shape,
      })
      .parse(input.body);
    const b = await buyerBooking(q, input.params.id as string, u.id, true);
    const [open] = await q.query("SELECT id FROM disputes WHERE booking_id=$1 AND status='OPEN'", [
      b.id,
    ]);
    ensure(!open, 409, 'SUPPORT_REVIEW', 'This booking is under support review.');
    const [existing] = await q.query(
      "SELECT id FROM deliveries WHERE booking_id=$1 AND status<>'CANCELLED'",
      [b.id],
    );
    ensure(!existing, 409, 'DELIVERY_EXISTS', 'A delivery is already arranged for this booking.');
    const [settings] = await q.query('SELECT * FROM settings WHERE id=1');
    ensure(
      !d.pay_on_delivery || (settings.pay_on_delivery_enabled && deps.config.features.wallet),
      403,
      'POD_DISABLED',
      'Pay on Delivery is not available yet.',
    );
    ensure(
      d.pay_on_delivery || b.paid,
      409,
      'PAYMENT_REQUIRED',
      'Pay for the booking first, or choose Pay on Delivery.',
    );
    const qd = await quote(q, b, d.vehicle_type, d.dropoff, d);
    ensure(
      qd.fare_kobo === d.expected_fare_kobo,
      409,
      'FARE_CHANGED',
      'The delivery fare changed. Please review the new quote.',
    );
    if (d.requested_driver_id) {
      const rider = await checkRider(q, d.requested_driver_id, u.id, d.vehicle_type);
      ensure(
        rider.user_id !== b.seller_id,
        409,
        'CONFLICT',
        'The seller cannot deliver their own order.',
      );
      requireServiceArea(rider, qd.pickup);
      await riderFree(q, rider.user_id);
      requireNearby(rider, d.dropoff, settings.delivery_radius_km);
    }
    const id = randomUUID();
    if (!d.pay_on_delivery) {
      ensure(
        (await lockedBalance(q, u.id)) >= qd.fare_kobo,
        409,
        'INSUFFICIENT_BALANCE',
        'Add money to your wallet to pay the delivery fare.',
      );
      await ledger(q, id, [
        { account: 'wallet', owner: u.id, amount: -qd.fare_kobo },
        { account: 'delivery_escrow', owner: id, amount: qd.fare_kobo },
      ]);
    }
    const [delivery] = await q.query(
      `INSERT INTO deliveries(id,booking_id,buyer_id,seller_id,vehicle_type,pickup_latitude,pickup_longitude,dropoff_address,dropoff_latitude,dropoff_longitude,distance_km,fare_kobo,commission_bps,pay_on_delivery,fare_paid,pickup_pin,delivery_pin)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) RETURNING *`,
      [
        id,
        b.id,
        u.id,
        b.seller_id,
        qd.vehicle.code,
        qd.pickup.latitude,
        qd.pickup.longitude,
        d.dropoff_address,
        d.dropoff.latitude,
        d.dropoff.longitude,
        qd.distance_km,
        qd.fare_kobo,
        settings.delivery_commission_bps,
        d.pay_on_delivery,
        !d.pay_on_delivery,
        pin(),
        pin(),
      ],
    );
    if (d.requested_driver_id) {
      await q.query('UPDATE deliveries SET requested_driver_id=$1 WHERE id=$2', [
        d.requested_driver_id,
        id,
      ]);
      delivery.requested_driver_id = d.requested_driver_id;
    }
    await q.query('UPDATE deliveries SET pricing=$1 WHERE id=$2', [JSON.stringify(qd.pricing), id]);
    await audit(q, u.id, 'delivery.request', id, { fare_kobo: qd.fare_kobo });
    await notify(
      q,
      b.seller_id,
      'delivery',
      'Delivery requested',
      `${b.title} will be collected by a driver. Check the driver's PIN before handing it over.`,
      b.id,
    );
    // Tell online drivers near the pickup point.
    const nearby = await q.query(
      "SELECT user_id,latitude,longitude FROM drivers WHERE status='APPROVED' AND online AND vehicle_type=$1 AND latitude IS NOT NULL AND location_at>now()-interval '5 minutes'",
      [qd.vehicle.code],
    );
    for (const n of nearby)
      if (
        d.requested_driver_id
          ? n.user_id === d.requested_driver_id
          : haversineKm(n.latitude, n.longitude, qd.pickup.latitude, qd.pickup.longitude) <=
            settings.delivery_radius_km
      )
        await notify(
          q,
          n.user_id,
          'delivery',
          'New delivery nearby',
          `${qd.distance_km} km trip · earn about ₦${Math.round((qd.fare_kobo * (10000 - settings.delivery_commission_bps)) / 1000000).toLocaleString()}` +
            (d.pay_on_delivery && !b.paid
              ? ` · you pay the seller ₦${Math.round(Number(b.total_kobo) / 100).toLocaleString()} at pickup; the buyer repays you on delivery`
              : ''),
        );
    return view({ ...delivery, booking_paid: b.paid }, u);
  }
  async function getBookingDelivery(user: any, input: RequestInput) {
    const u = user;
    const [d] = await db.query(
      `${withParty} WHERE d.booking_id=$1 AND d.status<>'CANCELLED' ORDER BY d.created_at DESC LIMIT 1`,
      [input.params.id],
    );
    if (!d) return null;
    ensure(
      [d.buyer_id, d.seller_id, d.driver_id].includes(u.id) || u.admin,
      404,
      'NOT_FOUND',
      'Delivery not found.',
    );
    return view(d, u);
  }
  async function getMyDriverProfile(user: any, input: RequestInput) {
    return await db.prisma.driver.findUnique({ where: { user_id: user.id } });
  }
  async function applyAsDriver(q: Query, u: any, input: RequestInput) {
    const d = z
      .object({
        vehicle_type: z.string().max(30),
        plate_number: z.string().trim().min(3).max(20),
        licence_number: z.string().trim().min(5).max(40),
        city: z.string().trim().min(2).max(100),
      })
      .parse(input.body);
    const [v] = await q.query('SELECT code FROM vehicle_types WHERE code=$1 AND active', [
      d.vehicle_type,
    ]);
    ensure(v, 400, 'INVALID_VEHICLE', 'Choose an available vehicle type.');
    const [old] = await q.query('SELECT status FROM drivers WHERE user_id=$1', [u.id]);
    ensure(
      !old || old.status === 'REJECTED',
      409,
      'DRIVER_EXISTS',
      'You already applied to drive.',
    );
    const [driver] = await q.query(
      "INSERT INTO drivers(user_id,vehicle_type,plate_number,licence_number,city) VALUES($1,$2,$3,$4,$5) ON CONFLICT(user_id) DO UPDATE SET vehicle_type=$2,plate_number=$3,licence_number=$4,city=$5,status='PENDING',reason=NULL RETURNING *",
      [u.id, d.vehicle_type, d.plate_number.toUpperCase(), d.licence_number, d.city],
    );
    await audit(q, u.id, 'driver.register', u.id);
    return driver;
  }
  async function updateDriverStatus(user: any, input: RequestInput) {
    const d = z.object({ online: z.boolean() }).and(point.partial()).parse(input.body);
    ensure(
      (d.latitude == null) === (d.longitude == null),
      400,
      'LOCATION_REQUIRED',
      'Send both latitude and longitude.',
    );
    const [driver] = await db.query('SELECT status FROM drivers WHERE user_id=$1', [user.id]);
    ensure(driver?.status === 'APPROVED', 403, 'DRIVER_NOT_APPROVED', 'Approved drivers only.');
    ensure(
      !d.online || (d.latitude != null && d.longitude != null),
      400,
      'LOCATION_REQUIRED',
      'Share your location to go online.',
    );
    const [saved] = await db.query(
      'UPDATE drivers SET online=$1,background_tracking=CASE WHEN $1 THEN background_tracking ELSE false END,latitude=COALESCE($2,latitude),longitude=COALESCE($3,longitude),location_at=CASE WHEN $2 IS NULL THEN location_at ELSE now() END WHERE user_id=$4 RETURNING online,latitude,longitude,location_at',
      [d.online, d.latitude ?? null, d.longitude ?? null, user.id],
    );
    if (d.online && d.latitude != null && d.longitude != null)
      await db.query(
        "UPDATE shopping_requests SET rider_latitude=$1,rider_longitude=$2,rider_location_at=now() WHERE rider_id=$3 AND status IN ('SHOPPING','PURCHASED') AND NOT review_open",
        [d.latitude, d.longitude, user.id],
      );
    // Live tracking: active jobs follow the driver's latest position.
    if (d.latitude != null)
      await db.query(
        "UPDATE deliveries SET driver_latitude=$1,driver_longitude=$2,driver_location_at=now() WHERE driver_id=$3 AND status IN ('ASSIGNED','PICKED_UP')",
        [d.latitude, d.longitude, user.id],
      );
    if (d.online && d.latitude != null) {
      await db.query(
        "UPDATE parcel_jobs SET driver_latitude=$1,driver_longitude=$2,location_at=now() WHERE driver_id=$3 AND status IN ('ACCEPTED','PICKED_UP') AND NOT review_open",
        [d.latitude, d.longitude, user.id],
      );
    }
    return saved;
  }
  async function listDriverJobs(user: any, input: RequestInput) {
    const u = user;
    const [driver] = await db.query('SELECT * FROM drivers WHERE user_id=$1', [u.id]);
    ensure(driver?.status === 'APPROVED', 403, 'DRIVER_NOT_APPROVED', 'Approved drivers only.');
    const [settings] = await db.query('SELECT delivery_radius_km FROM settings WHERE id=1');
    const active = await db.query(
      `${withParty} WHERE d.driver_id=$1 AND d.status IN ('ASSIGNED','PICKED_UP') ORDER BY d.assigned_at`,
      [u.id],
    );
    const open =
      driver.latitude == null
        ? []
        : (
            await db.query(
              `${withParty} WHERE d.status='OPEN' AND (d.scheduled_at IS NULL OR d.scheduled_at<=now()+interval '15 minutes') AND (d.requested_driver_id IS NULL OR d.requested_driver_id=$2) AND d.vehicle_type=$1 AND d.buyer_id<>$2 AND d.seller_id<>$2 ORDER BY d.created_at LIMIT 100`,
              [driver.vehicle_type, u.id],
            )
          )
            .map((d: any) => ({
              ...d,
              away_km:
                Math.round(
                  haversineKm(
                    driver.latitude,
                    driver.longitude,
                    d.pickup_latitude,
                    d.pickup_longitude,
                  ) * 10,
                ) / 10,
            }))
            .filter(
              (d) => d.requested_driver_id === u.id || d.away_km <= settings.delivery_radius_km,
            )
            .sort((a, b) => a.away_km - b.away_km)
            // Exact addresses are shared only after a driver takes the job.
            .map(({ pickup_address, dropoff_address, buyer_phone, ...d }) => ({
              ...d,
              dropoff_area: String(dropoff_address).split(',').slice(-2).join(',').trim(),
            }));
    const history = await db.query(
      `${withParty} WHERE d.driver_id=$1 AND d.status='DELIVERED' ORDER BY d.delivered_at DESC LIMIT 20`,
      [u.id],
    );
    return {
      driver,
      active: active.map((d) => view(d, u)),
      open: open.map((d) => view(d, u)),
      history: history.map((d) => view(d, u)),
    };
  }
  async function performDeliveryAction(q: Query, u: any, input: RequestInput) {
    const action = z
      .enum(['cancel', 'pay', 'claim', 'release', 'check', 'handover', 'deliver'])
      .parse(input.params.action);

    // Lock order matches booking cancel/expiry (booking → delivery) so the two can't deadlock.
    const [ref] = await q.query('SELECT booking_id FROM deliveries WHERE id=$1', [input.params.id]);
    ensure(ref, 404, 'NOT_FOUND', 'Delivery not found.');
    const [b] = await q.query('SELECT * FROM bookings WHERE id=$1 FOR UPDATE', [ref.booking_id]);
    const [d] = await q.query('SELECT * FROM deliveries WHERE id=$1 FOR UPDATE', [input.params.id]);
    const [caseOpen] = await q.query(
      "SELECT id FROM disputes WHERE booking_id=$1 AND status='OPEN'",
      [b.id],
    );
    ensure(
      !caseOpen || ['cancel', 'release'].includes(action),
      409,
      'SUPPORT_REVIEW',
      'This booking is paused for support review.',
    );
    if (action === 'claim') {
      const [driver] = await q.query('SELECT * FROM drivers WHERE user_id=$1', [u.id]);
      ensure(driver?.status === 'APPROVED', 403, 'DRIVER_NOT_APPROVED', 'Approved drivers only.');
      requireCurrentDriverDocuments(driver);
      const [servicePickup] = await q.query(
        'SELECT state,city,lga,area FROM sellers WHERE user_id=$1',
        [b.seller_id],
      );
      requireServiceArea(driver, servicePickup);
      ensure(
        u.id !== d.buyer_id && u.id !== d.seller_id,
        403,
        'CONFLICT',
        'You cannot deliver your own order.',
      );
      ensure(
        driver.vehicle_type === d.vehicle_type,
        409,
        'WRONG_VEHICLE',
        'This job needs a different vehicle.',
      );
      ensure(
        d.status === 'OPEN',
        409,
        'ALREADY_TAKEN',
        'Another driver already took this delivery.',
      );
      ensure(
        !d.requested_driver_id || d.requested_driver_id === u.id,
        403,
        'RIDER_NOT_SELECTED',
        'This delivery was offered to another rider.',
      );
      ensure(
        driver.online &&
          driver.location_at &&
          Date.now() - new Date(driver.location_at).getTime() < 5 * 60000,
        409,
        'LOCATION_STALE',
        'Go online and refresh your location before accepting a job.',
      );
      await riderFree(q, u.id);
      await q.query(
        "UPDATE deliveries SET status='ASSIGNED',driver_id=$1,assigned_at=now() WHERE id=$2",
        [u.id, d.id],
      );
      for (const party of [d.buyer_id, d.seller_id])
        await notify(
          q,
          party,
          'delivery',
          'Driver assigned',
          `${u.name} is on the way to collect ${b.title}.`,
          b.id,
        );
    } else if (action === 'release') {
      ensure(
        d.driver_id === u.id && d.status === 'ASSIGNED',
        409,
        'INVALID_TRANSITION',
        'Only an assigned job that is not yet collected can be released.',
      );
      if (d.requested_driver_id) {
        await cancelDelivery(
          q,
          d,
          'The selected rider released this delivery. Choose another rider.',
          u.id,
        );
        await notify(
          q,
          d.buyer_id,
          'delivery',
          'Choose another rider',
          'Your selected rider could not complete this delivery. The held fare was returned.',
          b.id,
        );
      } else {
        await returnRiderFront(q, d);
        await q.query(
          "UPDATE deliveries SET status='OPEN',driver_id=NULL,assigned_at=NULL WHERE id=$1",
          [d.id],
        );
        await notify(
          q,
          d.buyer_id,
          'delivery',
          'Finding another rider',
          'Your rider released the job. Choose another rider or wait for a nearby rider.',
          b.id,
        );
      }
    } else if (action === 'check') {
      // At the seller: the rider confirms the goods match the order. If the buyer hasn't paid yet
      // the rider pays the item price into escrow from their wallet; the buyer repays them at the door.
      ensure(d.driver_id === u.id, 403, 'FORBIDDEN', 'Only the assigned rider checks the goods.');
      ensure(
        d.status === 'ASSIGNED' && !d.rider_checked_at,
        409,
        'INVALID_TRANSITION',
        'Goods can be checked once, at the seller, before collection.',
      );
      const body = z
        .object({ note: z.string().trim().max(500).optional() })
        .parse(input.body ?? {});
      let fronted = 0;
      if (!b.paid) {
        fronted = Number(b.total_kobo);
        ensure(
          (await lockedBalance(q, u.id)) >= fronted,
          409,
          'INSUFFICIENT_BALANCE',
          `Add ${Math.ceil(fronted / 100).toLocaleString()} naira to your wallet to pay the seller for this order. The buyer pays you back on delivery.`,
        );
        await ledger(q, d.id, [
          { account: 'wallet', owner: u.id, amount: -fronted },
          { account: 'escrow', owner: b.id, amount: fronted },
        ]);
      }
      await q.query(
        'UPDATE deliveries SET rider_checked_at=now(),rider_check_note=$1,rider_fronted_kobo=$2 WHERE id=$3',
        [body.note || null, fronted, d.id],
      );
      await notify(
        q,
        d.seller_id,
        'delivery',
        'Rider checked the goods',
        `${u.name} confirmed ${b.title} is in order. Payment is held in escrow; confirm handover with the rider's code to receive it.`,
        b.id,
      );
    } else if (action === 'cancel') {
      ensure(d.buyer_id === u.id, 403, 'FORBIDDEN', 'Only the buyer can cancel a delivery.');
      ensure(
        ['OPEN', 'ASSIGNED'].includes(d.status),
        409,
        'INVALID_TRANSITION',
        'The driver already has your order. Contact support if something is wrong.',
      );
      await cancelDelivery(q, d, 'Buyer cancelled the delivery.', u.id);
    } else if (action === 'pay') {
      if (deps.config.demo && d.pay_on_delivery && d.progress_stage === 'ARRIVED_DROPOFF')
        ensure(
          d.inspection_accepted_at,
          409,
          'INSPECTION_REQUIRED',
          'Inspect and accept the goods before payment, or report a problem.',
        );
      // Digital Pay on Delivery: the buyer pays in-app at the door; cash is never accepted.
      ensure(d.buyer_id === u.id, 403, 'FORBIDDEN', 'Only the buyer can pay.');
      ensure(
        ['ASSIGNED', 'PICKED_UP'].includes(d.status),
        409,
        'INVALID_TRANSITION',
        'Nothing to pay right now.',
      );
      const due = (b.paid ? 0 : Number(b.total_kobo)) + (d.fare_paid ? 0 : Number(d.fare_kobo));
      ensure(due > 0, 409, 'ALREADY_PAID', 'Everything is already paid.');
      ensure(
        (await lockedBalance(q, u.id)) >= due,
        409,
        'INSUFFICIENT_BALANCE',
        'Add money to your wallet to pay.',
      );
      if (!b.paid) {
        // When the rider already paid the seller's escrow, the buyer's money repays the rider.
        await ledger(
          q,
          b.id,
          Number(d.rider_fronted_kobo)
            ? [
                { account: 'wallet', owner: u.id, amount: -Number(b.total_kobo) },
                { account: 'wallet', owner: d.driver_id, amount: Number(b.total_kobo) },
              ]
            : [
                { account: 'wallet', owner: u.id, amount: -Number(b.total_kobo) },
                { account: 'escrow', owner: b.id, amount: Number(b.total_kobo) },
              ],
        );
        await q.query('UPDATE bookings SET paid=TRUE WHERE id=$1', [b.id]);
      }
      if (!d.fare_paid) {
        await ledger(q, d.id, [
          { account: 'wallet', owner: u.id, amount: -Number(d.fare_kobo) },
          { account: 'delivery_escrow', owner: d.id, amount: Number(d.fare_kobo) },
        ]);
        await q.query('UPDATE deliveries SET fare_paid=TRUE WHERE id=$1', [d.id]);
      }
      await audit(q, u.id, 'delivery.pay', d.id, { due });
      if (d.driver_id)
        await notify(
          q,
          d.driver_id,
          'delivery',
          'Buyer has paid',
          'Ask the buyer for their delivery PIN.',
          b.id,
        );
    } else if (action === 'handover' || action === 'deliver') {
      const handover = action === 'handover';
      ensure(
        handover ? d.seller_id === u.id : d.driver_id === u.id,
        403,
        'FORBIDDEN',
        handover
          ? 'Only the seller confirms handover.'
          : 'Only the assigned driver confirms delivery.',
      );
      ensure(
        d.status === (handover ? 'ASSIGNED' : 'PICKED_UP'),
        409,
        'INVALID_TRANSITION',
        handover
          ? 'No driver is waiting to collect this order.'
          : 'Collect the order before delivering it.',
      );
      if (handover) {
        ensure(
          d.rider_checked_at,
          409,
          'RIDER_CHECK_REQUIRED',
          'The rider must check the goods in their app before you hand them over.',
        );
        ensure(
          b.paid || Number(d.rider_fronted_kobo) > 0,
          409,
          'ESCROW_NOT_FUNDED',
          'Payment for this order is not in escrow yet.',
        );
      }
      if (!handover)
        ensure(
          b.paid && d.fare_paid,
          409,
          'PAYMENT_REQUIRED',
          'The buyer must pay in the app before handover.',
        );
      ensure(
        !d.pin_locked_until || new Date(d.pin_locked_until).getTime() <= Date.now(),
        429,
        'PIN_LOCKED',
        'Too many incorrect PINs. Try again in 15 minutes.',
      );
      const body = z.object({ pin: z.string().regex(/^\d{6}$/) }).parse(input.body);
      if (body.pin !== (handover ? d.pickup_pin : d.delivery_pin)) {
        const failures = d.pin_failures + 1;
        await q.query('UPDATE deliveries SET pin_failures=$1,pin_locked_until=$2 WHERE id=$3', [
          failures,
          failures % 5 === 0 ? new Date(Date.now() + 15 * 60000) : null,
          d.id,
        ]);
        await audit(q, u.id, 'delivery.invalid_pin', d.id, { action });
        return { error: { status: 400, code: 'INVALID_PIN', message: 'That PIN is incorrect.' } };
      }
      if (handover) {
        await q.query(
          "UPDATE deliveries SET status='PICKED_UP',picked_up_at=now(),pin_failures=0,seller_released_at=now() WHERE id=$1",
          [d.id],
        );
        // Rider checked the goods and the seller confirmed handover: escrow goes to the seller.
        await releaseToSeller(q, b);
        await notify(
          q,
          d.seller_id,
          'payout',
          'Payment released',
          `${Math.round((Number(b.total_kobo) - Number(b.commission_kobo)) / 100).toLocaleString()} naira for ${b.title} is now in your earnings.`,
          b.id,
        );
        await notify(
          q,
          d.buyer_id,
          'delivery',
          'On the way',
          `${b.title} has been collected and is on its way to you.`,
          b.id,
        );
      } else {
        await q.query("UPDATE deliveries SET status='DELIVERED',delivered_at=now() WHERE id=$1", [
          d.id,
        ]);
        // A delivery partner company's agreed rate applies to its riders; the owner can switch
        // delivery commission off entirely.
        const [partner] = await q.query(
          "SELECT p.id,p.commission_bps FROM drivers dr JOIN delivery_partners p ON p.id=dr.partner_id AND p.status='ACTIVE' WHERE dr.user_id=$1",
          [d.driver_id],
        );
        const [switches] = await q.query('SELECT monetisation FROM settings WHERE id=1');
        const deliveryBps =
          switches?.monetisation?.delivery_commission === false
            ? 0
            : (partner?.commission_bps ?? d.commission_bps);
        if (partner)
          await q.query('UPDATE deliveries SET partner_id=$1 WHERE id=$2', [partner.id, d.id]);
        const driverShare = Math.round((Number(d.fare_kobo) * (10000 - deliveryBps)) / 10000);
        if (!d.seller_released_at) await releaseToSeller(q, b);
        // Driver earnings share the payable account, so drivers withdraw through payouts.
        await ledger(q, d.id, [
          { account: 'delivery_escrow', owner: d.id, amount: -Number(d.fare_kobo) },
          { account: 'seller_payable', owner: d.driver_id, amount: driverShare },
          { account: 'platform_revenue', amount: Number(d.fare_kobo) - driverShare },
        ]);
        await event(
          q,
          b,
          'COMPLETED',
          u.id,
          'Driver verified the buyer’s delivery PIN; delivery confirmed.',
        );
      }
    }
    if (action === 'handover' || action === 'deliver') {
      const stage = action === 'handover' ? 'GOODS_COLLECTED' : 'DELIVERED';
      await q.query('UPDATE deliveries SET progress_stage=$1 WHERE id=$2', [stage, d.id]);
      await q.query(
        'INSERT INTO delivery_milestones(id,delivery_id,actor_id,stage) VALUES($1,$2,$3,$4) ON CONFLICT(delivery_id,stage) DO NOTHING',
        [randomUUID(), d.id, u.id, stage],
      );
    }
    if (action === 'claim') {
      ensure(
        !d.scheduled_at || new Date(d.scheduled_at).getTime() <= Date.now() + 15 * 60000,
        409,
        'SCHEDULED_DELIVERY',
        'This job becomes available 15 minutes before its scheduled time.',
      );
      await q.query("UPDATE deliveries SET progress_stage='ASSIGNED' WHERE id=$1", [d.id]);
    }
    await audit(q, u.id, `delivery.${action}`, d.id);
    const [fresh] = await q.query(`${withParty} WHERE d.id=$1`, [d.id]);
    return view(fresh, u);
  }
  return {
    getDeliveryOptions,
    quoteDelivery,
    requestDelivery,
    getBookingDelivery,
    getMyDriverProfile,
    applyAsDriver,
    updateDriverStatus,
    listDriverJobs,
    performDeliveryAction,
  };
}

/** Business logic for admindeliveries requests. HTTP-free: callers pass plain input. */
export function createAdminDeliveriesService(deps: AppDeps) {
  const { db } = deps;
  async function listDrivers(user: any, input: RequestInput) {
    return await db.query(
      "SELECT d.*,u.name,u.email,u.phone,v.name AS vehicle_name FROM drivers d JOIN users u ON u.id=d.user_id JOIN vehicle_types v ON v.code=d.vehicle_type ORDER BY (d.status='PENDING') DESC,d.created_at DESC LIMIT 200",
    );
  }
  async function reviewDriver(q: Query, u: any, input: RequestInput) {
    const d = z
      .object({
        status: z.enum(['APPROVED', 'REJECTED', 'SUSPENDED']),
        reason: z.string().trim().min(3).max(500),
      })
      .parse(input.body);
    if (d.status === 'APPROVED')
      await requirePhotoVerification(q, input.params.id as string, 'driver');
    const [driver] = await q.query(
      "UPDATE drivers SET status=$1,reason=$2,online=CASE WHEN $1='APPROVED' THEN online ELSE FALSE END WHERE user_id=$3 RETURNING *",
      [d.status, d.reason, input.params.id],
    );
    ensure(driver, 404, 'NOT_FOUND', 'Driver not found.');
    await audit(q, u.id, 'driver.review', driver.user_id, d);
    await notify(
      q,
      driver.user_id,
      'verification',
      `Driver application ${d.status.toLowerCase()}`,
      d.reason,
    );
    return driver;
  }
  async function listDeliveries(user: any, input: RequestInput) {
    return await db.query(
      `SELECT d.id,d.status,d.distance_km,d.fare_kobo,d.pay_on_delivery,d.fare_paid,d.created_at,d.delivered_at,d.cancel_reason,b.title,s.business_name,buyer.name AS buyer_name,du.name AS driver_name,vt.name AS vehicle_name
         FROM deliveries d JOIN bookings b ON b.id=d.booking_id JOIN sellers s ON s.user_id=d.seller_id JOIN users buyer ON buyer.id=d.buyer_id
         LEFT JOIN users du ON du.id=d.driver_id JOIN vehicle_types vt ON vt.code=d.vehicle_type ORDER BY d.created_at DESC LIMIT 200`,
    );
  }
  async function listVehicleTypes(user: any, input: RequestInput) {
    return await db.prisma.vehicleType.findMany({ orderBy: { sort: 'asc' } });
  }
  async function saveVehicleType(q: Query, u: any, input: RequestInput) {
    const d = z
      .object({
        name: z.string().trim().min(2).max(60),
        base_fare_kobo: z.number().int().min(0).max(10000000),
        per_km_kobo: z.number().int().min(0).max(1000000),
        min_fare_kobo: z.number().int().min(0).max(10000000),
        max_km: z.number().int().min(1).max(500),
        active: z.boolean(),
      })
      .parse(input.body);
    const [v] = await q.query(
      'INSERT INTO vehicle_types(code,name,base_fare_kobo,per_km_kobo,min_fare_kobo,max_km,active,sort) VALUES($1,$2,$3,$4,$5,$6,$7,(SELECT COALESCE(MAX(sort),0)+1 FROM vehicle_types)) ON CONFLICT(code) DO UPDATE SET name=$2,base_fare_kobo=$3,per_km_kobo=$4,min_fare_kobo=$5,max_km=$6,active=$7 RETURNING *',
      [
        String(input.params.code).toLowerCase(),
        d.name,
        d.base_fare_kobo,
        d.per_km_kobo,
        d.min_fare_kobo,
        d.max_km,
        d.active,
      ],
    );
    await audit(q, u.id, 'vehicle_type.save', v.code, d);
    return v;
  }
  return { listDrivers, reviewDriver, listDeliveries, listVehicleTypes, saveVehicleType };
}
