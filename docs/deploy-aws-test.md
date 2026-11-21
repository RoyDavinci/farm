# Zuru test environment (AWS)

One EC2 server in London (eu-west-2) runs the whole test environment in Docker, in pilot mode.

| What           | Address                                        |
| -------------- | ---------------------------------------------- |
| API            | https://api.35-177-195-6.sslip.io/v1           |
| Admin console  | https://admin.35-177-195-6.sslip.io            |
| Mobile web app | https://app.35-177-195-6.sslip.io              |
| Health         | https://api.35-177-195-6.sslip.io/health/ready |

`sslip.io` turns the server's fixed IP into a hostname, and Caddy gets Let's Encrypt certificates for
each address automatically (renewed automatically). To use your own domain later, point
`api.`, `admin.` and `app.` records at the IP and change `HOST_SUFFIX` handling in `deploy/`.

## AWS resources (all tagged `Project=zuru-test`)

IDs are in `deploy/aws-test.env`.

- EC2 `t4g.small` (Ubuntu 24.04, ARM) with a 30 GB encrypted disk and 2 GB swap: about $15 a month.
- Elastic IP 35.177.195.6 (free while attached to the running server).
- Security group `zuru-test`: SSH only from the developer Mac's IP at creation time; HTTP/HTTPS open.
- Key pair `zuru-test`: the private key is `~/.ssh/zuru-test.pem` on the Mac that created it.

If your IP changes, allow SSH again:

```bash
aws ec2 authorize-security-group-ingress --region eu-west-2 --group-id sg-05df7c7eb0bf34744 --protocol tcp --port 22 --cidr "$(curl -s https://checkip.amazonaws.com)/32"
```

## On the server (`/opt/zuru`)

Docker Compose runs `postgres`, `redis`, `migrate` (runs before each release), `api`, `worker` and
`caddy`. Uploads, the database, Redis and certificates live in Docker volumes and survive releases.

Settings: `NODE_ENV=production`, `PILOT_MODE=true`, Paystack/Flutterwave **test** keys, Gmail SMTP,
uploads on the server disk. Secrets are generated once into `deploy/.env.test` (git-ignored) by
`node deploy/make-env.mjs`.

## Releasing

```bash
deploy/deploy.sh
```

Builds the API image locally (ARM, same as the server), builds the admin console and the mobile web
app pointed at the HTTPS API, uploads everything over SSH, runs migrations, restarts the services,
and checks `/health`. It keeps the last three images on the server.

Check it afterwards:

```bash
npm run smoke -- --api https://api.35-177-195-6.sslip.io --admin https://admin.35-177-195-6.sslip.io --web https://app.35-177-195-6.sslip.io
```

## First staff account

1. Register in the web app (or the phone app) with your email; the code arrives by email.
2. Make that account the owner:
   ```bash
   ssh -i ~/.ssh/zuru-test.pem ubuntu@35.177.195.6 "cd /opt/zuru && docker compose exec -T postgres psql -U zuru -d zuru -c \"UPDATE users SET admin=true, staff_role='owner' WHERE email='YOU@example.com'\""
   ```
3. Sign in to the admin console. Add further staff from its Staff page.

## Payment webhooks (provider test dashboards)

- Paystack: `https://api.35-177-195-6.sslip.io/v1/webhooks/paystack`
- Flutterwave: `https://api.35-177-195-6.sslip.io/v1/webhooks/flutterwave` (secret hash = `FLUTTERWAVE_WEBHOOK_SECRET`)

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
`docker compose exec -T postgres pg_dump -U zuru zuru | gzip > zuru-$(date +%F).sql.gz`.

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
