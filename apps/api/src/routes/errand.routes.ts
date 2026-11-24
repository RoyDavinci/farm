import { Router } from 'express';
import { createErrandController } from '../controllers/errand.controller.js';
import type { AppDeps } from '../types/deps.js';

/** "Buy it and bring it". */
export function errandRoutes(deps: AppDeps) {
  const r = Router();
  const c = createErrandController(deps);
  r.get('/errands/ideas', c.errandIdeas);
  r.post('/errands/plan', c.planErrand);
  r.post('/errands', c.placeErrand);
  return r;
}
