#!/usr/bin/env bash
# Deploy Mycade to the VPS: ship the current commit, install, build, run the server,
# and expose it over HTTPS with a Cloudflare quick tunnel (iOS needs HTTPS for motion).
#   usage (from repo root, inside WSL or Git Bash with ssh):  deploy/deploy.sh altair@23.95.188.69
set -euo pipefail
HOST="${1:-altair@23.95.188.69}"
APP_DIR='~/mycade'
CREDS_LOCAL="${CREDS_LOCAL:-}"

echo "==> shipping $(git rev-parse --short HEAD) to $HOST"
git archive --format=tar HEAD | ssh "$HOST" "mkdir -p $APP_DIR && tar -x -C $APP_DIR"

if [ -f .env ]; then
  echo "==> syncing .env (secrets stay off git)"
  scp -q .env "$HOST:$APP_DIR/.env"
fi
if [ -n "$CREDS_LOCAL" ] && [ -f "$CREDS_LOCAL" ]; then
  scp -q "$CREDS_LOCAL" "$HOST:$APP_DIR/gcp-creds.json"
fi
if [ -d server/data/avatars ]; then
  echo "==> syncing cached Buddies"
  ssh "$HOST" "mkdir -p $APP_DIR/server/data"
  tar -c -C server/data avatars | ssh "$HOST" "tar -x -C $APP_DIR/server/data"
fi

ssh "$HOST" bash -s <<'REMOTE'
set -euo pipefail
cd ~/mycade
# VPS-specific env: plain HTTP behind the tunnel, creds path on this box
sed -i '/^HTTPS=/d;/^GOOGLE_APPLICATION_CREDENTIALS=/d;/^tripo AI/d' .env || true
echo 'HTTPS=0' >> .env
[ -f gcp-creds.json ] && echo "GOOGLE_APPLICATION_CREDENTIALS=$HOME/mycade/gcp-creds.json" >> .env
npm ci --no-audit --no-fund --loglevel=error
npm run build --silent

# tunnel first so we know the public URL for the QR code
if ! docker ps --format '{{.Names}}' | grep -q '^mycade-tunnel$'; then
  docker rm -f mycade-tunnel >/dev/null 2>&1 || true
  docker run -d --name mycade-tunnel --restart unless-stopped --network host \
    cloudflare/cloudflared:latest tunnel --no-autoupdate --url http://localhost:8787 >/dev/null
fi
URL=""
for i in $(seq 1 30); do
  URL=$(docker logs mycade-tunnel 2>&1 | grep -o 'https://[a-z0-9-]*\.trycloudflare\.com' | tail -1 || true)
  [ -n "$URL" ] && break
  sleep 1
done
sed -i '/^PUBLIC_URL=/d' .env
[ -n "$URL" ] && echo "PUBLIC_URL=$URL" >> .env

pkill -f 'node server/index.js' || true
sleep 1
nohup node server/index.js > ~/mycade/server.log 2>&1 &
sleep 2
tail -5 ~/mycade/server.log
echo "PUBLIC: $URL"
REMOTE
