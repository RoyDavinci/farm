import { Router } from 'express';
import {
  createMediaController,
  createPublicMediaController,
} from '../controllers/media.controller.js';
import type { AppDeps } from '../types/deps.js';

export function mediaRoutes(deps: AppDeps) {
  const r = Router();
  const c = createMediaController(deps);
  r.post('/', ...c.uploadPhoto);
  r.post('/status-video', ...c.uploadVideo);
  return r;
}

export function publicMediaRoutes(deps: AppDeps) {
  const r = Router();
  const c = createPublicMediaController(deps);
  r.get('/:file', c.servePhoto);
  return r;
}
