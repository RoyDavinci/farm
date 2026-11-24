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
const offerCard = z.looseObject({
  id: z.string(),
  title: z.string(),
  price_kobo: z.number().int(),
  off_pct: z.number().int(),
  business_name: z.string(),
  verified: z.boolean(),
});
const group = z.looseObject({
  id: z.string(),
  listing_id: z.string(),
  title: z.string(),
  quantity: z.number().int(),
  shares: z.number().int(),
  taken: z.number().int(),
  spots_left: z.number().int(),
  full_price_kobo: z.number().int(),
  share_price_kobo: z.number().int(),
  discount_pct: z.number(),
  status: z.enum(['OPEN', 'ORDERED', 'DONE', 'CANCELLED', 'EXPIRED']),
  members: z.array(z.object({ name: z.string(), shares: z.number().int(), you: z.boolean() })),
  joined: z.boolean(),
  is_creator: z.boolean(),
  pickup_code: z.string().nullable(),
});

export const dealsResponses: Record<string, z.ZodType> = {
  'deals.offers': z.object({
    today: z.array(offerCard),
    week: z.array(offerCard),
    fresh: z.array(offerCard),
    wholesale: z.array(offerCard),
  }),
  'deals.listGroups': z.object({ open: z.array(group), mine: z.array(group) }),
  'deals.getGroup': group,
  'deals.startGroup': group,
  'deals.joinGroup': group,
  'deals.leaveGroup': ok,
  'deals.inviteToGroup': ok,
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
    z.looseObject({
      id: z.string(),
      text: z.string(),
      quantity: z.number().nullable(),
      unit: z.string().nullable(),
      budget_kobo: z.number().int().nullable(),
      needed_by: z.string().nullable(),
      area: z.string().nullable(),
      distance_km: z.number().nullable(),
      offered_listing_id: z.string().nullable(),
    }),
  ),
  'deals.offer': z.object({ id: z.string() }),
  'deals.closeRequest': ok,
};
