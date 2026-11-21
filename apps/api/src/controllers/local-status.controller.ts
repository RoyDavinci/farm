import type { RequestHandler } from 'express';
import type { AppDeps } from '../types/deps.js';
import { requestInput } from '../lib/http.js';
import { createLocalStatusService } from '../services/local-status.service.js';
export function createLocalStatusController(deps: AppDeps) {
  const service = createLocalStatusService(deps);
  const feed: RequestHandler = async (req, res) => {
    res.json(await service.feed(res.locals.user, requestInput(req)));
  };
  const mine: RequestHandler = async (req, res) => {
    res.json(await service.mine(res.locals.user));
  };
  const preferences: RequestHandler = async (req, res) => {
    res.json(await service.preferences(res.locals.user));
  };
  const publish: RequestHandler = (req, res) =>
    deps.mutate(req, res, (q, u) => service.publish(q, u, requestInput(req)));
  const remove: RequestHandler = (req, res) =>
    deps.mutate(req, res, (q, u) => service.remove(q, u, requestInput(req)));
  const event: RequestHandler = (req, res) =>
    deps.mutate(req, res, (q, u) => service.event(q, u, requestInput(req)));
  const mute: RequestHandler = (req, res) =>
    deps.mutate(req, res, (q, u) => service.mute(q, u, requestInput(req)));
  const report: RequestHandler = (req, res) =>
    deps.mutate(req, res, (q, u) => service.report(q, u, requestInput(req)));
  return { feed, mine, preferences, publish, remove, event, mute, report };
}
export function createAdminLocalStatusController(deps: AppDeps) {
  const service = createLocalStatusService(deps);
  const adminList: RequestHandler = async (req, res) => {
    res.json(await service.adminList());
  };
  const moderate: RequestHandler = (req, res) =>
    deps.mutate(req, res, (q, u) => service.moderate(q, u, requestInput(req)));
  return { adminList, moderate };
}
