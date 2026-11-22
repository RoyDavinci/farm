# Growth modules and integrations

The growth-stage features from the revenue roadmap. Each one works today; the parts that need a
third party (AI, courier APIs, SMS/WhatsApp) plug in later through
`apps/api/src/integrations` without changing the rest of the app.

## For sellers (app → More → Business hub)

| Module               | Plan                  | What it does                                                            |
| -------------------- | --------------------- | ----------------------------------------------------------------------- |
| Seller plans         | —                     | Seller Pro and Business, paid by card or from proceeds; cancel any time |
| Listing assistant    | Pro, Business         | Cleaner title, fuller description, tips and a price check vs the market |
| Business report      | Pro, Business         | Sales, best sellers, slow movers, low stock and next steps              |
| Market insights      | Pro, Business         | Typical prices, demand and trends by category and state                 |
| Team                 | Pro (1), Business (5) | Staff and managers work on the shop account (see Team access below)     |
| Bulk upload          | Business              | Up to 200 products at once, checked like normal listings                |
| Connect your systems | Business              | API keys and webhooks for POS, inventory or accounting software         |
| Bulk requests (B2B)  | Everyone              | Buyers ask for quotes; sellers quote; the buyer accepts one             |

The listing assistant and business report are rule-based today. With an AI provider connected
(`AI_PROVIDER`), the assistant rewrites descriptions with it; nothing else changes. Market figures
hide any group with fewer than 3 sellers.

## Paying for plans by card

`POST /me/subscriptions {plan_id, pay_with:'card'}` creates the plan as waiting for payment, then
`POST /payments/checkout {purpose:'subscription', provider, subscription_id}` opens the provider's
checkout. When the provider confirms the payment (webhook or the "I’ve paid" check), the plan
starts at once and the fee is booked as subscription revenue; it never sits in the wallet. If the
plan was cancelled in the meantime or the amount differs, the money goes back to the payer (refunded to the card, or kept in their
wallet when the wallet is switched on).

## Team access

A team member opens Account → Shops you work for → Work for this shop. The app then sends
`X-Act-As-Seller: <shop id>` and every request runs as the shop, limited by role
(`apps/api/src/services/team-access.ts`):

- **Staff**: products and photos, stories, orders (accept, decline, counter, ready, hand over),
  chat and support cases, the listing assistant. Can read everything else except money.
- **Manager**: all of that, plus cancelling orders, bulk upload and bulk-request quotes.
- **Owner only**: payouts, wallet and bank details, anything paid (promotions, featuring), plans,
  the team, API keys and webhooks, verification and account settings.

Access needs the shop to keep a plan with team seats; it stops when the member is removed or the
plan ends (the app then switches them back). Every change a member makes is logged and shown to the
owner under Business hub → Team.

## For buyers

- **Ahia Plus** membership (Account screen), paid by card through Paystack or Flutterwave. When
  online payments are off it falls back to bank transfer, which staff confirm in Admin → Growth.
- **Bulk requests** in the Business hub for shops, restaurants and events.
- **Plan sharing**: share a plan with family by email or phone, as editor or viewer.

## For staff (admin console)

- **Growth:** plan prices, subscribers (confirm pending payments), the market research report
  (CSV export, small groups suppressed) and integration status.
- **Planner content:** edit plan types, recipes and ingredients as JSON; hide or reset to the
  built-in version. Changes reach the app within a minute.
- **Advertising:** upload a banner image per campaign (2:1 works best).

Subscription and membership income appears in Admin → Revenue as “Subscriptions and membership”.

## Partner API

See `apps/api/src/integrations/README.md`. Keys are created by Business-plan sellers, never shown
twice, and can be revoked at any time. Webhooks are signed (`X-Ahia-Signature`, HMAC-SHA256) and
retried with back-off for up to six attempts.

## Also in this release

- Notification bell with an unread count; Chat tab with unread messages.
- Bottom bar: Home, Categories, Orders, Chat, More (Payments/Wallet moved to More).
- Story views and likes, shown on stories and in the story viewer.
- Adverts and featured shops target the buyer’s state from their location when they allow it.
