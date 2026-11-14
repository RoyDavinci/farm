import { z } from 'zod';
export const fundingInput = z.object({
  provider: z.enum(['paystack', 'flutterwave']),
  amount_kobo: z.number().int().min(10000).max(10000000),
});
export type FundingInput = z.infer<typeof fundingInput>;
