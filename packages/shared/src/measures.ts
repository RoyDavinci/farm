/**
 * Market measures: turns "0.14 kg egusi" into what people actually ask for at a Nigerian market
 * (derica, mudu, paint rubber, heaps, bunches, bottles). Sizes are typical, not exact, so the
 * metric amount is always shown alongside.
 */
export interface MarketMeasure {
  /** What to ask the seller for, e.g. "2 mudu" or "1 heap". */
  label: string;
  /** The metric amount it stands for, e.g. "≈ 3 kg"; empty when the unit is already countable. */
  note: string;
}

interface Rule {
  match: RegExp;
  /** Units this rule converts from. */
  from: string[];
  /** Measures from largest to smallest, in the source unit (kg or litre). */
  steps: { name: string; plural?: string; size: number }[];
}

const GRAIN = [
  { name: 'bag (50 kg)', plural: 'bags (50 kg)', size: 50 },
  { name: 'paint rubber', plural: 'paint rubbers', size: 4 },
  { name: 'mudu', plural: 'mudu', size: 1.6 },
  { name: 'derica', plural: 'derica', size: 0.4 },
];
const POWDER = [
  { name: 'paint rubber', plural: 'paint rubbers', size: 2.5 },
  { name: 'derica', plural: 'derica', size: 0.25 },
  { name: 'milk cup', plural: 'milk cups', size: 0.06 },
];
const rules: Rule[] = [
  { match: /\b(rice|beans|garri|gari|maize|corn|millet|oloyin)\b/i, from: ['kg'], steps: GRAIN },
  { match: /\b(egusi|ogbono|crayfish|iru|locust)\b/i, from: ['kg'], steps: POWDER },
  {
    match: /\b(tomato|tomatoes)\b/i,
    from: ['kg'],
    steps: [
      { name: 'basket', plural: 'baskets', size: 25 },
      { name: 'paint rubber', plural: 'paint rubbers', size: 4 },
      { name: 'heap', plural: 'heaps', size: 0.5 },
    ],
  },
  {
    match: /\b(pepper|rodo|tatashe|scotch|shombo)\b/i,
    from: ['kg'],
    steps: [
      { name: 'paint rubber', plural: 'paint rubbers', size: 3 },
      { name: 'heap', plural: 'heaps', size: 0.25 },
    ],
  },
  {
    match: /\bonions?\b/i,
    from: ['kg'],
    steps: [
      { name: 'paint rubber', plural: 'paint rubbers', size: 4 },
      { name: 'onion', plural: 'onions', size: 0.15 },
    ],
  },
  {
    match: /\b(ugu|efo|spinach|uziza|scent|leaves|bitterleaf)\b/i,
    from: ['kg'],
    steps: [{ name: 'bunch', plural: 'bunches', size: 0.25 }],
  },
  {
    match: /\b(okra|okro)\b/i,
    from: ['kg'],
    steps: [
      { name: 'paint rubber', plural: 'paint rubbers', size: 3 },
      { name: 'heap', plural: 'heaps', size: 0.3 },
    ],
  },
  {
    match: /\b(oil)\b/i,
    from: ['litre', 'liter', 'l'],
    steps: [
      { name: 'jerrycan (25 L)', plural: 'jerrycans (25 L)', size: 25 },
      { name: 'gallon (5 L)', plural: 'gallons (5 L)', size: 5 },
      { name: 'bottle (75 cl)', plural: 'bottles (75 cl)', size: 0.75 },
    ],
  },
  {
    match: /\b(salt|sugar)\b/i,
    from: ['kg'],
    steps: [
      { name: 'bag (1 kg)', plural: 'bags (1 kg)', size: 1 },
      { name: 'sachet (250 g)', plural: 'sachets (250 g)', size: 0.25 },
    ],
  },
];

const fmtNum = (n: number) => (Number.isInteger(n) ? String(n) : String(+n.toFixed(2)));
const fractions: [number, string][] = [
  [0.25, '¼'],
  [0.5, '½'],
  [0.75, '¾'],
];

/** A count in quarters, e.g. 1¾ or ½. */
function quarters(n: number) {
  const q = Math.max(0.25, Math.round(n * 4) / 4);
  const whole = Math.floor(q);
  const frac = fractions.find(([f]) => Math.abs(q - whole - f) < 0.01)?.[1] ?? '';
  return `${whole || ''}${frac}` || '0';
}

/**
 * The market measure for a quantity of an item. Falls back to the metric amount when no measure
 * fits, e.g. meat stays in kg because it's weighed.
 */
export function marketMeasure(name: string, quantity: number, unit: string): MarketMeasure {
  const u = unit.toLowerCase().trim();
  const metric = `${fmtNum(quantity)} ${unit}`;
  const rule = rules.find((r) => r.match.test(name) && r.from.includes(u));
  if (!rule || !(quantity > 0)) return { label: metric, note: '' };
  // The largest measure that gives at least one; the smallest otherwise.
  const step = rule.steps.find((s) => quantity / s.size >= 1) ?? rule.steps[rule.steps.length - 1];
  const count = quantity / step.size;
  // Seasoning-sized amounts: too small to buy by any measure.
  if (count < 0.2) return { label: 'a little', note: `≈ ${metric}` };
  const shown = count >= 3 ? String(Math.round(count)) : quarters(count);
  const one = shown === '1' || /^[¼½¾]$/.test(shown);
  return {
    label: `${shown} ${one ? step.name : (step.plural ?? `${step.name}s`)}`,
    note: `≈ ${metric}`,
  };
}
