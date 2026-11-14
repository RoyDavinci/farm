export type BookingStatus =
  | 'REQUESTED'
  | 'COUNTERED'
  | 'ACCEPTED'
  | 'READY_FOR_PICKUP'
  | 'COMPLETED'
  | 'DECLINED'
  | 'CANCELLED'
  | 'EXPIRED';
export interface User {
  id: string;
  name: string;
  email: string;
  phone: string;
  admin: boolean;
  email_verified_at?: string | null;
  staff_role?: 'owner' | 'operations' | 'finance' | 'support' | null;
}
export interface Seller {
  user_id: string;
  business_name: string;
  business_type: 'farm' | 'shop' | 'market_stall' | 'home_based';
  area: string;
  city: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'SUSPENDED';
  reason: string | null;
  address?: string;
}
export interface ProductVariant {
  id: string;
  listing_id: string;
  name: string;
  unit: string;
  price_kobo: number;
  stock: number;
  min_quantity: number;
  active: boolean;
  is_primary: boolean;
  wholesale_tiers: { min_quantity: number; price_kobo: number }[];
}
export interface Listing {
  id: string;
  seller_id: string;
  title: string;
  description: string;
  category: string;
  unit: string;
  price_kobo: number;
  stock: number;
  status: 'ACTIVE' | 'PAUSED';
  image_url: string | null;
  image_urls?: string[];
  thumbnail_url?: string | null;
  variants?: ProductVariant[];
  public_latitude?: number | null;
  public_longitude?: number | null;
  distance_km?: number | null;
  search_price?: number;
  market_id?: string | null;
  business_name: string;
  city: string;
  area: string;
  business_type: Seller['business_type'];
  in_stock?: boolean;
  stock_alert?: boolean;
  available_from?: string | null;
  preorder_capacity?: number;
  sponsored?: boolean;
}
export interface Booking {
  id: string;
  buyer_id: string;
  seller_id: string;
  listing_id: string;
  title: string;
  unit: string;
  quantity: number;
  price_kobo: number;
  total_kobo: number;
  commission_kobo: number;
  commission_bps: number;
  status: BookingStatus;
  paid: boolean;
  reserved_until: string | null;
  created_at: string;
  business_name: string;
  buyer_name: string;
  pickup_address?: string;
  pickup_code?: string;
  variant_id?: string;
  variant_name?: string;
  offer_version?: number;
  payment_recorded?: boolean;
  offer_quantity?: number;
  offer_price_kobo?: number;
  offer_note?: string;
  offer_expires_at?: string;
  dispute_status?: string | null;
  pickup_latitude?: number | null;
  pickup_longitude?: number | null;
  preorder?: boolean;
}
export interface OrderEvent {
  id: string;
  from_status: string | null;
  to_status: string;
  actor_id: string | null;
  reason: string;
  created_at: string;
}
export interface Settings {
  reservation_hours: number;
  commission_bps: number;
  payout_min_kobo?: number;
  payout_fee_kobo?: number;
  promotion_daily_kobo?: number;
  stock_confirmation: string;
  payment_mode: 'demo' | 'provider' | 'disabled';
  providers: string[];
}
export const money = (kobo: number) =>
  `₦${(kobo / 100).toLocaleString('en-NG', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
export const statusLabel = (status: string) => status.toLowerCase().replaceAll('_', ' ');

/**
 * API contract types generated from apps/api/openapi.json (`npm run api:contract`).
 * Example: `paths['/v1/bookings/{id}']['get']` or `operations['wallet.startFunding']`.
 */
export type { components, operations, paths } from './api-types';
