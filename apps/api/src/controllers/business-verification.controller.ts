import type { RequestHandler } from 'express';
import { requestInput } from '../lib/http.js';
import { createBusinessVerificationService } from '../services/business-verification.service.js';
import type { AppDeps } from '../types/deps.js';

export function createBusinessVerificationController(deps: AppDeps) {
  const { mutate } = deps;
  const service = createBusinessVerificationService(deps);
  const nearbySellers: RequestHandler = async (req, res) => {
    res.json(await service.nearbySellers(res.locals.user, requestInput(req)));
  };
  const getMyVerification: RequestHandler = async (req, res) => {
    res.json(await service.getMyVerification(res.locals.user, requestInput(req)));
  };
  const applyForVerification: RequestHandler = (req, res) =>
    mutate(req, res, (q, user) => service.applyForVerification(q, user, requestInput(req)));
  const listVerifications: RequestHandler = async (req, res) => {
    res.json(await service.listVerifications(res.locals.user, requestInput(req)));
  };
  const verificationHistory: RequestHandler = async (req, res) => {
    res.json(await service.verificationHistory(res.locals.user, requestInput(req)));
  };
  const decideVerification: RequestHandler = (req, res) =>
    mutate(req, res, (q, user) => service.decideVerification(q, user, requestInput(req)));
  return {
    nearbySellers,
    getMyVerification,
    applyForVerification,
    listVerifications,
    verificationHistory,
    decideVerification,
  };
}
