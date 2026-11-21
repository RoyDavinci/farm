import { Router } from 'express';
import { createBusinessVerificationController } from '../controllers/business-verification.controller.js';
import type { AppDeps } from '../types/deps.js';

/** Business verification: sellers apply; staff verify, reject, ask for more, suspend. */
export function businessVerificationRoutes(deps: AppDeps) {
  const r = Router();
  const c = createBusinessVerificationController(deps);
  r.get('/nearby-sellers', c.nearbySellers);
  r.get('/sellers/me/verification', c.getMyVerification);
  r.post('/sellers/me/verification', c.applyForVerification);
  r.get('/admin/verifications', c.listVerifications);
  r.get('/admin/verifications/:sellerId/history', c.verificationHistory);
  r.post('/admin/verifications/:sellerId', c.decideVerification);
  return r;
}
