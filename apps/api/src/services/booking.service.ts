import { discoveryEvent } from './discovery-operations.service.js';
import { listingAvailable as catalogueAvailable } from './retention.service.js';
import { randomInt, randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { Database, Query } from '../database/client.js';
import { ensure } from '../lib/errors.js';
import type { RequestInput } from '../lib/http.js';
import type { AppDeps } from '../types/deps.js';
import { audit } from './audit.service.js';
import { syncPrimary, unitPrice } from './catalog.service.js';
import { notify } from './communications.service.js';
import { cancelDelivery } from './deliveries.service.js';
import { ledger, lockedBalance } from './ledger.service.js';
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
    if (active && b.pickup_available && u.id === b.buyer_id) safe.pickup_code = pickup_code;
    return safe;
  });
}

/** Business logic for bookings requests. HTTP-free: callers pass plain input. */
export function createBookingsService(deps: AppDeps) {
  const { db, config: c } = deps;
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
        source_status_click_id: z.uuid().optional(),
      })
      .parse(input.body);
    const [l] = await q.query(
      "SELECT l.* FROM listings l JOIN sellers s ON s.user_id=l.seller_id WHERE l.id=$1 AND l.status='ACTIVE' AND s.status='APPROVED' AND EXISTS(SELECT 1 FROM users su WHERE su.id=s.user_id AND su.status='ACTIVE')",
      [d.listing_id],
    );
    ensure(
      l && (await catalogueAvailable(q, l.id)),
      404,
      'NOT_FOUND',
      'Listing is unavailable or needs stock reconfirmation.',
    );
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
      !preorder || c.features.preorders,
      409,
      'OUT_OF_STOCK',
      'This item is not available to book yet.',
    );
    ensure(
      preorder ? l.preorder_capacity >= d.quantity : variant.stock >= d.quantity,
      409,
      'OUT_OF_STOCK',
      preorder
        ? 'Not enough pre-order places left for this item.'
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
    await q.query('UPDATE bookings SET pickup_available=$1,delivery_available=$2 WHERE id=$3', [
      l.pickup_available,
      l.delivery_available,
      b.id,
    ]);
    b.pickup_available = l.pickup_available;
    b.delivery_available = l.delivery_available;
    b.preorder = preorder;
    await discoveryEvent(q, u.id, 'BOOKING', l.id, l.category);
    const [sourceClick] = await q.query(
      'SELECT id FROM status_clicks WHERE buyer_id=$1 AND listing_id=$2 AND booking_id IS NULL AND expires_at>now() AND ($3::text IS NULL OR id=$3) ORDER BY created_at DESC,id DESC LIMIT 1 FOR UPDATE',
      [u.id, l.id, d.source_status_click_id ?? null],
    );
    if (sourceClick)
      await q.query('UPDATE status_clicks SET booking_id=$1 WHERE id=$2 AND booking_id IS NULL', [
        b.id,
        sourceClick.id,
      ]);
    await event(q, { ...b, status: null }, 'REQUESTED', u.id, 'Buyer requested pickup booking.');
    const { pickup_code, ...safe } = b;
    return safe;
  }
  /** Expires overdue reservations before a booking action (outside its transaction). */
  const expireDue = () => expireReservations(db);
  async function performBookingAction(q: Query, u: any, input: RequestInput) {
    const action = z
      .enum([
        'accept',
        'decline',
        'ready',
        'cancel',
        'pay',
        'pickup',
        'counter',
        'approve-change',
        'decline-change',
      ])
      .parse(input.params.action);

    const [b] = await q.query('SELECT * FROM bookings WHERE id=$1 FOR UPDATE', [input.params.id]);
    ensure(
      b && (b.buyer_id === u.id || b.seller_id === u.id),
      404,
      'NOT_FOUND',
      'Booking not found.',
    );
    const [openCase] = await q.query(
      "SELECT id FROM disputes WHERE booking_id=$1 AND status='OPEN'",
      [b.id],
    );
    ensure(
      !openCase,
      409,
      'SUPPORT_REVIEW',
      'This booking is under support review. Open its support case for updates.',
    );
    const [delivery] = await q.query(
      "SELECT status FROM deliveries WHERE booking_id=$1 AND status IN ('OPEN','ASSIGNED','PICKED_UP')",
      [b.id],
    );
    ensure(
      !delivery || !['pickup', 'pay'].includes(action),
      409,
      'DELIVERY_IN_PROGRESS',
      action === 'pickup'
        ? 'This order is being delivered. The driver confirms it with the buyer’s delivery PIN.'
        : 'Pay from the delivery panel so the booking and fare are paid together.',
    );
    ensure(
      delivery?.status !== 'PICKED_UP' || action !== 'cancel',
      409,
      'DELIVERY_IN_PROGRESS',
      'A driver already has this order. Open a support case if something is wrong.',
    );
    // Recheck inside the locked transaction: a deadline can pass after the sweep.
    if (
      ['ACCEPTED', 'READY_FOR_PICKUP'].includes(b.status) &&
      new Date(b.reserved_until).getTime() <= Date.now()
    ) {
      await release(q, b, 'EXPIRED', null, 'Reservation expired; stock and wallet funds returned.');
      return {
        error: {
          status: 409,
          code: 'RESERVATION_EXPIRED',
          message: 'This reservation has expired. Please create a new booking.',
        },
      };
    }
    const seller = u.id === b.seller_id;
    const buyer = u.id === b.buyer_id;
    const allowed: Record<string, string[]> = {
      accept: ['REQUESTED'],
      decline: ['REQUESTED', 'COUNTERED'],
      counter: ['REQUESTED', 'COUNTERED'],
      'approve-change': ['COUNTERED'],
      'decline-change': ['COUNTERED'],
      ready: ['ACCEPTED'],
      cancel: ['REQUESTED', 'COUNTERED', 'ACCEPTED', 'READY_FOR_PICKUP'],
      pay: ['ACCEPTED', 'READY_FOR_PICKUP'],
      pickup: ['READY_FOR_PICKUP'],
    };
    ensure(
      allowed[action].includes(b.status),
      409,
      'INVALID_TRANSITION',
      `Cannot ${action} a ${b.status.toLowerCase()} booking.`,
    );
    if (['accept', 'decline', 'ready', 'pickup', 'counter'].includes(action))
      ensure(seller, 403, 'FORBIDDEN', 'Only the seller can perform this action.');
    if (action === 'counter') {
      const d = z
        .object({
          quantity: z.number().int().min(1).max(100000),
          price_kobo: z.number().int().min(100).max(100000000),
          note: z.string().trim().min(3).max(500),
        })
        .parse(input.body);
      const [v] = await q.query('SELECT * FROM listing_variants WHERE id=$1', [b.variant_id]);
      const [cl] = await q.query('SELECT preorder_capacity FROM listings WHERE id=$1', [
        b.listing_id,
      ]);
      ensure(
        v?.active &&
          d.quantity >= v.min_quantity &&
          d.quantity <= (b.preorder ? cl.preorder_capacity : v.stock),
        409,
        'OUT_OF_STOCK',
        'The proposed quantity is unavailable for this variant.',
      );
      ensure(
        d.quantity * d.price_kobo <= 100000000,
        400,
        'ORDER_LIMIT',
        'Offer exceeds the current order limit.',
      );
      await q.query(
        'UPDATE bookings SET offer_quantity=$1,offer_price_kobo=$2,offer_note=$3,offer_expires_at=$4,offer_version=offer_version+1 WHERE id=$5',
        [d.quantity, d.price_kobo, d.note, new Date(Date.now() + 168 * 3600000), b.id],
      );
      await event(
        q,
        b,
        'COUNTERED',
        u.id,
        `Seller offered ${d.quantity} ${b.unit} at ₦${d.price_kobo / 100} per unit. ${d.note}`,
      );
    } else if (action === 'decline-change') {
      ensure(buyer, 403, 'FORBIDDEN', 'Only the buyer can decline revised terms.');
      await event(q, b, 'DECLINED', u.id, 'Buyer declined the seller counteroffer.');
    } else if (action === 'accept' || action === 'approve-change') {
      if (action === 'approve-change') {
        const d = z.object({ offer_version: z.number().int().min(0) }).parse(input.body);
        ensure(
          d.offer_version === b.offer_version,
          409,
          'OFFER_CHANGED',
          'The seller revised this offer. Refresh and review the latest terms before approving.',
        );
        ensure(buyer, 403, 'FORBIDDEN', 'Only the buyer can approve revised terms.');
        if (new Date(b.offer_expires_at).getTime() <= Date.now()) {
          await release(q, b, 'EXPIRED', null, 'Counteroffer expired.');
          return {
            error: {
              status: 409,
              code: 'OFFER_EXPIRED',
              message: 'This counteroffer has expired.',
            },
          };
        }
        b.quantity = b.offer_quantity;
        b.price_kobo = b.offer_price_kobo;
        b.total_kobo = b.quantity * b.price_kobo;
        b.commission_kobo = Math.round((b.total_kobo * b.commission_bps) / 10000);
        await q.query(
          'UPDATE bookings SET quantity=$1,price_kobo=$2,total_kobo=$3,commission_kobo=$4 WHERE id=$5',
          [b.quantity, b.price_kobo, b.total_kobo, b.commission_kobo, b.id],
        );
      }

      const [s] = await q.query('SELECT status FROM sellers WHERE user_id=$1', [b.seller_id]);
      ensure(
        s?.status === 'APPROVED',
        403,
        'SELLER_NOT_APPROVED',
        'Your seller account is not approved.',
      );
      const [l] = await q.query('SELECT * FROM listings WHERE id=$1 FOR UPDATE', [b.listing_id]);
      const [v] = await q.query('SELECT * FROM listing_variants WHERE id=$1 FOR UPDATE', [
        b.variant_id,
      ]);
      ensure(
        l.status === 'ACTIVE' &&
          v?.active &&
          (b.preorder ? l.preorder_capacity : v.stock) >= b.quantity &&
          b.quantity >= v.min_quantity,
        409,
        'OUT_OF_STOCK',
        b.preorder
          ? 'Pre-order places are no longer available for this item.'
          : 'Stock is no longer available for this variant.',
      );
      if (b.preorder)
        await q.query('UPDATE listings SET preorder_capacity=preorder_capacity-$1 WHERE id=$2', [
          b.quantity,
          l.id,
        ]);
      else {
        await q.query('UPDATE listing_variants SET stock=stock-$1 WHERE id=$2', [b.quantity, v.id]);
        await syncPrimary(q, l.id);
      }
      await q.query('UPDATE listings SET confirmed_at=now() WHERE id=$1', [l.id]);
      const [pickup] = await q.query(
        'SELECT address,latitude,longitude,market_id FROM sellers WHERE user_id=$1',
        [b.seller_id],
      );
      await q.query(
        'UPDATE bookings SET pickup_address_snapshot=$1,pickup_latitude=$2,pickup_longitude=$3,pickup_market_id=$4 WHERE id=$5',
        [pickup.address, pickup.latitude, pickup.longitude, pickup.market_id, b.id],
      );
      const [s2] = await q.query('SELECT reservation_hours FROM settings WHERE id=1');
      // Pre-orders are held from the harvest date, so the collection window starts then.
      const holdFrom = b.preorder
        ? Math.max(Date.now(), new Date(l.available_from).getTime())
        : Date.now();
      await q.query('UPDATE bookings SET reserved_until=$1 WHERE id=$2', [
        new Date(holdFrom + s2.reservation_hours * 3600000),
        b.id,
      ]);
      await event(
        q,
        b,
        'ACCEPTED',
        u.id,
        b.preorder
          ? `Seller accepted the pre-order; ready from ${new Date(l.available_from).toDateString()}.`
          : 'Seller accepted; stock reserved.',
      );
    } else if (action === 'decline')
      await event(q, b, 'DECLINED', u.id, 'Seller declined the booking.');
    else if (action === 'cancel')
      await release(
        q,
        b,
        'CANCELLED',
        u.id,
        'Booking cancelled; reserved stock released and wallet payment refunded.',
      );
    else if (action === 'ready')
      await event(q, b, 'READY_FOR_PICKUP', u.id, 'Seller marked the order ready for collection.');
    else if (action === 'pay') {
      if (b.preorder) {
        const [p] = await q.query(
          'SELECT available_from,preorder_advance_allowed FROM listings WHERE id=$1',
          [b.listing_id],
        );
        ensure(
          !p.available_from ||
            new Date(p.available_from).getTime() <= Date.now() ||
            (deps.config.demo && p.preorder_advance_allowed),
          409,
          'ADVANCE_NOT_ACCEPTED',
          'The seller accepts payment once this product becomes available.',
        );
      }
      ensure(buyer, 403, 'FORBIDDEN', 'Only the buyer can pay.');
      ensure(!b.paid, 409, 'ALREADY_PAID', 'This booking is already paid.');
      ensure(c.demo || c.payments, 503, 'PAYMENTS_DISABLED', 'Wallet payments are not enabled.');
      ensure(
        (await lockedBalance(q, u.id)) >= b.total_kobo,
        409,
        'INSUFFICIENT_BALANCE',
        'Add money to your wallet before paying.',
      );
      await ledger(q, b.id, [
        { account: 'wallet', owner: u.id, amount: -b.total_kobo },
        { account: 'escrow', owner: b.id, amount: b.total_kobo },
      ]);
      await q.query('UPDATE bookings SET paid=TRUE WHERE id=$1', [b.id]);
      await audit(q, u.id, 'booking.pay', b.id);
      await notify(q, b.seller_id, 'payment', 'Booking paid', `${b.title} has been paid.`, b.id);
    } else if (action === 'pickup') {
      ensure(
        b.pickup_available,
        409,
        'PICKUP_UNAVAILABLE',
        'This booking requires rider delivery.',
      );
      ensure(b.paid, 409, 'PAYMENT_REQUIRED', 'The buyer must pay before pickup can be confirmed.');
      ensure(
        !b.pickup_locked_until || new Date(b.pickup_locked_until).getTime() <= Date.now(),
        429,
        'PICKUP_LOCKED',
        'Too many incorrect codes. Try again in 15 minutes.',
      );
      const d = z.object({ code: z.string().regex(/^\d{6}$/) }).parse(input.body);
      if (d.code !== b.pickup_code) {
        const attempts = b.pickup_failures + 1;
        await q.query('UPDATE bookings SET pickup_failures=$1,pickup_locked_until=$2 WHERE id=$3', [
          attempts,
          attempts % 5 === 0 ? new Date(Date.now() + 15 * 60000) : null,
          b.id,
        ]);
        await audit(q, u.id, 'pickup.invalid_code', b.id);
        return {
          error: {
            status: 400,
            code: 'INVALID_PICKUP_CODE',
            message: 'The pickup code is incorrect.',
          },
        };
      }
      await ledger(q, b.id, [
        { account: 'escrow', owner: b.id, amount: -b.total_kobo },
        {
          account: 'seller_payable',
          owner: b.seller_id,
          amount: b.total_kobo - b.commission_kobo,
        },
        { account: 'platform_revenue', amount: b.commission_kobo },
      ]);
      await event(
        q,
        b,
        'COMPLETED',
        u.id,
        'Seller verified the buyer’s pickup code; collection confirmed.',
      );
    }
    return { ok: true, id: b.id };
  }
  return {
    listBookings,
    getBooking,
    listBookingEvents,
    createBooking,
    performBookingAction,
    expireDue,
  };
}
