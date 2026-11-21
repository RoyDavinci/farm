import { Router } from 'express';
import type { AppDeps } from '../types/deps.js';
import { createDiscoveryOperationsController } from '../controllers/discovery-operations.controller.js';
export function discoveryOperationsRoutes(deps: AppDeps) {
  const r = Router(),
    c = createDiscoveryOperationsController(deps);
  r.get('/discovery/preferences', c.preferences);
  r.put('/discovery/preferences', c.savePreferences);
  r.get('/preorder-interests', c.interests);
  r.post('/listings/:id/interest', c.registerInterest);
  r.post('/preorder-interests/:id/confirm', c.confirmInterest);
  r.post('/preorder-interests/:id/cancel', c.cancelInterest);
  r.put('/listings/:id/advance-preference', c.advancePreference);
  return r;
}
export function adminDiscoveryOperationsRoutes(deps: AppDeps) {
  const r = Router(),
    c = createDiscoveryOperationsController(deps);
  r.get('/analytics', c.metrics);
  return r;
}
