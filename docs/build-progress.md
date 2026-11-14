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
- The seller confirms handover with the driver's PIN. The driver confirms delivery with the buyer's PIN. The booking then completes and earnings are split.
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
- 33 integration tests (`npm test`) on a real PostgreSQL test database, run in CI as an optional (non-blocking) step, along with a required check that the generated OpenAPI contract (`apps/api/openapi.json`) and shared API types are up to date.
- Row locks follow one order (user → booking → delivery → listing → variant); `mutate` retries transactions Postgres aborts as deadlocks or serialization conflicts.

## Needs people, accounts or decisions (not code)

- **Translations need native-speaker review** before launch. The Pidgin, Yorùbá, Hausa and Igbo strings in `apps/mobile/src/i18n/translations.ts` are first drafts. Screens outside the core journey are still English only.
- Legal/licensing validation of the wallet, held funds, payouts and Pay on Delivery (the brief requires this before handling real money). Keep "Allow digital Pay on Delivery" switched off in Settings until then.
- Live Paystack/Flutterwave accounts with transfers enabled, webhook URLs, and sandbox acceptance tests of funding **and** payouts. Live money has not been exercised.
- `PAYOUT_ENCRYPTION_KEY`, SMTP, managed PostgreSQL, S3 buckets, `PUBLIC_API_URL` and `EXPO_PUBLIC_WEB_URL` for each environment.
- Expo/EAS project (`eas init` adds the project id that push tokens need), Apple and Google developer accounts, and store listings. Native binaries have not been built.
- A log/uptime service pointed at the JSON logs and `/health/ready`, and a schedule (cron or managed job) for `npm run backup`. Do a restore test.

## Known limitations / possible next work

- Driving is a mode inside the main app, not a separate store app.
- Delivery distance is straight-line × 1.3, not road routing. Drivers aren't auto-assigned (it's first to claim), and there are no batched or multi-stop trips.
- Delivery handover uses 6-digit PINs. QR codes could be added later.
- Uploads retry but are not resumable mid-file (files are capped at 5–8 MB).
- Search still uses SQL distance maths rather than PostGIS. That's fine at current scale, but worth revisiting for large catalogues.
- Only the audit log and ledger have "load older" paging. Other admin lists show the latest 100–200 rows.
