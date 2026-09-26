#!/bin/bash
# Hard deploy to the Steam Deck: run the normal deploy (build + push + restart the
# service), then RESTART Steam itself so a fresh renderer picks up the new binary
# from a clean boot — the on-device counterpart to a cold start.
#
# Steam on the Deck is a --user unit; gamescope-session refuses a manual restart
# (dependency-only), so we bounce steam-launcher.service and wait for the Big
# Picture window to come back. Same connection settings as deck-deploy.sh (.env).
set -euo pipefail
cd "$(dirname "$0")/.."

bash scripts/deck-deploy.sh "$@"

set -o allexport; source .env; set +o allexport
: "${DECK_HOST:?set DECK_HOST in .env}"
: "${DECK_USER:?set DECK_USER in .env}"
DECK_SSH_KEY="${DECK_SSH_KEY:-$HOME/.ssh/id_rsa}"
DECK_SSH_KEY="${DECK_SSH_KEY/#\~/$HOME}"
SSH=(ssh -o StrictHostKeyChecking=accept-new)
[[ -f "$DECK_SSH_KEY" ]] && SSH+=(-i "$DECK_SSH_KEY")
SSH+=("$DECK_USER@$DECK_HOST")

echo "[i] Restarting Steam on the Deck (steam-launcher.service)…"
"${SSH[@]}" bash -s <<'REMOTE'
export XDG_RUNTIME_DIR="/run/user/$(id -u)"
export DBUS_SESSION_BUS_ADDRESS="unix:path=${XDG_RUNTIME_DIR}/bus"
systemctl --user restart steam-launcher.service
REMOTE

echo "[i] Waiting for the Big Picture window to return (up to ~90s)…"
PORT="${SHELVES_CEF_PORT:-8080}"
for _ in $(seq 1 45); do
  sleep 2
  if "${SSH[@]}" "curl -sf http://127.0.0.1:$PORT/json 2>/dev/null | grep -qi 'big picture'"; then
    echo "[OK] Steam UI is back — hard deploy complete."
    exit 0
  fi
done
echo "[!] Steam UI not confirmed yet; it may still be coming up. Check the device."
