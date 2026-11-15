# Build progress

Status of the features from the requirements brief and roadmap. Reservations stay one week, stock updates stay immediate and the default commission stays 5%. Every rate, fee and fare below is a setting, not a hard-coded value.

## Built

### Marketplace and booking

- Email OTP registration, sign-in and password recovery. Rotating refresh tokens and device sessions.
- Seller applications reviewed by staff. Listings with up to six photos, variants and wholesale tiers.
- Location search by distance, city, area, market and filters, with approximate public map pins.
- Bookings with accept, decline and counteroffer. Atomic stock reservation, a one-week hold, private pickup codes and lockout after failed codes.
- **Pre-orders**: a listing can have a "ready from" harvest date and a pre-order capacity. Buyers book against that capacity, and the collection hold starts from the harvest date.
- Messaging, in-app notifications, email alerts, favourites, reviews of completed pickups, reports and moderation.
- Disputes with reason codes, private evidence, returns, reviewed refunds and receipts.

### Money

- Wallet funding through Paystack/Flutterwave hosted checkout, verified server-side, plus a simulated development mode. Double-entry ledger with idempotent mutations.
- **Seller and driver payouts**. Bank accounts are confirmed by name with the provider and stored encrypted (only the last four digits are shown). Funds are held when a payout is requested. Staff approve or reject each one. Transfers go out through Paystack or Flutterwave and are settled only after server-side verification (webhook or recheck). The payout minimum and fee are configurable.
- **Sponsored listings**, paid from seller proceeds at a configurable daily price. They are labelled "Sponsored" in search. Staff can stop one with a pro-rata refund.
- Reconciliation exceptions and rechecks for provider funding. Checkout preparation is recorded as a durable funding intent around the provider call; a recovery job releases interrupted checkouts, re-verifies pending top-ups with the provider and expires unpaid ones after 72 hours. The Wallet screen shows pending, interrupted, failed and expired top-ups.

### Delivery network

- Drivers apply for free inside the app (**Drive** tab), upload licence and vehicle documents, and are approved by staff.
- Vehicle types and fares (base, per km, minimum, maximum distance) and the delivery commission are configurable in **Settings**.
- Buyers get a quote and request delivery on an accepted booking. Online drivers within the configured radius are notified, and the first matching driver to claim a job gets it.
- The seller confirms handover with the driver's PIN. The driver confirms delivery with the buyer's PIN. Each PIN is also shown as a QR code that the other person can scan with the phone camera. The booking then completes and earnings are split.
- Live tracking: the driver's phone shares its location every 15 seconds while online, and the buyer sees it on the map.
- **Digital Pay on Delivery** (off by default): the buyer pays in the app at the door before revealing the PIN. Cash is never accepted.
- Cancelling or expiry before collection refunds a prepaid fare. Once a driver has collected the order, it cannot be cancelled or expire, and problems go to support.

### Retention

- Push notifications (Expo) for every alert, with a per-user switch. Taps open the relevant screen.
- Back-in-stock alerts per listing, and "new listing" alerts for followers of a seller.
- **Book again** on past bookings.
- Seller shop pages and WhatsApp sharing with deep links (`/?seller=ID` on web, `farmersmarket://seller/ID` in the app).
- Seller sales analytics: sales, earnings, average order, repeat buyers, a daily chart, best sellers, low stock and acceptance rate.
- Languages: English, Naijá (Pidgin), Yorùbá, Hausa and Igbo for navigation and the core buy/sell/wallet actions.

### Operations

- **Staff roles** (owner, operations, finance, support), enforced on every admin API path. The console hides areas a role can't use. Only owners manage staff, settings and fares, and the last owner cannot be removed.
- **Verification documents** for sellers and drivers: stored privately, opened through 60-second signed links, with every view audited, and accepted or rejected with a note.
- Layered API (config / routes / controllers / services / middleware), Prisma schema and migrations, Winston logging with secrets redacted and request ids, validated configuration that refuses unsafe production settings, helmet + strict CORS + compression + per-IP rate limits. `/health` (liveness) and `/health/ready` (worker heartbeats, delayed email/push, stuck payouts).
- Background jobs can run in the API or as a separate deployment (`npm run worker`, `RUN_WORKERS=false` on the API).
- Keyset paging for the audit log and ledger ("Load older entries").
- `npm run backup`: `pg_dump` archive, optional copy to S3, and retention pruning.
- `apps/api/Dockerfile` (one image for API and worker, verified to build and start). `apps/mobile/eas.json` build profiles.
- Mobile offline support: the last loaded bookings, wallet, account and inbox show while offline, with a banner. New-listing drafts are saved on the device, and photo uploads retry automatically.
- 41 integration tests (`npm test`) on real PostgreSQL and Redis, run in CI as an optional (non-blocking) step. A required CI check keeps the generated OpenAPI contract (`apps/api/openapi.json`) and the shared API types up to date.
- API contract: every JSON endpoint has a published response schema. A "contract tour" test calls every endpoint, and every recorded response is checked against its schema. The mobile app and the admin console call the API through a client typed from this contract.
- Redis (optional): shared rate limits and instant live updates across API instances (events are published after commit). Without Redis each instance works on its own.
- Delivery fares use Mapbox driving distance when a token is set (cached, with a 3 s timeout), falling back to the straight-line estimate.
- Staging on Render (`render.yaml`): API, worker, admin and mobile-web sites, Postgres and Redis. It deploys after CI passes on `main`, and a smoke-test workflow then checks it. See `docs/deploy-staging.md`.
- `npm run acceptance:payments`: a guided end-to-end check of top-ups and payouts against the providers' test environments (`docs/payment-acceptance.md`).
- Phone builds are ready for EAS: dev client, icons, splash and profiles, passing `expo-doctor` (`docs/mobile-builds.md`).
- Row locks follow one order (user → booking → delivery → listing → variant); `mutate` retries transactions Postgres aborts as deadlocks or serialization conflicts.

## Needs people, accounts or decisions (not code)

- **Translations need native-speaker review** before launch. The Pidgin, Yorùbá, Hausa and Igbo strings in `apps/mobile/src/i18n/translations.ts` are first drafts. Screens outside the core journey are still English only.
- Legal/licensing validation of the wallet, held funds, payouts and Pay on Delivery (the brief requires this before handling real money). Keep "Allow digital Pay on Delivery" switched off in Settings until then.
- Paystack/Flutterwave test keys on staging, then a run of `npm run acceptance:payments` (not yet run against real providers). Later, live accounts with transfers enabled. Live money has not been exercised.
- Creating the Render Blueprint and filling in its secrets (SMTP, R2/S3, payment test keys, Mapbox), after pushing the repository to GitHub. See `docs/deploy-staging.md`.
- `eas init` (it adds the project ID that push tokens need), Firebase for Android push, an Apple Developer account for iPhone builds, and later store listings. No native build has been run yet. See `docs/mobile-builds.md`.
- A log/uptime service pointed at the JSON logs and `/health/ready`, and a schedule (cron or managed job) for `npm run backup`. Do a restore test.

## Known limitations / possible next work

- Driving is a mode inside the main app, not a separate store app.
- Road distance needs a Mapbox token; without one, fares use the straight-line estimate. Drivers aren't auto-assigned (it's first to claim), and there are no batched or multi-stop trips.
- QR scanning works in the phone apps only; the web preview falls back to typing the 6 digits.
- Uploads retry but are not resumable mid-file (files are capped at 5–8 MB).
- Search still uses SQL distance maths rather than PostGIS. That's fine at current scale, but worth revisiting for large catalogues.
- Only the audit log and ledger have "load older" paging. Other admin lists show the latest 100–200 rows.
