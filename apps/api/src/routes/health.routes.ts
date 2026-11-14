import { Router } from 'express';
import { createHealthController } from '../controllers/health.controller.js';
import type { AppDeps } from '../types/deps.js';

export function healthRoutes(deps: AppDeps) {
  const r = Router();
  const c = createHealthController(deps);
  r.get('/health', c.liveness);
  r.get('/health/ready', c.readiness);
  return r;
}
