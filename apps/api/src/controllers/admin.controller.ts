import type { RequestHandler } from 'express';
import { requestInput } from '../lib/http.js';
import { createAdminService } from '../services/admin.service.js';
import type { AppDeps } from '../types/deps.js';

/** Operations console: overview, seller review, moderation, settings, audit log and ledger. */
export function createAdminController(deps: AppDeps) {
  const { mutate } = deps;
  const service = createAdminService(deps);
  const getReconciliation: RequestHandler = async (req, res) => {
    res.json(await service.getReconciliation(res.locals.user, requestInput(req)));
  };
  const recheckFunding: RequestHandler = async (req, res) => {
    res.json(await service.recheckFunding(res.locals.user, requestInput(req)));
  };
  const getOverview: RequestHandler = async (req, res) => {
    res.json(await service.getOverview(res.locals.user, requestInput(req)));
  };
  const listSellers: RequestHandler = async (req, res) => {
    res.json(await service.listSellers(res.locals.user, requestInput(req)));
  };
  const reviewSeller: RequestHandler = (req, res) =>
    mutate(req, res, (q, user) => service.reviewSeller(q, user, requestInput(req)));
  const listBookings: RequestHandler = async (req, res) => {
    res.json(await service.listBookings(res.locals.user, requestInput(req)));
  };
  const listListings: RequestHandler = async (req, res) => {
    res.json(await service.listListings(res.locals.user, requestInput(req)));
  };
  const moderateListing: RequestHandler = (req, res) =>
    mutate(req, res, (q, user) => service.moderateListing(q, user, requestInput(req)));
  const updateSettings: RequestHandler = (req, res) =>
    mutate(req, res, (q, user) => service.updateSettings(q, user, requestInput(req)));
  const listAudit: RequestHandler = async (req, res) => {
    res.json(await service.listAudit(res.locals.user, requestInput(req)));
  };
  const listLedger: RequestHandler = async (req, res) => {
    res.json(await service.listLedger(res.locals.user, requestInput(req)));
  };
  return {
    getReconciliation,
    recheckFunding,
    getOverview,
    listSellers,
    reviewSeller,
    listBookings,
    listListings,
    moderateListing,
    updateSettings,
    listAudit,
    listLedger,
  };
}
