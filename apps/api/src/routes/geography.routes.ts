import { Router } from 'express';
import { createGeographyController } from '../controllers/geography.controller.js';
import type { AppDeps } from '../types/deps.js';

export function geographyRoutes(deps: AppDeps) {
  const r = Router();
  const c = createGeographyController(deps);
  r.get('/maps/config', c.getMapConfig);
  r.get('/maps/geocode', c.geocode);
  r.get('/markets', c.listMarkets);
  r.post('/admin/markets', c.createMarket);
  r.patch('/sellers/me/location', c.updateSellerLocation);
  r.get('/search', c.search);
  return r;
}
