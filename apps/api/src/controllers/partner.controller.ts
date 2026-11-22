import type { RequestHandler } from 'express';
import { requestInput } from '../lib/http.js';
import { createPartnerService } from '../services/partner.service.js';
import type { AppDeps } from '../types/deps.js';

export function createPartnerController(deps: AppDeps) {
  const { mutate } = deps;
  const service = createPartnerService(deps);
  const listKeys: RequestHandler = async (req, res) => {
    res.json(await service.listKeys(res.locals.user, requestInput(req)));
  };
  const createKey: RequestHandler = (req, res) =>
    mutate(req, res, (q, user) => service.createKey(q, user, requestInput(req)));
  const revokeKey: RequestHandler = (req, res) =>
    mutate(req, res, (q, user) => service.revokeKey(q, user, requestInput(req)));
  const createWebhook: RequestHandler = (req, res) =>
    mutate(req, res, (q, user) => service.createWebhook(q, user, requestInput(req)));
  const deleteWebhook: RequestHandler = (req, res) =>
    mutate(req, res, (q, user) => service.deleteWebhook(q, user, requestInput(req)));
  const integrations: RequestHandler = async (req, res) => {
    res.json(await service.integrations(res.locals.user, requestInput(req)));
  };
  return { listKeys, createKey, revokeKey, createWebhook, deleteWebhook, integrations };
}
