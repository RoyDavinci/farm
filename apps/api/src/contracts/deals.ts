import { z } from 'zod';

const ok = z.object({ ok: z.literal(true) });
const suggestion = z.object({
  seller_id: z.string(),
  business_name: z.string(),
  area: z.string(),
  city: z.string(),
  verified: z.boolean(),
  rating: z.number().nullable(),
  reviews: z.number().int(),
  fulfilment_pct: z.number().int().nullable(),
  sales: z.number().int(),
  distance_km: z.number().nullable(),
  examples: z.array(z.string()),
  reason: z.string(),
});

/** Sales, price watches and buyer requests. */
export const dealsResponses: Record<string, z.ZodType> = {
  'deals.setSale': z.looseObject({
    id: z.string(),
    price_kobo: z.number().int(),
    was_price_kobo: z.number().int().nullable(),
    sale_until: z.string().nullable(),
  }),
  'deals.listWatches': z.array(
    z.object({
      id: z.string(),
      label: z.string(),
      kind: z.enum(['LISTING', 'PRODUCT', 'SEARCH']),
      listing_id: z.string().nullable(),
      catalogue_product_id: z.string().nullable(),
      query: z.string().nullable(),
      watched_price_kobo: z.number().int().nullable(),
      lowest: z
        .object({
          listing_id: z.string(),
          title: z.string(),
          business_name: z.string(),
          price_kobo: z.number().int(),
          on_sale: z.boolean(),
        })
        .nullable(),
      created_at: z.string(),
    }),
  ),
  'deals.watchPrice': z.object({
    id: z.string(),
    label: z.string(),
    watched_price_kobo: z.number().int().nullable(),
  }),
  'deals.unwatchPrice': ok,
  'deals.suggest': z.object({ category: z.string().nullable(), sellers: z.array(suggestion) }),
  'deals.createRequest': z.object({
    id: z.string(),
    text: z.string(),
    category: z.string().nullable(),
    sellers: z.array(suggestion),
  }),
  'deals.myRequests': z.array(
    z.looseObject({
      id: z.string(),
      text: z.string(),
      status: z.enum(['OPEN', 'CLOSED']),
      sellers_alerted: z.number().int(),
      offers: z.array(
        z.looseObject({
          id: z.string(),
          listing_id: z.string(),
          title: z.string(),
          price_kobo: z.number().int(),
          business_name: z.string(),
        }),
      ),
    }),
  ),
  'deals.sellerRequests': z.array(
    z.looseObject({ id: z.string(), text: z.string(), offered_listing_id: z.string().nullable() }),
  ),
  'deals.offer': z.object({ id: z.string() }),
  'deals.closeRequest': ok,
};
