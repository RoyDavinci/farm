/**
 * Recipe library for the meal planner: Nigerian dishes built from a shared ingredient list.
 * Allergen data here is a planning aid, not a guarantee: `allergens` are known to be present,
 * `may` are possible (for example blends and cubes whose recipe varies by brand). Prices are rough
 * per-unit estimates in naira for budgeting only.
 */
export const allergenNames = {
  peanut: 'Groundnuts / peanuts',
  tree_nut: 'Tree nuts',
  milk: 'Milk / dairy',
  egg: 'Eggs',
  fish: 'Fish',
  shellfish: 'Shellfish (crayfish, prawns)',
  soy: 'Soy',
  wheat: 'Wheat / gluten',
  sesame: 'Sesame',
} as const;
export type Allergen = keyof typeof allergenNames;

/** Diet patterns and the ingredient tags they rule out. */
export const dietPatterns: Record<string, { label: string; excludes: string[] }> = {
  vegetarian: { label: 'Vegetarian', excludes: ['meat', 'poultry', 'fish', 'seafood'] },
  vegan: { label: 'Vegan', excludes: ['meat', 'poultry', 'fish', 'seafood', 'egg', 'dairy'] },
  no_seafood: { label: 'No seafood', excludes: ['fish', 'seafood'] },
  no_pork: { label: 'No pork', excludes: ['pork'] },
  no_beef: { label: 'No beef', excludes: ['beef'] },
  low_salt: { label: 'Low salt (preference)', excludes: [] },
  low_sugar: { label: 'Low sugar (preference)', excludes: [] },
};

export interface Ingredient {
  name: string;
  unit: string;
  /** Estimated naira per unit. */
  price: number;
  category: string;
  keywords: string;
  allergens?: Allergen[];
  may?: Allergen[];
  tags?: string[];
  /** Round shopping quantities up to this step (default 1 for pieces, 0.5 otherwise). */
  step?: number;
}

const ing = (
  name: string,
  unit: string,
  price: number,
  category: string,
  keywords: string,
  extra: Partial<Ingredient> = {},
): Ingredient => ({ name, unit, price, category, keywords, ...extra });
const V = 'Vegetables',
  F = 'Food & groceries',
  L = 'Livestock';

export const ingredients: Record<string, Ingredient> = {
  rice: ing('Rice', 'kg', 1700, 'Grains', 'rice'),
  beans: ing('Beans (oloyin or brown)', 'kg', 2100, 'Grains', 'beans'),
  yam: ing('Yam', 'kg', 1200, 'Tubers', 'yam'),
  plantain: ing('Plantain', 'piece', 400, 'Fruit', 'plantain', { step: 1 }),
  garri: ing('Garri', 'kg', 1500, F, 'garri'),
  semolina: ing('Semolina / wheat swallow', 'kg', 2200, F, 'semolina semovita wheat', {
    allergens: ['wheat'],
  }),
  spaghetti: ing('Spaghetti', 'pack', 1000, F, 'spaghetti pasta', {
    allergens: ['wheat'],
    step: 1,
  }),
  bread: ing('Bread', 'piece', 1500, F, 'bread', {
    allergens: ['wheat'],
    may: ['milk', 'egg', 'soy', 'sesame'],
    step: 1,
  }),
  ogi: ing('Pap (ogi / akamu)', 'kg', 2000, F, 'pap ogi akamu custard'),
  tomatoes: ing('Tomatoes', 'kg', 1500, V, 'tomatoes'),
  tatashe: ing('Red bell pepper (tatashe)', 'kg', 2200, V, 'tatashe bell pepper'),
  rodo: ing('Scotch bonnet (ata rodo)', 'kg', 3000, V, 'rodo scotch bonnet pepper'),
  onions: ing('Onions', 'kg', 1200, V, 'onions'),
  ugu: ing('Ugu leaves', 'kg', 4000, V, 'ugu pumpkin leaves'),
  spinach: ing('Spinach (efo)', 'kg', 3000, V, 'spinach efo'),
  okra: ing('Okra', 'kg', 2500, V, 'okra'),
  carrots: ing('Carrots', 'kg', 1800, V, 'carrots'),
  green_beans: ing('Green beans', 'kg', 2500, V, 'green beans'),
  cabbage: ing('Cabbage', 'piece', 1200, V, 'cabbage', { step: 1 }),
  veg_oil: ing('Vegetable oil', 'litre', 3200, F, 'vegetable oil'),
  palm_oil: ing('Palm oil', 'litre', 2000, F, 'palm oil'),
  cubes: ing('Seasoning cubes', 'pack', 1500, F, 'seasoning cubes', {
    may: ['wheat', 'soy', 'milk'],
    step: 1,
  }),
  salt: ing('Salt', 'kg', 800, F, 'salt'),
  curry_thyme: ing('Curry and thyme', 'pack', 600, F, 'curry thyme spice', { step: 1 }),
  crayfish: ing('Ground crayfish', 'kg', 12000, F, 'crayfish', {
    allergens: ['shellfish'],
    tags: ['seafood'],
    step: 0.25,
  }),
  stockfish: ing('Stockfish / dried fish', 'kg', 9000, F, 'stockfish dried fish', {
    allergens: ['fish'],
    tags: ['fish'],
    step: 0.25,
  }),
  catfish: ing('Fresh catfish', 'kg', 4500, F, 'catfish fish', {
    allergens: ['fish'],
    tags: ['fish'],
  }),
  chicken: ing('Chicken', 'kg', 5000, L, 'chicken', { tags: ['poultry', 'meat'] }),
  beef: ing('Beef', 'kg', 6500, F, 'beef meat', { tags: ['meat', 'beef'] }),
  goat_meat: ing('Goat meat', 'kg', 7000, L, 'goat meat', { tags: ['meat'] }),
  ponmo: ing('Ponmo (cow skin)', 'kg', 4000, F, 'ponmo cow skin', { tags: ['meat', 'beef'] }),
  eggs: ing('Eggs', 'piece', 140, L, 'eggs', { allergens: ['egg'], tags: ['egg'], step: 1 }),
  egusi: ing('Ground egusi', 'kg', 5000, F, 'egusi melon seeds'),
  ogbono: ing('Ground ogbono', 'kg', 9000, F, 'ogbono'),
  iru: ing('Locust beans (iru)', 'kg', 6000, F, 'iru locust beans', { step: 0.25 }),
  pepper_soup_spice: ing('Pepper soup spice', 'pack', 600, F, 'pepper soup spice', { step: 1 }),
  uziza: ing('Uziza or scent leaves', 'kg', 3000, V, 'uziza scent leaves', { step: 0.25 }),
  milk: ing('Milk', 'pack', 1500, F, 'milk', { allergens: ['milk'], tags: ['dairy'], step: 1 }),
  sugar: ing('Sugar', 'kg', 1800, F, 'sugar'),
  peanuts: ing('Roasted groundnuts', 'kg', 2500, F, 'groundnut peanut', { allergens: ['peanut'] }),
  suya_spice: ing('Suya spice (yaji)', 'pack', 800, F, 'suya spice yaji', {
    allergens: ['peanut'],
    step: 1,
  }),
};

export interface Recipe {
  key: string;
  name: string;
  description: string;
  /** Minutes, roughly. */
  time: number;
  meals: ('BREAKFAST' | 'LUNCH' | 'DINNER')[];
  /** Ingredient key → quantity per serving. */
  per_serving: Record<string, number>;
  steps: string[];
}

const r = (
  key: string,
  name: string,
  description: string,
  time: number,
  meals: Recipe['meals'],
  per_serving: Record<string, number>,
  steps: string[],
): Recipe => ({ key, name, description, time, meals, per_serving, steps });
const LD: Recipe['meals'] = ['LUNCH', 'DINNER'];

export const recipes: Recipe[] = [
  r(
    'jollof-rice',
    'Jollof rice with chicken',
    'Party-style jollof cooked in a rich tomato and pepper base.',
    90,
    LD,
    {
      rice: 0.15,
      tomatoes: 0.12,
      tatashe: 0.05,
      rodo: 0.01,
      onions: 0.04,
      veg_oil: 0.04,
      cubes: 0.1,
      curry_thyme: 0.1,
      chicken: 0.2,
      salt: 0.005,
    },
    [
      'Season and boil the chicken; keep the stock.',
      'Blend tomatoes, tatashe, rodo and onions; fry in oil until the oil rises.',
      'Add stock, cubes, curry and thyme; stir in washed rice.',
      'Cover tightly and cook on low heat until soft.',
      'Fry or grill the chicken and serve.',
    ],
  ),
  r(
    'fried-rice',
    'Nigerian fried rice',
    'Rice stir-fried with carrots, green beans and liver-style seasoning.',
    75,
    LD,
    {
      rice: 0.15,
      carrots: 0.04,
      green_beans: 0.04,
      onions: 0.03,
      veg_oil: 0.04,
      cubes: 0.1,
      curry_thyme: 0.1,
      chicken: 0.2,
    },
    [
      'Parboil rice in chicken stock with curry.',
      'Dice and stir-fry vegetables.',
      'Fry the rice in batches with the vegetables.',
      'Serve with the chicken.',
    ],
  ),
  r(
    'rice-and-stew',
    'White rice and tomato stew',
    'Everyday rice with beef stew.',
    60,
    LD,
    {
      rice: 0.15,
      tomatoes: 0.15,
      tatashe: 0.05,
      rodo: 0.01,
      onions: 0.04,
      veg_oil: 0.05,
      beef: 0.15,
      cubes: 0.1,
    },
    [
      'Boil the beef with onions and seasoning.',
      'Blend and fry the pepper base until the oil rises.',
      'Add beef and stock; simmer.',
      'Boil the rice and serve with stew.',
    ],
  ),
  r(
    'egusi-soup',
    'Egusi soup',
    'Melon seed soup with ugu, assorted meat and stockfish.',
    75,
    LD,
    {
      egusi: 0.07,
      palm_oil: 0.04,
      ugu: 0.06,
      beef: 0.1,
      ponmo: 0.05,
      stockfish: 0.03,
      crayfish: 0.015,
      rodo: 0.01,
      onions: 0.02,
      cubes: 0.1,
    },
    [
      'Boil the meats and stockfish.',
      'Heat palm oil, fry the egusi paste in lumps.',
      'Add stock, crayfish and pepper; simmer.',
      'Add ugu at the end. Serve with a swallow.',
    ],
  ),
  r(
    'efo-riro',
    'Efo riro',
    'Yoruba spinach stew with iru and assorted meat.',
    60,
    LD,
    {
      spinach: 0.12,
      tatashe: 0.05,
      rodo: 0.01,
      onions: 0.03,
      palm_oil: 0.04,
      iru: 0.01,
      beef: 0.1,
      ponmo: 0.05,
      crayfish: 0.01,
      cubes: 0.1,
    },
    [
      'Boil meats; blanch the spinach.',
      'Fry onions and iru in palm oil, add the pepper base.',
      'Add meats, crayfish and spinach; simmer briefly.',
    ],
  ),
  r(
    'okra-soup',
    'Okra soup',
    'Draw soup with okra, fish and meat.',
    45,
    LD,
    {
      okra: 0.1,
      palm_oil: 0.03,
      catfish: 0.12,
      beef: 0.08,
      crayfish: 0.01,
      rodo: 0.01,
      onions: 0.02,
      cubes: 0.1,
    },
    [
      'Boil meat and fish with seasoning.',
      'Add palm oil, pepper and crayfish.',
      'Stir in chopped okra; cook a few minutes.',
    ],
  ),
  r(
    'ogbono-soup',
    'Ogbono soup',
    'Draw soup with ground ogbono and leafy greens.',
    50,
    LD,
    {
      ogbono: 0.04,
      palm_oil: 0.03,
      beef: 0.1,
      stockfish: 0.03,
      crayfish: 0.01,
      ugu: 0.04,
      rodo: 0.01,
      cubes: 0.1,
    },
    [
      'Boil meat and stockfish.',
      'Dissolve ogbono in warm palm oil.',
      'Add stock gradually, stirring; add crayfish and pepper.',
      'Add greens and serve with a swallow.',
    ],
  ),
  r(
    'pepper-soup',
    'Catfish pepper soup',
    'Light, spicy soup for cool evenings.',
    40,
    LD,
    { catfish: 0.25, pepper_soup_spice: 0.15, uziza: 0.01, rodo: 0.01, onions: 0.02, cubes: 0.1 },
    [
      'Clean the catfish with hot water.',
      'Boil water with spice, pepper and onions.',
      'Add fish; simmer gently and finish with uziza leaves.',
    ],
  ),
  r(
    'goat-pepper-soup',
    'Goat meat pepper soup',
    'Classic pepper soup with goat meat.',
    70,
    LD,
    { goat_meat: 0.25, pepper_soup_spice: 0.15, uziza: 0.01, rodo: 0.01, onions: 0.02, cubes: 0.1 },
    [
      'Cut and wash the goat meat.',
      'Boil with onions, spice and pepper until tender.',
      'Add uziza leaves at the end.',
    ],
  ),
  r(
    'moi-moi',
    'Moi moi',
    'Steamed bean pudding with peppers and egg.',
    90,
    ['LUNCH', 'DINNER', 'BREAKFAST'],
    {
      beans: 0.1,
      tatashe: 0.04,
      onions: 0.02,
      veg_oil: 0.03,
      eggs: 0.5,
      crayfish: 0.005,
      cubes: 0.1,
    },
    [
      'Soak and peel the beans.',
      'Blend with peppers and onions; mix in oil and seasoning.',
      'Fill wraps or tins with sliced egg; steam for about an hour.',
    ],
  ),
  r(
    'akara-and-pap',
    'Akara and pap',
    'Bean fritters with hot pap.',
    45,
    ['BREAKFAST'],
    {
      beans: 0.08,
      rodo: 0.005,
      onions: 0.02,
      veg_oil: 0.05,
      ogi: 0.08,
      sugar: 0.02,
      milk: 0.25,
      salt: 0.003,
    },
    [
      'Peel and blend the beans with pepper and onion.',
      'Whisk until fluffy and deep-fry spoonfuls.',
      'Make pap with hot water; add milk and sugar to taste.',
    ],
  ),
  r(
    'beans-and-plantain',
    'Beans porridge with dodo',
    'Ewa with palm oil sauce and fried plantain.',
    80,
    LD,
    {
      beans: 0.12,
      palm_oil: 0.03,
      onions: 0.02,
      rodo: 0.01,
      crayfish: 0.005,
      cubes: 0.1,
      plantain: 1,
      veg_oil: 0.03,
    },
    [
      'Boil beans until soft.',
      'Add palm oil, pepper, onions and crayfish; mash slightly.',
      'Fry sliced plantain and serve together.',
    ],
  ),
  r(
    'yam-porridge',
    'Yam porridge (asaro)',
    'Yam cooked in a palm oil and pepper sauce.',
    45,
    LD,
    {
      yam: 0.3,
      palm_oil: 0.03,
      tatashe: 0.03,
      rodo: 0.01,
      onions: 0.02,
      crayfish: 0.005,
      spinach: 0.03,
      cubes: 0.1,
    },
    [
      'Peel and cube the yam; boil in a little water.',
      'Add blended pepper, palm oil and crayfish.',
      'Mash some pieces to thicken; add greens.',
    ],
  ),
  r(
    'yam-and-egg',
    'Boiled yam and egg sauce',
    'Quick breakfast of yam with tomato egg sauce.',
    30,
    ['BREAKFAST', 'LUNCH'],
    { yam: 0.25, eggs: 2, tomatoes: 0.06, onions: 0.02, rodo: 0.005, veg_oil: 0.02, salt: 0.003 },
    ['Boil peeled yam in salted water.', 'Fry onions, tomatoes and pepper; stir in beaten eggs.'],
  ),
  r(
    'plantain-and-eggs',
    'Dodo and eggs',
    'Fried plantain with scrambled eggs.',
    25,
    ['BREAKFAST'],
    { plantain: 1, eggs: 2, onions: 0.01, tomatoes: 0.03, veg_oil: 0.04, salt: 0.002 },
    ['Slice and fry the plantain.', 'Scramble eggs with onions and tomatoes.'],
  ),
  r(
    'jollof-spaghetti',
    'Jollof spaghetti',
    'Spaghetti cooked in a jollof-style sauce.',
    35,
    LD,
    {
      spaghetti: 0.5,
      tomatoes: 0.08,
      tatashe: 0.03,
      rodo: 0.005,
      onions: 0.02,
      veg_oil: 0.03,
      cubes: 0.1,
      curry_thyme: 0.1,
    },
    [
      'Fry the blended pepper base.',
      'Add water and seasoning, then the spaghetti.',
      'Cook until the sauce is absorbed.',
    ],
  ),
  r(
    'eba-garri',
    'Eba (garri swallow)',
    'Swallow to serve with any soup.',
    10,
    LD,
    { garri: 0.15 },
    ['Pour garri into boiling water and stir firmly until smooth.'],
  ),
  r(
    'semo-swallow',
    'Semo or wheat swallow',
    'Smooth swallow to serve with any soup.',
    15,
    LD,
    { semolina: 0.12 },
    ['Stir semolina into boiling water and turn until smooth and firm.'],
  ),
  r(
    'suya-beef',
    'Beef suya',
    'Spiced grilled beef with onions and tomatoes.',
    40,
    ['DINNER'],
    { beef: 0.2, suya_spice: 0.2, onions: 0.03, tomatoes: 0.03, veg_oil: 0.01 },
    [
      'Slice beef thinly and coat with oil and suya spice.',
      'Grill on skewers until charred at the edges.',
      'Serve with sliced onions and tomatoes.',
    ],
  ),
  r(
    'bread-and-tea',
    'Bread, eggs and tea',
    'Simple breakfast.',
    10,
    ['BREAKFAST'],
    { bread: 0.25, eggs: 1, milk: 0.25, sugar: 0.015 },
    ['Boil or fry the eggs.', 'Make tea or cocoa with milk and sugar.'],
  ),
];
export const recipeByKey = (key: string) => recipes.find((x) => x.key === key);

/** What a recipe contains: known allergens, possible allergens and diet tags. */
export function recipeFacts(recipe: Recipe, ing: Record<string, Ingredient> = ingredients) {
  const allergens = new Set<string>(),
    may = new Set<string>(),
    tags = new Set<string>();
  for (const key of Object.keys(recipe.per_serving)) {
    const x = ing[key];
    if (!x) continue;
    x.allergens?.forEach((a) => allergens.add(a));
    x.may?.forEach((a) => may.add(a));
    x.tags?.forEach((t) => tags.add(t));
  }
  for (const a of allergens) may.delete(a);
  return { allergens: [...allergens], may: [...may], tags: [...tags] };
}

export interface DietProfile {
  allergies: string[];
  intolerances: string[];
  avoid: string[];
  patterns: string[];
}

/**
 * Checks a recipe against a diet profile. EXCLUDED: contains a recorded allergen, an avoided
 * ingredient or a food the diet rules out. WARNING: may contain an allergen, or contains an
 * intolerance. Never claims a recipe is safe: OK only means nothing recorded conflicts.
 */
export function checkRecipe(
  recipe: Recipe,
  profile: DietProfile | null,
  ing: Record<string, Ingredient> = ingredients,
) {
  const facts = recipeFacts(recipe, ing);
  const reasons: string[] = [];
  let status: 'OK' | 'WARNING' | 'EXCLUDED' = 'OK';
  if (!profile) return { status, reasons, ...facts };
  const label = (a: string) => allergenNames[a as Allergen] || a;
  const avoid = profile.avoid.map((a) => a.toLowerCase());
  for (const a of profile.allergies)
    if (facts.allergens.includes(a)) {
      status = 'EXCLUDED';
      reasons.push(`Contains ${label(a)}`);
    }
  for (const key of Object.keys(recipe.per_serving)) {
    const x = ing[key];
    if (!x) continue;
    if (avoid.some((a) => a && (x.name.toLowerCase().includes(a) || key.includes(a)))) {
      status = 'EXCLUDED';
      reasons.push(`Contains ${x.name}, which you avoid`);
    }
  }
  for (const p of profile.patterns)
    for (const tag of dietPatterns[p]?.excludes || [])
      if (facts.tags.includes(tag)) {
        status = 'EXCLUDED';
        reasons.push(`Not ${dietPatterns[p].label.toLowerCase()}: contains ${tag}`);
        break;
      }
  if (status !== 'EXCLUDED') {
    for (const a of profile.allergies)
      if (facts.may.includes(a)) {
        status = 'WARNING';
        reasons.push(`May contain ${label(a)} (check the brand you buy)`);
      }
    for (const a of profile.intolerances)
      if (facts.allergens.includes(a) || facts.may.includes(a)) {
        status = 'WARNING';
        reasons.push(`Contains or may contain ${label(a)} (intolerance)`);
      }
  }
  return { status, reasons: [...new Set(reasons)], ...facts };
}

/** Rounds a shopping quantity up to a sensible step. */
export function shoppingQuantity(
  key: string,
  amount: number,
  ing: Record<string, Ingredient> = ingredients,
) {
  const x = ing[key];
  const step = x.step ?? (['piece', 'pack'].includes(x.unit) ? 1 : 0.5);
  return Math.max(step, Math.ceil(amount / step - 1e-9) * step);
}
