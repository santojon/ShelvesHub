#!/usr/bin/env bash
#
# In-container harness entrypoint. Runs two Linux validations against a headless
# Chromium, with no Steam Deck:
#   1. the runtime scenario harness (scripts/harness.sh) — the native tab,
#      coexistence, sole-host and fallback paths against a mock of Steam's UI;
#   2. a daemon-injection smoke — the real ShelvesHub daemon discovers the
#      headless target over CDP and injects its runtime + an example bundle.
#
# Exits non-zero if either fails, so it drops straight into CI.
set -uo pipefail

ROOT="${SHELVES_ROOT:-/work}"
cd "$ROOT" || { echo "error: repo not found at $ROOT (mount it or COPY it)"; exit 1; }
[[ -f Cargo.toml ]] || { echo "error: $ROOT has no Cargo.toml"; exit 1; }

# Which checks to run: all (default) | scenarios | smoke | install.
MODE="${1:-all}"

BROWSER_BIN="${BROWSER:-/usr/bin/chromium}"
command -v cargo >/dev/null || { echo "error: cargo missing in image"; exit 1; }
[[ -x "$BROWSER_BIN" ]] || { echo "error: browser not found at $BROWSER_BIN"; exit 1; }

echo "== ShelvesHub Docker harness (mode: $MODE) =="
echo "[i] $(cargo --version) · $("$BROWSER_BIN" --version 2>/dev/null) · $(uname -m)"

FAIL=0

# ── 1. Runtime scenario harness ─────────────────────────────────────────────
if [[ "$MODE" == "all" || "$MODE" == "scenarios" ]]; then
echo ""
echo "[scenarios] Runtime scenarios (scripts/harness.sh)…"
if HARNESS_NO_SANDBOX=1 HEADLESS=1 BROWSER="$BROWSER_BIN" bash scripts/harness.sh; then
  echo "[ok] runtime scenarios passed"
else
  echo "[X] runtime scenarios failed"
  FAIL=1
fi
fi

# ── 3. Install / uninstall lifecycle (SteamOS user-service path) ─────────────
if [[ "$MODE" == "all" || "$MODE" == "install" ]]; then
echo ""
echo "[install] Install / uninstall lifecycle…"
if bash docker/install-scenario.sh; then
  echo "[ok] install/uninstall lifecycle passed"
else
  echo "[X] install/uninstall lifecycle failed"
  FAIL=1
fi
fi

# ── 2. Daemon-injection smoke ───────────────────────────────────────────────
if [[ "$MODE" == "all" || "$MODE" == "smoke" ]]; then
echo ""
echo "[smoke] Daemon injection smoke (daemon → headless Chromium)…"
daemon_smoke() {
  cargo build --quiet --bin shelveshub --bin shelves-devtools || return 1
  local dt="$ROOT/target/debug/shelves-devtools"
  local daemon="$ROOT/target/debug/shelveshub"
  local port=9444 prof; prof="$(mktemp -d)"
  local bpid="" dpid="" ok=""

  "$BROWSER_BIN" --headless=new --no-sandbox --disable-dev-shm-usage --disable-gpu \
    --remote-debugging-port="$port" --user-data-dir="$prof" \
    --no-first-run --no-default-browser-check --disable-features=Translate \
    "file://$ROOT/examples/harness/index.html" >/dev/null 2>&1 &
  bpid=$!

  local up=""
  for _ in $(seq 1 40); do
    curl -sf "http://127.0.0.1:$port/json/version" >/dev/null 2>&1 && { up=1; break; }
    sleep 0.25
  done
  if [[ -z "$up" ]]; then echo "  DevTools endpoint never came up"; kill "$bpid" 2>/dev/null; rm -rf "$prof"; return 1; fi

  # SHELVES_DESKTOP_UI=1: the smoke injects into a plain headless Chromium, not
  # the Steam gamepad / Big Picture UI, so the default gamepad-only gate would
  # (correctly) stand down. Opt into desktop injection so the smoke can verify it.
  SHELVES_CEF_PORT="$port" SHELVES_RPC_ADDR="127.0.0.1:60123" \
    SHELVES_BUNDLE_PATH="$ROOT/examples/bundle/shelves-example.js" \
    SHELVES_TARGET="harness" SHELVES_INTERVAL_SECS=2 SHELVES_DESKTOP_UI=1 \
    "$daemon" >/tmp/shelveshub-daemon.log 2>&1 &
  dpid=$!

  for _ in $(seq 1 30); do
    sleep 1
    if [[ "$("$dt" --port "$port" --target harness probe 2>/dev/null)" == "injected: true" ]]; then ok=1; break; fi
  done

  kill "$dpid" "$bpid" 2>/dev/null; wait "$dpid" 2>/dev/null; rm -rf "$prof"
  [[ -n "$ok" ]]
}
if daemon_smoke; then
  echo "[ok] daemon injected into the headless renderer"
else
  echo "[X] daemon injection smoke failed"
  echo "---- daemon log (tail) ----"; tail -n 20 /tmp/shelveshub-daemon.log 2>/dev/null || true
  FAIL=1
fi
fi

# ── 4. Plugin backend probes (the plugin running UNDER the host) ─────────────
# ShelvesHub hosts the plugin's Python backend, so its OS-coupled probes get real
# coverage on this container's OS/arch (incl. ARM64) here — not only the plugin
# repo's own x86_64 runner. Skips cleanly when the plugin isn't checked out.
if [[ "$MODE" == "all" || "$MODE" == "plugin" ]]; then
echo ""
echo "[plugin] Deck Shelves backend probes under the host (cross-OS, fail-soft)…"
if python3 docker/plugin-probes.py; then
  echo "[ok] plugin backend probes fail-soft on $(uname -m)"
else
  echo "[X] plugin backend probes failed"
  FAIL=1
fi
fi

echo ""
if [[ "$FAIL" -eq 0 ]]; then echo "[OK] Docker harness passed"; else echo "[X] Docker harness failed"; fi
exit "$FAIL"
