import type { RequestHandler } from 'express';
import type { AppDeps } from '../types/deps.js';
import { requestInput } from '../lib/http.js';
import { createRegionsService } from '../services/regions.service.js';
export function createRegionsController(deps: AppDeps) {
  const service = createRegionsService(deps);
  const listRegions: RequestHandler = async (req, res) => {
    res.json(await service.listRegions());
  };
  const activeRegions: RequestHandler = async (req, res) => {
    res.json(await service.activeRegions());
  };
  const saveRegion: RequestHandler = (req, res) =>
    deps.mutate(req, res, (q, u) => service.saveRegion(q, u, requestInput(req)));
  return { listRegions, activeRegions, saveRegion };
}
