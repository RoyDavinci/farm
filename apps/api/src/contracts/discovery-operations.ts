import { z } from 'zod';
import { discoveryPreferenceInput } from '../services/discovery-operations.service.js';
const ok = z.object({ ok: z.boolean() }),
  counts = z.record(z.string(), z.number());
export const discoveryOperationsResponses: Record<string, z.ZodType> = {
  'discovery-operations.preferences': discoveryPreferenceInput,
  'discovery-operations.savePreferences': ok,
  'discovery-operations.interests': z.array(
    z.object({
      id: z.string(),
      buyer_id: z.string(),
      listing_id: z.string(),
      quantity: z.number(),
      status: z.enum(['WAITING', 'AVAILABLE', 'CONFIRMED', 'CANCELLED']),
      booking_id: z.string().nullable(),
      created_at: z.string(),
      notified_at: z.string().nullable(),
      title: z.string(),
      price_kobo: z.number(),
      available_from: z.string().nullable(),
      preorder_advance_allowed: z.boolean(),
    }),
  ),
  'discovery-operations.registerInterest': ok,
  'discovery-operations.confirmInterest': z.object({ id: z.string() }),
  'discovery-operations.cancelInterest': ok,
  'discovery-operations.advancePreference': ok,
  'discovery-operations.metrics': z.object({
    window_days: z.number(),
    funnel: counts,
    orders: counts,
    network: counts,
    supply: counts,
    status: counts,
    notes: z.array(z.string()),
  }),
};
