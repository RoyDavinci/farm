#!/bin/zsh
# Deploys the Ahia test environment to the EC2 server in deploy/aws-test.env.
#   deploy/deploy.sh            build everything and release it
# Needs: ~/.ssh/zuru-test.pem, deploy/.env.test (node deploy/make-env.mjs).
set -euo pipefail
cd "${0:A:h}/.."
source deploy/aws-test.env
# DOMAIN (aws-test.env) is the main address; the sslip.io names keep working for older app builds.
SSLIP="${PUBLIC_IP//./-}.sslip.io"
HOST_SUFFIX="${DOMAIN:-$SSLIP}"
API_URL="https://api.$HOST_SUFFIX/v1"
if [[ $HOST_SUFFIX == $SSLIP ]]; then
  API_HOSTS="api.$SSLIP" ADMIN_HOSTS="admin.$SSLIP" APP_HOSTS="app.$SSLIP"
  ROOT_HOSTS="www.$SSLIP" ROOT_HOST="www.$SSLIP" WWW_HOSTS="home.$SSLIP"
else
  API_HOSTS="api.$DOMAIN, api.$SSLIP" ADMIN_HOSTS="admin.$DOMAIN, admin.$SSLIP"
  APP_HOSTS="app.$DOMAIN, app.$SSLIP" ROOT_HOSTS="$DOMAIN" ROOT_HOST="$DOMAIN" WWW_HOSTS="www.$DOMAIN"
  # Let's Encrypt can only issue certificates once every name points at this server.
  for h in $DOMAIN www.$DOMAIN api.$DOMAIN admin.$DOMAIN app.$DOMAIN; do
    got=$(dig +short A $h | tail -1)
    [[ $got == $PUBLIC_IP ]] || { echo "✗ $h resolves to '${got:-nothing}', not $PUBLIC_IP. Add an A record for it and retry."; exit 1; }
  done
fi
RELEASE="$(git rev-parse --short HEAD 2>/dev/null || echo dev)-$(date +%Y%m%d%H%M%S)"
SSH=(ssh -i ~/.ssh/zuru-test.pem -o StrictHostKeyChecking=accept-new -o ServerAliveInterval=30 ubuntu@$PUBLIC_IP)
BUILD=deploy/.build
rm -rf $BUILD && mkdir -p $BUILD/sites

echo "▸ Release $RELEASE → $HOST_SUFFIX"
echo "▸ Waiting for the server to finish its first-boot setup"
until "${SSH[@]}" 'test -f /var/lib/zuru-ready && docker info >/dev/null 2>&1' 2>/dev/null; do sleep 5; done

echo "▸ Building the admin console and the mobile web app"
cp -R apps/landing $BUILD/sites/landing
VITE_API_URL=$API_URL npm run build -w @ahia/admin >/dev/null
cp -R apps/admin/dist $BUILD/sites/admin
(cd apps/mobile && EXPO_PUBLIC_API_URL=$API_URL npx expo export --platform web --output-dir ../../$BUILD/sites/web >/dev/null)

# Upload only the API source (a few MB) and build the image on the server: uploading a built
# image (~1.5 GB) is far too slow on an ordinary home connection.
echo "▸ Uploading the API source and building the image on the server"
{
  printf '%s\n' .dockerignore package.json package-lock.json tsconfig.base.json \
    apps/api/package.json apps/admin/package.json apps/mobile/package.json packages/shared/package.json
  git ls-files -co --exclude-standard apps/api # git-ignored files (.env, uploads) never leave the Mac
} | sort -u > $BUILD/context.txt
COPYFILE_DISABLE=1 tar --no-mac-metadata --no-xattrs -czf - -T $BUILD/context.txt | "${SSH[@]}" "rm -rf /opt/zuru/src && mkdir -p /opt/zuru/src && tar -C /opt/zuru/src -xzf - 2>/dev/null &&
  cd /opt/zuru/src && docker build -q -f apps/api/Dockerfile -t zuru-api:$RELEASE . >/dev/null"

echo "▸ Uploading configuration and sites"
# Caddy bind-mounts /opt/zuru/sites: replace its contents in place, never the folder itself.
# Public URLs and CORS follow the current addresses rather than whatever .env.test was created with.
{
  grep -vE '^(HOST_SUFFIX|POSTGRES_PASSWORD|TURN_PRIVATE_IP|PUBLIC_API_URL|PUBLIC_WEB_URL|CORS_ORIGINS)=' deploy/.env.test
  echo "PUBLIC_API_URL=https://api.$HOST_SUFFIX"
  echo "PUBLIC_WEB_URL=https://app.$HOST_SUFFIX"
  echo "CORS_ORIGINS=https://admin.$HOST_SUFFIX,https://app.$HOST_SUFFIX,https://admin.$SSLIP,https://app.$SSLIP"
} > $BUILD/api.env
{
  echo "RELEASE=$RELEASE"
  echo "API_HOSTS=$API_HOSTS"
  echo "ADMIN_HOSTS=$ADMIN_HOSTS"
  echo "APP_HOSTS=$APP_HOSTS"
  echo "ROOT_HOSTS=$ROOT_HOSTS"
  echo "ROOT_HOST=$ROOT_HOST"
  echo "WWW_HOSTS=$WWW_HOSTS"
  echo "ANDROID_APK_URL=${ANDROID_APK_URL:-/#faq}"
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
  docker image ls zuru-api --format "{{.Tag}}" | sort -r | tail -n +4 | xargs -r -I{} docker image rm zuru-api:{} >/dev/null 2>&1 || true
  docker builder prune -f --filter until=168h >/dev/null 2>&1 || true'

echo "▸ Checking https://api.$HOST_SUFFIX/health"
for i in {1..30}; do
  curl -fsS --max-time 10 "https://api.$HOST_SUFFIX/health" && echo && break
  sleep 5
done
echo
echo "API:    https://api.$HOST_SUFFIX/v1"
echo "Admin:  https://admin.$HOST_SUFFIX"
echo "Web:    https://app.$HOST_SUFFIX"
[[ $HOST_SUFFIX == $SSLIP ]] || echo "Site:   https://$DOMAIN (landing page)"
