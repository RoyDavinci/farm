import { Router } from 'express';
import { createRetentionController } from '../controllers/retention.controller.js';
import type { AppDeps } from '../types/deps.js';

export function retentionRoutes(deps: AppDeps) {
  const r = Router();
  const c = createRetentionController(deps);
  r.get('/listings/:id', c.getListing);
  r.get('/sellers/:id/listings', c.listSellerListings);
  r.put('/listings/:id/stock-alert', c.addStockAlert);
  r.delete('/listings/:id/stock-alert', c.removeStockAlert);
  r.get('/sellers/me/analytics', c.getSellerAnalytics);
  return r;
}
