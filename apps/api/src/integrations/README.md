# Integrations

Every third-party service Ahia may use later plugs in here. Each has an interface and a built-in
default, so the features already work without an external account.

| Kind      | Variable             | Default                         | Used by                                    |
| --------- | -------------------- | ------------------------------- | ------------------------------------------ |
| AI        | `AI_PROVIDER`        | `none` (rule-based)             | Listing assistant, business report         |
| Billing   | `BILLING_PROVIDER`   | `proceeds` (earnings or manual) | Seller subscriptions, Ahia Plus membership |
| Logistics | `LOGISTICS_PROVIDER` | `manual` (Ahia riders/partners) | Courier quotes, booking, tracking          |
| Messaging | `MESSAGING_PROVIDER` | `email` (email + push)          | SMS / WhatsApp                             |

## Adding a provider

1. Create `src/integrations/<kind>-<name>.ts` implementing the interface from `index.ts`.
2. Call `registerIntegration('<kind>', '<name>', adapter)` when the module loads, and import the
   module once from `src/app.ts`.
3. Set the variable (for example `AI_PROVIDER=<name>`) and the provider's secret in the
   environment. The admin console's Growth page shows what is connected.

Rules for every adapter:

- Send the minimum data needed. Never send allergy or diet profiles, private addresses, payment
  details or identity documents to an AI or messaging provider.
- Time out (10–20 seconds) and return `null` on failure so callers fall back to the built-in
  result.
- Sign a data-processing agreement before enabling it in production.

## Partner API (built in)

Business tier sellers create API keys and webhooks in the app (Business hub). Partners call:

- `GET /v1/partner/listings` — the seller's listings and options
- `PATCH /v1/partner/listings/{id}` — update stock, price or status of the main option
- `GET /v1/partner/orders` — recent orders

with the header `X-Api-Key: ahia_…`. Webhooks receive `order.created` and `order.status_changed`
as JSON with an `X-Ahia-Signature` header (HMAC-SHA256 of the body with the webhook secret).
