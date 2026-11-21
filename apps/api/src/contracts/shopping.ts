import { z } from 'zod';
export const NearbyRider = z
  .object({
    id: z.string(),
    name: z.string(),
    vehicle_type: z.string(),
    vehicle_name: z.string(),
    city: z.string(),
    distance_km: z.number(),
    completed_jobs: z.number(),
    badges: z.record(z.string(), z.boolean()),
    rating_avg: z.number().nullable(),
    verified: z.boolean(),
  })
  .meta({ id: 'NearbyRider' });
export const ShoppingRequest = z
  .looseObject({
    id: z.string(),
    buyer_id: z.string(),
    rider_id: z.string(),
    status: z.enum(['REQUESTED', 'ACCEPTED', 'SHOPPING', 'PURCHASED', 'DELIVERED', 'CANCELLED']),
    items: z.string(),
    source_name: z.string(),
    source_address: z.string(),
    dropoff_address: z.string(),
    goods_budget_kobo: z.number(),
    delivery_fee_kobo: z.number(),
    payment_mode: z.enum(['REIMBURSE', 'ADVANCE']),
    commission_bps: z.number(),
    quote_version: z.number(),
    actual_goods_kobo: z.number().nullable(),
    reimbursement_kobo: z.number().nullable(),
    receipt_note: z.string().nullable(),
    review_open: z.boolean(),
    review_note: z.string().nullable(),
    delivery_pin: z.string().optional(),
    buyer_name: z.string().optional(),
    rider_name: z.string().optional(),
    vehicle_name: z.string().optional(),
    created_at: z.string(),
    updated_at: z.string(),
  })
  .meta({ id: 'ShoppingRequest' });
const Message = z.object({
  id: z.string(),
  sender_id: z.string(),
  sender_name: z.string().optional(),
  body: z.string(),
  created_at: z.string(),
});
export const ShoppingDetail = ShoppingRequest.extend({
  receipt_photos: z.array(z.object({ id: z.string(), url: z.string(), created_at: z.string() })),
  tracking: z
    .object({ latitude: z.number(), longitude: z.number(), updated_at: z.string() })
    .nullable(),
  advance_available_kobo: z.number(),
  advance_payouts: z.array(
    z.looseObject({
      id: z.string(),
      amount_kobo: z.number(),
      fee_kobo: z.number(),
      status: z.string(),
      failure_reason: z.string().nullable(),
      recovery_error: z.string().nullable(),
    }),
  ),
  messages: z.array(Message),
}).meta({ id: 'ShoppingDetail' });
export const shoppingResponses: Record<string, z.ZodType> = {
  'shopping.uploadReceipt': z.object({ id: z.string() }),
  'shopping.location': z.object({ updated_at: z.string() }),
  'shopping.nearbyRiders': z.array(NearbyRider),
  'shopping.quote': z.object({
    delivery_fee_kobo: z.number(),
    distance_km: z.number(),
    vehicle_name: z.string(),
    rider_name: z.string(),
  }),
  'shopping.create': ShoppingRequest,
  'shopping.mine': z.array(ShoppingRequest),
  'shopping.detail': ShoppingDetail,
  'shopping.message': Message,
  'shopping.act': ShoppingRequest,
  'shopping.advancePayout': z.looseObject({ id: z.string(), status: z.string() }),
  'shopping.adminList': z.array(ShoppingRequest),
  'shopping.review': ShoppingRequest,
};
