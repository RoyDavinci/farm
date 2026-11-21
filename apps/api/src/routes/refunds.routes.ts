import { Router } from 'express';
import { createAdminRefundsController } from '../controllers/refunds.controller.js';
import type { AppDeps } from '../types/deps.js';

export function adminRefundRoutes(deps: AppDeps) {
  const r = Router();
  const c = createAdminRefundsController(deps);
  r.get('/refunds', c.listRefunds);
  r.post('/refunds/:id/resolve', c.resolveRefund);
  return r;
}
