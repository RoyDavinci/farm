import { z } from 'zod';

/**
 * A plan's wizard answers. Kept apart from the services: planner and planner-wizard import each
 * other, and a schema read while modules load fails when the worker loads planner-wizard first.
 */
export const wizardAnswers = z.record(
  z.string().max(40),
  z.union([z.number().min(0).max(5000), z.string().max(40), z.array(z.string().max(120)).max(200)]),
);
