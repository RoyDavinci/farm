import type { RequestHandler } from 'express';
import { z } from 'zod';
import type { Query } from '../database/client.js';
import { ensure } from '../lib/errors.js';
import { requestInput } from '../lib/http.js';
import { audit } from '../services/audit.service.js';
import { event } from '../services/booking.service.js';
import { notify } from '../services/communications.service.js';
import {
  cancelDelivery,
  createAdminDeliveriesService,
  createDeliveriesService,
  fareFor,
  haversineKm,
  point,
  ROAD_FACTOR,
} from '../services/deliveries.service.js';
import { ledger, lockedBalance } from '../services/ledger.service.js';
import type { AppDeps } from '../types/deps.js';

export function createDeliveriesController(deps: AppDeps) {
  const { mutate } = deps;
  const service = createDeliveriesService(deps);
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
  const getDeliveryOptions: RequestHandler = async (req, res) => {
    res.json(await service.getDeliveryOptions(res.locals.user, requestInput(req)));
  };
  const quoteDelivery: RequestHandler = async (req, res) => {
    res.json(await service.quoteDelivery(res.locals.user, requestInput(req)));
  };
  const requestDelivery: RequestHandler = (req, res) =>
    mutate(req, res, (q, user) => service.requestDelivery(q, user, requestInput(req)));
  const getBookingDelivery: RequestHandler = async (req, res) => {
    res.json(await service.getBookingDelivery(res.locals.user, requestInput(req)));
  };
  const performDeliveryAction: RequestHandler = async (req, res) => {
    const action = z
      .enum(['cancel', 'pay', 'claim', 'release', 'handover', 'deliver'])
      .parse(req.params.action);
    return mutate(req, res, async (q, u) => {
      // Lock order matches booking cancel/expiry (booking → delivery) so the two can't deadlock.
      const [ref] = await q.query('SELECT booking_id FROM deliveries WHERE id=$1', [req.params.id]);
      ensure(ref, 404, 'NOT_FOUND', 'Delivery not found.');
      const [b] = await q.query('SELECT * FROM bookings WHERE id=$1 FOR UPDATE', [ref.booking_id]);
      const [d] = await q.query('SELECT * FROM deliveries WHERE id=$1 FOR UPDATE', [req.params.id]);
      if (action === 'claim') {
        const [driver] = await q.query('SELECT * FROM drivers WHERE user_id=$1', [u.id]);
        ensure(driver?.status === 'APPROVED', 403, 'DRIVER_NOT_APPROVED', 'Approved drivers only.');
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
        const [busy] = await q.query(
          "SELECT id FROM deliveries WHERE driver_id=$1 AND status IN ('ASSIGNED','PICKED_UP')",
          [u.id],
        );
        ensure(!busy, 409, 'DRIVER_BUSY', 'Finish your current delivery first.');
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
        await q.query(
          "UPDATE deliveries SET status='OPEN',driver_id=NULL,assigned_at=NULL WHERE id=$1",
          [d.id],
        );
        await notify(
          q,
          d.buyer_id,
          'delivery',
          'Finding another driver',
          'Your driver released the job. We are finding another driver.',
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
          await ledger(q, b.id, [
            { account: 'wallet', owner: u.id, amount: -Number(b.total_kobo) },
            { account: 'escrow', owner: b.id, amount: Number(b.total_kobo) },
          ]);
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
        const body = z.object({ pin: z.string().regex(/^\d{6}$/) }).parse(req.body);
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
            "UPDATE deliveries SET status='PICKED_UP',picked_up_at=now(),pin_failures=0 WHERE id=$1",
            [d.id],
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
          const driverShare = Math.round(
            (Number(d.fare_kobo) * (10000 - d.commission_bps)) / 10000,
          );
          await ledger(q, b.id, [
            { account: 'escrow', owner: b.id, amount: -Number(b.total_kobo) },
            {
              account: 'seller_payable',
              owner: b.seller_id,
              amount: Number(b.total_kobo) - Number(b.commission_kobo),
            },
            { account: 'platform_revenue', amount: Number(b.commission_kobo) },
          ]);
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
      await audit(q, u.id, `delivery.${action}`, d.id);
      const [fresh] = await q.query(`${withParty} WHERE d.id=$1`, [d.id]);
      return view(fresh, u);
    });
  };
  const getMyDriverProfile: RequestHandler = async (req, res) => {
    res.json(await service.getMyDriverProfile(res.locals.user, requestInput(req)));
  };
  const applyAsDriver: RequestHandler = (req, res) =>
    mutate(req, res, (q, user) => service.applyAsDriver(q, user, requestInput(req)));
  const updateDriverStatus: RequestHandler = async (req, res) => {
    res.json(await service.updateDriverStatus(res.locals.user, requestInput(req)));
  };
  const listDriverJobs: RequestHandler = async (req, res) => {
    res.json(await service.listDriverJobs(res.locals.user, requestInput(req)));
  };
  return {
    getDeliveryOptions,
    quoteDelivery,
    requestDelivery,
    getBookingDelivery,
    performDeliveryAction,
    getMyDriverProfile,
    applyAsDriver,
    updateDriverStatus,
    listDriverJobs,
  };
}

export function createAdminDeliveriesController(deps: AppDeps) {
  const { mutate } = deps;
  const service = createAdminDeliveriesService(deps);
  const listDrivers: RequestHandler = async (req, res) => {
    res.json(await service.listDrivers(res.locals.user, requestInput(req)));
  };
  const reviewDriver: RequestHandler = (req, res) =>
    mutate(req, res, (q, user) => service.reviewDriver(q, user, requestInput(req)));
  const listDeliveries: RequestHandler = async (req, res) => {
    res.json(await service.listDeliveries(res.locals.user, requestInput(req)));
  };
  const listVehicleTypes: RequestHandler = async (req, res) => {
    res.json(await service.listVehicleTypes(res.locals.user, requestInput(req)));
  };
  const saveVehicleType: RequestHandler = (req, res) =>
    mutate(req, res, (q, user) => service.saveVehicleType(q, user, requestInput(req)));
  return { listDrivers, reviewDriver, listDeliveries, listVehicleTypes, saveVehicleType };
}
