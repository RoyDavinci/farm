import { Router } from 'express';
import { createPartnerController } from '../controllers/partner.controller.js';
import type { AppDeps } from '../types/deps.js';

/** Partner integrations for sellers (API keys, webhooks) and the integration status for staff. */
export function partnerRoutes(deps: AppDeps) {
  const r = Router();
  const c = createPartnerController(deps);
  r.get('/sellers/me/integrations', c.listKeys);
  r.post('/sellers/me/api-keys', c.createKey);
  r.delete('/sellers/me/api-keys/:id', c.revokeKey);
  r.post('/sellers/me/webhooks', c.createWebhook);
  r.delete('/sellers/me/webhooks/:id', c.deleteWebhook);
  r.get('/admin/integrations', c.integrations);
  return r;
}
