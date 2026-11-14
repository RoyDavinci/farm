import type { Request } from 'express';
import { z } from 'zod';

/**
 * Keyset paging: pass ?before=<cursor>&before_id=<id> from the last row for older rows.
 * cursor is the exact database timestamp text (JS dates drop microseconds).
 */
export function parsePage(req: Request) {
  return z
    .object({
      before: z.string().max(64).optional(),
      before_id: z.string().max(64).default(''),
      limit: z.coerce.number().int().min(1).max(200).default(100),
    })
    .parse(req.query);
}
