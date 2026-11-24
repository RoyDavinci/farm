#!/bin/zsh
# Opens Prisma Studio on the TEST SERVER's database through an SSH tunnel.
#   ./deploy/studio.sh           → http://localhost:5555 (Ctrl-C closes it and the tunnel)
# For your local database instead: npm run db:studio
# Careful: edits in Studio change the live test data straight away.
set -euo pipefail
cd "${0:A:h}/.."
source deploy/aws-test.env
SSH=(ssh -i ~/.ssh/zuru-test.pem -o StrictHostKeyChecking=accept-new -o ServerAliveInterval=30 ubuntu@$PUBLIC_IP)
PG_IP=$("${SSH[@]}" "docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' zuru-postgres-1")
PASS=$(grep '^POSTGRES_PASSWORD=' deploy/.env.test | cut -d= -f2-)
PORT=15432
"${SSH[@]}" -N -L $PORT:$PG_IP:5432 &
TUNNEL=$!
trap 'kill $TUNNEL 2>/dev/null' EXIT INT TERM
sleep 2
echo "▸ Prisma Studio on the test server database → http://localhost:5555"
cd apps/api
DATABASE_URL="postgresql://zuru:$(node -e 'console.log(encodeURIComponent(process.argv[1]))' "$PASS")@127.0.0.1:$PORT/zuru" npx prisma studio --port 5555 --browser none
