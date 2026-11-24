import { Router } from 'express';
import { createRiskController } from '../controllers/risk.controller.js';
import type { AppDeps } from '../types/deps.js';

/** BVN verification for customers. */
export function riskRoutes(deps: AppDeps) {
  const r = Router();
  const c = createRiskController(deps);
  r.get('/me/kyc', c.getKyc);
  r.post('/me/kyc/bvn', c.startBvn);
  r.post('/me/kyc/bvn/:id/refresh', c.refreshBvn);
  return r;
}

/** Staff Risk queue: flags, account freezes and bank-name overrides. */
export function adminRiskRoutes(deps: AppDeps) {
  const r = Router();
  const c = createRiskController(deps);
  r.get('/risk', c.listRisk);
  r.post('/risk/:id/clear', c.clearRisk);
  r.post('/users/:id/freeze', c.freezeUser);
  r.post('/users/:id/unfreeze', c.unfreezeUser);
  r.post('/payout-accounts/:id/allow', c.allowPayoutAccount);
  r.get('/sign-in-codes', c.listSignInCodes);
  r.post('/sign-in-codes/:id/issue', c.issueSignInCode);
  return r;
}
