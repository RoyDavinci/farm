import { z } from 'zod';
import { sellerTypes } from '../config/marketplace.js';
export const searchInput = z.object({
  q: z.string().max(100).default(''),
  city: z.string().max(100).default(''),
  area: z.string().max(100).default(''),
  market_id: z.uuid().optional(),
  category: z.string().max(50).default(''),
  seller_type: z.enum(sellerTypes).optional(),
  lat: z.coerce.number().min(-90).max(90).optional(),
  lng: z.coerce.number().min(-180).max(180).optional(),
  radius_km: z.coerce.number().min(1).max(500).default(25),
  min_price: z.coerce.number().int().min(0).optional(),
  max_price: z.coerce.number().int().min(0).optional(),
  min_rating: z.coerce.number().min(0).max(5).default(0),
  delivery_available: z.enum(['true', 'false']).optional(),
  availability: z.enum(['in_stock', 'preorder']).optional(),
  wholesale: z.enum(['true', 'false']).default('false'),
  sort: z.enum(['recent', 'distance', 'price_asc', 'price_desc', 'rating']).default('recent'),
  cursor: z.string().max(100).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
export type SearchInput = z.infer<typeof searchInput>;
