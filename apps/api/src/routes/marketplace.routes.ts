import { Router } from 'express';
import { createMarketplaceController } from '../controllers/marketplace.controller.js';
import type { AppDeps } from '../types/deps.js';

export function marketplaceRoutes(deps: AppDeps) {
  const r = Router();
  const c = createMarketplaceController(deps);
  r.post('/sellers', c.applyAsSeller);
  r.get('/listings', c.listListings);
  r.post('/listings', c.createListing);
  r.patch('/listings/:id', c.updateListing);
  return r;
}
