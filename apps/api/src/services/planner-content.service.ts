import { z } from 'zod';
import type { Query } from '../database/client.js';
import { planTemplates, type PlanTemplate } from '../config/planner-templates.js';
import {
  ingredients as defaultIngredients,
  recipes as defaultRecipes,
  type Ingredient,
  type Recipe,
} from '../config/recipes.js';

const allergen = z.enum([
  'peanut',
  'tree_nut',
  'milk',
  'egg',
  'fish',
  'shellfish',
  'soy',
  'wheat',
  'sesame',
]);
export const ingredientSchema = z.object({
  name: z.string().trim().min(2).max(80),
  unit: z.string().trim().min(1).max(20),
  price: z.number().min(0).max(10_000_000),
  category: z.string().trim().min(2).max(60),
  keywords: z.string().trim().max(200),
  allergens: z.array(allergen).optional(),
  may: z.array(allergen).optional(),
  tags: z.array(z.string().max(30)).optional(),
  step: z.number().positive().max(100).optional(),
});
export const recipeSchema = z.object({
  key: z.string().regex(/^[a-z0-9-]{2,60}$/),
  name: z.string().trim().min(2).max(80),
  description: z.string().trim().max(300),
  time: z.number().int().min(1).max(1440),
  meals: z.array(z.enum(['BREAKFAST', 'LUNCH', 'DINNER'])).min(1),
  per_serving: z.record(z.string(), z.number().positive().max(100)),
  steps: z.array(z.string().trim().min(2).max(400)).min(1).max(30),
});
const templateItem = z.object({
  section: z.string().trim().min(1).max(60),
  name: z.string().trim().min(1).max(120),
  category: z.string().trim().min(2).max(60),
  keywords: z.string().trim().max(200),
  unit: z.string().trim().min(1).max(30),
  qty: z.object({
    fixed: z.number().min(0).optional(),
    perRoom: z.number().min(0).optional(),
    perPerson: z.number().min(0).optional(),
  }),
  price: z.tuple([z.number().min(0), z.number().min(0), z.number().min(0)]),
  priority: z.enum(['ESSENTIAL', 'IMPORTANT', 'OPTIONAL']),
});
export const templateSchema = z.object({
  key: z.string().regex(/^[a-z0-9-]{2,40}$/),
  kind: z.enum(['HOME', 'EVENT', 'FOOD', 'PERSONAL', 'OFFICE', 'CUSTOM']),
  title: z.string().trim().min(2).max(60),
  description: z.string().trim().max(300),
  questions: z.array(z.enum(['budget', 'people', 'rooms', 'tier', 'target_date'])),
  roomsLabel: z.string().max(40).optional(),
  peopleLabel: z.string().max(40).optional(),
  match: z.array(z.string().trim().min(2).max(40)).max(40),
  items: z.array(templateItem).max(200),
});

export interface PlannerContent {
  templates: PlanTemplate[];
  recipes: Recipe[];
  ingredients: Record<string, Ingredient>;
  /** Keys changed or added by staff, by type. */
  custom: { TEMPLATE: Set<string>; RECIPE: Set<string>; INGREDIENT: Set<string> };
}

let cache: { at: number; data: PlannerContent } | null = null;
/** Call after staff edits so the next request sees them. */
export const invalidatePlannerContent = () => {
  cache = null;
};

/**
 * Templates, recipes and ingredients in use: the defaults in code with staff edits applied on top.
 * An edit can change or add an item, or switch a default off. Invalid rows are skipped.
 */
export async function plannerContent(q: Query): Promise<PlannerContent> {
  if (cache && Date.now() - cache.at < 30_000) return cache.data;
  const rows = await q.query('SELECT type,key,data,active FROM planner_content');
  const templates = new Map(planTemplates.map((t) => [t.key, t]));
  const recipes = new Map(defaultRecipes.map((r) => [r.key, r]));
  const ingredients = new Map(Object.entries(defaultIngredients));
  const custom = {
    TEMPLATE: new Set<string>(),
    RECIPE: new Set<string>(),
    INGREDIENT: new Set<string>(),
  };
  for (const row of rows) {
    const table = { TEMPLATE: templates, RECIPE: recipes, INGREDIENT: ingredients }[
      row.type as 'TEMPLATE'
    ] as Map<string, unknown>;
    custom[row.type as 'TEMPLATE'].add(row.key);
    if (!row.active) {
      table.delete(row.key);
      continue;
    }
    const schema = { TEMPLATE: templateSchema, RECIPE: recipeSchema, INGREDIENT: ingredientSchema }[
      row.type as 'TEMPLATE'
    ];
    const parsed = (schema as z.ZodType).safeParse(row.data);
    if (parsed.success) table.set(row.key, parsed.data);
  }
  const ingredientMap = Object.fromEntries(ingredients) as Record<string, Ingredient>;
  const data: PlannerContent = {
    templates: [...templates.values()],
    // Recipes that use an unknown ingredient are left out rather than breaking grocery lists.
    recipes: [...recipes.values()].filter((r) =>
      Object.keys(r.per_serving).every((k) => ingredientMap[k]),
    ),
    ingredients: ingredientMap,
    custom,
  };
  cache = { at: Date.now(), data };
  return data;
}
