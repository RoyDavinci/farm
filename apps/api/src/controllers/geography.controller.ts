import type { RequestHandler } from 'express';
import { requestInput } from '../lib/http.js';
import { createGeographyService } from '../services/geography.service.js';
import type { AppDeps } from '../types/deps.js';

export function createGeographyController(deps: AppDeps) {
  const { mutate } = deps;
  const service = createGeographyService(deps);
  const getMapConfig: RequestHandler = async (req, res) => {
    res.json(await service.getMapConfig(res.locals.user, requestInput(req)));
  };
  const geocode: RequestHandler = async (req, res) => {
    res.json(await service.geocode(res.locals.user, requestInput(req)));
  };
  const listMarkets: RequestHandler = async (req, res) => {
    res.json(await service.listMarkets(res.locals.user, requestInput(req)));
  };
  const createMarket: RequestHandler = (req, res) =>
    mutate(req, res, (q, user) => service.createMarket(q, user, requestInput(req)));
  const updateSellerLocation: RequestHandler = (req, res) =>
    mutate(req, res, (q, user) => service.updateSellerLocation(q, user, requestInput(req)));
  const search: RequestHandler = async (req, res) => {
    res.json(await service.search(res.locals.user, requestInput(req)));
  };
  return { getMapConfig, geocode, listMarkets, createMarket, updateSellerLocation, search };
}
