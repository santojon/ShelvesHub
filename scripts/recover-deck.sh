#!/usr/bin/env bash
#
# Recover a Steam Deck whose UI windows have collapsed: a black screen where the
# background JS context still answers (route stays /routes/library/home) but the
# visible windows (Big Picture, Main Menu, …) are gone. This is NOT fixed by
# SteamClient.User.StartRestart — that can worsen it. The reliable fix is to
# restart steam-launcher.service, then wait ~60-90s for the windows to return.
#
# Reads DECK_HOST / DECK_CDP_HOST / DECK_USER / DECK_CDP_PORT from .env.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="${ENV_FILE:-$ROOT/.env}"
if [ -f "$ENV_FILE" ]; then
  set -a; . "$ENV_FILE"; set +a
fi

HOST="${DECK_CDP_HOST:-${DECK_HOST:?set DECK_HOST or DECK_CDP_HOST}}"
DECK_LOGIN="${DECK_USER:-deck}"
PORT="${DECK_CDP_PORT:-8081}"

echo "Recovering Steam UI on ${DECK_LOGIN}@${HOST} (CDP ${HOST}:${PORT})…"

# steam-launcher.service is a --user unit; no sudo needed. gamescope-session
# refuses manual restart (dependency-only), so target the launcher.
ssh -o StrictHostKeyChecking=no -o ConnectTimeout=8 "${DECK_LOGIN}@${HOST}" \
  'systemctl --user restart steam-launcher.service' \
  && echo "steam-launcher.service restart requested." \
  || { echo "Restart command failed over SSH."; exit 1; }

echo "Waiting for the Big Picture window to return (up to ~120s)…"
for _ in $(seq 1 60); do
  if curl -s -m 3 "http://${HOST}:${PORT}/json" 2>/dev/null | grep -qi "big picture"; then
    echo "Steam UI is back (Big Picture window present). Recovered."
    exit 0
  fi
  sleep 2
done

echo "Timed out waiting for the Big Picture window — check the device directly."
exit 1
