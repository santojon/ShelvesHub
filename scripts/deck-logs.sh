#!/usr/bin/env bash
#
# Tail the ShelvesHub service logs on the Steam Deck over SSH.
# Reads DECK_HOST / DECK_USER / DECK_SSH_KEY from .env.
#
# Usage:  pnpm deck:logs
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

[[ -f .env ]] || { echo "error: .env not found (run 'pnpm setup' or copy .env.example)"; exit 1; }
set -o allexport; # shellcheck disable=SC1091
source .env; set +o allexport

: "${DECK_HOST:?set DECK_HOST in .env}"
: "${DECK_USER:?set DECK_USER in .env}"
DECK_SSH_KEY="${DECK_SSH_KEY:-$HOME/.ssh/id_rsa}"
DECK_SSH_KEY="${DECK_SSH_KEY/#\~/$HOME}"
SSH=(ssh)
[[ -f "$DECK_SSH_KEY" ]] && SSH+=(-i "$DECK_SSH_KEY")

exec "${SSH[@]}" "$DECK_USER@$DECK_HOST" \
  'journalctl --user -u shelveshub -f'
