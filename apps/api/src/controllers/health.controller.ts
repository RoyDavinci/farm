import type { RequestHandler } from 'express';
import { createHealthService } from '../services/health.service.js';
import type { AppDeps } from '../types/deps.js';

/** Liveness and readiness probes for load balancers and uptime monitors. */
export function createHealthController(deps: AppDeps) {
  const service = createHealthService(deps);
  const liveness: RequestHandler = async (_req, res) => {
    res.json(await service.liveness());
  };
  const readiness: RequestHandler = async (_req, res) => {
    const { healthy, body } = await service.readiness();
    res.status(healthy ? 200 : 503).json(body);
  };
  return { liveness, readiness };
}
