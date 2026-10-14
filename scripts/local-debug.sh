#!/usr/bin/env bash
#
# Local end-to-end debug harness (Linux/macOS).
#
# Launches a Chromium-family browser with remote debugging, runs the loader
# against it, injects the example Deck Shelves bundle, and verifies the result —
# all without a Steam Deck. Chromium speaks the same DevTools protocol as
# Steam's CEF renderer, so this exercises the real injection + RPC path.
#
# Usage:
#   scripts/local-debug.sh            # headless
#   HEADLESS=0 scripts/local-debug.sh # show the browser window
#
# Env overrides: SHELVES_CEF_PORT (default 9222), BROWSER (path to a browser),
#                SHELVES_BUNDLE_PATH (default examples/bundle/shelves-example.js),
#                SHELVES_RPC_PORT (default 60124; an installed service keeps 60123)
#
# The daemon runs on a copy of the bundle with its own settings, hub store (updates
# and settings sync off), token file and an empty backend directory, all in a temp
# directory, with the boot movie and auto-recovery off: it downloads nothing and
# touches neither an installed service's files nor this machine's Steam.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PORT="${SHELVES_CEF_PORT:-9222}"
RPC_PORT="${SHELVES_RPC_PORT:-60124}"
HARNESS="$ROOT/examples/harness/index.html"
BUNDLE="${SHELVES_BUNDLE_PATH:-$ROOT/examples/bundle/shelves-example.js}"
HEADLESS="${HEADLESS:-1}"
TARGET_FILTER="${SHELVES_TARGET:-harness}"

command -v cargo >/dev/null || { echo "error: cargo (Rust) is required"; exit 1; }

# ── Locate a Chromium-family browser ────────────────────────────────────────
find_browser() {
  if [[ -n "${BROWSER:-}" ]]; then echo "$BROWSER"; return; fi
  local candidates=(
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
    "/Applications/Chromium.app/Contents/MacOS/Chromium"
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge"
    "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser"
    google-chrome google-chrome-stable chromium chromium-browser
    microsoft-edge brave-browser
  )
  for c in "${candidates[@]}"; do
    if [[ -x "$c" ]]; then echo "$c"; return; fi
    if command -v "$c" >/dev/null 2>&1; then command -v "$c"; return; fi
  done
  return 1
}

BROWSER_BIN="$(find_browser)" || {
  echo "error: no Chromium-family browser found."
  echo "       Install Chrome/Chromium/Edge/Brave, or set BROWSER=/path/to/browser"
  exit 1
}
echo "[i] Browser : $BROWSER_BIN"
echo "[i] Port    : $PORT"
echo "[i] RPC port: $RPC_PORT"
echo "[i] Bundle  : $BUNDLE"

# ── Build the binaries ──────────────────────────────────────────────────────
echo "[i] Building loader + shelves-devtools..."
cargo build --quiet
DEVTOOLS="$ROOT/target/debug/shelves-devtools"
LOADER="$ROOT/target/debug/shelveshub"

PROFILE="$(mktemp -d)"
WORK="$(mktemp -d)"
BROWSER_PID=""
LOADER_PID=""
cleanup() {
  [[ -n "$LOADER_PID" ]] && kill "$LOADER_PID" 2>/dev/null || true
  [[ -n "$BROWSER_PID" ]] && kill "$BROWSER_PID" 2>/dev/null || true
  rm -rf "$PROFILE" "$WORK" 2>/dev/null || true
}
trap cleanup EXIT
cp "$BUNDLE" "$WORK/bundle.js"
mkdir -p "$WORK/settings" "$WORK/backend"
echo '{ "auto_update": false, "config_sync": false }' >"$WORK/hub.json"

# ── Launch the browser ──────────────────────────────────────────────────────
BROWSER_ARGS=(
  --remote-debugging-port="$PORT"
  --user-data-dir="$PROFILE"
  --no-first-run --no-default-browser-check --disable-features=Translate
  "file://$HARNESS"
)
# Chromium as root in a container needs --no-sandbox and a larger-than-default
# shared-memory workaround; opt in via HARNESS_NO_SANDBOX=1.
[[ "${HARNESS_NO_SANDBOX:-0}" == "1" ]] && BROWSER_ARGS=(--no-sandbox --disable-dev-shm-usage "${BROWSER_ARGS[@]}")
[[ "$HEADLESS" == "1" ]] && BROWSER_ARGS=(--headless=new "${BROWSER_ARGS[@]}")

echo "[i] Launching browser..."
"$BROWSER_BIN" "${BROWSER_ARGS[@]}" >/dev/null 2>&1 &
BROWSER_PID=$!

echo -n "[i] Waiting for DevTools endpoint"
for _ in $(seq 1 40); do
  if curl -sf "http://127.0.0.1:$PORT/json/version" >/dev/null 2>&1; then break; fi
  echo -n "."; sleep 0.25
done
echo
curl -sf "http://127.0.0.1:$PORT/json/version" >/dev/null 2>&1 || { echo "error: DevTools never came up"; exit 1; }

# ── Run the loader against it (serves RPC + injects on its loop) ────────────
echo "[i] Starting loader (CEF=127.0.0.1:$PORT)..."
SHELVES_CEF_PORT="$PORT" \
SHELVES_RPC_HOST=127.0.0.1 SHELVES_RPC_PORT="$RPC_PORT" SHELVES_RPC_TOKEN_FILE="$WORK/rpc-token" \
SHELVES_BUNDLE_PATH="$WORK/bundle.js" SHELVES_HUB_CONFIG="$WORK/hub.json" \
SHELVES_SETTINGS_DIR="$WORK/settings" SHELVES_BACKEND_DIR="$WORK/backend" \
SHELVES_CONFIG_FILE="$WORK/shelveshub.config.json" \
SHELVES_BOOT_MOVIE=0 SHELVES_BOOT_MOVIE_FILE="$WORK/no-movie.webm" SHELVES_RECOVER_CMD=off \
SHELVES_TARGET="$TARGET_FILTER" \
SHELVES_INTERVAL_SECS=5 \
SHELVES_DESKTOP_UI=1 \
  "$LOADER" &
LOADER_PID=$!

echo -n "[i] Waiting for injection"
for _ in $(seq 1 20); do
  if [[ "$("$DEVTOOLS" --port "$PORT" --target "$TARGET_FILTER" probe 2>/dev/null)" == "injected: true" ]]; then break; fi
  echo -n "."; sleep 0.5
done
echo
# Without Steam's UI the runtime's scan never signals ready, so the bundle boots when
# its gate gives up (about 12 s).
echo -n "[i] Waiting for the bundle to boot"
for _ in $(seq 1 40); do
  if [[ "$("$DEVTOOLS" --port "$PORT" --target "$TARGET_FILTER" eval '!!window.__SHELVES_DEMO__' 2>/dev/null)" == "true" ]]; then break; fi
  echo -n "."; sleep 0.5
done
echo

echo
echo "===== verification ====="
echo "--- probe ---"
"$DEVTOOLS" --port "$PORT" --target "$TARGET_FILTER" probe || true
echo "--- window.__SHELVES_DEMO__ ---"
"$DEVTOOLS" --port "$PORT" --target "$TARGET_FILTER" eval "window.__SHELVES_DEMO__" || true
echo "--- QAM panel registered? ---"
"$DEVTOOLS" --port "$PORT" --target "$TARGET_FILTER" eval \
  "!!(window.__SHELVES_HOST__ && window.__SHELVES_HOST__.qam && window.__SHELVES_HOST__.qam._specs['deck-shelves'])" || true
echo "--- rpc via host (ping/getVersion/isInjected) ---"
"$DEVTOOLS" --port "$PORT" --target "$TARGET_FILTER" eval \
  "Promise.all([__SHELVES_HOST__.rpc.call('ping'),__SHELVES_HOST__.rpc.call('getVersion'),__SHELVES_HOST__.rpc.call('isInjected')])" || true
echo "--- console (3s) ---"
"$DEVTOOLS" --port "$PORT" --target "$TARGET_FILTER" console --duration 3 || true
echo "========================"
echo "[OK] Done. (set HEADLESS=0 to watch the rendered shelves in a window)"
exit 0
