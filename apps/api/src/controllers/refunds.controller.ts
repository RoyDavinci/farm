import type { RequestHandler } from 'express';
import { requestInput } from '../lib/http.js';
import { createAdminRefundsService } from '../services/card-refunds.service.js';
import type { AppDeps } from '../types/deps.js';

/** Finance console: refunds to buyers' cards (used when the wallet feature is off). */
export function createAdminRefundsController(deps: AppDeps) {
  const { mutate } = deps;
  const service = createAdminRefundsService(deps);
  const listRefunds: RequestHandler = async (_req, res) => {
    res.json(await service.listRefunds());
  };
  const resolveRefund: RequestHandler = (req, res) =>
    mutate(req, res, (q, user) => service.resolveRefund(q, user, requestInput(req)));
  return { listRefunds, resolveRefund };
}
