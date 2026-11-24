import { featureNames, type FeatureName } from '../config/features.js';
import { z } from 'zod';
import { sellerTypes, productConditions } from '../config/marketplace.js';

/**
 * Response shapes published in openapi.json (components.schemas) and used to generate the shared
 * client types. Objects are "loose": they list the fields clients rely on and allow extra ones.
 * Tests parse real responses with these schemas, so they cannot silently drift from the API.
 * Timestamps are ISO strings; money is integer kobo.
 */
const timestamp = z.string();
const kobo = z.number().int();

export const User = z
  .looseObject({
    id: z.string(),
    name: z.string(),
    email: z.string().nullable(),
    phone: z.string(),
    admin: z.boolean(),
    email_verified_at: timestamp.nullish(),
    staff_role: z.enum(['owner', 'operations', 'finance', 'support']).nullish(),
  })
  .meta({ id: 'User' });

export const Seller = z
  .looseObject({
    user_id: z.string(),
    business_name: z.string(),
    state: z.string().optional(),
    lga: z.string().optional(),
    business_type: z.enum(sellerTypes),
    city: z.string(),
    area: z.string(),
    status: z.enum(['PENDING', 'APPROVED', 'REJECTED', 'SUSPENDED']),
    reason: z.string().nullable(),
    address: z.string().optional(),
    latitude: z.number().nullish(),
    longitude: z.number().nullish(),
    market_id: z.string().nullish(),
  })
  .meta({ id: 'Seller' });

export const Me = z
  .looseObject({
    user: User,
    seller: Seller.nullable(),
    transaction_pin_set: z.boolean().optional(),
    staff_areas: z.array(z.string()).optional(),
  })
  .meta({ id: 'Me' });

export const Settings = z
  .looseObject({
    reservation_hours: z.number().int(),
    commission_bps: z.number().int(),
    payout_min_kobo: kobo.optional(),
    payout_fee_kobo: kobo.optional(),
    promotion_daily_kobo: kobo.optional(),
    status_boost_hourly_kobo: z.number(),
    status_lifetime_hours: z.number(),
    status_radius_km: z.number(),
    status_max_active: z.number(),
    delivery_commission_bps: z.number().int().optional(),
    delivery_radius_km: z.number().optional(),
    pay_on_delivery_enabled: z.boolean().optional(),
    stock_confirmation: z.string(),
    payment_mode: z.enum(['demo', 'provider', 'disabled']),
    /** Feature switches for this deployment (PILOT_MODE turns later-phase features off). */
    features: z.object(
      Object.fromEntries(featureNames.map((n) => [n, z.boolean()])) as Record<
        FeatureName,
        z.ZodBoolean
      >,
    ),
    providers: z.array(z.string()),
    catalog: z.object({
      categories: z.array(z.string()),
      seller_types: z.array(z.string()),
      units: z.array(z.string()),
      conditions: z.array(z.string()),
    }),
  })
  .meta({ id: 'Settings' });

export const ProductVariant = z
  .looseObject({
    id: z.string(),
    listing_id: z.string(),
    name: z.string(),
    unit: z.string(),
    price_kobo: kobo,
    stock: z.number().int(),
    min_quantity: z.number().int(),
    active: z.boolean(),
    is_primary: z.boolean(),
    wholesale_tiers: z.array(z.object({ min_quantity: z.number().int(), price_kobo: kobo })),
  })
  .meta({ id: 'ProductVariant' });

export const Listing = z
  .looseObject({
    pickup_available: z.boolean(),
    delivery_available: z.boolean(),
    confirmed_at: z.string(),
    archived_at: z.string().nullable(),
    preorder_advance_allowed: z.boolean(),
    id: z.string(),
    seller_id: z.string(),
    title: z.string(),
    description: z.string(),
    condition: z.enum(productConditions),
    category: z.string(),
    unit: z.string(),
    price_kobo: kobo,
    stock: z.number().int(),
    status: z.enum(['ACTIVE', 'PAUSED']),
    image_url: z.string().nullable(),
    image_urls: z.array(z.string()).optional(),
    thumbnail_url: z.string().nullish(),
    variants: z.array(ProductVariant).optional(),
    public_latitude: z.number().nullish(),
    public_longitude: z.number().nullish(),
    distance_km: z.number().nullish(),
    search_price: kobo.nullish(),
    rating_avg: z.number().nullish(),
    rating_count: z.number().int().nullish(),
    /** The seller passed business verification (identity, contact, location). Never paid for. */
    seller_verified: z.boolean().nullish(),
    market_id: z.string().nullish(),
    business_name: z.string(),
    city: z.string(),
    area: z.string(),
    business_type: z.enum(sellerTypes),
    in_stock: z.boolean().optional(),
    stock_alert: z.boolean().optional(),
    available_from: timestamp.nullish(),
    preorder_capacity: z.number().int().optional(),
    sponsored: z.boolean().optional(),
  })
  .meta({ id: 'Listing' });

export const BookingStatus = z
  .enum([
    'REQUESTED',
    'COUNTERED',
    'ACCEPTED',
    'READY_FOR_PICKUP',
    'COMPLETED',
    'DECLINED',
    'CANCELLED',
    'EXPIRED',
  ])
  .meta({ id: 'BookingStatus' });

export const Booking = z
  .looseObject({
    pickup_available: z.boolean(),
    delivery_available: z.boolean(),
    id: z.string(),
    buyer_id: z.string(),
    seller_id: z.string(),
    listing_id: z.string(),
    title: z.string(),
    unit: z.string(),
    quantity: z.number().int(),
    price_kobo: kobo,
    total_kobo: kobo,
    commission_kobo: kobo,
    commission_bps: z.number().int(),
    status: BookingStatus,
    paid: z.boolean(),
    reserved_until: timestamp.nullable(),
    created_at: timestamp,
    business_name: z.string(),
    buyer_name: z.string(),
    pickup_address: z.string().optional(),
    pickup_code: z.string().optional(),
    pickup_latitude: z.number().nullish(),
    pickup_longitude: z.number().nullish(),
    variant_id: z.string().nullish(),
    variant_name: z.string().optional(),
    offer_version: z.number().int().optional(),
    payment_recorded: z.boolean().optional(),
    offer_quantity: z.number().int().nullish(),
    offer_price_kobo: kobo.nullish(),
    offer_note: z.string().nullish(),
    offer_expires_at: timestamp.nullish(),
    dispute_status: z.string().nullish(),
    preorder: z.boolean().optional(),
  })
  .meta({ id: 'Booking' });

export const OrderEvent = z
  .looseObject({
    id: z.string(),
    booking_id: z.string(),
    from_status: z.string().nullable(),
    to_status: z.string(),
    actor_id: z.string().nullable(),
    reason: z.string(),
    created_at: timestamp,
  })
  .meta({ id: 'OrderEvent' });

export const FundingStatus = z
  .enum(['INITIALIZING', 'PENDING', 'UNCERTAIN', 'FAILED', 'EXPIRED', 'SUCCESSFUL'])
  .meta({ id: 'FundingStatus' });

export const Funding = z
  .looseObject({
    id: z.string(),
    provider: z.string(),
    amount_kobo: kobo,
    status: FundingStatus,
    checkout_url: z.string().nullable(),
    created_at: timestamp,
  })
  .meta({ id: 'Funding' });

export const Wallet = z
  .looseObject({
    balance_kobo: kobo,
    seller_payable_kobo: kobo,
    entries: z.array(
      z.looseObject({
        id: z.string(),
        account: z.string(),
        amount_kobo: kobo,
        reference: z.string(),
        created_at: timestamp,
      }),
    ),
    funding: z.array(Funding),
    /** Refunds sent back to the buyer's card (when the wallet feature is off). */
    refunds: z.array(
      z.looseObject({
        id: z.string(),
        amount_kobo: kobo,
        status: z.enum(['PENDING', 'SENDING', 'REFUNDED', 'FAILED']),
        provider: z.string(),
        created_at: timestamp,
      }),
    ),
  })
  .meta({ id: 'Wallet' });

export const FundingCheckout = z
  .looseObject({
    reference: z.string(),
    checkout_url: z.string(),
    provider: z.enum(['paystack', 'flutterwave']),
    fallback_used: z.boolean(),
  })
  .meta({ id: 'FundingCheckout' });

export const Ok = z.looseObject({ ok: z.boolean() }).meta({ id: 'Ok' });

export const SearchResult = z
  .looseObject({
    items: z.array(Listing),
    sponsored: z.array(Listing),
    next_cursor: z.string().nullable(),
  })
  .meta({ id: 'SearchResult' });

export const PayoutSummary = z
  .looseObject({
    account: z
      .looseObject({
        bank_name: z.string(),
        account_last4: z.string(),
        account_name: z.string(),
        name_match: z.boolean(),
      })
      .nullable(),
    available_kobo: kobo,
    /** Withdrawal limits, cool-down and freeze. */
    limits: z
      .looseObject({
        level: z.enum(['BASIC', 'VERIFIED', 'TRUSTED']),
        daily_limit_kobo: kobo,
        monthly_limit_kobo: kobo,
        daily_used_kobo: kobo,
        monthly_used_kobo: kobo,
        locked_until: z.string().nullable(),
        lock_reason: z.string().nullable(),
        frozen: z.boolean(),
        new_earner: z.boolean(),
      })
      .optional(),
    /** Recent card top-ups and new earners' proceeds that can't be withdrawn yet. */
    held_wallet_kobo: kobo.optional(),
    held_earnings_kobo: kobo.optional(),
    /** Money added to the wallet, which anyone can withdraw. */
    wallet_kobo: kobo,
    /** Has seller or driver earnings (available_kobo) to withdraw. */
    earner: z.boolean(),
    min_kobo: kobo,
    fee_kobo: kobo,
    mode: z.enum(['provider', 'simulated', 'disabled']),
    payouts: z.array(
      z.looseObject({
        id: z.string(),
        amount_kobo: kobo,
        fee_kobo: kobo,
        status: z.string(),
        failure_reason: z.string().nullable(),
        created_at: timestamp,
        bank_name: z.string(),
        account_last4: z.string(),
      }),
    ),
  })
  .meta({ id: 'PayoutSummary' });

export const Delivery = z
  .looseObject({
    id: z.string(),
    booking_id: z.string(),
    status: z.enum(['OPEN', 'ASSIGNED', 'PICKED_UP', 'DELIVERED', 'CANCELLED']),
    vehicle_type: z.string(),
    distance_km: z.number(),
    fare_kobo: kobo,
    pay_on_delivery: z.boolean(),
    fare_paid: z.boolean(),
    dropoff_address: z.string().optional(),
    dropoff_latitude: z.number(),
    dropoff_longitude: z.number(),
    pickup_latitude: z.number(),
    pickup_longitude: z.number(),
    driver_latitude: z.number().nullish(),
    driver_longitude: z.number().nullish(),
    driver_location_at: timestamp.nullish(),
    driver_name: z.string().nullish(),
    driver_phone: z.string().nullish(),
    vehicle_name: z.string().optional(),
    plate_number: z.string().nullish(),
    pickup_pin: z.string().optional(),
    delivery_pin: z.string().optional(),
    booking_paid: z.boolean().optional(),
    total_kobo: kobo.optional(),
  })
  .meta({ id: 'Delivery' });

/** Success response schemas for the core resources, by operation id. */
export const coreResponses: Record<string, z.ZodType> = {
  'account.getMe': Me,
  'account.getSettings': Settings,
  'account.logout': Ok,
  'bookings.listBookings': z.array(Booking),
  'bookings.getBooking': Booking,
  'bookings.listBookingEvents': z.array(OrderEvent),
  'marketplace.listListings': z.array(Listing),
  'retention.getListing': Listing,
  'retention.listSellerListings': z.array(Listing),
  'geography.search': SearchResult,
  'wallet.getWallet': Wallet,
  'wallet.startFunding': FundingCheckout,
  'wallet.startCheckout': FundingCheckout,
  'payouts.getPayoutSummary': PayoutSummary,
  'deliveries.getBookingDelivery': Delivery.nullable(),
};
