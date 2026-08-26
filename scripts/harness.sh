#!/usr/bin/env bash
#
# Scenario harness for the ShelvesHub host runtime (runtime/shelves-host.js).
#
# Runs the runtime against a mock of Steam's CEF internals (fake webpack + the
# real vendored React + a QuickAccessMenuBrowserView consumer) in a headless
# Chromium, once per scenario, and asserts the outcome — so the native QAM tab,
# coexistence mirroring, the sole-host path and the fallback panel are all
# verified WITHOUT a Steam Deck.
#
# Scenarios:
#   coexist-mirror    — foreign loader + a plugin panel → our tab MIRRORS it
#   coexist-fallback  — foreign loader, no plugin panel → our tab shows FALLBACK
#   sole-host         — no loader → runtime installs the host, our tab present
#   coexist-late      — QAM mounted before the runtime → re-point still lands it
#
# Usage:  scripts/harness.sh            (headless)
#         HEADLESS=0 scripts/harness.sh (show the browser window)
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PORT="${HARNESS_PORT:-9333}"
HTTP_PORT="${HARNESS_HTTP_PORT:-8199}"
HARNESS_DIR="$ROOT/examples/harness"
# Served over HTTP (not file://) so every script shares one origin — real error
# messages instead of opaque "Script error.", and no file:// fetch restrictions.
PAGE="http://127.0.0.1:$HTTP_PORT/examples/harness/scenario.html"
HEADLESS="${HEADLESS:-1}"

command -v cargo >/dev/null || { echo "error: cargo (Rust) is required"; exit 1; }
command -v python3 >/dev/null || { echo "error: python3 is required (static file server)"; exit 1; }

find_browser() {
  if [[ -n "${BROWSER:-}" ]]; then echo "$BROWSER"; return; fi
  local candidates=(
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
    "/Applications/Chromium.app/Contents/MacOS/Chromium"
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge"
    "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser"
    google-chrome google-chrome-stable chromium chromium-browser microsoft-edge brave-browser
  )
  local c
  for c in "${candidates[@]}"; do
    if [[ -x "$c" ]]; then echo "$c"; return; fi
    if command -v "$c" >/dev/null 2>&1; then command -v "$c"; return; fi
  done
  return 1
}

BROWSER_BIN="$(find_browser)" || { echo "error: no Chromium-family browser found (set BROWSER=/path)"; exit 1; }
# React / ReactDOM are a DEV-TEST dependency only (MIT, Meta) — fetched on demand,
# never committed here and never part of the service or any release artifact.
mkdir -p "$HARNESS_DIR/vendor"
if [[ ! -f "$HARNESS_DIR/vendor/react.js" ]]; then
  echo "[i] Fetching React (dev-test dependency, MIT)…"
  curl -sSL -o "$HARNESS_DIR/vendor/react.js" https://unpkg.com/react@18.3.1/umd/react.production.min.js \
    || { echo "error: could not fetch react.js (network needed on first run)"; exit 1; }
fi
if [[ ! -f "$HARNESS_DIR/vendor/react-dom.js" ]]; then
  echo "[i] Fetching ReactDOM (dev-test dependency, MIT)…"
  curl -sSL -o "$HARNESS_DIR/vendor/react-dom.js" https://unpkg.com/react-dom@18.3.1/umd/react-dom.production.min.js \
    || { echo "error: could not fetch react-dom.js (network needed on first run)"; exit 1; }
fi

echo "[i] Browser  : $BROWSER_BIN"
echo "[i] Building shelves-devtools…"
cargo build --quiet --bin shelves-devtools || { echo "build failed"; exit 1; }
DEVTOOLS="$ROOT/target/debug/shelves-devtools"

# Static file server over the repo root, so /runtime/shelves-host.js and
# /examples/harness/* are same-origin.
python3 -m http.server "$HTTP_PORT" --directory "$ROOT" >/dev/null 2>&1 &
HTTP_PID=$!
trap 'kill "$HTTP_PID" 2>/dev/null' EXIT
sleep 0.6

HEADLESS_FLAG="--headless=new"
[[ "$HEADLESS" == "0" ]] && HEADLESS_FLAG=""

# assertion expression per scenario (returns "PASS …" or "FAIL …")
assert_for() {
  case "$1" in
    coexist-mirror)   echo 'var r=__HARNESS_REPORT__();var ok=r.bridge&&!r.hostInstalled&&r.owner==="decky"&&r.specs.indexOf("deck-shelves")>=0&&r.shelvesTabPresent&&/DECK SHELVES EDITOR/.test(r.shelvesTabText)&&r.openHub;(ok?"PASS ":"FAIL ")+JSON.stringify(r)+(window.__HARNESS_ERROR__?(" ERR="+window.__HARNESS_ERROR__):"")' ;;
    coexist-fallback) echo 'var r=__HARNESS_REPORT__();var fu=r.fallbackUi;var uiOk=!!(fu&&fu.panel&&fu.hasToggle&&fu.buttons.length===4&&fu.buttons.every(function(b){return b.present&&b.hasIcon;}));var ok=r.bridge&&!r.hostInstalled&&r.specs.length===0&&r.shelvesTabPresent&&!/DECK SHELVES EDITOR/.test(r.shelvesTabText)&&uiOk;(ok?"PASS ":"FAIL ")+JSON.stringify(r)+(window.__HARNESS_ERROR__?(" ERR="+window.__HARNESS_ERROR__):"")' ;;
    sole-host)        echo 'var r=__HARNESS_REPORT__();var ok=r.hostInstalled&&r.owner==="shelveshub"&&r.shelvesTabPresent;(ok?"PASS ":"FAIL ")+JSON.stringify(r)+(window.__HARNESS_ERROR__?(" ERR="+window.__HARNESS_ERROR__):"")' ;;
    sole-host-mirror) echo 'var r=__HARNESS_REPORT__();var ok=r.hostInstalled&&r.owner==="shelveshub"&&r.specs.indexOf("deck-shelves")>=0&&r.shelvesTabPresent&&/DECK SHELVES EDITOR/.test(r.shelvesTabText)&&r.openHub;(ok?"PASS ":"FAIL ")+JSON.stringify(r)+(window.__HARNESS_ERROR__?(" ERR="+window.__HARNESS_ERROR__):"")' ;;
    coexist-late)     echo 'var r=__HARNESS_REPORT__();var ok=r.bridge&&!r.hostInstalled&&r.shelvesTabPresent;(ok?"PASS ":"FAIL ")+JSON.stringify(r)+(window.__HARNESS_ERROR__?(" ERR="+window.__HARNESS_ERROR__):"")' ;;
  esac
}

run_scenario() {
  local sc="$1"
  local udir; udir="$(mktemp -d)"
  # shellcheck disable=SC2086
  "$BROWSER_BIN" $HEADLESS_FLAG --remote-debugging-port="$PORT" --user-data-dir="$udir" \
    --no-first-run --no-default-browser-check --disable-gpu --disable-extensions \
    --disable-background-networking "$PAGE?scenario=$sc" >/dev/null 2>&1 &
  local pid=$!
  local ready="" i
  for i in $(seq 1 60); do
    sleep 0.3
    ready="$("$DEVTOOLS" --port "$PORT" --target harness eval 'String(!!window.__HARNESS_READY__)' 2>/dev/null | tr -d '"')"
    [[ "$ready" == "true" ]] && break
  done
  local out
  out="$("$DEVTOOLS" --port "$PORT" --target harness eval "$(assert_for "$sc")" 2>/dev/null)"
  kill "$pid" 2>/dev/null; wait "$pid" 2>/dev/null
  rm -rf "$udir"
  if echo "$out" | grep -q '"PASS'; then
    printf '  \033[32mPASS\033[0m  %s\n' "$sc"
    return 0
  fi
  printf '  \033[31mFAIL\033[0m  %s\n        %s\n' "$sc" "$out"
  return 1
}

echo "[i] Running scenarios…"
FAILED=0
for sc in coexist-mirror coexist-fallback sole-host sole-host-mirror coexist-late; do
  run_scenario "$sc" || FAILED=$((FAILED + 1))
done

echo ""
if [[ "$FAILED" -eq 0 ]]; then
  echo "[OK] all scenarios passed"
  exit 0
fi
echo "[X] $FAILED scenario(s) failed"
exit 1
