#!/usr/bin/env bash
# Local launcher: Mongo (docker) + API :5000 + React :3001
# Runs at boot as the systemd user service `hypertube` (see scripts/hypertube.service).
cd "$(dirname "$0")"
source ~/.nvm/nvm.sh && nvm use 16 >/dev/null

# Downloads go to the USB drive when it's set up (scripts/setup-usb-storage.sh)
USB=/mnt/hypertube
if grep -q "[[:space:]]$USB[[:space:]]" /etc/fstab; then
  for i in $(seq 1 60); do mountpoint -q "$USB" && break; sleep 2; done
  mountpoint -q "$USB" || { echo "USB drive not mounted at $USB"; exit 1; }
  export TORRENT_DIR="$USB/torrents"
  export TORRENT_CACHE_GB="${TORRENT_CACHE_GB:-800}"
  mkdir -p "$TORRENT_DIR"
fi

# secrets (OAuth keys, session secret) live in .env, which git ignores
set -a
[ -f .env ] && . ./.env
set +a

# at boot Docker may still be starting
for i in $(seq 1 30); do docker start hypertube-mongo >/dev/null 2>&1 && break; sleep 2; done
export MONGO_URI="${MONGO_URI:-mongodb://localhost:27017/Hypertube}"

# HYPERTUBE_DEV=1 runs the hot-reloading dev servers instead (nodemon + React dev server)
if [ "${HYPERTUBE_DEV:-0}" = "1" ]; then
  exec npm run dev
fi

# Production: built web app + API in one Node process. Rebuild the web app when its source
# changed since the last build (a restart of the service is all a deploy needs).
BUILD=client/build/index.html
if [ ! -f "$BUILD" ] || [ -n "$(find client/src client/public -newer "$BUILD" -print -quit)" ]; then
  echo "Building web app..."
  # a failed build would leave client/build empty; keep serving the last good one instead
  rm -rf client/build.prev && [ -d client/build ] && cp -a client/build client/build.prev
  if ! (cd client && npx react-scripts build); then
    echo "Web app build FAILED - serving the previous build"
    [ -d client/build.prev ] && rm -rf client/build && mv client/build.prev client/build && touch "$BUILD"
    [ -f "$BUILD" ] || exit 1
  fi
fi
export NODE_ENV=production WEB_PORT=3001
exec node server/server.js
