import type { RequestHandler } from 'express';
import type { AppDeps } from '../types/deps.js';
import { requestInput } from '../lib/http.js';
import { createCataloguePolicyService } from '../services/catalogue-policy.service.js';
import { createMarketProfilesService } from '../services/market-profiles.service.js';
export function createMarketOperationsController(deps: AppDeps) {
  const service = { ...createCataloguePolicyService(deps), ...createMarketProfilesService(deps) };
  const adminCategories: RequestHandler = async (req, res) => {
    res.json(await service.categories());
  };
  const categories: RequestHandler = async (req, res) => {
    res.json(await service.categories());
  };
  const saveCategory: RequestHandler = (req, res) =>
    deps.mutate(req, res, (q, u) => service.saveCategory(q, u, requestInput(req)));
  const policies: RequestHandler = async (req, res) => {
    res.json(await service.policies());
  };
  const savePolicies: RequestHandler = (req, res) =>
    deps.mutate(req, res, (q, u) => service.savePolicies(q, u, requestInput(req)));
  const approveStockPolicy: RequestHandler = (req, res) =>
    deps.mutate(req, res, (q, u) => service.approveStockPolicy(q, u, requestInput(req)));
  const archive: RequestHandler = (req, res) =>
    deps.mutate(req, res, (q, u) => service.archive(q, u, requestInput(req)));
  const confirmStock: RequestHandler = (req, res) =>
    deps.mutate(req, res, (q, u) => service.confirmStock(q, u, requestInput(req)));
  const sellerDetails: RequestHandler = async (req, res) => {
    res.json(await service.sellerDetails(res.locals.user));
  };
  const saveSellerDetails: RequestHandler = (req, res) =>
    deps.mutate(req, res, (q, u) => service.saveSellerDetails(q, u, requestInput(req)));
  const driverDetails: RequestHandler = async (req, res) => {
    res.json(await service.driverDetails(res.locals.user));
  };
  const saveDriverDetails: RequestHandler = (req, res) =>
    deps.mutate(req, res, (q, u) => service.saveDriverDetails(q, u, requestInput(req)));
  const publicProfile: RequestHandler = async (req, res) => {
    res.json(await service.publicProfile(res.locals.user, requestInput(req)));
  };
  const marketMap: RequestHandler = async (req, res) => {
    res.json(await service.marketMap(res.locals.user, requestInput(req)));
  };
  const mapping: RequestHandler = async (req, res) => {
    res.json(await service.mapping());
  };
  const saveWaypoint: RequestHandler = (req, res) =>
    deps.mutate(req, res, (q, u) => service.saveWaypoint(q, u, requestInput(req)));
  const savePath: RequestHandler = (req, res) =>
    deps.mutate(req, res, (q, u) => service.savePath(q, u, requestInput(req)));
  const bookingMap: RequestHandler = async (req, res) => {
    res.json(await service.bookingMap(res.locals.user, requestInput(req)));
  };
  const bookingRoute: RequestHandler = async (req, res) => {
    res.json(await service.bookingRoute(res.locals.user, requestInput(req)));
  };
  return {
    adminCategories,
    categories,
    saveCategory,
    policies,
    savePolicies,
    approveStockPolicy,
    archive,
    confirmStock,
    sellerDetails,
    saveSellerDetails,
    driverDetails,
    saveDriverDetails,
    publicProfile,
    marketMap,
    mapping,
    saveWaypoint,
    savePath,
    bookingMap,
    bookingRoute,
  };
}
