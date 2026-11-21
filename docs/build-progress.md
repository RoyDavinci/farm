# Build progress

Status of the features from the requirements brief and roadmap. Reservations stay one week, stock updates stay immediate and the default commission stays 5%. Every rate, fee and fare below is a setting, not a hard-coded value.

## Pilot mode

- `PILOT_MODE=true` runs the brief's first release: core marketplace, booking and delivery. The wallet, Local Status, promotions, shopping errands, parcels, voice, pre-orders and indoor market maps are switched off; each has its own `FEATURE_<NAME>` override. Details: [pilot mode](pilot-mode.md).
- Without a wallet, buyers pay each booking and delivery fare directly at Paystack or Flutterwave, and refunds go back to the card automatically, with a finance Refunds page for exceptions.

## General marketplace revamp

- Broader product categories, individual and business seller types, new/used/refurbished condition, and general retail units. Catalog choices come from `/settings` and are validated by the API.
- Buyer-selected nearby riders for order delivery. Only the selected rider receives the invitation; acceptance and availability are checked on the server.
- Shopping requests for goods from a specified location, with a buyer-set goods cap and a separate delivery fee. A private request chat supports agreement on reimbursement or app advance before buyer funding.
- Request-linked advances and bank-payout tracking. Bank payouts keep existing approval and fee rules; unused advances must be recovered before refund or delivery settlement.
- Itemised purchase records, cap enforcement, PIN-confirmed delivery, unused-budget refunds, support pauses and an admin Shopping workspace.
- Local simulated walkthrough: both shopping modes and selected-rider delivery completed, with zero remaining request escrow/advance balances. API/client builds and typechecks are checked separately; automated tests remain deferred for the new flows.
- Private shopping receipt photos: up to six images of 5 MB each, re-encoded without metadata, participant/staff access through expiring links, with previews in the mobile app and admin console.
- Shopping-request live maps: rider opt-in foreground sharing every 15 seconds, buyer/staff polling every 10 seconds, stale-location notices, and location hidden once paused or closed. Online Drive mode also updates active shopping requests.
- Receipt/tracking verification: the local migration is applied; typechecks, API/admin builds, mobile web export and API contract consistency pass. A local simulated walkthrough confirmed private receipt storage/signed viewing, unrelated-account denial, rider location updates and location hiding on paused/closed requests. Automated tests remain deferred; physical-device GPS/background behaviour has not been exercised. S3 private-record upload, signed read, anonymous-access denial (403) and temporary-object cleanup were verified against the configured bucket. The ignored local backend environment now selects S3 for private records; existing local records retain their stored provider.
- Still needed: the new brand name, native-speaker review of the new screens, live payment/advance acceptance and device/location verification. Continuous background tracking is not included.
- The API contract has been regenerated and its consistency check passes, including receipt uploads, shopping tracking and nearby-rider query parameters.

## Updated local brief

- Photo and short-video Local Status: seller circles plus a paginated photo/video feed on Market; seller publishing/preview/delete; 24-hour default expiry; linked-product availability; nearby or state/LGA/city discovery; reports, mute/unmute and staff moderation.
- Aggregate story views/unique viewers/product clicks with no viewer identities exposed to sellers. Active paid listing promotions and approved matching Boost Status campaigns are labelled Sponsored. Status campaigns support selected LGA/city targets and their own budget/refund lifecycle.
- Separate promotional notification opt-in, default off, and one favourite-seller new-product alert per buyer per 24 hours. No status-publication broadcasts.
- State/LGA seller location fields and admin-configurable status lifetime, radius and active-post limits. Full comparison and later-phase scope: [updated brief review](updated-brief-review.md).

## Status video campaigns and conversions

- Short-video upload, server duration/container validation, H.264/AAC compression, WebP posters, byte-range playback and tap-to-play mobile/admin viewers. FFmpeg is included in the Dockerfile; native clients need rebuilding for `expo-video`.
- Boost Status quotes, distinct state/LGA or state/city targeting, per-hour/area configurable pricing, earnings holds, staff approval, full pending refunds, prorated active refunds and expiry/unavailability recovery.
- Buyer/product-bound 24-hour click references and last-click booking attribution, with one booking per reference. Organic/sponsored funnels and per-campaign booking/completion metrics do not expose buyer identities.
- A local simulated journey completed video processing, targeted paid discovery, an attributed booking through pickup completion, and campaign cancellation/refund checks. Automated tests and deployment remain deferred. Details: [media campaigns and attribution](status-media-campaigns.md).

## Mobile navigation

- Four bottom controls: Market, Bookings, Wallet and More. More opens a scrollable sheet for Sell, Riders, Drive, Inbox and Account. The sheet highlights the current secondary section, animates in/out, supports backdrop/close/Escape dismissal and respects reduced-motion preferences.

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
- Buyers get a quote and request delivery on an accepted booking. Buyers can select an online nearby rider, who receives an invitation and must accept. The original unassigned matching path remains compatible with older clients.
- The seller confirms handover with the driver's PIN. The driver confirms delivery with the buyer's PIN. Each PIN is also shown as a QR code that the other person can scan with the phone camera. The booking then completes and earnings are split.
- Live tracking: the driver's phone shares its location every 15 seconds while online, and the buyer sees it on the map.
- **Digital Pay on Delivery** (off by default): the buyer pays in the app at the door before revealing the PIN. Cash is never accepted.
- Cancelling or expiry before collection refunds a prepaid fare. Once a driver has collected the order, it cannot be cancelled or expire, and problems go to support.

### Retention

- Push notifications (Expo) for every alert, with a per-user switch. Taps open the relevant screen.
- Back-in-stock alerts per listing, and "new listing" alerts for followers of a seller.
- **Book again** on past bookings.
- Seller shop pages and WhatsApp sharing with deep links (`/?seller=ID` on web, `zuru://seller/ID` in the app).
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
- Road distance needs a Mapbox token; without one, fares use the straight-line estimate. Riders must accept invitations; they are not automatically assigned, and there are no batched or multi-stop trips.
- QR scanning works in the phone apps only; the web preview falls back to typing the 6 digits.
- Uploads retry but are not resumable mid-file (images are capped at 5–8 MB and status videos at 20 MB).
- Search still uses SQL distance maths rather than PostGIS. That's fine at current scale, but worth revisiting for large catalogues.
- Only the audit log and ledger have "load older" paging. Other admin lists show the latest 100–200 rows.
