import { Router } from 'express';
import { createPushController } from '../controllers/push.controller.js';
import type { AppDeps } from '../types/deps.js';

export function pushRoutes(deps: AppDeps) {
  const r = Router();
  const c = createPushController(deps);
  r.put('/me/push-tokens', c.registerPushToken);
  r.delete('/me/push-tokens', c.removePushToken);
  return r;
}
