import type { RequestHandler } from 'express';
import type { AppDeps } from '../types/deps.js';
import { requestInput } from '../lib/http.js';
import { createStatusBoostService } from '../services/status-boost.service.js';
export function createStatusBoostController(deps: AppDeps) {
  const service = createStatusBoostService(deps);
  const quote: RequestHandler = async (req, res) => {
    res.json(await service.quote(res.locals.user, requestInput(req)));
  };
  const create: RequestHandler = (req, res) =>
    deps.mutate(req, res, (q, u) => service.create(q, u, requestInput(req)));
  const mine: RequestHandler = async (req, res) => {
    res.json(await service.mine(res.locals.user));
  };
  const cancel: RequestHandler = (req, res) =>
    deps.mutate(req, res, (q, u) => service.cancel(q, u, requestInput(req)));
  return { quote, create, mine, cancel };
}
export function createAdminStatusBoostController(deps: AppDeps) {
  const service = createStatusBoostService(deps);
  const list: RequestHandler = async (req, res) => {
    res.json(await service.list());
  };
  const review: RequestHandler = (req, res) =>
    deps.mutate(req, res, (q, u) => service.review(q, u, requestInput(req)));
  return { list, review };
}
