#!/usr/bin/env bash
# Follow the test server's logs.  Usage: npm run logs:test [-- api|worker|edge|failures|samsung]
#   api       every API request (failed ones show errorCode, reason and the device)
#   worker    background jobs (emails, push, expiries)
#   edge      every request reaching the front door (Caddy), even ones the API never saw
#   failures  API requests that failed, and the app's "could not reach Ahia" reports
#   samsung   front-door and API lines from Samsung phones and browsers
set -euo pipefail
cd "$(dirname "$0")/.."
SSH=(ssh -i "${SSH_KEY:-$HOME/.ssh/zuru-test.pem}" -o ConnectTimeout=10 "ubuntu@${HOST:-35.177.195.6}")
case "${1:-api}" in
  api) "${SSH[@]}" 'docker logs -f --tail 50 zuru-api-1' ;;
  worker) "${SSH[@]}" 'docker logs -f --tail 50 zuru-worker-1' ;;
  edge) "${SSH[@]}" 'docker logs -f --tail 50 zuru-caddy-1 2>&1 | grep --line-buffered "http.log.access"' ;;
  failures) "${SSH[@]}" 'docker logs -f --tail 500 zuru-api-1 2>&1 | grep --line-buffered -E "\"status\":(4|5)[0-9][0-9]|could not reach"' ;;
  samsung) "${SSH[@]}" '(docker logs -f --tail 2000 zuru-caddy-1 2>&1 & docker logs -f --tail 2000 zuru-api-1 2>&1) | grep --line-buffered -iE "samsung|SM-[A-Z][0-9]"' ;;
  *) echo "Usage: npm run logs:test -- api|worker|edge|failures|samsung" >&2; exit 1 ;;
esac
