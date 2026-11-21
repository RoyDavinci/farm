/**
 * Feature switches. PILOT_MODE launches the brief's first release: the core marketplace and
 * booking loop plus delivery, with every later-phase or regulatory-gated feature off. Each
 * switch can still be set on its own with FEATURE_<NAME>=true|false, which wins over the preset.
 */
export const featureNames = [
  // Stored-value wallet: open top-ups and a visible balance. Off = pay each purchase directly.
  'wallet',
  'local_status',
  'promotions',
  'shopping',
  'parcels',
  'voice',
  'preorders',
  'market_maps',
] as const;
export type FeatureName = (typeof featureNames)[number];
export type Features = Record<FeatureName, boolean>;

export function readFeatures(env: Record<string, string | undefined>): Features {
  const pilot = ['true', '1'].includes(String(env.PILOT_MODE ?? '').toLowerCase());
  const features = {} as Features;
  for (const name of featureNames) {
    const raw = String(env[`FEATURE_${name.toUpperCase()}`] ?? '').toLowerCase();
    features[name] = raw === '' ? !pilot : raw === 'true' || raw === '1';
  }
  return features;
}

/** API paths owned by each switchable feature (admin paths are under /admin). */
export const featurePaths: Record<FeatureName, RegExp[]> = {
  wallet: [/^\/wallet\/fund$/],
  local_status: [/^\/(admin\/)?local-status(\/|$)/, /^\/(admin\/)?status-boosts(\/|$)/],
  promotions: [
    /^\/listings\/[^/]+\/promote$/,
    /^\/sellers\/me\/promotions$/,
    /^\/admin\/promotions(\/|$)/,
  ],
  shopping: [/^\/(admin\/)?shopping(\/|$)/],
  parcels: [/^\/(admin\/)?parcels(\/|$)/],
  voice: [/^\/voice\//, /^\/conversations\/[^/]+\/call$/],
  preorders: [
    /^\/(admin\/)?preorder-interests(\/|$)/,
    /^\/listings\/[^/]+\/(interest|advance-preference)$/,
  ],
  market_maps: [/^\/markets\//, /^\/bookings\/[^/]+\/market-(map|route)$/, /^\/admin\/markets\//],
};

/** Which disabled feature (if any) owns this /v1-relative path. */
export function disabledFeatureFor(features: Features, path: string): FeatureName | null {
  for (const name of featureNames)
    if (!features[name] && featurePaths[name].some((re) => re.test(path))) return name;
  return null;
}
