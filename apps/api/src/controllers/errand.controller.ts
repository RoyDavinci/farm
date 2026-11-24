import type { RequestHandler } from 'express';
import { requestInput } from '../lib/http.js';
import { createErrandService } from '../services/errand.service.js';
import type { AppDeps } from '../types/deps.js';

/** "Buy it and bring it": plan a basket from a sentence, then place it for a delivery time. */
export function createErrandController(deps: AppDeps) {
  const { mutate } = deps;
  const service = createErrandService(deps);
  const planErrand: RequestHandler = async (req, res) => {
    res.json(await service.planErrand(res.locals.user, requestInput(req)));
  };
  const errandIdeas: RequestHandler = async (req, res) => {
    res.json(await service.errandIdeas(res.locals.user, requestInput(req)));
  };
  const placeErrand: RequestHandler = (req, res) =>
    mutate(req, res, (q, user) => service.placeErrand(q, user, requestInput(req)));
  return { planErrand, errandIdeas, placeErrand };
}
