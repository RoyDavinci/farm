/**
 * Integration points for third-party services. Each one is an interface with a built-in default
 * that works without any external account, so features run today and a provider can be plugged
 * in later by adding an adapter here and selecting it with an environment variable.
 *
 *   AI_PROVIDER         none (default: rule-based assistant)            → add e.g. an LLM adapter
 *   BILLING_PROVIDER    proceeds (default: seller proceeds / manual)    → add a card subscriptions adapter
 *   LOGISTICS_PROVIDER  manual (default: Ahia riders + partner rates)   → add a courier API adapter
 *   MESSAGING_PROVIDER  email (default: existing email + push)          → add SMS / WhatsApp adapter
 *
 * Adapters must never receive more personal data than the task needs (no allergy profiles, no
 * private addresses) and must be covered by a data-processing agreement before going live.
 */

// ---------------------------------------------------------------- AI
export interface AiRequest {
  /** What the assistant is for, e.g. "listing" or "business_report". */
  task: string;
  /** Instructions plus the minimum business data needed (no personal data). */
  prompt: string;
  maxWords?: number;
}
export interface AiProvider {
  name: string;
  /** False when the provider is not configured; callers then use their rule-based result. */
  available: boolean;
  complete(request: AiRequest): Promise<string | null>;
}
/** Default: no AI. Features fall back to their rule-based suggestions. */
export const noAi: AiProvider = { name: 'rules', available: false, complete: async () => null };

// ---------------------------------------------------------------- Billing
export interface BillingCharge {
  userId: string;
  amountKobo: number;
  description: string;
  reference: string;
}
export interface BillingProvider {
  name: string;
  /** How the customer pays: 'proceeds' (seller earnings), 'manual' (staff record a transfer), or a card provider. */
  method: 'proceeds' | 'manual' | 'card';
  /** Card providers return a checkout URL; proceeds/manual are handled by the subscriptions service. */
  startCheckout?(charge: BillingCharge): Promise<{ checkoutUrl: string }>;
}
/** Built in: seller proceeds, bank transfer confirmed by staff, or card through the Paystack / Flutterwave checkout. */
export const proceedsBilling: BillingProvider = { name: 'paystack-card', method: 'card' };

// ---------------------------------------------------------------- Logistics
export interface DeliveryQuoteRequest {
  pickup: { latitude: number; longitude: number; state: string };
  dropoff: { latitude: number; longitude: number; state: string };
  weightKg?: number;
}
export interface LogisticsProvider {
  name: string;
  available: boolean;
  quote(request: DeliveryQuoteRequest): Promise<{ fareKobo: number; etaMinutes: number } | null>;
  book?(deliveryId: string, request: DeliveryQuoteRequest): Promise<{ externalId: string }>;
  track?(externalId: string): Promise<{ status: string; latitude?: number; longitude?: number }>;
}
/** Default: Ahia's own riders and delivery partner companies (see delivery_partners). */
export const manualLogistics: LogisticsProvider = {
  name: 'ahia-riders',
  available: false,
  quote: async () => null,
};

// ---------------------------------------------------------------- Messaging
export interface MessagingProvider {
  name: string;
  available: boolean;
  /** SMS or WhatsApp text to a verified phone number. */
  send(phone: string, text: string): Promise<boolean>;
}
export const noMessaging: MessagingProvider = {
  name: 'email-and-push',
  available: false,
  send: async () => false,
};

// ---------------------------------------------------------------- Registry
const ai: Record<string, AiProvider> = { none: noAi };
const billing: Record<string, BillingProvider> = { proceeds: proceedsBilling };
const logistics: Record<string, LogisticsProvider> = { manual: manualLogistics };
const messaging: Record<string, MessagingProvider> = { email: noMessaging };

/** Registers an adapter (call at startup from the adapter's module). */
export function registerIntegration(
  kind: 'ai' | 'billing' | 'logistics' | 'messaging',
  key: string,
  adapter: AiProvider | BillingProvider | LogisticsProvider | MessagingProvider,
) {
  (({ ai, billing, logistics, messaging }) as Record<string, Record<string, unknown>>)[kind][key] =
    adapter;
}

const pick = <T>(table: Record<string, T>, env: string | undefined, fallback: string) =>
  table[env || fallback] ?? table[fallback];
export const integrations = {
  ai: () => pick(ai, process.env.AI_PROVIDER, 'none'),
  billing: () => pick(billing, process.env.BILLING_PROVIDER, 'proceeds'),
  logistics: () => pick(logistics, process.env.LOGISTICS_PROVIDER, 'manual'),
  messaging: () => pick(messaging, process.env.MESSAGING_PROVIDER, 'email'),
};

/** What is configured, for the admin console. */
export function integrationStatus() {
  const row = (
    kind: string,
    p: { name: string; available?: boolean },
    options: string[],
    purpose: string,
  ) => ({
    kind,
    provider: p.name,
    connected: p.available !== false,
    options,
    purpose,
  });
  return [
    row('ai', integrations.ai(), Object.keys(ai), 'Listing assistant and business report wording'),
    row(
      'billing',
      integrations.billing(),
      Object.keys(billing),
      'Subscriptions and membership payments',
    ),
    row(
      'logistics',
      integrations.logistics(),
      Object.keys(logistics),
      'Third-party courier quotes, booking and tracking',
    ),
    row(
      'messaging',
      integrations.messaging(),
      Object.keys(messaging),
      'SMS and WhatsApp notifications',
    ),
    {
      kind: 'partner_api',
      provider: 'ahia',
      connected: true,
      options: ['api keys', 'webhooks'],
      purpose: 'Business tier sellers connect inventory and order systems',
    },
  ];
}
