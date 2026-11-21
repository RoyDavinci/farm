#!/bin/zsh
# Deploys the Ahia test environment to the EC2 server in deploy/aws-test.env.
#   deploy/deploy.sh            build everything and release it
# Needs: Docker running locally, ~/.ssh/zuru-test.pem, deploy/.env.test (node deploy/make-env.mjs).
set -euo pipefail
cd "${0:A:h}/.."
source deploy/aws-test.env
HOST_SUFFIX="${PUBLIC_IP//./-}.sslip.io"
API_URL="https://api.$HOST_SUFFIX/v1"
RELEASE="$(git rev-parse --short HEAD 2>/dev/null || echo dev)-$(date +%Y%m%d%H%M%S)"
SSH=(ssh -i ~/.ssh/zuru-test.pem -o StrictHostKeyChecking=accept-new -o ServerAliveInterval=30 ubuntu@$PUBLIC_IP)
BUILD=deploy/.build
rm -rf $BUILD && mkdir -p $BUILD/sites

echo "▸ Release $RELEASE → $HOST_SUFFIX"
echo "▸ Waiting for the server to finish its first-boot setup"
until "${SSH[@]}" 'test -f /var/lib/zuru-ready && docker info >/dev/null 2>&1' 2>/dev/null; do sleep 5; done

echo "▸ Building the API image (linux/arm64)"
docker build --platform linux/arm64 -f apps/api/Dockerfile -t zuru-api:$RELEASE . >/dev/null

echo "▸ Building the admin console and the mobile web app"
VITE_API_URL=$API_URL npm run build -w @ahia/admin >/dev/null
cp -R apps/admin/dist $BUILD/sites/admin
(cd apps/mobile && EXPO_PUBLIC_API_URL=$API_URL npx expo export --platform web --output-dir ../../$BUILD/sites/web >/dev/null)

echo "▸ Uploading the image"
docker save zuru-api:$RELEASE | gzip -1 | "${SSH[@]}" 'gunzip | docker load' >/dev/null

echo "▸ Uploading configuration and sites"
# Caddy bind-mounts /opt/zuru/sites: replace its contents in place, never the folder itself.
grep -vE '^(HOST_SUFFIX|POSTGRES_PASSWORD|TURN_PRIVATE_IP)=' deploy/.env.test > $BUILD/api.env
{
  echo "RELEASE=$RELEASE"
  echo "HOST_SUFFIX=$HOST_SUFFIX"
  grep -E '^POSTGRES_PASSWORD=' deploy/.env.test
} > $BUILD/.env
chmod 600 $BUILD/api.env $BUILD/.env
cp deploy/compose.yaml deploy/Caddyfile $BUILD/
# TURN relay config, filled from the secrets file (the server's private IP comes from AWS).
TURN_SECRET=$(grep -E '^VOICE_TURN_SECRET=' deploy/.env.test | cut -d= -f2-)
PRIVATE_IP=$(grep -E '^TURN_PRIVATE_IP=' deploy/.env.test | cut -d= -f2-)
sed -e "s/__PUBLIC_IP__/$PUBLIC_IP/" -e "s/__PRIVATE_IP__/$PRIVATE_IP/g" -e "s/__TURN_SECRET__/$TURN_SECRET/" \
  deploy/turnserver.conf.template > $BUILD/turnserver.conf
chmod 600 $BUILD/turnserver.conf
COPYFILE_DISABLE=1 tar --no-mac-metadata --no-xattrs -C $BUILD -czf - compose.yaml Caddyfile turnserver.conf api.env .env sites | "${SSH[@]}" 'rm -rf /opt/zuru/next && mkdir -p /opt/zuru/next && tar -C /opt/zuru/next -xzf - 2>/dev/null &&
  cd /opt/zuru && mkdir -p sites && find sites -mindepth 1 -delete && cp -a next/sites/. sites/ && mv next/compose.yaml next/Caddyfile next/turnserver.conf next/api.env next/.env . && rm -rf next && chmod 600 api.env .env && chmod 644 turnserver.conf'

echo "▸ Starting release $RELEASE"
"${SSH[@]}" 'cd /opt/zuru && docker compose up -d --remove-orphans --wait api worker caddy coturn && docker compose exec -T caddy caddy reload --config /etc/caddy/Caddyfile >/dev/null 2>&1 || true
  docker image ls zuru-api --format "{{.Tag}}" | sort -r | tail -n +4 | xargs -r -I{} docker image rm zuru-api:{} >/dev/null 2>&1 || true'

echo "▸ Checking https://api.$HOST_SUFFIX/health"
for i in {1..30}; do
  curl -fsS --max-time 10 "https://api.$HOST_SUFFIX/health" && echo && break
  sleep 5
done
echo
echo "API:    https://api.$HOST_SUFFIX/v1"
echo "Admin:  https://admin.$HOST_SUFFIX"
echo "Web:    https://app.$HOST_SUFFIX"
