// Domain types come from the API contract (apps/api/src/contracts/responses.ts → openapi.json →
// api-types.ts). Regenerate with `npm run api:contract` after changing the API.
import type { components } from './api-types';
type Schemas = components['schemas'];

export type User = Schemas['User'];
export type Seller = Schemas['Seller'];
export type Me = Schemas['Me'];
export type Settings = Schemas['Settings'];
export type ProductVariant = Schemas['ProductVariant'];
export type Listing = Schemas['Listing'];
export type BookingStatus = Schemas['BookingStatus'];
export type Booking = Schemas['Booking'];
export type OrderEvent = Schemas['OrderEvent'];
export type FundingStatus = Schemas['FundingStatus'];
export type Funding = Schemas['Funding'];
export type FundingCheckout = Schemas['FundingCheckout'];
export type Wallet = Schemas['Wallet'];
export type SearchResult = Schemas['SearchResult'];
export type PayoutSummary = Schemas['PayoutSummary'];
export type Delivery = Schemas['Delivery'];
export type NearbyRider = Schemas['NearbyRider'];
export type LocalStatus = Schemas['LocalStatus'];
export type ShoppingRequest = Schemas['ShoppingRequest'];
export type ShoppingDetail = Schemas['ShoppingDetail'];
export type ApiError = Schemas['Error'];

export const money = (kobo: number) =>
  `₦${(kobo / 100).toLocaleString('en-NG', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
export const statusLabel = (status: string) => status.toLowerCase().replaceAll('_', ' ');

/**
 * API contract types generated from apps/api/openapi.json (`npm run api:contract`).
 * Example: `paths['/v1/bookings/{id}']['get']` or `operations['wallet.startFunding']`.
 */
export type { components, operations, paths } from './api-types';
export { createRequest, type ApiPath, type Send } from './request';
