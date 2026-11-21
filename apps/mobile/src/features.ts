import type { Settings } from '@zuru/shared';

export type FeatureName = keyof NonNullable<Settings['features']>;

/** Whether a feature is switched on for this deployment. Older servers have every feature on. */
export function featureOn(settings: Settings | null | undefined, name: FeatureName) {
  return settings?.features?.[name] ?? true;
}
