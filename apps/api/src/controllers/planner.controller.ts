import type { RequestHandler } from 'express';
import { requestInput } from '../lib/http.js';
import { createPlannerService } from '../services/planner.service.js';
import type { AppDeps } from '../types/deps.js';

export function createPlannerController(deps: AppDeps) {
  const { mutate } = deps;
  const service = createPlannerService(deps);
  const listMembers: RequestHandler = async (req, res) => {
    res.json(await service.listMembers(res.locals.user, requestInput(req)));
  };
  const shareWith: RequestHandler = (req, res) =>
    mutate(req, res, (q, user) => service.shareWith(q, user, requestInput(req)));
  const removeMember: RequestHandler = (req, res) =>
    mutate(req, res, (q, user) => service.removeMember(q, user, requestInput(req)));
  const listTemplates: RequestHandler = async (req, res) => {
    res.json(await service.listTemplates(res.locals.user, requestInput(req)));
  };
  const listRecipes: RequestHandler = async (req, res) => {
    res.json(await service.listRecipes(res.locals.user, requestInput(req)));
  };
  const getDietProfile: RequestHandler = async (req, res) => {
    res.json(await service.getDietProfile(res.locals.user, requestInput(req)));
  };
  const listPlans: RequestHandler = async (req, res) => {
    res.json(await service.listPlans(res.locals.user, requestInput(req)));
  };
  const getPlan: RequestHandler = async (req, res) => {
    res.json(await service.getPlan(res.locals.user, requestInput(req)));
  };
  const matches: RequestHandler = async (req, res) => {
    res.json(await service.matches(res.locals.user, requestInput(req)));
  };
  const readText: RequestHandler = async (req, res) => {
    res.json(await service.readText(res.locals.user, requestInput(req)));
  };
  const saveDietProfile: RequestHandler = (req, res) =>
    mutate(req, res, (q, user) => service.saveDietProfile(q, user, requestInput(req)));
  const deleteDietProfile: RequestHandler = (req, res) =>
    mutate(req, res, (q, user) => service.deleteDietProfile(q, user, requestInput(req)));
  const createPlan: RequestHandler = (req, res) =>
    mutate(req, res, (q, user) => service.createPlan(q, user, requestInput(req)));
  const updatePlan: RequestHandler = (req, res) =>
    mutate(req, res, (q, user) => service.updatePlan(q, user, requestInput(req)));
  const deletePlan: RequestHandler = (req, res) =>
    mutate(req, res, (q, user) => service.deletePlan(q, user, requestInput(req)));
  const duplicatePlan: RequestHandler = (req, res) =>
    mutate(req, res, (q, user) => service.duplicatePlan(q, user, requestInput(req)));
  const addItem: RequestHandler = (req, res) =>
    mutate(req, res, (q, user) => service.addItem(q, user, requestInput(req)));
  const updateItem: RequestHandler = (req, res) =>
    mutate(req, res, (q, user) => service.updateItem(q, user, requestInput(req)));
  const deleteItem: RequestHandler = (req, res) =>
    mutate(req, res, (q, user) => service.deleteItem(q, user, requestInput(req)));
  const addMeal: RequestHandler = (req, res) =>
    mutate(req, res, (q, user) => service.addMeal(q, user, requestInput(req)));
  const removeMeal: RequestHandler = (req, res) =>
    mutate(req, res, (q, user) => service.removeMeal(q, user, requestInput(req)));
  const buildGroceryList: RequestHandler = (req, res) =>
    mutate(req, res, (q, user) => service.buildGroceryList(q, user, requestInput(req)));
  return {
    listMembers,
    shareWith,
    removeMember,
    listTemplates,
    listRecipes,
    getDietProfile,
    listPlans,
    getPlan,
    matches,
    readText,
    saveDietProfile,
    deleteDietProfile,
    createPlan,
    updatePlan,
    deletePlan,
    duplicatePlan,
    addItem,
    updateItem,
    deleteItem,
    addMeal,
    removeMeal,
    buildGroceryList,
  };
}
