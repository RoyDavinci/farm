import { Router } from 'express';
import type { AppDeps } from '../types/deps.js';
import { createMarketOperationsController } from '../controllers/market-operations.controller.js';
export function marketOperationsRoutes(deps: AppDeps) {
  const r = Router(),
    c = createMarketOperationsController(deps);
  r.get('/catalogue/categories', c.categories);
  r.post('/listings/:id/archive', c.archive);
  r.post('/listings/:id/confirm-stock', c.confirmStock);
  r.get('/sellers/me/details', c.sellerDetails);
  r.put('/sellers/me/details', c.saveSellerDetails);
  r.get('/sellers/:id/public-profile', c.publicProfile);
  r.get('/drivers/me/details', c.driverDetails);
  r.put('/drivers/me/details', c.saveDriverDetails);
  r.get('/markets/:id/map', c.marketMap);
  r.get('/bookings/:id/market-map', c.bookingMap);
  r.get('/bookings/:id/market-route', c.bookingRoute);
  return r;
}
export function adminMarketOperationsRoutes(deps: AppDeps) {
  const r = Router(),
    c = createMarketOperationsController(deps);
  r.get('/catalogue', c.adminCategories);
  r.put('/catalogue', c.saveCategory);
  r.get('/policies', c.policies);
  r.put('/policies', c.savePolicies);
  r.post('/policies/approve-stock', c.approveStockPolicy);
  r.get('/markets/mapping', c.mapping);
  r.put('/markets/waypoints', c.saveWaypoint);
  r.put('/markets/paths', c.savePath);
  return r;
}
