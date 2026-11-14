import { randomInt, randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { Database, Query } from '../database/client.js';
import { ensure } from '../lib/errors.js';
import type { RequestInput } from '../lib/http.js';
import type { AppDeps } from '../types/deps.js';
import { syncPrimary, unitPrice } from './catalog.service.js';
import { notify } from './communications.service.js';
import { cancelDelivery } from './deliveries.service.js';
import { ledger } from './ledger.service.js';
import { paymentService } from './payment-provider.service.js';
import { listingAvailable, notifyIfRestocked } from './retention.service.js';

const id = () => randomUUID();

/** Moves a booking to a new status, records the event and notifies the other party. */
export async function event(q: Query, b: any, to: string, actor: string | null, reason: string) {
  await q.query('UPDATE bookings SET status=$1 WHERE id=$2', [to, b.id]);
  await q.query(
    'INSERT INTO events(id,booking_id,from_status,to_status,actor_id,reason) VALUES($1,$2,$3,$4,$5,$6)',
    [id(), b.id, b.status || null, to, actor, reason],
  );
  const [booking] = await q.query('SELECT * FROM bookings WHERE id=$1', [b.id]);
  for (const uid of new Set<string>([booking.buyer_id, booking.seller_id])) {
    if (uid === actor) continue;
    await notify(
      q,
      uid,
      'booking',
      `Booking ${to.toLowerCase().replaceAll('_', ' ')}`,
      `${booking.title}: ${reason}`,
      booking.id,
    );
  }
}

/**
 * Ends a booking (cancel/expire/decline): cancels an unfinished delivery, returns reserved stock
 * or pre-order capacity, and refunds a held wallet payment.
 */
export async function release(q: Query, b: any, to: string, actor: string | null, reason: string) {
  // An unfinished delivery is cancelled with the booking and its prepaid fare refunded.
  const [delivery] = await q.query(
    "SELECT * FROM deliveries WHERE booking_id=$1 AND status IN ('OPEN','ASSIGNED') FOR UPDATE",
    [b.id],
  );
  if (delivery) await cancelDelivery(q, delivery, `Booking ${to.toLowerCase()}: ${reason}`, actor);
  if (['ACCEPTED', 'READY_FOR_PICKUP'].includes(b.status)) {
    await q.query('SELECT id FROM listings WHERE id=$1 FOR UPDATE', [b.listing_id]);
    const wasAvailable = await listingAvailable(q, b.listing_id);
    if (b.preorder)
      await q.query('UPDATE listings SET preorder_capacity=preorder_capacity+$1 WHERE id=$2', [
        b.quantity,
        b.listing_id,
      ]);
    else {
      await q.query('UPDATE listing_variants SET stock=stock+$1 WHERE id=$2', [
        b.quantity,
        b.variant_id,
      ]);
      await syncPrimary(q, b.listing_id);
    }
    await notifyIfRestocked(q, b.listing_id, wasAvailable);
    if (b.paid) {
      await ledger(q, b.id, [
        { account: 'escrow', owner: b.id, amount: -b.total_kobo },
        { account: 'wallet', owner: b.buyer_id, amount: b.total_kobo },
      ]);
      await q.query('UPDATE bookings SET paid=FALSE WHERE id=$1', [b.id]);
    }
  }
  await event(q, b, to, actor, reason);
}

/** Expires reservations and counteroffers whose deadline has passed (also run by the worker). */
export async function expireReservations(db: Database, now = new Date()) {
  await db.transaction(async (q) => {
    const rows = await q.query(
      "SELECT * FROM bookings WHERE ((status IN ('ACCEPTED','READY_FOR_PICKUP') AND reserved_until <= $1) OR (status='COUNTERED' AND offer_expires_at<=$1)) AND NOT EXISTS(SELECT 1 FROM disputes d WHERE d.booking_id=bookings.id AND d.status='OPEN') AND NOT EXISTS(SELECT 1 FROM deliveries dv WHERE dv.booking_id=bookings.id AND dv.status='PICKED_UP') ORDER BY id FOR UPDATE",
      [now],
    );
    for (const b of rows)
      await release(
        q,
        b,
        'EXPIRED',
        null,
        'One-week reservation expired; stock released and wallet payment refunded.',
      );
  });
}

/**
 * Bookings visible to a user. Pickup address and coordinates are shown only during an active
 * reservation, and the pickup code only to the buyer.
 */
export async function readBookings(db: Database, u: any, bookingId?: string) {
  const rows = await db.query(
    `SELECT b.*,EXISTS(SELECT 1 FROM ledger pl WHERE pl.account='escrow' AND pl.owner_id=b.id AND pl.amount_kobo>0) AS payment_recorded,(SELECT d.status FROM disputes d WHERE d.booking_id=b.id) AS dispute_status,s.business_name,s.address,buyer.name AS buyer_name FROM bookings b JOIN sellers s ON s.user_id=b.seller_id JOIN users buyer ON buyer.id=b.buyer_id WHERE ${bookingId ? 'b.id=$2 AND ' : ''}(b.buyer_id=$1 OR b.seller_id=$1 ${u.admin ? 'OR TRUE' : ''}) ORDER BY b.created_at DESC LIMIT 100`,
    bookingId ? [u.id, bookingId] : [u.id],
  );
  return rows.map((b) => {
    const {
      pickup_code,
      address,
      pickup_address_snapshot,
      pickup_latitude,
      pickup_longitude,
      pickup_failures,
      pickup_locked_until,
      ...safe
    } = b;
    const active =
      ['ACCEPTED', 'READY_FOR_PICKUP'].includes(b.status) &&
      new Date(b.reserved_until).getTime() > Date.now();
    if (active && (u.id === b.buyer_id || u.id === b.seller_id || u.admin)) {
      safe.pickup_address = pickup_address_snapshot || address;
      safe.pickup_latitude = pickup_latitude;
      safe.pickup_longitude = pickup_longitude;
    }
    if (active && u.id === b.buyer_id) safe.pickup_code = pickup_code;
    return safe;
  });
}

/** Business logic for bookings requests. HTTP-free: callers pass plain input. */
export function createBookingsService(deps: AppDeps) {
  const { db, config: c } = deps;
  const payments = paymentService(c);
  const visibleBookings = (u: any, bookingId?: string) => readBookings(db, u, bookingId);
  const id = () => randomUUID();
  async function listBookings(user: any, input: RequestInput) {
    await expireReservations(db);
    return await visibleBookings(user);
  }
  async function getBooking(user: any, input: RequestInput) {
    await expireReservations(db);
    const [b] = await visibleBookings(user, input.params.id as string);
    ensure(b, 404, 'NOT_FOUND', 'Booking not found.');
    return b;
  }
  async function listBookingEvents(user: any, input: RequestInput) {
    const [b] = await visibleBookings(user, input.params.id as string);
    ensure(b, 404, 'NOT_FOUND', 'Booking not found.');
    return await db.query('SELECT * FROM events WHERE booking_id=$1 ORDER BY created_at,id', [
      b.id,
    ]);
  }
  async function createBooking(q: Query, u: any, input: RequestInput) {
    const d = z
      .object({
        listing_id: z.uuid(),
        variant_id: z.uuid().optional(),
        quantity: z.number().int().min(1).max(100000),
      })
      .parse(input.body);
    const [l] = await q.query(
      "SELECT l.* FROM listings l JOIN sellers s ON s.user_id=l.seller_id WHERE l.id=$1 AND l.status='ACTIVE' AND s.status='APPROVED' AND EXISTS(SELECT 1 FROM users su WHERE su.id=s.user_id AND su.status='ACTIVE')",
      [d.listing_id],
    );
    ensure(l, 404, 'NOT_FOUND', 'Listing is unavailable.');
    ensure(l.seller_id !== u.id, 400, 'OWN_LISTING', 'You cannot book your own listing.');
    const [variant] = await q.query(
      `SELECT * FROM listing_variants WHERE listing_id=$1 AND active AND ${d.variant_id ? 'id=$2' : 'is_primary'}`,
      d.variant_id ? [l.id, d.variant_id] : [l.id],
    );
    ensure(variant, 400, 'VARIANT_REQUIRED', 'Choose an available product variant.');
    ensure(
      d.quantity >= variant.min_quantity,
      400,
      'MIN_QUANTITY',
      `Minimum order is ${variant.min_quantity} ${variant.unit}.`,
    );
    const preorder = !!l.available_from && new Date(l.available_from).getTime() > Date.now();
    ensure(
      preorder ? l.preorder_capacity >= d.quantity : variant.stock >= d.quantity,
      409,
      'OUT_OF_STOCK',
      preorder
        ? 'Not enough pre-order capacity left for this harvest.'
        : 'Not enough stock for this variant.',
    );
    const price = unitPrice(variant as any, d.quantity);
    const [s] = await q.query('SELECT * FROM settings WHERE id=1');
    const total = price * d.quantity;
    ensure(total <= 100000000, 400, 'ORDER_LIMIT', 'Order exceeds the current ₦1,000,000 limit.');
    const [b] = await q.query(
      'INSERT INTO bookings(id,buyer_id,seller_id,listing_id,title,unit,quantity,price_kobo,total_kobo,commission_bps,commission_kobo,pickup_code) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *',
      [
        id(),
        u.id,
        l.seller_id,
        l.id,
        l.title,
        variant.unit,
        d.quantity,
        price,
        total,
        s.commission_bps,
        Math.round((total * s.commission_bps) / 10000),
        String(randomInt(100000, 1000000)),
      ],
    );
    await q.query('UPDATE bookings SET variant_id=$1,variant_name=$2,preorder=$3 WHERE id=$4', [
      variant.id,
      variant.name,
      preorder,
      b.id,
    ]);
    b.variant_id = variant.id;
    b.variant_name = variant.name;
    b.preorder = preorder;
    await event(q, { ...b, status: null }, 'REQUESTED', u.id, 'Buyer requested pickup booking.');
    const { pickup_code, ...safe } = b;
    return safe;
  }
  return { listBookings, getBooking, listBookingEvents, createBooking };
}
