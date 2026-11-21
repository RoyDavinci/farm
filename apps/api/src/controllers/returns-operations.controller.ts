import type { RequestHandler } from 'express';
import type { AppDeps } from '../types/deps.js';
import { requestInput } from '../lib/http.js';
import { createReturnsOperationsService } from '../services/returns-operations.service.js';
export function createReturnsOperationsController(deps: AppDeps) {
  const service = createReturnsOperationsService(deps);
  const mine: RequestHandler = async (req, res) => {
    res.json(await service.mine(res.locals.user));
  };
  const appeals: RequestHandler = async (req, res) => {
    res.json(await service.appeals(res.locals.user));
  };
  const list: RequestHandler = async (req, res) => {
    res.json(await service.list());
  };
  const listAppeals: RequestHandler = async (req, res) => {
    res.json(await service.listAppeals());
  };
  const create: RequestHandler = (req, res) =>
    deps.mutate(req, res, (q, u) => service.create(q, u, requestInput(req)));
  const action: RequestHandler = (req, res) =>
    deps.mutate(req, res, (q, u) => service.action(q, u, requestInput(req)));
  const appeal: RequestHandler = (req, res) =>
    deps.mutate(req, res, (q, u) => service.appeal(q, u, requestInput(req)));
  const reviewAppeal: RequestHandler = (req, res) =>
    deps.mutate(req, res, (q, u) => service.reviewAppeal(q, u, requestInput(req)));
  return { mine, appeals, list, listAppeals, create, action, appeal, reviewAppeal };
}
