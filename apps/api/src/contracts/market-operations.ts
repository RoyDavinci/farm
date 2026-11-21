import { z } from 'zod';
import {
  sellerDetailsInput,
  driverDetailsInput,
  waypointInput,
  pathInput,
} from '../services/market-profiles.service.js';
import { categoryInput } from '../services/catalogue-policy.service.js';
const ok = z.object({ ok: z.boolean() }),
  badges = z.record(z.string(), z.boolean()),
  row = z.record(z.string(), z.any());
export const marketOperationsResponses: Record<string, z.ZodType> = {
  'market-operations.adminCategories': z.array(categoryInput.extend({ updated_at: z.string() })),
  'market-operations.categories': z.array(categoryInput.extend({ updated_at: z.string() })),
  'market-operations.saveCategory': ok,
  'market-operations.savePolicies': ok,
  'market-operations.approveStockPolicy': ok,
  'market-operations.archive': ok,
  'market-operations.confirmStock': ok,
  'market-operations.saveSellerDetails': ok.extend({ requires_review: z.boolean() }),
  'market-operations.saveDriverDetails': ok,
  'market-operations.policies': z.object({
    id: z.number(),
    draft: row,
    approved: row,
    updated_at: z.string(),
  }),
  'market-operations.sellerDetails': z.object({ details: sellerDetailsInput.partial(), badges }),
  'market-operations.driverDetails': z.object({ details: driverDetailsInput.partial(), badges }),
  'market-operations.publicProfile': z.object({
    business_name: z.string(),
    business_type: z.string(),
    city: z.string(),
    area: z.string(),
    state: z.string(),
    lga: z.string(),
    description: z.string().nullable(),
    categories: z.array(z.string()).nullable(),
    badges,
  }),
  'market-operations.marketMap': z.object({
    market: row,
    waypoints: z.array(waypointInput.extend({ id: z.string(), updated_at: z.string() })),
    paths: z.array(pathInput.extend({ id: z.string() })),
  }),
  'market-operations.mapping': z.object({
    markets: z.array(row),
    waypoints: z.array(waypointInput.extend({ id: z.string(), updated_at: z.string() })),
    paths: z.array(pathInput.extend({ id: z.string() })),
  }),
  'market-operations.saveWaypoint': z.object({ id: z.string() }),
  'market-operations.savePath': ok,
  'market-operations.bookingMap': z.object({
    market: row,
    waypoints: z.array(waypointInput.extend({ id: z.string(), updated_at: z.string() })),
    paths: z.array(pathInput.extend({ id: z.string() })),
    pickup_address: z.string().nullable(),
  }),
  'market-operations.bookingRoute': z.object({
    metres: z.number(),
    steps: z.array(z.object({ from: row, to: row, metres: z.number(), instructions: z.string() })),
    pickup_address: z.string().nullable(),
    notice: z.string(),
  }),
};
