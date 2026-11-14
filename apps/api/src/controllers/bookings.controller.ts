import type { RequestHandler } from 'express';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { ensure } from '../lib/errors.js';
import { requestInput } from '../lib/http.js';
import { audit } from '../services/audit.service.js';
import {
  createBookingsService,
  event,
  expireReservations,
  readBookings as readBookingsFor,
  release,
} from '../services/booking.service.js';
import { syncPrimary } from '../services/catalog.service.js';
import { notify } from '../services/communications.service.js';
import { ledger, lockedBalance } from '../services/ledger.service.js';
import { paymentService } from '../services/payment-provider.service.js';
import type { AppDeps } from '../types/deps.js';

/** Booking lifecycle: request, counteroffer, accept, pay, ready, pickup, cancel. */
export function createBookingsController(deps: AppDeps) {
  const { db, config: c, mutate } = deps;
  const service = createBookingsService(deps);
  const payments = paymentService(c);
  const readBookings = (u: any, bookingId?: string) => readBookingsFor(db, u, bookingId);
  const id = () => randomUUID();
  const listBookings: RequestHandler = async (req, res) => {
    res.json(await service.listBookings(res.locals.user, requestInput(req)));
  };
  const getBooking: RequestHandler = async (req, res) => {
    res.json(await service.getBooking(res.locals.user, requestInput(req)));
  };
  const listBookingEvents: RequestHandler = async (req, res) => {
    res.json(await service.listBookingEvents(res.locals.user, requestInput(req)));
  };
  const createBooking: RequestHandler = (req, res) =>
    mutate(req, res, (q, user) => service.createBooking(q, user, requestInput(req)));
  const performBookingAction: RequestHandler = async (req, res) => {
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
      .parse(req.params.action);
    await expireReservations(db);
    return mutate(req, res, async (q, u) => {
      const [b] = await q.query('SELECT * FROM bookings WHERE id=$1 FOR UPDATE', [req.params.id]);
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
        await release(
          q,
          b,
          'EXPIRED',
          null,
          'Reservation expired; stock and wallet funds returned.',
        );
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
          .parse(req.body);
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
          const d = z.object({ offer_version: z.number().int().min(0) }).parse(req.body);
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
            ? 'Pre-order capacity is no longer available for this harvest.'
            : 'Stock is no longer available for this variant.',
        );
        if (b.preorder)
          await q.query('UPDATE listings SET preorder_capacity=preorder_capacity-$1 WHERE id=$2', [
            b.quantity,
            l.id,
          ]);
        else {
          await q.query('UPDATE listing_variants SET stock=stock-$1 WHERE id=$2', [
            b.quantity,
            v.id,
          ]);
          await syncPrimary(q, l.id);
        }
        await q.query('UPDATE listings SET confirmed_at=now() WHERE id=$1', [l.id]);
        const [pickup] = await q.query(
          'SELECT address,latitude,longitude FROM sellers WHERE user_id=$1',
          [b.seller_id],
        );
        await q.query(
          'UPDATE bookings SET pickup_address_snapshot=$1,pickup_latitude=$2,pickup_longitude=$3 WHERE id=$4',
          [pickup.address, pickup.latitude, pickup.longitude, b.id],
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
        await event(
          q,
          b,
          'READY_FOR_PICKUP',
          u.id,
          'Seller marked the order ready for collection.',
        );
      else if (action === 'pay') {
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
        await notify(
          q,
          b.seller_id,
          'payment',
          'Booking paid',
          `${b.title} has been paid from the buyer’s wallet.`,
          b.id,
        );
      } else if (action === 'pickup') {
        ensure(
          b.paid,
          409,
          'PAYMENT_REQUIRED',
          'The buyer must pay before pickup can be confirmed.',
        );
        ensure(
          !b.pickup_locked_until || new Date(b.pickup_locked_until).getTime() <= Date.now(),
          429,
          'PICKUP_LOCKED',
          'Too many incorrect codes. Try again in 15 minutes.',
        );
        const d = z.object({ code: z.string().regex(/^\d{6}$/) }).parse(req.body);
        if (d.code !== b.pickup_code) {
          const attempts = b.pickup_failures + 1;
          await q.query(
            'UPDATE bookings SET pickup_failures=$1,pickup_locked_until=$2 WHERE id=$3',
            [attempts, attempts % 5 === 0 ? new Date(Date.now() + 15 * 60000) : null, b.id],
          );
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
    });
  };
  return { listBookings, getBooking, listBookingEvents, createBooking, performBookingAction };
}
