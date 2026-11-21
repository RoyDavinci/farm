import { Router } from 'express';
import type { AppDeps } from '../types/deps.js';
import { createReturnsOperationsController } from '../controllers/returns-operations.controller.js';
export function returnsOperationsRoutes(deps: AppDeps) {
  const r = Router(),
    c = createReturnsOperationsController(deps);
  r.get('/return-journeys', c.mine);
  r.post('/return-journeys/:id/action', c.action);
  r.get('/appeals', c.appeals);
  r.post('/disputes/:id/appeal', c.appeal);
  return r;
}
export function adminReturnsOperationsRoutes(deps: AppDeps) {
  const r = Router(),
    c = createReturnsOperationsController(deps);
  r.get('/returns', c.list);
  r.post('/returns', c.create);
  r.get('/appeals', c.listAppeals);
  r.post('/appeals/:id/review', c.reviewAppeal);
  return r;
}
