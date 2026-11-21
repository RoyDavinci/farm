import { Router } from 'express';
import type { AppDeps } from '../types/deps.js';
import { createRegionsController } from '../controllers/regions.controller.js';
export function regionRoutes(deps: AppDeps) {
  const r = Router(),
    c = createRegionsController(deps);
  r.get('/regions', c.activeRegions);
  return r;
}
export function adminRegionRoutes(deps: AppDeps) {
  const r = Router(),
    c = createRegionsController(deps);
  r.get('/regions', c.listRegions);
  r.put('/regions', c.saveRegion);
  return r;
}
