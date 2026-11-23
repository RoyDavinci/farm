import type { RequestHandler } from 'express';
import { requestInput } from '../lib/http.js';
import { createKycService } from '../services/kyc.service.js';
import { createRiskService } from '../services/risk.service.js';
import type { AppDeps } from '../types/deps.js';

/** Identity checks for customers, and the staff Risk queue (flags, freezes, bank-name overrides). */
export function createRiskController(deps: AppDeps) {
  const { mutate } = deps;
  const kyc = createKycService(deps);
  const risk = createRiskService(deps);
  const getKyc: RequestHandler = async (req, res) => {
    res.json(await kyc.getKyc(res.locals.user, requestInput(req)));
  };
  const startBvn: RequestHandler = (req, res) =>
    mutate(req, res, (q, user) => kyc.startBvn(q, user, requestInput(req)));
  const refreshBvn: RequestHandler = (req, res) =>
    mutate(req, res, (q, user) => kyc.refreshBvn(q, user, requestInput(req)));
  const listRisk: RequestHandler = async (req, res) => {
    res.json(await risk.listRisk(res.locals.user, requestInput(req)));
  };
  const clearRisk: RequestHandler = (req, res) =>
    mutate(req, res, (q, user) => risk.clearRisk(q, user, requestInput(req)));
  const freezeUser: RequestHandler = (req, res) =>
    mutate(req, res, (q, user) => risk.freezeUser(q, user, requestInput(req)));
  const unfreezeUser: RequestHandler = (req, res) =>
    mutate(req, res, (q, user) => risk.unfreezeUser(q, user, requestInput(req)));
  const allowPayoutAccount: RequestHandler = (req, res) =>
    mutate(req, res, (q, user) => risk.allowPayoutAccount(q, user, requestInput(req)));
  return {
    getKyc,
    startBvn,
    refreshBvn,
    listRisk,
    clearRisk,
    freezeUser,
    unfreezeUser,
    allowPayoutAccount,
  };
}
