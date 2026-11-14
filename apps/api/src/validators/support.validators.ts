import { z } from 'zod';
export const resolveDisputeInput = z.object({
  resolution: z.string().trim().min(10).max(4000),
  refund_kobo: z.number().int().min(0),
  restock: z.boolean().default(false),
});
export type ResolveDisputeInput = z.infer<typeof resolveDisputeInput>;
