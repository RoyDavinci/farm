import { z } from 'zod';

const ok = z.object({ ok: z.literal(true) });
const product = z.looseObject({
  id: z.string(),
  name: z.string(),
  brand: z.string(),
  category: z.string(),
  unit: z.string(),
});

/** Shared catalogue and quick stock/price tools. */
export const catalogueResponses: Record<string, z.ZodType> = {
  'catalogue.searchCatalogue': z.array(
    product.extend({
      photos: z.number().int(),
      photo: z.string().nullable(),
      sellers: z.number().int(),
      min_price_kobo: z.number().int().nullable(),
      max_price_kobo: z.number().int().nullable(),
      listed: z.boolean(),
    }),
  ),
  'catalogue.addProduct': product,
  'catalogue.adminAddProduct': product,
  'catalogue.addFromCatalogue': z.object({
    created: z.number().int(),
    ids: z.array(z.string()),
    skipped: z.array(z.string()),
  }),
  'catalogue.updatePrices': z.object({ updated: z.number().int() }),
  'catalogue.setOutToday': z.object({ id: z.string(), out_until: z.string().nullable() }),
  'catalogue.setStockMode': z.object({
    id: z.string(),
    stock_mode: z.enum(['ALWAYS', 'COUNTED']),
    stock: z.number().int(),
  }),
  'catalogue.adminCatalogue': z.array(
    product.extend({
      active: z.boolean(),
      listings: z.number().int(),
      photos: z.array(
        z.object({ id: z.string(), url: z.string(), source: z.string(), uses: z.number().int() }),
      ),
    }),
  ),
  'catalogue.addStaffPhoto': z.object({ id: z.string(), filled: z.number().int() }),
  'catalogue.removePhoto': ok,
  'catalogue.setProductActive': ok,
  'catalogue.bareListings': z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      category: z.string(),
      unit: z.string(),
      created_at: z.string(),
      business_name: z.string(),
      area: z.string().nullable(),
      suggestions: z.array(
        z.object({
          id: z.string(),
          url: z.string(),
          thumbnail_url: z.string(),
          product: z.string(),
          hits: z.number().int(),
        }),
      ),
    }),
  ),
  'catalogue.setListingPhoto': ok,
  'catalogue.fillBareListings': z.object({ filled: z.number().int(), left: z.number().int() }),
};
