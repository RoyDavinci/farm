import { Router } from 'express';
import type { AppDeps } from '../types/deps.js';
import { createDeliveryOperationsController } from '../controllers/delivery-operations.controller.js';
export function deliveryOperationsRoutes(deps: AppDeps) {
  const r = Router(),
    c = createDeliveryOperationsController(deps);
  r.put('/drivers/me/background-consent', c.backgroundConsent);
  r.put('/drivers/me/background-location', c.backgroundLocation);
  r.get('/deliveries/:id/timeline', c.timeline);
  r.post('/deliveries/:id/milestone', c.milestone);
  r.post('/deliveries/:id/schedule', c.schedule);
  r.post('/deliveries/:id/retry', c.retry);
  r.post('/deliveries/:id/inspection', c.inspection);
  r.post('/deliveries/:id/rating', c.rateDriver);
  r.post('/deliveries/:id/incident', c.incident);
  return r;
}
export function adminDeliveryOperationsRoutes(deps: AppDeps) {
  const r = Router(),
    c = createDeliveryOperationsController(deps);
  r.get('/tariffs', c.tariffs);
  r.put('/tariffs', c.saveTariff);
  r.get('/incidents', c.incidents);
  r.post('/incidents/:id/resolve', c.resolveIncident);
  return r;
}
