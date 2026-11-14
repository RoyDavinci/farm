import { Router } from 'express';
import {
  createAdminDeliveriesController,
  createDeliveriesController,
} from '../controllers/deliveries.controller.js';
import type { AppDeps } from '../types/deps.js';

export function deliveryRoutes(deps: AppDeps) {
  const r = Router();
  const c = createDeliveriesController(deps);
  r.get('/delivery/options', c.getDeliveryOptions);
  r.post('/bookings/:id/delivery/quote', c.quoteDelivery);
  r.post('/bookings/:id/delivery', c.requestDelivery);
  r.get('/bookings/:id/delivery', c.getBookingDelivery);
  r.post('/deliveries/:id/:action', c.performDeliveryAction);
  r.get('/drivers/me', c.getMyDriverProfile);
  r.post('/drivers', c.applyAsDriver);
  r.put('/drivers/me/status', c.updateDriverStatus);
  r.get('/drivers/me/jobs', c.listDriverJobs);
  return r;
}

export function adminDeliveryRoutes(deps: AppDeps) {
  const r = Router();
  const c = createAdminDeliveriesController(deps);
  r.get('/drivers', c.listDrivers);
  r.post('/drivers/:id/review', c.reviewDriver);
  r.get('/deliveries', c.listDeliveries);
  r.get('/vehicle-types', c.listVehicleTypes);
  r.put('/vehicle-types/:code', c.saveVehicleType);
  return r;
}
