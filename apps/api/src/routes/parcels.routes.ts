import { Router } from 'express';
import type { AppDeps } from '../types/deps.js';
import { createParcelsController } from '../controllers/parcels.controller.js';
export function parcelRoutes(deps: AppDeps) {
  const r = Router(),
    c = createParcelsController(deps);
  r.get('/parcels', c.mine);
  r.post('/parcels/quote', c.quote);
  r.post('/parcels', c.create);
  r.post('/parcels/:id/action', c.action);
  return r;
}
export function adminParcelRoutes(deps: AppDeps) {
  const r = Router(),
    c = createParcelsController(deps);
  r.get('/parcels', c.list);
  r.post('/parcels/:id/review', c.review);
  return r;
}
