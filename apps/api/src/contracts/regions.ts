import { z } from 'zod';
import { regionInput } from '../services/regions.service.js';
export const regionResponses: Record<string, z.ZodType> = {
  'regions.listRegions': z.array(regionInput.extend({ updated_at: z.string() })),
  'regions.activeRegions': z.array(regionInput.omit({ enabled: true, notes: true })),
  'regions.saveRegion': z.object({ ok: z.boolean() }),
};
