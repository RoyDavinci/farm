import { z } from 'zod';
import { variantSchema } from '../services/catalog.service.js';

export const sellerSchema = z.object({
  business_name: z.string().trim().min(2).max(100),
  business_type: z.enum(['farm', 'shop', 'market_stall', 'home_based']),
  city: z.string().trim().min(2).max(100),
  area: z.string().trim().min(2).max(100),
  address: z.string().trim().min(8).max(500),
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
  market_id: z.uuid().nullable().optional(),
});

export const listingSchema = z.object({
  title: z.string().trim().min(3).max(120),
  description: z.string().trim().min(5).max(2000),
  category: z.enum(['Vegetables', 'Fruit', 'Grains', 'Tubers', 'Livestock', 'Other']),
  unit: z.enum(['kg', 'crate', 'bag', 'basket', 'piece', 'carton']),
  price_kobo: z.number().int().min(100).max(100000000),
  stock: z.number().int().min(0).max(100000),
  status: z.enum(['ACTIVE', 'PAUSED']).default('ACTIVE'),
  image_url: z.url().max(2000).nullable().optional(),
  image_urls: z.array(z.url().max(2000)).max(6).optional(),
  variants: z.array(variantSchema).min(1).max(20).optional(),
  // Pre-orders: buyers may book up to preorder_capacity units before the harvest date.
  available_from: z.iso.datetime({ offset: true }).nullable().optional(),
  preorder_capacity: z.number().int().min(0).max(100000).optional(),
});
