import { Router } from 'express';
import { createPartnerApiController } from '../controllers/partner-api.controller.js';
import type { AppDeps } from '../types/deps.js';

/** Partner API for sellers' own systems, authenticated with X-Api-Key (no user session). */
export function partnerApiRoutes(deps: AppDeps) {
  const r = Router();
  const c = createPartnerApiController(deps);
  r.use('/partner', c.authenticateKey);
  r.get('/partner/listings', c.listings);
  r.patch('/partner/listings/:id', c.updateListing);
  r.get('/partner/orders', c.orders);
  return r;
}
