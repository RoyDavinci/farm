import { Router } from 'express';
import {
  createPublicEvidenceController,
  createSupportController,
} from '../controllers/support.controller.js';
import type { AppDeps } from '../types/deps.js';

export function supportRoutes(deps: AppDeps) {
  const r = Router();
  const c = createSupportController(deps);
  r.get('/disputes', c.listDisputes);
  r.get('/bookings/:id/dispute', c.getBookingDispute);
  r.post('/bookings/:id/dispute', c.openDispute);
  r.get('/disputes/:id', c.getDispute);
  r.post('/disputes/:id/evidence', ...c.uploadEvidence);
  r.get('/evidence/:id/link', c.getEvidenceLink);
  r.get('/evidence/:id', c.downloadEvidence);
  r.post('/disputes/:id/return', c.updateReturn);
  r.get('/admin/disputes', c.listAllDisputes);
  r.post('/admin/disputes/:id/resolve', c.resolveDispute);
  r.get('/bookings/:id/receipt', c.getReceipt);
  return r;
}

export function publicEvidenceRoutes(deps: AppDeps) {
  const r = Router();
  const c = createPublicEvidenceController(deps);
  r.get('/evidence/:id', c.downloadSignedEvidence);
  return r;
}
