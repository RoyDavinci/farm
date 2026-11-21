import { z } from 'zod';
import { ensure } from '../lib/errors.js';
import type { RequestInput } from '../lib/http.js';
import { readIdempotency } from '../middleware/idempotency.js';
import type { AppDeps } from '../types/deps.js';
import { createDeliveriesService } from './deliveries.service.js';
import { startFunding } from './funding.service.js';

export const checkoutInput = z.discriminatedUnion('purpose', [
  z.object({
    purpose: z.literal('booking'),
    provider: z.enum(['paystack', 'flutterwave']),
    booking_id: z.uuid(),
  }),
  z.object({
    purpose: z.literal('delivery'),
    provider: z.enum(['paystack', 'flutterwave']),
    booking_id: z.uuid(),
    // The quote the buyer saw; the server re-quotes and charges only if it still matches.
    quote: z.record(z.string(), z.unknown()),
    expected_fare_kobo: z.number().int().positive(),
  }),
]);

/**
 * Direct checkout: the buyer pays one purchase at the provider instead of topping up a wallet.
 *   booking  – the exact booking total; applied to the booking as soon as payment is verified.
 *   delivery – the exact quoted fare; the app then requests the delivery, which uses it.
 * Anything not applied (the booking expired meanwhile, the delivery was never requested) is
 * refunded to the card by the card-refund job when the wallet feature is off.
 */
export function createCheckoutService(deps: AppDeps) {
  const { db, config: c } = deps;
  const deliveries = createDeliveriesService(deps);
  async function startCheckout(user: any, input: RequestInput) {
    const identity = readIdempotency(input);
    const d = checkoutInput.parse(input.body);
    ensure(c.payments, 503, 'PAYMENTS_DISABLED', 'Online payments are not enabled.');
    const [b] = await db.query('SELECT * FROM bookings WHERE id=$1 AND buyer_id=$2', [
      d.booking_id,
      user.id,
    ]);
    ensure(b, 404, 'NOT_FOUND', 'Booking not found.');
    ensure(
      ['ACCEPTED', 'READY_FOR_PICKUP'].includes(b.status) &&
        new Date(b.reserved_until).getTime() > Date.now(),
      409,
      'INVALID_TRANSITION',
      'Only an accepted, unexpired booking can be paid.',
    );
    let amount: number;
    if (d.purpose === 'booking') {
      ensure(!b.paid, 409, 'ALREADY_PAID', 'This booking is already paid.');
      amount = Number(b.total_kobo);
    } else {
      ensure(b.paid, 409, 'PAYMENT_REQUIRED', 'Pay for the booking before arranging delivery.');
      const quote = await deliveries.quoteDelivery(user, {
        ...input,
        params: { id: b.id },
        body: d.quote,
      } as RequestInput);
      ensure(
        quote.fare_kobo === d.expected_fare_kobo,
        409,
        'FARE_CHANGED',
        'The delivery fare changed. Please review the new quote.',
      );
      amount = quote.fare_kobo;
    }
    ensure(
      amount >= 10000 && amount <= 10000000,
      400,
      'AMOUNT_OUT_OF_RANGE',
      'Online payments must be between ₦100 and ₦100,000.',
    );
    return startFunding(db, c, user, identity, {
      provider: d.provider,
      amount_kobo: amount,
      purpose: d.purpose,
      target_id: b.id,
    });
  }
  return { startCheckout };
}
