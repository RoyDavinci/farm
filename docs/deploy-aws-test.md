# Ahia test environment (AWS)

One EC2 server in London (eu-west-2) runs the whole test environment in Docker, in pilot mode.

| What           | Address                                         |
| -------------- | ----------------------------------------------- |
| API            | https://api.ahiamarketplace.com/v1              |
| Admin console  | https://admin.ahiamarketplace.com               |
| Mobile web app | https://app.ahiamarketplace.com                 |
| Health         | https://api.ahiamarketplace.com/health/ready    |
| Site           | https://ahiamarketplace.com (redirects to app.) |

The domain is `DOMAIN` in `deploy/aws-test.env`; Caddy gets Let's Encrypt certificates for each address
automatically (renewed automatically). The old `api.`, `admin.` and `app.35-177-195-6.sslip.io`
addresses keep working, so app builds made before the switch still connect.

DNS (at Hostinger, the registrar): A records for `@`, `www`, `api`, `admin` and `app`, all pointing at
`35.177.195.6`. `deploy/deploy.sh` refuses to release until all five resolve to the server, because
Let's Encrypt cannot issue a certificate for a name that points elsewhere. Remove `DOMAIN` to go
back to sslip.io only.

## AWS resources (all tagged `Project=zuru-test`)

IDs are in `deploy/aws-test.env`.

- EC2 `t4g.small` (Ubuntu 24.04, ARM) with a 30 GB encrypted disk and 2 GB swap: about $15 a month.
- Elastic IP 35.177.195.6 (free while attached to the running server).
- Security group `zuru-test`: SSH only from the developer's VPN range `79.127.146.0/24` (key login
  only); HTTP/HTTPS open;
  TURN on 3478 (UDP/TCP) and relay ports 49160–49359 (UDP) for voice calls.
- Key pair `zuru-test`: the private key is `~/.ssh/zuru-test.pem` on the Mac that created it.

If you connect from outside that range (VPN off, another network), allow your address:

```bash
aws ec2 authorize-security-group-ingress --region eu-west-2 --group-id sg-05df7c7eb0bf34744 --protocol tcp --port 22 --cidr "$(curl -s https://checkip.amazonaws.com)/32"
```

## On the server (`/opt/zuru`)

Docker Compose runs `postgres`, `redis`, `migrate` (runs before each release), `api`, `worker`,
`caddy` and `coturn`. Uploads, the database, Redis and certificates live in Docker volumes and survive releases.

Settings: `NODE_ENV=production`, `PILOT_MODE=true` with voice calls, Local Status (stories) and paid promotions
switched back on (`FEATURE_VOICE`, `FEATURE_LOCAL_STATUS`, `FEATURE_PROMOTIONS`), Paystack/Flutterwave **test** keys, Gmail SMTP,
uploads on the server disk. Secrets are generated once into `deploy/.env.test` (git-ignored) by
`node deploy/make-env.mjs`.

## Voice calls

Voice is switched on for the test environment (`FEATURE_VOICE=true`, overriding pilot mode).
Calls are relay-only: audio goes through the coturn server on this machine
(`deploy/turnserver.conf.template`), so neither caller sees the other's IP address. The API hands each
signed-in caller a TURN login that expires after an hour (HMAC of the shared `VOICE_TURN_SECRET`).
The relay refuses to forward into private networks or the AWS metadata address.

Phones need a build made after the microphone-permission fix (Android `RECORD_AUDIO`, iOS microphone
text). Older builds cannot use the microphone.

## Releasing

```bash
deploy/deploy.sh
```

Uploads the API source (a few hundred KB; git-ignored files such as `.env` are never sent) and builds
the image on the server, builds the admin console and the mobile web app locally pointed at the HTTPS
API, uploads them over SSH, runs migrations, restarts the services, and checks `/health`. A release
takes about four minutes. It keeps the last three images on the server.

If it stops at "Waiting for the server", your IP address has changed: allow it again (above).

Check it afterwards:

```bash
npm run smoke -- --api https://api.ahiamarketplace.com --admin https://admin.ahiamarketplace.com --web https://app.ahiamarketplace.com
```

## First staff account

1. Register in the web app (or the phone app) with your email; the code arrives by email.
2. Make that account the owner:
   ```bash
   ssh -i ~/.ssh/zuru-test.pem ubuntu@35.177.195.6 "cd /opt/zuru && docker compose exec -T postgres psql -U zuru -d zuru -c \"UPDATE users SET admin=true, staff_role='owner' WHERE email='YOU@example.com'\""
   ```
3. Sign in to the admin console. Add further staff from its Staff page.

## Payment webhooks (provider test dashboards)

- Paystack: `https://api.ahiamarketplace.com/v1/webhooks/paystack`
- Flutterwave: `https://api.ahiamarketplace.com/v1/webhooks/flutterwave` (secret hash = `FLUTTERWAVE_WEBHOOK_SECRET`)

Each provider account holds one webhook URL; if another app uses the same test account, only one of
them gets webhooks. Without webhooks, payments are still confirmed by the return page, the in-app
"I've paid — confirm" button and the recovery job.

## Phone builds

`apps/mobile/eas.json` points the `development` and `preview` builds at this API.
`npm run dev:mobile:test` runs the app locally against it. See [phone builds](mobile-builds.md).

## Logs and maintenance

```bash
ssh -i ~/.ssh/zuru-test.pem ubuntu@35.177.195.6
cd /opt/zuru && docker compose ps && docker compose logs -f api worker
```

There are no automatic backups on this test server. To take one:
`docker compose exec -T postgres pg_dump -U zuru zuru | gzip > ahia-$(date +%F).sql.gz`.

## Removing it

Stops all charges (deletes the server, its disk and data):

```bash
source deploy/aws-test.env
aws ec2 terminate-instances --region $REGION --instance-ids $INSTANCE_ID
aws ec2 wait instance-terminated --region $REGION --instance-ids $INSTANCE_ID
aws ec2 release-address --region $REGION --allocation-id $ALLOCATION_ID
aws ec2 delete-security-group --region $REGION --group-id $SECURITY_GROUP
aws ec2 delete-key-pair --region $REGION --key-name zuru-test
```

## Demo catalogue

28 demo sellers in Lagos, Abuja, Ibadan and Port Harcourt with 229 products (drawn product pictures),
34 stories and about 240 reviews from 12 demo buyers, so the app has something to show. Each review belongs to a past order that is
marked completed and unpaid (no money moved). Demo accounts use `@demo.ahia.example` and cannot sign
in.

```bash
node deploy/demo/draw-photos.mjs   # draws deploy/demo/photos/*.jpg (git-ignored)
```

Upload the pictures and load them (safe to re-run; it skips what already exists):

```bash
COPYFILE_DISABLE=1 tar --no-mac-metadata -C deploy/demo/photos -czf - . | ssh -i ~/.ssh/zuru-test.pem ubuntu@35.177.195.6 'rm -rf /opt/zuru/demo-photos && mkdir -p /opt/zuru/demo-photos && tar -C /opt/zuru/demo-photos -xzf - && cd /opt/zuru && docker compose run --rm --no-deps -v /opt/zuru/demo-photos:/demo:ro -e DEMO_CATALOG=yes api node dist/database/demo-catalog.js /demo'
```

Stories last a week. To bring them back, or to delete all demo data:

```bash
ssh -i ~/.ssh/zuru-test.pem ubuntu@35.177.195.6 'cd /opt/zuru && docker compose run --rm --no-deps -e DEMO_CATALOG=yes api node dist/database/demo-catalog.js --refresh-stories'
ssh -i ~/.ssh/zuru-test.pem ubuntu@35.177.195.6 'cd /opt/zuru && docker compose run --rm --no-deps -e DEMO_CATALOG=yes api node dist/database/demo-catalog.js --remove'
```
