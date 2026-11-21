import { z } from 'zod';

const CardRefund = z.looseObject({
  id: z.string(),
  funding_id: z.string(),
  user_id: z.string(),
  provider: z.string(),
  amount_kobo: z.number(),
  status: z.enum(['PENDING', 'SENDING', 'REFUNDED', 'FAILED']),
  provider_refund_id: z.string().nullable(),
  error: z.string().nullable(),
  created_at: z.string(),
});

export const refundResponses: Record<string, z.ZodType> = {
  'refunds.listRefunds': z.array(
    CardRefund.extend({ buyer_name: z.string(), needs_review: z.boolean() }),
  ),
  'refunds.resolveRefund': CardRefund,
};
