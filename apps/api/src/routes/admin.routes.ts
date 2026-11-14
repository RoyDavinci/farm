import { Router } from 'express';
import { createAdminController } from '../controllers/admin.controller.js';
import type { AppDeps } from '../types/deps.js';

export function adminRoutes(deps: AppDeps) {
  const r = Router();
  const c = createAdminController(deps);
  r.get('/admin/reconciliation', c.getReconciliation);
  r.post('/admin/funding/:id/recheck', c.recheckFunding);
  r.get('/admin/overview', c.getOverview);
  r.get('/admin/sellers', c.listSellers);
  r.post('/admin/sellers/:id/review', c.reviewSeller);
  r.get('/admin/bookings', c.listBookings);
  r.get('/admin/listings', c.listListings);
  r.post('/admin/listings/:id/moderate', c.moderateListing);
  r.put('/admin/settings', c.updateSettings);
  r.get('/admin/audit', c.listAudit);
  r.get('/admin/ledger', c.listLedger);
  return r;
}
