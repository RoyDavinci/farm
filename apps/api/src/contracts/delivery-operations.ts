import { z } from 'zod';
import { tariffInput } from '../services/delivery-operations.service.js';
const ok = z.object({ ok: z.boolean() }),
  rating = z.object({
    punctuality: z.number(),
    care: z.number(),
    professionalism: z.number(),
    comment: z.string(),
  });
export const deliveryOperationsResponses: Record<string, z.ZodType> = {
  'delivery-operations.backgroundConsent': ok,
  'delivery-operations.backgroundLocation': ok,
  'delivery-operations.timeline': z.object({
    inspection_minutes: z.number(),
    inspection_deadline: z.string().nullable(),
    inspection_policy_state: z.literal('DRAFT'),
    stage: z.string(),
    scheduled_at: z.string().nullable(),
    inspection_started_at: z.string().nullable(),
    inspection_accepted_at: z.string().nullable(),
    milestones: z.array(z.object({ stage: z.string(), created_at: z.string() })),
    rating: rating.nullable(),
  }),
  'delivery-operations.milestone': ok,
  'delivery-operations.schedule': ok,
  'delivery-operations.retry': ok,
  'delivery-operations.inspection': ok,
  'delivery-operations.rateDriver': ok,
  'delivery-operations.incident': z.object({ id: z.string() }),
  'delivery-operations.tariffs': z.array(tariffInput.extend({ id: z.string() })),
  'delivery-operations.saveTariff': ok,
  'delivery-operations.incidents': z.array(
    z.object({
      id: z.string(),
      delivery_id: z.string(),
      reporter_id: z.string(),
      kind: z.string(),
      description: z.string(),
      status: z.string(),
      resolution: z.string().nullable(),
      created_at: z.string(),
      title: z.string(),
    }),
  ),
  'delivery-operations.resolveIncident': ok,
};
