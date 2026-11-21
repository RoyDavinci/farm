import type { RequestHandler } from 'express';
import type { AppDeps } from '../types/deps.js';
import { requestInput } from '../lib/http.js';
import { createParcelsService } from '../services/parcels.service.js';
export function createParcelsController(deps: AppDeps) {
  const service = createParcelsService(deps);
  const quote: RequestHandler = async (req, res) => {
    res.json(await service.quote(res.locals.user, requestInput(req)));
  };
  const mine: RequestHandler = async (req, res) => {
    res.json(await service.mine(res.locals.user));
  };
  const list: RequestHandler = async (req, res) => {
    res.json(await service.list());
  };
  const create: RequestHandler = (req, res) =>
    deps.mutate(req, res, (q, u) => service.create(q, u, requestInput(req)));
  const action: RequestHandler = (req, res) =>
    deps.mutate(req, res, (q, u) => service.action(q, u, requestInput(req)));
  const review: RequestHandler = (req, res) =>
    deps.mutate(req, res, (q, u) => service.review(q, u, requestInput(req)));
  return { quote, mine, list, create, action, review };
}
