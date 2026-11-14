import { randomInt, randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { Query } from '../database/client.js';
import { ensure } from '../lib/errors.js';
import type { RequestInput } from '../lib/http.js';
import type { AppDeps } from '../types/deps.js';
import { audit } from './audit.service.js';
import { notify } from './communications.service.js';
import { ledger, lockedBalance } from './ledger.service.js';

/** Straight-line distance in km. */
export function haversineKm(aLat: number, aLng: number, bLat: number, bLng: number) {
  const rad = (d: number) => (d * Math.PI) / 180;
  const h =
    Math.sin(rad(bLat - aLat) / 2) ** 2 +
    Math.cos(rad(aLat)) * Math.cos(rad(bLat)) * Math.sin(rad(bLng - aLng) / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.min(1, Math.sqrt(h)));
}
/** Roads are longer than the straight line; 1.3 is a common urban detour factor. */
export const ROAD_FACTOR = 1.3;

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

/** Cancels an unfinished delivery and refunds a prepaid fare. Used by booking release/expiry. */
export async function cancelDelivery(q: Query, d: any, reason: string, actor: string | null) {
  if (!['OPEN', 'ASSIGNED'].includes(d.status)) return;
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
export function createDeliveriesService(deps: AppDeps) {
  const { db } = deps;
  async function quote(q: Query, b: any, vehicle: string, drop: z.infer<typeof point>) {
    const [s] = await q.query('SELECT latitude,longitude FROM sellers WHERE user_id=$1', [
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
    const km =
      Math.round(
        haversineKm(s.latitude, s.longitude, drop.latitude, drop.longitude) * ROAD_FACTOR * 10,
      ) / 10;
    ensure(km <= v.max_km, 400, 'TOO_FAR', `${v.name} delivery covers up to ${v.max_km} km.`);
    return { pickup: s, vehicle: v, distance_km: km, fare_kobo: fareFor(v, km) };
  }
  async function buyerBooking(q: Query, id: string, uid: string, lock = false) {
    const [b] = await q.query(`SELECT * FROM bookings WHERE id=$1${lock ? ' FOR UPDATE' : ''}`, [
      id,
    ]);
    ensure(b && b.buyer_id === uid, 404, 'NOT_FOUND', 'Booking not found.');
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
    s.business_name,s.address AS pickup_address,buyer.name AS buyer_name,buyer.phone AS buyer_phone,
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
      pay_on_delivery: s.pay_on_delivery_enabled,
    };
  }
  async function quoteDelivery(user: any, input: RequestInput) {
    const d = z.object({ vehicle_type: z.string().max(30), dropoff: point }).parse(input.body);
    const b = await buyerBooking(db, input.params.id as string, user.id);
    const { distance_km, fare_kobo, vehicle } = await quote(db, b, d.vehicle_type, d.dropoff);
    return { distance_km, fare_kobo, vehicle_type: vehicle.code, vehicle_name: vehicle.name };
  }
  async function requestDelivery(q: Query, u: any, input: RequestInput) {
    const d = z
      .object({
        vehicle_type: z.string().max(30),
        dropoff: point,
        dropoff_address: z.string().trim().min(8).max(500),
        pay_on_delivery: z.boolean().default(false),
        expected_fare_kobo: z.number().int().positive(),
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
      !d.pay_on_delivery || settings.pay_on_delivery_enabled,
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
    const qd = await quote(q, b, d.vehicle_type, d.dropoff);
    ensure(
      qd.fare_kobo === d.expected_fare_kobo,
      409,
      'FARE_CHANGED',
      'The delivery fare changed. Please review the new quote.',
    );
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
      "SELECT user_id,latitude,longitude FROM drivers WHERE status='APPROVED' AND online AND vehicle_type=$1 AND latitude IS NOT NULL AND location_at>now()-interval '30 minutes'",
      [qd.vehicle.code],
    );
    for (const n of nearby)
      if (
        haversineKm(n.latitude, n.longitude, qd.pickup.latitude, qd.pickup.longitude) <=
        settings.delivery_radius_km
      )
        await notify(
          q,
          n.user_id,
          'delivery',
          'New delivery nearby',
          `${qd.distance_km} km trip · earn about ₦${Math.round((qd.fare_kobo * (10000 - settings.delivery_commission_bps)) / 1000000).toLocaleString()}`,
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
    const [driver] = await db.query('SELECT status FROM drivers WHERE user_id=$1', [user.id]);
    ensure(driver?.status === 'APPROVED', 403, 'DRIVER_NOT_APPROVED', 'Approved drivers only.');
    ensure(
      !d.online || d.latitude != null,
      400,
      'LOCATION_REQUIRED',
      'Share your location to go online.',
    );
    const [saved] = await db.query(
      'UPDATE drivers SET online=$1,latitude=COALESCE($2,latitude),longitude=COALESCE($3,longitude),location_at=CASE WHEN $2 IS NULL THEN location_at ELSE now() END WHERE user_id=$4 RETURNING online,latitude,longitude,location_at',
      [d.online, d.latitude ?? null, d.longitude ?? null, user.id],
    );
    // Live tracking: active jobs follow the driver's latest position.
    if (d.latitude != null)
      await db.query(
        "UPDATE deliveries SET driver_latitude=$1,driver_longitude=$2,driver_location_at=now() WHERE driver_id=$3 AND status IN ('ASSIGNED','PICKED_UP')",
        [d.latitude, d.longitude, user.id],
      );
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
              `${withParty} WHERE d.status='OPEN' AND d.vehicle_type=$1 AND d.buyer_id<>$2 AND d.seller_id<>$2 ORDER BY d.created_at LIMIT 100`,
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
            .filter((d) => d.away_km <= settings.delivery_radius_km)
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
  return {
    getDeliveryOptions,
    quoteDelivery,
    requestDelivery,
    getBookingDelivery,
    getMyDriverProfile,
    applyAsDriver,
    updateDriverStatus,
    listDriverJobs,
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
