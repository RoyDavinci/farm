import type { RequestHandler } from 'express';
import { requestInput } from '../lib/http.js';
import { createRetentionService } from '../services/retention.service.js';
import type { AppDeps } from '../types/deps.js';

export function createRetentionController(deps: AppDeps) {
  const { mutate } = deps;
  const service = createRetentionService(deps);
  const getListing: RequestHandler = async (req, res) => {
    res.json(await service.getListing(res.locals.user, requestInput(req)));
  };
  const listSellerListings: RequestHandler = async (req, res) => {
    res.json(await service.listSellerListings(res.locals.user, requestInput(req)));
  };
  const addStockAlert: RequestHandler = (req, res) =>
    mutate(req, res, (q, user) => service.addStockAlert(q, user, requestInput(req)));
  const removeStockAlert: RequestHandler = (req, res) =>
    mutate(req, res, (q, user) => service.removeStockAlert(q, user, requestInput(req)));
  const getSellerAnalytics: RequestHandler = async (req, res) => {
    res.json(await service.getSellerAnalytics(res.locals.user, requestInput(req)));
  };
  return { getListing, listSellerListings, addStockAlert, removeStockAlert, getSellerAnalytics };
}
