#!/usr/bin/env bash
#
# Steam ARM64 lab: Valve's native ARM64 Steam client in a container, headless, with
# the debug port on — the daemon then discovers and injects into it like on a device.
# Needs an arm64 Docker host (Apple silicon runs it natively; QEMU would be far too
# slow for Steam's own interface).
#
# Usage:
#   scripts/steam-arm64-lab.sh            # boot the client, run the daemon, record evidence
#   scripts/steam-arm64-lab.sh login      # same, plus VNC on localhost:5900 to sign in once
#   scripts/steam-arm64-lab.sh shell      # a shell in the container
#   STEAM_CHANNEL=publicbeta scripts/steam-arm64-lab.sh
#
# The Steam root (client + session) lives on the named volume shelveshub-steam-arm64,
# so the first start's download and a sign-in survive container restarts. The hub's
# arm64 build (pnpm build:arm64), runtime, a real bundle and the plugin's backend are
# staged into a temporary directory mounted at /shelveshub.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
MODE="${1:-boot}"
IMAGE="shelveshub-steam-arm64"
VOLUME="shelveshub-steam-arm64"
NAME="shelveshub-steam-arm64-lab"
DS_ROOT="${DECK_SHELVES_ROOT:-$ROOT/../Deck-Shelves}"
command -v docker >/dev/null || { echo "error: docker is required"; exit 1; }
[[ "$(docker info --format '{{.Architecture}}' 2>/dev/null)" == aarch64* ]] \
  || echo "[!] Docker host is not arm64 — the client would run under emulation"

BIN="target/aarch64-unknown-linux-gnu/release"
[[ -x "$BIN/shelveshub" ]] || { echo "[i] no arm64 build yet — running pnpm build:arm64"; pnpm build:arm64; }
STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT
cp "$BIN/shelveshub" "$STAGE/"
[[ -x "$BIN/shelves-devtools" ]] && cp "$BIN/shelves-devtools" "$STAGE/"
cp -R runtime "$STAGE/runtime"
cp shelveshub.config.json "$STAGE/"

# A real bundle: LAB_BUNDLE, else the plugin's own build, else the one this machine's
# hub carries; the repository's copy is only a placeholder.
mkdir -p "$STAGE/bundle"
for candidate in "${LAB_BUNDLE:-}" "$DS_ROOT/dist/index.iife.js" "$HOME/.local/share/shelveshub/bundle/index.js"; do
  if [[ -n "$candidate" && -f "$candidate" && "$(wc -c <"$candidate")" -gt 100000 ]]; then
    cp "$candidate" "$STAGE/bundle/index.js"
    echo "[i] bundle: $candidate"
    break
  fi
done
[[ -f "$STAGE/bundle/index.js" ]] || { cp bundle/index.js "$STAGE/bundle/index.js"; echo "[!] no real bundle found — the daemon will try to download one"; }
if [[ -f "$DS_ROOT/main.py" && -d "$DS_ROOT/src/backend" ]]; then
  mkdir -p "$STAGE/backend/src"
  cp "$DS_ROOT/main.py" "$STAGE/backend/"
  cp -R "$DS_ROOT/src/backend" "$STAGE/backend/src/backend"
  echo "[i] backend: $DS_ROOT"
fi

echo "[i] building ${IMAGE}…"
docker build --platform linux/arm64 -t "$IMAGE" docker/steam-arm64
docker volume create "$VOLUME" >/dev/null
docker rm -f "$NAME" >/dev/null 2>&1 || true

PORTS=(-p 127.0.0.1:8090:8081)
[[ "$MODE" == "login" ]] && PORTS+=(-p 127.0.0.1:5900:5900)
TTY=()
[[ "$MODE" == "shell" ]] && TTY=(-it)
echo "[i] running ($MODE) — debug port on localhost:8090${PORTS[2]:+, VNC on localhost:5900}"
docker run --rm "${TTY[@]+"${TTY[@]}"}" --name "$NAME" --platform linux/arm64 --shm-size=1g \
  -v "$VOLUME":/home/steam/.local/share/Steam \
  -v "$STAGE":/shelveshub \
  -v "$ROOT/site/reports/qa/evidence":/evidence \
  -e QA_EVIDENCE_DIR=/evidence -e STEAM_CHANNEL -e STEAM_FLAGS -e LAB_WAIT_SECS -e LAB_KEEP \
  -e LAB_DESKTOP_UI -e LAB_VNC_PASSWORD -e LAB_SETTLE_SECS -e LAB_MAX_STARTS \
  "${PORTS[@]}" "$IMAGE" "$MODE"
