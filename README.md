# Farmers Market

Express + TypeScript API, Expo React Native buyer/seller/driver app, and React operations console. It covers the marketplace and booking loop, wallet payments, seller and driver payouts, delivery by verified drivers, sponsored listings, pre-orders, and staff roles. See [build progress](docs/build-progress.md) for the full feature list and what still needs accounts or decisions.

## Run locally

Use Node.js 24 LTS, npm 11 and Docker (for the local PostgreSQL database). Dependencies are managed by the root npm workspace and lockfile.

```sh
npm install
npm run setup
npm run dev
```

The built mobile preview can also be served with `npm run preview:mobile` at http://localhost:8095. Stop that preview before starting Expo web on the same port.

In a second terminal:

```sh
npm run dev:mobile
```

Open the admin at http://localhost:5173. Scan Expo's QR code with a compatible Expo Go or development build, or run `npm run dev:mobile:web` and open http://localhost:8095. The API runs at http://localhost:4000.

`npm run setup` creates ignored local environment files (including a random local database password in the repo-root `.env`), starts PostgreSQL with Docker Compose, applies the Prisma migrations and seeds demo accounts. If port 5432 is taken, it uses 5433. On a newly configured checkout their password is `FarmersMarket2026!`. If `.env` already exists, setup preserves it and uses its `SEED_PASSWORD`. Rerunning seed does not overwrite existing account passwords.

| Account | Email                 | Purpose                                            |
| ------- | --------------------- | -------------------------------------------------- |
| Admin   | admin@farmers.market  | Review sellers and operate the marketplace         |
| Seller  | seller@farmers.market | Approved seller with example produce               |
| Buyer   | buyer@farmers.market  | Browse, book, fund a simulated wallet, and collect |

PostgreSQL runs in Docker (`docker compose up -d`; data persists in a Docker volume). The schema is managed by Prisma: `apps/api/prisma/schema.prisma` is the schema of record and `apps/api/prisma/migrations` holds the SQL migrations. `npm run dev` applies pending migrations before starting the API. To change the schema, edit `schema.prisma` and run `npm run db:migrate:dev -w @farmers-market/api -- --name <change>`. Tests use a separate `farmers_market_test` database that is rebuilt on every run.

Databases created before the Prisma switch (on PostgreSQL) need a one-time `npx prisma migrate resolve --applied 0_init` in `apps/api`. Data from the old embedded PGlite database is not migrated automatically; it is left untouched in `apps/api/.data/farmers-market`.

## Try the first flow

1. In the mobile app, create an account with a name, unique international-format phone number, email and password (minimum 10 characters), then verify the code emailed to you.
2. Open **Sell**, enter the business and private collection address, and submit for approval.
3. Sign in to the admin website and verify your email code, then open **Sellers**, review the application, enter a decision reason, and approve it.
4. Return to the seller app and refresh. Add a listing with a price and available stock. Changes are confirmed immediately.
5. In another browser session or on a second device, sign in as a buyer. Find the listing and request a quantity. A request alone does not hold stock.
6. As the seller, accept the incoming booking. Stock is reserved atomically for **168 hours (one week)**. Mark it ready for pickup when prepared.
7. As the buyer, open **Wallet**, add explicitly simulated funds, and pay for the accepted booking. **Bookings** shows the pickup address, external map directions and private six-digit pickup code.
8. On collection, give that code to the seller. The seller enters it and confirms pickup. Completion credits seller proceeds less the **5% commission** to the seller payable ledger account.
9. The admin can inspect the booking timeline, balanced ledger entries, and audit log.

Buyer and seller roles share an account but a seller cannot book their own produce. The seller can never retrieve a buyer's pickup code from the API. Cancellations and expiry release reserved stock and refund held wallet payments. Invalid pickup codes are logged and five failed attempts lock confirmation for 15 minutes. A background sweep checks expiry every 30 seconds; reads and order actions also check expiry.

Use a private browser window or separate browser profile to keep buyer, seller and administrator sessions separate. Sessions are per browser tab on web; native tokens use Expo SecureStore. Pull down to refresh mobile screens; data also refreshes every 20 seconds.

## Physical devices

Change `EXPO_PUBLIC_API_URL` in `apps/mobile/.env` to your computer's reachable LAN address, for example `http://192.168.1.20:4000/v1`, then restart Expo. On the Android emulator use `http://10.0.2.2:4000/v1`. Keep the phone and computer on the same network. Expo SDK 58 / React Native 0.88.1 require a matching Expo Go or development build. Native iOS and Android binaries have not been built in this checkout.

## Payments

Local development starts with `PAYMENTS_ENABLED=false` and `ALLOW_DEMO_FUNDING=true`. These balances are **simulated**, clearly labelled in both clients, and have no real monetary value. Demo funding is always unavailable when `NODE_ENV=production`.

Paystack and Flutterwave hosted-checkout adapters are implemented. To use provider sandbox payments:

1. Set `ALLOW_DEMO_FUNDING=false` and `PAYMENTS_ENABLED=true`.
2. Supply test keys in `apps/api/.env` for one or both providers.
3. Set `PAYMENT_RETURN_URL` to a reachable app/web return page. After checkout, the buyer uses **Verify completed payment**; signed provider webhooks also perform verification.
4. Configure public HTTPS webhook endpoints `/v1/webhooks/paystack` and `/v1/webhooks/flutterwave`. Configure Flutterwave's webhook secret to match `FLUTTERWAVE_WEBHOOK_SECRET`; this implementation expects the documented `flutterwave-signature` HMAC-SHA256 signature over the raw body. Paystack uses `x-paystack-signature` HMAC-SHA512.

A top-up interrupted mid-checkout is marked as interrupted and shown in Wallet; a background job re-checks pending top-ups with the provider every few minutes for 72 hours, so a lost webhook still credits the wallet (once). Redirect parameters and payment screenshots never credit a wallet. Funding credits require an authenticated server-side provider verification with matching reference, exact amount and NGN currency; repeated callbacks cannot credit twice. Keys stay on the API server.

Live provider accounts, wallet/custody approval, and provider sandbox/live acceptance checks are still required before handling customer money. The internal held-payment ledger is a technical accounting mechanism; it does not itself establish a licensed escrow or wallet service. Live payments and transfers have not been exercised.

Payout approvals commit a durable `READY` dispatch record before contacting the provider. The payout recovery job runs every minute, resumes approvals that were never dispatched, and rechecks in-progress transfers after a two-minute dispatch lease or five-minute retry delay. Flutterwave transfers can be recovered by reference even if a timeout lost their provider ID. Settlement requires matching reference, amount and NGN currency, under a payout row lock.

Once dispatch starts, recovery only verifies: it never automatically sends that payout again. An ambiguous or missing provider result keeps funds held and shows a review message and reference in **Payouts**; **Recheck** requests another verification. Operators must reconcile the reference with the provider before any manual correction. Existing interrupted payouts are migrated as `UNKNOWN` and verified without redispatch. A verified failed transfer returns held funds; an unverified rejection does not.

Apply the additive payout recovery migration with `npm run db:migrate` before starting the updated API and worker. Automated tests are deferred for this batch; typechecking, contract generation and builds are the validation steps.

Sellers and drivers withdraw earnings from **Wallet**: the bank account name is confirmed with the provider first, then staff approve each payout in the console's **Payouts** page. Transfers are settled only after the provider confirms them. Without provider keys, development payouts are simulated and labelled.

Provider references: [Paystack webhooks](https://paystack.com/docs/payments/webhooks/), [Flutterwave webhooks](https://developer.flutterwave.com/docs/webhooks), [Flutterwave verification](https://developer.flutterwave.com/docs/transaction-verification).

## Workspace

```text
apps/api        Express API (see apps/api/README.md for its layout)
apps/mobile     Expo app: Market, Bookings, Sell, Drive, Wallet, Inbox and Account
apps/admin      Vite/React operations console
packages/shared Shared frontend domain types and formatting
```

Useful commands:

```sh
npm run typecheck
npm run build
npm run export:web -w @farmers-market/mobile
npm run db:migrate
npm run db:seed
npm test
```

`npm test` runs the integration suite against a real PostgreSQL test database (`farmers_market_test`, rebuilt each run): OTP sign-in, bookings, payments and funding recovery, payouts, push, pre-orders, promotions, staff roles, documents, delivery (including a cancel/claim race), paging, security headers and the API contract. CI typechecks, checks the OpenAPI contract and builds every push. Tests also run in CI but are optional: a failure is reported without failing the build.

The API contract lives in `apps/api/openapi.json` and is generated from the code; `npm run api:contract` regenerates it and the TypeScript types in `packages/shared/src/api-types.ts`. The shared domain types (`Listing`, `Booking`, `Wallet`, …) are aliases of those generated types, and the mobile app calls the API through `apps/mobile/src/request.ts`, which checks paths, parameters and request bodies against the contract at compile time.

Production helpers: `npm run worker` (background jobs as their own process), `npm run backup` (database backup, optional S3 copy), `apps/api/Dockerfile` (API and worker image), and `apps/mobile/eas.json` (native build profiles).

## Email OTP with Nodemailer

Registration and sign-in now require a six-digit email code. Codes expire after ten minutes, can be used only once and allow five attempts. Resends have a one-minute cooldown and invalidate the previous code. Password recovery also uses email OTP and signs out all existing devices. Phone numbers are collected as contact details; no SMS provider is needed for this version.

For real email delivery, configure `apps/api/.env`:

```dotenv
MAIL_MODE=smtp
MAIL_FROM=Farmers Market <no-reply@your-domain.example>
SMTP_HOST=smtp.your-provider.example
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=your-smtp-user
SMTP_PASSWORD=your-smtp-password
OTP_SECRET=your-random-secret-with-at-least-32-characters
```

Port 587 uses required STARTTLS. For implicit TLS on port 465, use `SMTP_SECURE=true`. Credentials stay on the server. Use a sender your mail provider permits; configure its domain records according to that provider's instructions. See [Nodemailer SMTP documentation](https://nodemailer.com/smtp).

Until SMTP is configured, local `MAIL_MODE=file` uses Nodemailer's stream transport and saves private `.eml` files in `apps/api/.data/farmers-market/mail`. Open the newest verification-code email locally to obtain the development code. These files are not served by the API; no code is returned in an HTTP response. Restart the API after changing environment settings. Production startup requires SMTP and an OTP secret and never permits file delivery. New checkout setup generates an OTP secret automatically.

Access tokens expire after 30 minutes; clients rotate refresh credentials automatically for up to 30 days. Reusing an already consumed refresh credential revokes its device session. Account settings list signed-in devices and allow revocation. Existing pre-OTP sessions are invalidated when the account migration is applied.

## Photos, messaging and notifications

Approved sellers can choose or take up to six photos per listing. The API validates and compresses JPEG/PNG/WebP inputs (maximum 5 MB each) and creates WebP thumbnails. Set `PUBLIC_API_URL` to the reachable API origin so image URLs work on physical phones. Local uploads persist under `UPLOAD_DIR`. For deployments, set `STORAGE_PROVIDER=s3` and configure the S3-compatible photo bucket; use `RECORDS_STORAGE_PROVIDER=s3` and a private records bucket for verification documents and dispute evidence. New camera permissions require rebuilding a native development client.

Open a listing and choose **Message seller**. The **Inbox** tab contains conversations and booking updates, with unread/read status, participant blocking and reporting. Messages are text only in this batch. WebSocket connections authenticate via a message rather than URL credentials, and polling provides a fallback. Messages are persisted before delivery/read acknowledgement.

Booking events and seller-review decisions create inbox updates and durable email jobs in the same database transaction. A worker retries failed emails with backoff. Administrators can inspect **Email queue** and retry failed jobs. Account settings control non-authentication email alerts. Expo push delivery is implemented with a durable queue and retries. Configure the EAS project and native push credentials before validating delivery on devices.

Seller profiles show completed-pickup reviews and allow favouriting. Only the booking buyer can review a completed pickup. **Users** and **Reports** in the admin console support account status changes and moderation report resolution; booking disputes support private evidence, returns, staff decisions and refunds, with receipts available to buyers.

## Delivery

Buyers can choose **Get it delivered instead** on an accepted booking. Drivers apply free in the **Drive** tab and are approved under **Drivers** in the console. Vehicle fares, the delivery commission, the driver job radius and digital Pay on Delivery (off by default) are set under **Settings**. Drop-off and pickup use map pins, so the seller needs a collection pin.

## Staging and phone builds

- Staging on Render: [docs/deploy-staging.md](docs/deploy-staging.md). The Blueprint wires browser API hosts and CORS to Render’s public hostnames, and gives the worker the API’s public URL. Custom domains need explicit CORS and public URL overrides.
- Payment acceptance in provider test mode: [docs/payment-acceptance.md](docs/payment-acceptance.md)
- Phone builds with Expo EAS: [docs/mobile-builds.md](docs/mobile-builds.md)

## Current scope

This is still a local build rather than a production release. What's built, what needs external accounts or decisions (legal review, live payment accounts, native-speaker translation review, store accounts), and known limitations are tracked in [build progress](docs/build-progress.md).
