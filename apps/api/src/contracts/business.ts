import { z } from 'zod';

const ok = z.object({ ok: z.boolean() });
const id = z.object({ id: z.string() });
const kobo = z.number().int();
const ts = z.string();
const count = z.number().int();
const verificationStatus = z.enum([
  'NONE',
  'PENDING',
  'INFO_REQUESTED',
  'VERIFIED',
  'REJECTED',
  'SUSPENDED',
  'EXPIRED',
]);
const Switches = z.object({
  transaction_commission: z.boolean(),
  delivery_commission: z.boolean(),
  sponsored_products: z.boolean(),
  featured_sellers: z.boolean(),
  local_ads: z.boolean(),
});
const Package = z.looseObject({
  id: z.string(),
  kind: z.enum(['PRODUCT', 'SELLER']),
  name: z.string(),
  days: count,
  price_kobo: kobo,
  active: z.boolean(),
});
const Featured = z.looseObject({
  id: z.string(),
  seller_id: z.string(),
  days: count,
  fee_kobo: kobo,
  starts_at: ts,
  ends_at: ts,
  status: z.enum(['ACTIVE', 'CANCELLED']),
  refund_kobo: kobo,
  running: z.boolean(),
});
const Ad = z.looseObject({
  id: z.string(),
  advertiser: z.string(),
  title: z.string(),
  body: z.string(),
  image_url: z.string().nullable(),
  link_url: z.string().nullable(),
  cta: z.string(),
});
const CaseNote = z.object({
  id: z.string(),
  kind: z.enum(['MESSAGE', 'INTERNAL', 'UPDATE', 'SYSTEM']),
  body: z.string(),
  created_at: ts,
  author_id: z.string().nullable(),
  author_name: z.string().nullable(),
  author_role: z.enum(['buyer', 'seller', 'staff', 'system']),
});

export const businessResponses: Record<string, z.ZodType> = {
  // Business verification
  'business-verification.nearbySellers': z.array(
    z.object({
      seller_id: z.string(),
      business_name: z.string(),
      business_type: z.string(),
      area: z.string(),
      city: z.string(),
      state: z.string(),
      verified: z.boolean(),
      featured: z.boolean(),
      rating_avg: z.number(),
      rating_count: count,
      products: count,
      image_url: z.string().nullable(),
      distance_km: z.number().nullable(),
    }),
  ),
  'business-verification.getMyVerification': z.object({
    status: verificationStatus,
    details: z.record(z.string(), z.unknown()),
    verified_at: ts.nullable(),
    expires_at: ts.nullable(),
    documents: count,
    history: z.array(
      z.object({ id: z.string(), status: z.string(), note: z.string(), created_at: ts }),
    ),
    requirements: z.array(z.string()),
    means: z.string(),
  }),
  'business-verification.applyForVerification': z.object({ status: z.literal('PENDING') }),
  'business-verification.listVerifications': z.array(
    z.looseObject({
      seller_id: z.string(),
      business_name: z.string(),
      verification_status: verificationStatus,
      verification_details: z.record(z.string(), z.unknown()),
      verified_at: ts.nullable(),
      verification_expires_at: ts.nullable(),
      documents: z.array(
        z.object({ id: z.string(), kind: z.string(), status: z.string(), filename: z.string() }),
      ),
    }),
  ),
  'business-verification.verificationHistory': z.array(
    z.object({
      id: z.string(),
      status: z.string(),
      note: z.string(),
      created_at: ts,
      actor_name: z.string().nullable(),
    }),
  ),
  'business-verification.decideVerification': ok,
  // Revenue
  'revenue.getSwitches': Switches,
  'revenue.saveSwitches': Switches,
  'revenue.listPackages': z.array(Package),
  'revenue.adminPackages': z.array(Package),
  'revenue.savePackage': id,
  'revenue.updatePackage': id,
  'revenue.featureMyShop': z.object({ id: z.string(), ends_in_days: count, fee_kobo: kobo }),
  'revenue.myFeatured': z.array(Featured),
  'revenue.featuredSellers': z.array(
    z.object({
      seller_id: z.string(),
      business_name: z.string(),
      business_type: z.string(),
      area: z.string(),
      city: z.string(),
      state: z.string(),
      verified: z.boolean(),
      rating_avg: z.number(),
      rating_count: count,
      products: count,
      image_url: z.string().nullable(),
    }),
  ),
  'revenue.adminFeatured': z.array(Featured.extend({ business_name: z.string() })),
  'revenue.cancelFeatured': z.object({ ok: z.boolean(), refund_kobo: kobo }),
  'revenue.serveAds': z.array(Ad.extend({ label: z.string() })),
  'revenue.clickAd': z.object({ link_url: z.string().nullable() }),
  'revenue.adminAds': z.array(
    Ad.extend({
      status: z.enum(['DRAFT', 'ACTIVE', 'PAUSED', 'ENDED']),
      price_kobo: kobo,
      paid_kobo: kobo,
      impressions: count,
      clicks: count,
      click_rate: z.number(),
      live: z.boolean(),
      starts_at: ts,
      ends_at: ts,
    }),
  ),
  'revenue.saveAd': id,
  'revenue.updateAd': id,
  'revenue.setAdStatus': ok,
  'revenue.recordAdPayment': ok,
  'revenue.adminPartners': z.array(
    z.looseObject({
      id: z.string(),
      name: z.string(),
      commission_bps: count,
      status: z.enum(['ACTIVE', 'PAUSED']),
      drivers: count,
      deliveries: count,
      commission_kobo: kobo,
      riders: z.array(z.looseObject({ driver_id: z.string(), name: z.string() })),
    }),
  ),
  'revenue.savePartner': id,
  'revenue.updatePartner': id,
  'revenue.assignPartnerDriver': ok,
  'revenue.revenueReport': z.object({
    from: z.string(),
    to: z.string(),
    total_kobo: kobo,
    streams: z.array(
      z.object({
        stream: z.string(),
        label: z.string(),
        amount_kobo: kobo,
        entries: count,
        share: z.number(),
      }),
    ),
    orders: z.object({ completed: count, cancelled: count, gross_kobo: kobo }),
    series: z.array(z.object({ day: z.string(), amount_kobo: kobo })),
    switches: Switches,
    note: z.string(),
  }),
  // Complaint cases
  'cases.caseTimeline': z.object({
    id: z.string(),
    status: z.string(),
    priority: z.enum(['LOW', 'NORMAL', 'HIGH', 'URGENT']),
    assigned_to: z.string().nullable(),
    assigned_name: z.string().nullable(),
    snapshot: z.record(z.string(), z.unknown()),
    notes: z.array(CaseNote),
  }),
  'cases.sendCaseMessage': ok,
  'cases.caseQueue': z.array(
    z.looseObject({
      id: z.string(),
      booking_id: z.string(),
      reason_code: z.string(),
      status: z.string(),
      priority: z.enum(['LOW', 'NORMAL', 'HIGH', 'URGENT']),
      assigned_to: z.string().nullable(),
      assigned_name: z.string().nullable(),
      title: z.string(),
      total_kobo: kobo,
      buyer_name: z.string(),
      business_name: z.string(),
      note_count: count,
      age_hours: count,
    }),
  ),
  'cases.caseAssignees': z.array(
    z.object({ id: z.string(), name: z.string(), staff_role: z.string() }),
  ),
  'cases.assignCase': ok,
  'cases.addCaseNote': ok,
};
