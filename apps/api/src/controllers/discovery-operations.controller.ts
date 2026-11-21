import type { RequestHandler } from 'express';
import type { AppDeps } from '../types/deps.js';
import { requestInput } from '../lib/http.js';
import { createDiscoveryOperationsService } from '../services/discovery-operations.service.js';
export function createDiscoveryOperationsController(deps: AppDeps) {
  const service = createDiscoveryOperationsService(deps);
  const preferences: RequestHandler = async (req, res) => {
    res.json(await service.preferences(res.locals.user));
  };
  const interests: RequestHandler = async (req, res) => {
    res.json(await service.interests(res.locals.user));
  };
  const metrics: RequestHandler = async (req, res) => {
    res.json(await service.metrics());
  };
  const savePreferences: RequestHandler = (req, res) =>
    deps.mutate(req, res, (q, u) => service.savePreferences(q, u, requestInput(req)));
  const registerInterest: RequestHandler = (req, res) =>
    deps.mutate(req, res, (q, u) => service.registerInterest(q, u, requestInput(req)));
  const confirmInterest: RequestHandler = (req, res) =>
    deps.mutate(req, res, (q, u) => service.confirmInterest(q, u, requestInput(req)));
  const cancelInterest: RequestHandler = (req, res) =>
    deps.mutate(req, res, (q, u) => service.cancelInterest(q, u, requestInput(req)));
  const advancePreference: RequestHandler = (req, res) =>
    deps.mutate(req, res, (q, u) => service.advancePreference(q, u, requestInput(req)));
  return {
    preferences,
    interests,
    metrics,
    savePreferences,
    registerInterest,
    confirmInterest,
    cancelInterest,
    advancePreference,
  };
}
