import type { RequestHandler } from 'express';
import { requestInput } from '../lib/http.js';
import { createAdminPayoutsService, createPayoutsService } from '../services/payouts.service.js';
import type { AppDeps } from '../types/deps.js';

export function createPayoutsController(deps: AppDeps) {
  const { mutate } = deps;
  const service = createPayoutsService(deps);
  const listBanks: RequestHandler = async (req, res) => {
    res.json(await service.listBanks(res.locals.user, requestInput(req)));
  };
  const resolveAccount: RequestHandler = async (req, res) => {
    res.json(await service.resolveAccount(res.locals.user, requestInput(req)));
  };
  const saveAccount: RequestHandler = async (req, res) => {
    const prepared = await service.prepareAccount(res.locals.user, requestInput(req));
    return mutate(req, res, (q, user) => service.saveAccount(q, user, prepared));
  };
  const getPayoutSummary: RequestHandler = async (req, res) => {
    res.json(await service.getPayoutSummary(res.locals.user, requestInput(req)));
  };
  const requestPayout: RequestHandler = (req, res) =>
    mutate(req, res, (q, user) => service.requestPayout(q, user, requestInput(req)));
  const cancelPayout: RequestHandler = (req, res) =>
    mutate(req, res, (q, user) => service.cancelPayout(q, user, requestInput(req)));
  return { listBanks, resolveAccount, saveAccount, getPayoutSummary, requestPayout, cancelPayout };
}

export function createAdminPayoutsController(deps: AppDeps) {
  const { mutate } = deps;
  const service = createAdminPayoutsService(deps);
  const listPayouts: RequestHandler = async (req, res) => {
    res.json(await service.listPayouts(res.locals.user, requestInput(req)));
  };
  const approvePayout: RequestHandler = async (req, res) => {
    res.json(await service.approvePayout(res.locals.user, requestInput(req)));
  };
  const rejectPayout: RequestHandler = (req, res) =>
    mutate(req, res, (q, user) => service.rejectPayout(q, user, requestInput(req)));
  const recheckPayout: RequestHandler = async (req, res) => {
    res.json(await service.recheckPayout(res.locals.user, requestInput(req)));
  };
  const resolvePayout: RequestHandler = (req, res) =>
    mutate(req, res, (q, user) => service.resolvePayout(q, user, requestInput(req)));
  return { listPayouts, approvePayout, rejectPayout, recheckPayout, resolvePayout };
}
