import { z } from 'zod';
export const fundingInput = z.object({
  provider: z.enum(['paystack', 'flutterwave']),
  amount_kobo: z.number().int().min(10000).max(10000000),
  /** card: Paystack's checkout shows only the card option. */
  method: z.enum(['card', 'any']).default('any'),
});
export type FundingInput = z.input<typeof fundingInput>;
