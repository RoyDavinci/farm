import { Router } from 'express';
import {
  createAdminPromotionsController,
  createPromotionsController,
} from '../controllers/promotions.controller.js';
import type { AppDeps } from '../types/deps.js';

export function promotionRoutes(deps: AppDeps) {
  const r = Router();
  const c = createPromotionsController(deps);
  r.get('/sellers/me/promotions', c.listMyPromotions);
  r.post('/listings/:id/promote', c.promoteListing);
  return r;
}

export function adminPromotionRoutes(deps: AppDeps) {
  const r = Router();
  const c = createAdminPromotionsController(deps);
  r.get('/promotions', c.listPromotions);
  r.post('/promotions/:id/cancel', c.cancelPromotion);
  return r;
}
