import type { Request, Response } from 'express';
import type { Config } from '../config/index.js';
import type { Database, Query } from '../database/client.js';

/**
 * Runs a state-changing request in one transaction, serialised per user, with
 * Idempotency-Key replay so client retries never repeat a booking, payment or payout.
 */
export type Mutate = (
  req: Request,
  res: Response,
  fn: (q: Query, user: import('../services/auth.service.js').AuthenticatedUser) => Promise<any>,
) => Promise<void>;

/** Dependencies shared by every controller (created once per app instance). */
export interface AppDeps {
  db: Database;
  config: Config;
  mutate: Mutate;
}
