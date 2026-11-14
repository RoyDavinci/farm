import type { RequestHandler } from 'express';
import { requestInput } from '../lib/http.js';
import {
  createAdminPromotionsService,
  createPromotionsService,
} from '../services/promotions.service.js';
import type { AppDeps } from '../types/deps.js';

export function createPromotionsController(deps: AppDeps) {
  const { mutate } = deps;
  const service = createPromotionsService(deps);
  const listMyPromotions: RequestHandler = async (req, res) => {
    res.json(await service.listMyPromotions(res.locals.user, requestInput(req)));
  };
  const promoteListing: RequestHandler = (req, res) =>
    mutate(req, res, (q, user) => service.promoteListing(q, user, requestInput(req)));
  return { listMyPromotions, promoteListing };
}

export function createAdminPromotionsController(deps: AppDeps) {
  const { mutate } = deps;
  const service = createAdminPromotionsService(deps);
  const listPromotions: RequestHandler = async (req, res) => {
    res.json(await service.listPromotions(res.locals.user, requestInput(req)));
  };
  const cancelPromotion: RequestHandler = (req, res) =>
    mutate(req, res, (q, user) => service.cancelPromotion(q, user, requestInput(req)));
  return { listPromotions, cancelPromotion };
}
