#!/usr/bin/env bash
#
# Forward the Steam Deck's CEF DevTools port to your machine so the
# cross-platform `shelves-devtools` tool can inspect / inject / debug the Deck's
# renderer from Linux, macOS or Windows (WSL).
#
# Reads DECK_HOST / DECK_USER / DECK_SSH_KEY from .env.
#
# Usage:
#   scripts/deck-tunnel.sh           # forwards local 8080 -> deck 8080
#   LOCAL_PORT=9100 scripts/deck-tunnel.sh
#
# Then, in another terminal:
#   shelves-devtools --port 8080 targets
#   shelves-devtools --port 8080 inject --bundle bundle/index.js
#   shelves-devtools --port 8080 console
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

[[ -f .env ]] || { echo "error: .env not found (copy .env.example)"; exit 1; }
set -o allexport; # shellcheck disable=SC1091
source .env; set +o allexport

: "${DECK_HOST:?set DECK_HOST in .env}"
: "${DECK_USER:?set DECK_USER in .env}"
DECK_SSH_KEY="${DECK_SSH_KEY:-$HOME/.ssh/id_rsa}"
DECK_SSH_KEY="${DECK_SSH_KEY/#\~/$HOME}"
SSH=(ssh)
[[ -f "$DECK_SSH_KEY" ]] && SSH+=(-i "$DECK_SSH_KEY")
# Steam's CEF debug port (8080) — overridable via DECK_CDP_PORT (Deck Shelves style).
LOCAL_PORT="${LOCAL_PORT:-8080}"
REMOTE_PORT="${REMOTE_PORT:-${DECK_CDP_PORT:-8080}}"

echo "[i] Tunnelling localhost:$LOCAL_PORT -> $DECK_HOST:$REMOTE_PORT (Ctrl-C to stop)"
echo "    Use:  shelves-devtools --port $LOCAL_PORT targets"
exec "${SSH[@]}" -N \
  -L "$LOCAL_PORT:127.0.0.1:$REMOTE_PORT" \
  "$DECK_USER@$DECK_HOST"
