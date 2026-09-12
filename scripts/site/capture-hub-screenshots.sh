#!/usr/bin/env bash
#
# Capture the ShelvesHub management-panel screenshots from a live Steam session
# (via deckprobe) into assets/screenshots — the canonical location the README and
# the landing site both reference (the site links them via raw.githubusercontent,
# it keeps no copies of its own).
#
# Requires: the daemon running with Big Picture open and the Deck Shelves tab
# reachable. Targets the local Mac by default (127.0.0.1:8080); override with
# DECK_CDP_HOST / DECK_CDP_PORT (e.g. a Deck at 192.168.x.x:8081). Pass
# `--only hub_panel` (etc.) to capture a single view.
#
# The runtime honours window.__SHELVES_LOCALE__ (set by the scenarios to en-US)
# so captures are in English regardless of the Steam UI language.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
HOST="${DECK_CDP_HOST:-127.0.0.1}"
PORT="${DECK_CDP_PORT:-8080}"
cd "$ROOT"

echo "[i] Capturing hub screenshots from ${HOST}:${PORT}…"
DECKPROBE_QAM_SCOPE_SEL='.deck-shelves-qam-scope,[data-fb-panel]' \
  node deckprobe/scripts/py.mjs -m deckprobe.screenshots.run \
    --host "$HOST" --port "$PORT" \
    --scenarios-dir scripts/deckprobe-ext/screenshots/scenarios \
    --out assets/screenshots "$@"

echo "[i] Done — screenshots in assets/screenshots (README + site reference them there)."
