import type { RequestHandler } from 'express';
import { requestInput } from '../lib/http.js';
import { createMarketplaceService } from '../services/listing.service.js';
import type { AppDeps } from '../types/deps.js';

/** Seller applications and listings (create, update, browse). */
export function createMarketplaceController(deps: AppDeps) {
  const { mutate } = deps;
  const service = createMarketplaceService(deps);
  const applyAsSeller: RequestHandler = (req, res) =>
    mutate(req, res, (q, user) => service.applyAsSeller(q, user, requestInput(req)));
  const listListings: RequestHandler = async (req, res) => {
    res.json(await service.listListings(res.locals.user, requestInput(req)));
  };
  const createListing: RequestHandler = (req, res) =>
    mutate(req, res, (q, user) => service.createListing(q, user, requestInput(req)));
  const updateListing: RequestHandler = (req, res) =>
    mutate(req, res, (q, user) => service.updateListing(q, user, requestInput(req)));
  return { applyAsSeller, listListings, createListing, updateListing };
}
