import { Router } from 'express';
import type { AppDeps } from '../types/deps.js';
import {
  createShoppingController,
  createPublicShoppingController,
  createAdminShoppingController,
} from '../controllers/shopping.controller.js';
export function shoppingRoutes(deps: AppDeps) {
  const r = Router(),
    c = createShoppingController(deps);
  r.get('/riders/nearby', c.nearbyRiders);
  r.post('/shopping/quote', c.quote);
  r.get('/shopping', c.mine);
  r.post('/shopping', c.create);
  r.get('/shopping/:id', c.detail);
  r.post('/shopping/:id/messages', c.message);
  r.post('/shopping/:id/receipts', ...c.uploadReceipt);
  r.post('/shopping/:id/location', c.location);
  r.post('/shopping/:id/advance-payout', c.advancePayout);
  r.post('/shopping/:id/:action', c.act);
  return r;
}
export function adminShoppingRoutes(deps: AppDeps) {
  const r = Router(),
    c = createAdminShoppingController(deps);
  r.get('/shopping', c.adminList);
  r.post('/shopping/:id/review', c.review);
  return r;
}

export function publicShoppingRoutes(deps: AppDeps) {
  const r = Router(),
    c = createPublicShoppingController(deps);
  r.get('/shopping-receipts/:id/:photo', c.receipt);
  return r;
}
