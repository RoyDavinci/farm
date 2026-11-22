import { z } from 'zod';

const ok = z.object({ ok: z.boolean() });
const id = z.object({ id: z.string() });
const kobo = z.number().int();
const count = z.number().int();
const ts = z.string();
const Plan = z.looseObject({
  id: z.string(),
  audience: z.enum(['SELLER', 'BUYER']),
  name: z.string(),
  description: z.string(),
  price_kobo: kobo,
  period_days: count,
  features: z.record(z.string(), z.unknown()),
  active: z.boolean(),
});
const Subscription = z.looseObject({
  id: z.string(),
  plan_id: z.string(),
  status: z.enum(['PENDING_PAYMENT', 'ACTIVE', 'CANCELLED', 'EXPIRED']),
  fee_kobo: kobo,
  starts_at: ts.nullable(),
  ends_at: ts.nullable(),
});
const Rfq = z.looseObject({
  id: z.string(),
  title: z.string(),
  category: z.string(),
  quantity: z.number(),
  unit: z.string(),
  status: z.enum(['OPEN', 'AWARDED', 'CLOSED']),
  budget_kobo: kobo.nullable(),
  needed_by: z.string().nullable(),
});
const Content = z.object({
  key: z.string(),
  title: z.string(),
  custom: z.boolean(),
  data: z.record(z.string(), z.unknown()),
});

export const growthResponses: Record<string, z.ZodType> = {
  // Plan sharing and planner content
  'planner.listMembers': z.object({
    owner: z.object({ user_id: z.string(), name: z.string() }),
    members: z.array(
      z.object({
        user_id: z.string(),
        name: z.string(),
        role: z.enum(['VIEWER', 'EDITOR']),
        created_at: ts,
      }),
    ),
    you: z.enum(['OWNER', 'EDITOR', 'VIEWER']),
  }),
  'planner.shareWith': z.object({ ok: z.boolean(), name: z.string() }),
  'planner.removeMember': ok,
  'planner-admin.getContent': z.object({
    templates: z.array(Content),
    recipes: z.array(Content),
    ingredients: z.array(Content),
    hidden: z.array(z.object({ type: z.string(), key: z.string() })),
    help: z.string(),
  }),
  'planner-admin.saveContent': ok,
  'planner-admin.resetContent': ok,
  // Subscriptions and membership
  'growth.listPlans': z.array(Plan),
  'growth.mySubscriptions': z.object({
    subscriptions: z.array(Subscription),
    seller_features: z.looseObject({ plan: z.string().nullable() }),
  }),
  'growth.subscribe': z.looseObject({
    id: z.string(),
    pay_by_card: z.boolean().optional(),
    status: z.enum(['ACTIVE', 'PENDING_PAYMENT']),
    message: z.string(),
  }),
  'growth.cancelSubscription': ok,
  'growth.adminPlans': z.array(Plan),
  'growth.createPlan': id,
  'growth.updatePlan': id,
  'growth.adminSubscriptions': z.array(
    Subscription.extend({ plan_name: z.string(), user_name: z.string() }),
  ),
  'growth.activateSubscription': ok,
  // Assistant, report, insights, research
  'growth.listingAssist': z.object({
    title: z.string(),
    description: z.string(),
    tips: z.array(z.string()),
    price: z
      .object({ median_kobo: kobo, low_kobo: kobo, high_kobo: kobo, sellers: count })
      .nullable(),
    source: z.string(),
  }),
  'growth.businessReport': z.looseObject({
    days: count,
    sales: z.object({
      requests: count,
      completed: count,
      lost: count,
      gross_kobo: kobo,
      net_kobo: kobo,
    }),
    actions: z.array(z.string()),
    source: z.string(),
  }),
  'growth.marketInsights': z.looseObject({
    category: z.string(),
    state: z.string(),
    sellers: count,
    listings: count,
    price: z.object({ median_kobo: kobo, p25_kobo: kobo, p75_kobo: kobo }).nullable(),
    note: z.string(),
  }),
  'growth.researchReport': z.object({
    state: z.string(),
    generated_at: ts,
    rows: z.array(
      z.object({
        category: z.string(),
        sellers: count,
        listings: count,
        median_price_kobo: kobo.nullable(),
        orders_30_days: count.nullable(),
        gmv_30_days_kobo: kobo.nullable(),
        searches_30_days: count,
        suppressed: z.boolean(),
      }),
    ),
    note: z.string(),
  }),
  // B2B
  'growth.createRfq': id,
  'growth.myRfqs': z.array(Rfq),
  'growth.openRfqs': z.array(Rfq),
  'growth.getRfq': Rfq.extend({
    quotes: z.array(
      z.looseObject({
        id: z.string(),
        total_kobo: kobo,
        delivery_days: count,
        business_name: z.string(),
      }),
    ),
  }),
  'growth.submitQuote': ok,
  'growth.acceptQuote': z.object({ ok: z.boolean(), seller_id: z.string() }),
  'growth.closeRfq': ok,
  // Enterprise
  'growth.listTeam': z.object({
    seats: count,
    members: z.array(z.looseObject({ user_id: z.string(), name: z.string(), role: z.string() })),
    activity: z.array(
      z.looseObject({
        member_name: z.string(),
        method: z.string(),
        path: z.string(),
        status: count,
      }),
    ),
    note: z.string(),
  }),
  'growth.myTeams': z.array(
    z.object({
      seller_id: z.string(),
      business_name: z.string(),
      area: z.string(),
      city: z.string(),
      role: z.enum(['MANAGER', 'STAFF']),
      added_at: ts,
    }),
  ),
  'growth.addTeamMember': ok,
  'growth.removeTeamMember': ok,
  'growth.importListings': z.object({ created: count, ids: z.array(z.string()) }),
  // Partner integrations
  'partner.listKeys': z.object({
    keys: z.array(z.looseObject({ id: z.string(), name: z.string(), key_prefix: z.string() })),
    webhooks: z.array(z.looseObject({ id: z.string(), url: z.string(), active: z.boolean() })),
    docs: z.string(),
  }),
  'partner.createKey': z.object({ id: z.string(), key: z.string(), message: z.string() }),
  'partner.revokeKey': ok,
  'partner.createWebhook': z.object({ id: z.string(), secret: z.string(), message: z.string() }),
  'partner.deleteWebhook': ok,
  'partner.integrations': z.object({
    providers: z.array(
      z.object({
        kind: z.string(),
        provider: z.string(),
        connected: z.boolean(),
        options: z.array(z.string()),
        purpose: z.string(),
      }),
    ),
    partner_api: z.object({ active_keys: count, webhooks: count, failed_deliveries: count }),
  }),
  'partner-api.listings': z.array(
    z.looseObject({
      id: z.string(),
      title: z.string(),
      status: z.string(),
      variants: z.array(z.unknown()),
    }),
  ),
  'partner-api.updateListing': ok,
  'partner-api.orders': z.array(
    z.looseObject({ id: z.string(), status: z.string(), total_kobo: kobo }),
  ),
};
