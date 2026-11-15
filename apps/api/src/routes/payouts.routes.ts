import { Router } from 'express';
import {
  createAdminPayoutsController,
  createPayoutsController,
} from '../controllers/payouts.controller.js';
import type { AppDeps } from '../types/deps.js';

export function payoutRoutes(deps: AppDeps) {
  const r = Router();
  const c = createPayoutsController(deps);
  r.get('/payouts/banks', c.listBanks);
  r.post('/payouts/accounts/resolve', c.resolveAccount);
  r.post('/payouts/accounts', c.saveAccount);
  r.get('/payouts', c.getPayoutSummary);
  r.post('/payouts', c.requestPayout);
  r.post('/payouts/:id/cancel', c.cancelPayout);
  return r;
}

export function adminPayoutRoutes(deps: AppDeps) {
  const r = Router();
  const c = createAdminPayoutsController(deps);
  r.get('/payouts', c.listPayouts);
  r.post('/payouts/:id/approve', c.approvePayout);
  r.post('/payouts/:id/reject', c.rejectPayout);
  r.post('/payouts/:id/recheck', c.recheckPayout);
  r.post('/payouts/:id/resolve', c.resolvePayout);
  return r;
}
