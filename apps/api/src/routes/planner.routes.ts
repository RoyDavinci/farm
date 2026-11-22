import { Router } from 'express';
import { createPlannerController } from '../controllers/planner.controller.js';
import type { AppDeps } from '../types/deps.js';

/** Smart Planner: templates, recipes, diet profile, plans, items, product matches and meals. */
export function plannerRoutes(deps: AppDeps) {
  const r = Router();
  const c = createPlannerController(deps);
  r.get('/planner/templates', c.listTemplates);
  r.get('/planner/recipes', c.listRecipes);
  r.post('/planner/read', c.readText);
  r.get('/planner/diet-profile', c.getDietProfile);
  r.put('/planner/diet-profile', c.saveDietProfile);
  r.delete('/planner/diet-profile', c.deleteDietProfile);
  r.get('/plans', c.listPlans);
  r.post('/plans', c.createPlan);
  r.get('/plans/:id', c.getPlan);
  r.patch('/plans/:id', c.updatePlan);
  r.delete('/plans/:id', c.deletePlan);
  r.post('/plans/:id/duplicate', c.duplicatePlan);
  r.get('/plans/:id/members', c.listMembers);
  r.post('/plans/:id/members', c.shareWith);
  r.delete('/plans/:id/members/:userId', c.removeMember);
  r.post('/plans/:id/items', c.addItem);
  r.patch('/plans/:id/items/:itemId', c.updateItem);
  r.delete('/plans/:id/items/:itemId', c.deleteItem);
  r.get('/plans/:id/items/:itemId/matches', c.matches);
  r.post('/plans/:id/meals', c.addMeal);
  r.delete('/plans/:id/meals/:mealId', c.removeMeal);
  r.post('/plans/:id/grocery-list', c.buildGroceryList);
  return r;
}
