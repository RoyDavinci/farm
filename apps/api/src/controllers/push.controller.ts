import type { RequestHandler } from 'express';
import { requestInput } from '../lib/http.js';
import { createPushService } from '../services/push.service.js';
import type { AppDeps } from '../types/deps.js';

/** Device push tokens for Expo notifications. */
export function createPushController(deps: AppDeps) {
  const service = createPushService(deps);
  const registerPushToken: RequestHandler = async (req, res) => {
    res.json(await service.registerPushToken(res.locals.user, requestInput(req)));
  };
  const removePushToken: RequestHandler = async (req, res) => {
    res.json(await service.removePushToken(res.locals.user, requestInput(req)));
  };
  return { registerPushToken, removePushToken };
}
