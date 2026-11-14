import { Router } from 'express';
import {
  createPublicDocumentController,
  createVerificationController,
} from '../controllers/verification.controller.js';
import type { AppDeps } from '../types/deps.js';

export function verificationRoutes(deps: AppDeps) {
  const r = Router();
  const c = createVerificationController(deps);
  r.get('/sellers/me/documents', c.listMyDocuments);
  r.post('/sellers/me/documents', ...c.uploadDocument);
  r.get('/admin/seller-documents', c.listDocuments);
  r.get('/admin/seller-documents/:id/link', c.getDocumentLink);
  r.post('/admin/seller-documents/:id/review', c.reviewDocument);
  return r;
}

export function publicDocumentRoutes(deps: AppDeps) {
  const r = Router();
  const c = createPublicDocumentController(deps);
  r.get('/seller-documents/:id', c.downloadDocument);
  return r;
}
