import type { RequestHandler } from 'express';
import { requestInput } from '../lib/http.js';
import {
  createAdminDeliveriesService,
  createDeliveriesService,
} from '../services/deliveries.service.js';
import type { AppDeps } from '../types/deps.js';

export function createDeliveriesController(deps: AppDeps) {
  const { mutate } = deps;
  const service = createDeliveriesService(deps);
  const getDeliveryOptions: RequestHandler = async (req, res) => {
    res.json(await service.getDeliveryOptions(res.locals.user, requestInput(req)));
  };
  const quoteDelivery: RequestHandler = async (req, res) => {
    res.json(await service.quoteDelivery(res.locals.user, requestInput(req)));
  };
  const requestDelivery: RequestHandler = (req, res) =>
    mutate(req, res, (q, user) => service.requestDelivery(q, user, requestInput(req)));
  const getBookingDelivery: RequestHandler = async (req, res) => {
    res.json(await service.getBookingDelivery(res.locals.user, requestInput(req)));
  };
  const performDeliveryAction: RequestHandler = (req, res) =>
    mutate(req, res, (q, user) => service.performDeliveryAction(q, user, requestInput(req)));
  const getMyDriverProfile: RequestHandler = async (req, res) => {
    res.json(await service.getMyDriverProfile(res.locals.user, requestInput(req)));
  };
  const applyAsDriver: RequestHandler = (req, res) =>
    mutate(req, res, (q, user) => service.applyAsDriver(q, user, requestInput(req)));
  const updateDriverStatus: RequestHandler = async (req, res) => {
    res.json(await service.updateDriverStatus(res.locals.user, requestInput(req)));
  };
  const listDriverJobs: RequestHandler = async (req, res) => {
    res.json(await service.listDriverJobs(res.locals.user, requestInput(req)));
  };
  return {
    getDeliveryOptions,
    quoteDelivery,
    requestDelivery,
    getBookingDelivery,
    performDeliveryAction,
    getMyDriverProfile,
    applyAsDriver,
    updateDriverStatus,
    listDriverJobs,
  };
}

export function createAdminDeliveriesController(deps: AppDeps) {
  const { mutate } = deps;
  const service = createAdminDeliveriesService(deps);
  const listDrivers: RequestHandler = async (req, res) => {
    res.json(await service.listDrivers(res.locals.user, requestInput(req)));
  };
  const reviewDriver: RequestHandler = (req, res) =>
    mutate(req, res, (q, user) => service.reviewDriver(q, user, requestInput(req)));
  const listDeliveries: RequestHandler = async (req, res) => {
    res.json(await service.listDeliveries(res.locals.user, requestInput(req)));
  };
  const listVehicleTypes: RequestHandler = async (req, res) => {
    res.json(await service.listVehicleTypes(res.locals.user, requestInput(req)));
  };
  const saveVehicleType: RequestHandler = (req, res) =>
    mutate(req, res, (q, user) => service.saveVehicleType(q, user, requestInput(req)));
  return { listDrivers, reviewDriver, listDeliveries, listVehicleTypes, saveVehicleType };
}
