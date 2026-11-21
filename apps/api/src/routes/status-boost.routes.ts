import { Router } from 'express';
import type { AppDeps } from '../types/deps.js';
import {
  createStatusBoostController,
  createAdminStatusBoostController,
} from '../controllers/status-boost.controller.js';
export function statusBoostRoutes(deps: AppDeps) {
  const r = Router(),
    c = createStatusBoostController(deps);
  r.post('/local-status/:id/boost-quote', c.quote);
  r.post('/local-status/:id/boost', c.create);
  r.get('/status-boosts/mine', c.mine);
  r.post('/status-boosts/:id/cancel', c.cancel);
  return r;
}
export function adminStatusBoostRoutes(deps: AppDeps) {
  const r = Router(),
    c = createAdminStatusBoostController(deps);
  r.get('/status-boosts', c.list);
  r.post('/status-boosts/:id/review', c.review);
  return r;
}
