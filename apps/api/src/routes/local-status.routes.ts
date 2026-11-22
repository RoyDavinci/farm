import { Router } from 'express';
import type { AppDeps } from '../types/deps.js';
import {
  createLocalStatusController,
  createAdminLocalStatusController,
} from '../controllers/local-status.controller.js';
export function localStatusRoutes(deps: AppDeps) {
  const r = Router(),
    c = createLocalStatusController(deps);
  r.get('/local-status', c.feed);
  r.get('/local-status/mine', c.mine);
  r.get('/local-status/preferences', c.preferences);
  r.post('/local-status', c.publish);
  r.delete('/local-status/:id', c.remove);
  r.post('/local-status/:id/events', c.event);
  r.put('/local-status/preferences', c.mute);
  r.post('/local-status/:id/report', c.report);
  r.post('/local-status/:id/like', c.like);
  return r;
}
export function adminLocalStatusRoutes(deps: AppDeps) {
  const r = Router(),
    c = createAdminLocalStatusController(deps);
  r.get('/local-status', c.adminList);
  r.post('/local-status/:id/remove', c.moderate);
  return r;
}
