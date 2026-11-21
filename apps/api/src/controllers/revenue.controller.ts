import type { RequestHandler } from 'express';
import { requestInput } from '../lib/http.js';
import { createRevenueService } from '../services/revenue.service.js';
import type { AppDeps } from '../types/deps.js';

export function createRevenueController(deps: AppDeps) {
  const { mutate } = deps;
  const service = createRevenueService(deps);
  const listPackages: RequestHandler = async (req, res) => {
    res.json(await service.listPackages(res.locals.user, requestInput(req)));
  };
  const featuredSellers: RequestHandler = async (req, res) => {
    res.json(await service.featuredSellers(res.locals.user, requestInput(req)));
  };
  const myFeatured: RequestHandler = async (req, res) => {
    res.json(await service.myFeatured(res.locals.user, requestInput(req)));
  };
  const featureMyShop: RequestHandler = (req, res) =>
    mutate(req, res, (q, user) => service.featureMyShop(q, user, requestInput(req)));
  const serveAds: RequestHandler = async (req, res) => {
    res.json(await service.serveAds(res.locals.user, requestInput(req)));
  };
  const clickAd: RequestHandler = async (req, res) => {
    res.json(await service.clickAd(res.locals.user, requestInput(req)));
  };
  const getSwitches: RequestHandler = async (req, res) => {
    res.json(await service.getSwitches(res.locals.user, requestInput(req)));
  };
  const saveSwitches: RequestHandler = (req, res) =>
    mutate(req, res, (q, user) => service.saveSwitches(q, user, requestInput(req)));
  const revenueReport: RequestHandler = async (req, res) => {
    res.json(await service.revenueReport(res.locals.user, requestInput(req)));
  };
  const adminPackages: RequestHandler = async (req, res) => {
    res.json(await service.adminPackages(res.locals.user, requestInput(req)));
  };
  const savePackage: RequestHandler = (req, res) =>
    mutate(req, res, (q, user) => service.savePackage(q, user, requestInput(req)));
  const adminFeatured: RequestHandler = async (req, res) => {
    res.json(await service.adminFeatured(res.locals.user, requestInput(req)));
  };
  const cancelFeatured: RequestHandler = (req, res) =>
    mutate(req, res, (q, user) => service.cancelFeatured(q, user, requestInput(req)));
  const adminAds: RequestHandler = async (req, res) => {
    res.json(await service.adminAds(res.locals.user, requestInput(req)));
  };
  const saveAd: RequestHandler = (req, res) =>
    mutate(req, res, (q, user) => service.saveAd(q, user, requestInput(req)));
  const setAdStatus: RequestHandler = (req, res) =>
    mutate(req, res, (q, user) => service.setAdStatus(q, user, requestInput(req)));
  const recordAdPayment: RequestHandler = (req, res) =>
    mutate(req, res, (q, user) => service.recordAdPayment(q, user, requestInput(req)));
  const adminPartners: RequestHandler = async (req, res) => {
    res.json(await service.adminPartners(res.locals.user, requestInput(req)));
  };
  const savePartner: RequestHandler = (req, res) =>
    mutate(req, res, (q, user) => service.savePartner(q, user, requestInput(req)));
  const assignPartnerDriver: RequestHandler = (req, res) =>
    mutate(req, res, (q, user) => service.assignPartnerDriver(q, user, requestInput(req)));
  const updatePackage: RequestHandler = (req, res) =>
    mutate(req, res, (q, user) => service.savePackage(q, user, requestInput(req)));
  const updateAd: RequestHandler = (req, res) =>
    mutate(req, res, (q, user) => service.saveAd(q, user, requestInput(req)));
  const updatePartner: RequestHandler = (req, res) =>
    mutate(req, res, (q, user) => service.savePartner(q, user, requestInput(req)));
  return {
    updatePackage,
    updateAd,
    updatePartner,
    listPackages,
    featuredSellers,
    myFeatured,
    featureMyShop,
    serveAds,
    clickAd,
    getSwitches,
    saveSwitches,
    revenueReport,
    adminPackages,
    savePackage,
    adminFeatured,
    cancelFeatured,
    adminAds,
    saveAd,
    setAdStatus,
    recordAdPayment,
    adminPartners,
    savePartner,
    assignPartnerDriver,
  };
}
