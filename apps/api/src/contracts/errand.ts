import { z } from 'zod';

/** "Buy it and bring it". */
export const errandResponses: Record<string, z.ZodType> = {
  'errand.errandIdeas': z.array(
    z.object({ key: z.string(), name: z.string(), prompt: z.string() }),
  ),
  'errand.planErrand': z.object({
    text: z.string(),
    servings: z.number().int(),
    recipes: z.array(z.object({ key: z.string(), name: z.string() })),
    items: z.array(
      z.object({
        key: z.string(),
        name: z.string(),
        from: z.string(),
        needed_quantity: z.number(),
        needed_unit: z.string(),
        listing: z
          .object({
            id: z.string(),
            title: z.string(),
            unit: z.string(),
            price_kobo: z.number().int(),
            image_url: z.string().nullable(),
            seller_id: z.string(),
            business_name: z.string(),
          })
          .nullable(),
        quantity: z.number().int(),
        line_kobo: z.number().int(),
        alternatives: z.number().int(),
        unit_differs: z.boolean(),
        oversized: z.boolean(),
        extra_trip_kobo: z.number().int().nullable(),
      }),
    ),
    sellers: z.array(
      z.object({
        seller_id: z.string(),
        business_name: z.string(),
        area: z.string(),
        verified: z.boolean(),
        rating: z.number().nullable(),
        distance_km: z.number(),
        subtotal_kobo: z.number().int(),
        delivery_kobo: z.number().int(),
      }),
    ),
    missing: z.array(z.string()),
    goods_kobo: z.number().int(),
    delivery_kobo: z.number().int(),
    total_kobo: z.number().int(),
  }),
  'errand.placeErrand': z.object({
    errand_id: z.string(),
    deliver_at: z.string(),
    orders: z.array(
      z.object({
        booking_id: z.string(),
        seller_id: z.string(),
        items: z.number().int(),
        total_kobo: z.number().int(),
      }),
    ),
  }),
};
