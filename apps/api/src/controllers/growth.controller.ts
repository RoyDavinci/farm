import type { RequestHandler } from 'express';
import { requestInput } from '../lib/http.js';
import { createGrowthService } from '../services/growth.service.js';
import type { AppDeps } from '../types/deps.js';

export function createGrowthController(deps: AppDeps) {
  const { mutate } = deps;
  const service = createGrowthService(deps);
  const myTeams: RequestHandler = async (req, res) => {
    res.json(await service.myTeams(res.locals.user, requestInput(req)));
  };
  const listPlans: RequestHandler = async (req, res) => {
    res.json(await service.listPlans(res.locals.user, requestInput(req)));
  };
  const mySubscriptions: RequestHandler = async (req, res) => {
    res.json(await service.mySubscriptions(res.locals.user, requestInput(req)));
  };
  const subscribe: RequestHandler = (req, res) =>
    mutate(req, res, (q, user) => service.subscribe(q, user, requestInput(req)));
  const cancelSubscription: RequestHandler = (req, res) =>
    mutate(req, res, (q, user) => service.cancelSubscription(q, user, requestInput(req)));
  const adminPlans: RequestHandler = async (req, res) => {
    res.json(await service.adminPlans(res.locals.user, requestInput(req)));
  };
  const createPlan: RequestHandler = (req, res) =>
    mutate(req, res, (q, user) => service.savePlan(q, user, requestInput(req)));
  const updatePlan: RequestHandler = (req, res) =>
    mutate(req, res, (q, user) => service.savePlan(q, user, requestInput(req)));
  const adminSubscriptions: RequestHandler = async (req, res) => {
    res.json(await service.adminSubscriptions(res.locals.user, requestInput(req)));
  };
  const activateSubscription: RequestHandler = (req, res) =>
    mutate(req, res, (q, user) => service.activateSubscription(q, user, requestInput(req)));
  const listingAssist: RequestHandler = async (req, res) => {
    res.json(await service.listingAssist(res.locals.user, requestInput(req)));
  };
  const businessReport: RequestHandler = async (req, res) => {
    res.json(await service.businessReport(res.locals.user, requestInput(req)));
  };
  const marketInsights: RequestHandler = async (req, res) => {
    res.json(await service.marketInsights(res.locals.user, requestInput(req)));
  };
  const researchReport: RequestHandler = async (req, res) => {
    res.json(await service.researchReport(res.locals.user, requestInput(req)));
  };
  const createRfq: RequestHandler = (req, res) =>
    mutate(req, res, (q, user) => service.createRfq(q, user, requestInput(req)));
  const myRfqs: RequestHandler = async (req, res) => {
    res.json(await service.myRfqs(res.locals.user, requestInput(req)));
  };
  const openRfqs: RequestHandler = async (req, res) => {
    res.json(await service.openRfqs(res.locals.user, requestInput(req)));
  };
  const getRfq: RequestHandler = async (req, res) => {
    res.json(await service.getRfq(res.locals.user, requestInput(req)));
  };
  const submitQuote: RequestHandler = (req, res) =>
    mutate(req, res, (q, user) => service.submitQuote(q, user, requestInput(req)));
  const acceptQuote: RequestHandler = (req, res) =>
    mutate(req, res, (q, user) => service.acceptQuote(q, user, requestInput(req)));
  const closeRfq: RequestHandler = (req, res) =>
    mutate(req, res, (q, user) => service.closeRfq(q, user, requestInput(req)));
  const listTeam: RequestHandler = async (req, res) => {
    res.json(await service.listTeam(res.locals.user, requestInput(req)));
  };
  const addTeamMember: RequestHandler = (req, res) =>
    mutate(req, res, (q, user) => service.addTeamMember(q, user, requestInput(req)));
  const removeTeamMember: RequestHandler = (req, res) =>
    mutate(req, res, (q, user) => service.removeTeamMember(q, user, requestInput(req)));
  const importListings: RequestHandler = (req, res) =>
    mutate(req, res, (q, user) => service.importListings(q, user, requestInput(req)));
  return {
    myTeams,
    listPlans,
    mySubscriptions,
    subscribe,
    cancelSubscription,
    adminPlans,
    createPlan,
    updatePlan,
    adminSubscriptions,
    activateSubscription,
    listingAssist,
    businessReport,
    marketInsights,
    researchReport,
    createRfq,
    myRfqs,
    openRfqs,
    getRfq,
    submitQuote,
    acceptQuote,
    closeRfq,
    listTeam,
    addTeamMember,
    removeTeamMember,
    importListings,
  };
}
