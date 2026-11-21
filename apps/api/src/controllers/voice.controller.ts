import type { RequestHandler } from 'express';
import type { AppDeps } from '../types/deps.js';
import { requestInput } from '../lib/http.js';
import { createVoiceService } from '../services/voice.service.js';
export function createVoiceController(deps: AppDeps) {
  const service = createVoiceService(deps);
  const settings: RequestHandler = async (req, res) => {
    res.json(await service.settings(res.locals.user));
  };
  const active: RequestHandler = async (req, res) => {
    res.json(await service.active(res.locals.user, requestInput(req)));
  };
  const signals: RequestHandler = async (req, res) => {
    res.json(await service.signals(res.locals.user, requestInput(req)));
  };
  const start: RequestHandler = (req, res) =>
    deps.mutate(req, res, (q, u) => service.start(q, u, requestInput(req)));
  const action: RequestHandler = (req, res) =>
    deps.mutate(req, res, (q, u) => service.action(q, u, requestInput(req)));
  const signal: RequestHandler = (req, res) =>
    deps.mutate(req, res, (q, u) => service.signal(q, u, requestInput(req)));
  return { settings, active, signals, start, action, signal };
}
