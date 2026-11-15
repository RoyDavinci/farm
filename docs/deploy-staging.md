# Staging on Render

`render.yaml` describes the whole staging environment, all in Render's Frankfurt region (the closest to Nigeria):

| Render resource                          | What it runs                                                                                  |
| ---------------------------------------- | --------------------------------------------------------------------------------------------- |
| `farmers-market-api` (web, Docker)       | The API. Runs `prisma migrate deploy` before each release, and its health check is `/health`. |
| `farmers-market-worker` (worker, Docker) | Background jobs: expiry, email, push, funding recovery.                                       |
| `farmers-market-admin` (static site)     | The operations console.                                                                       |
| `farmers-market-web` (static site)       | The mobile app as a website, so it can be tried on any phone browser.                         |
| `farmers-market-db` (Postgres 17)        | The database.                                                                                 |
| `farmers-market-redis` (Key Value)       | Shared rate limits and live updates. Internal only.                                           |

Staging runs with `NODE_ENV=production`. That means real email, real (test-mode) payments, no simulated money, and the same safety checks as production. Each service redeploys on its own after CI passes on `main`. Then the **Staging smoke test** workflow waits for the new commit to go live and checks it.

## One-time setup

1. **Push the repository to GitHub.** It has no remote yet:
   ```bash
   git remote add origin git@github.com:<you>/<repo>.git
   ```
   ```bash
   git push -u origin main
   ```
2. **File storage (Cloudflare R2, or any S3-compatible storage).**
   - Create two buckets, for example `farmers-market-staging` (photos) and `farmers-market-staging-records` (private documents and evidence).
   - Create an API token with read/write access to both.
   - Note the S3 endpoint, `https://<account-id>.r2.cloudflarestorage.com`.
3. **Email.** Get SMTP settings from a provider such as Resend, Postmark, Brevo or Amazon SES. You need a host, username, password, and a verified sender address for `MAIL_FROM`.
4. **Payments (test mode).**
   - **Paystack:** the test secret key (`sk_test_…`). For payout testing, enable transfers on the account.
   - **Flutterwave:** the test secret key (`FLWSECK_TEST-…`), plus a webhook secret hash of your choosing.
5. **Optional.**
   - A Mapbox public token (`pk.…`) for maps and road-distance fares. Without it, fares use the straight-line estimate.
   - An Expo access token for push security.
6. **Create the Blueprint.** In Render, go to **New → Blueprint**, pick the repository, and Render reads `render.yaml`.
   - Fill in the values it asks for (all are marked `sync: false`). The API and the worker ask for the same SMTP, payment, storage and Mapbox values; give both the same answers.
   - `S3_ENDPOINT` is the R2 endpoint, `S3_BUCKET` the photos bucket, and `RECORDS_S3_BUCKET` the records bucket. `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY` are the R2 token's keys.
   - Render generates `OTP_SECRET` and `PAYOUT_ENCRYPTION_KEY` once and shares them between the API and the worker. Never change `PAYOUT_ENCRYPTION_KEY` afterwards, or stored bank accounts become unreadable.
7. **Payment webhooks** (after the first deploy, using the API's URL):
   - Paystack: Settings → API Keys & Webhooks → Test Webhook URL: `https://<api-host>/v1/webhooks/paystack`.
   - Flutterwave: Settings → Webhooks → `https://<api-host>/v1/webhooks/flutterwave`, with the same secret hash as `FLUTTERWAVE_WEBHOOK_SECRET`.
   - Callback/redirect URL (both providers): `https://<api-host>/v1/payments/return`. The API works this out from its own URL, so no setting is needed.
8. **First staff account.**
   - Register in the staging web app (`farmers-market-web`).
   - Open the database in Render, use **Connect → PSQL**, and run this with the address you registered:
     ```sql
     UPDATE users SET admin = true, staff_role = 'owner' WHERE email = '<you>';
     ```
   - Sign in to the admin site. Further staff are added from its **Staff** page.
9. **Smoke test in GitHub.**
   - Under Settings → Secrets and variables → Actions → **Variables**, add `STAGING_API_URL`, `STAGING_ADMIN_URL` and `STAGING_WEB_URL`.
   - The **Staging smoke test** workflow then runs after every successful build of `main`. You can also run it by hand from the Actions tab.

## Checking staging by hand

```bash
npm run smoke -- --api https://<api-host> --admin https://<admin-host> --web https://<web-host>
```

To check payments end to end against the providers' test environments, see [payment acceptance](payment-acceptance.md).

## Notes

- **Plans:** Render's default paid plans are used, because workers and pre-deploy migrations aren't available on the free plan. Change `plan:` in `render.yaml` to resize.
- **Phone builds:** set `EXPO_PUBLIC_API_URL=https://<api-host>/v1` in the EAS `preview` profile (see `apps/mobile/eas.json`).
- **Backups:** Render takes daily Postgres backups on paid plans. `npm run backup` with `DATABASE_URL` set to the external connection string takes an extra copy.
