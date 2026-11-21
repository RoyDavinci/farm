import type { RequestHandler } from 'express';
import type { AppDeps } from '../types/deps.js';
import { requestInput } from '../lib/http.js';
import { createDeliveryOperationsService } from '../services/delivery-operations.service.js';
export function createDeliveryOperationsController(deps: AppDeps) {
  const service = createDeliveryOperationsService(deps);
  const backgroundConsent: RequestHandler = (req, res) =>
    deps.mutate(req, res, (q, u) => service.backgroundConsent(q, u, requestInput(req)));
  const backgroundLocation: RequestHandler = async (req, res) => {
    res.json(
      await deps.db.transaction((q) =>
        service.backgroundLocation(q, res.locals.user, requestInput(req)),
      ),
    );
  };
  const timeline: RequestHandler = async (req, res) => {
    res.json(await service.timeline(res.locals.user, requestInput(req)));
  };
  const tariffs: RequestHandler = async (req, res) => {
    res.json(await service.tariffs());
  };
  const incidents: RequestHandler = async (req, res) => {
    res.json(await service.incidents());
  };
  const milestone: RequestHandler = (req, res) =>
    deps.mutate(req, res, (q, u) => service.milestone(q, u, requestInput(req)));
  const schedule: RequestHandler = (req, res) =>
    deps.mutate(req, res, (q, u) => service.schedule(q, u, requestInput(req)));
  const retry: RequestHandler = (req, res) =>
    deps.mutate(req, res, (q, u) => service.retry(q, u, requestInput(req)));
  const inspection: RequestHandler = (req, res) =>
    deps.mutate(req, res, (q, u) => service.inspection(q, u, requestInput(req)));
  const rateDriver: RequestHandler = (req, res) =>
    deps.mutate(req, res, (q, u) => service.rateDriver(q, u, requestInput(req)));
  const incident: RequestHandler = (req, res) =>
    deps.mutate(req, res, (q, u) => service.incident(q, u, requestInput(req)));
  const saveTariff: RequestHandler = (req, res) =>
    deps.mutate(req, res, (q, u) => service.saveTariff(q, u, requestInput(req)));
  const resolveIncident: RequestHandler = (req, res) =>
    deps.mutate(req, res, (q, u) => service.resolveIncident(q, u, requestInput(req)));
  return {
    backgroundConsent,
    backgroundLocation,
    timeline,
    tariffs,
    incidents,
    milestone,
    schedule,
    retry,
    inspection,
    rateDriver,
    incident,
    saveTariff,
    resolveIncident,
  };
}
