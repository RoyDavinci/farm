import { Router } from 'express';
import type { AppDeps } from '../types/deps.js';
import { createVoiceController } from '../controllers/voice.controller.js';
export function voiceRoutes(deps: AppDeps) {
  const r = Router(),
    c = createVoiceController(deps);
  r.get('/voice/config', c.settings);
  r.get('/conversations/:id/call', c.active);
  r.post('/conversations/:id/call', c.start);
  r.post('/voice/:id/action', c.action);
  r.get('/voice/:id/signals', c.signals);
  r.post('/voice/:id/signals', c.signal);
  return r;
}
