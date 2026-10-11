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
#   coexist-native    — native Steam UI available → mirror + native hub button
#   coexist-fallback-native — native UI available, no plugin → native fallback panel
#   coexist-idle      — combined host settled → no permanent sub-1s poll / observer churn
#   coop-mirror       — loader present + forced ownership → host published, panel mirrored
#   coop-fallback     — same, no plugin panel → fallback with the plugin updates delegated
#
# Usage:  scripts/harness.sh            (headless)
#         HEADLESS=0 scripts/harness.sh (show the browser window)
#         HARNESS_JSON=path.json scripts/harness.sh (also write per-scenario evidence)
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PORT="${HARNESS_PORT:-9333}"
HTTP_PORT="${HARNESS_HTTP_PORT:-8199}"
HARNESS_DIR="$ROOT/examples/harness"
# Served over HTTP (not file://) so every script shares one origin — real error
# messages instead of opaque "Script error.", and no file:// fetch restrictions.
PAGE="http://127.0.0.1:$HTTP_PORT/examples/harness/scenario.html"
HEADLESS="${HEADLESS:-1}"
JSON_OUT="${HARNESS_JSON:-}"

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
# Per-scenario report + verdict files, folded into HARNESS_JSON at the end.
EVIDENCE_DIR="$(mktemp -d)"
trap 'kill "$HTTP_PID" 2>/dev/null; wait "$HTTP_PID" 2>/dev/null; rm -rf "$EVIDENCE_DIR"' EXIT
sleep 0.6

HEADLESS_FLAG="--headless=new"
[[ "$HEADLESS" == "0" ]] && HEADLESS_FLAG=""

# Chromium refuses to run as root without --no-sandbox, and Docker's default
# /dev/shm is too small for it — opt in when running inside a container.
SANDBOX_FLAGS=""
[[ "${HARNESS_NO_SANDBOX:-0}" == "1" ]] && SANDBOX_FLAGS="--no-sandbox --disable-dev-shm-usage"

# assertion expression per scenario (returns "PASS …" or "FAIL …")
assert_for() {
  case "$1" in
    coexist-mirror)   echo 'var r=__HARNESS_REPORT__();var ok=r.bridge&&!r.hostInstalled&&r.owner==="decky"&&r.qamOwner==="shelveshub"&&r.specs.indexOf("deck-shelves")>=0&&r.shelvesTabPresent&&/DECK SHELVES EDITOR/.test(r.shelvesTabText)&&r.openHub;(ok?"PASS ":"FAIL ")+JSON.stringify(r)+(window.__HARNESS_ERROR__?(" ERR="+window.__HARNESS_ERROR__):"")' ;;
    coexist-fallback) echo 'var r=__HARNESS_REPORT__();var fu=r.fallbackUi;var uiOk=!!(fu&&fu.panel&&fu.coexistNote&&!fu.download&&fu.update&&fu.updateToggles>=1&&fu.sections.indexOf("sec-updates")>=0&&fu.sections.indexOf("sec-troubleshooting")>=0&&fu.version);var ok=r.bridge&&!r.hostInstalled&&r.specs.length===0&&r.shelvesTabPresent&&!/DECK SHELVES EDITOR/.test(r.shelvesTabText)&&uiOk;(ok?"PASS ":"FAIL ")+JSON.stringify(r)+(window.__HARNESS_ERROR__?(" ERR="+window.__HARNESS_ERROR__):"")' ;;
    sole-host)        echo 'var r=__HARNESS_REPORT__();var ok=r.hostInstalled&&r.owner==="shelveshub"&&r.shelvesTabPresent;(ok?"PASS ":"FAIL ")+JSON.stringify(r)+(window.__HARNESS_ERROR__?(" ERR="+window.__HARNESS_ERROR__):"")' ;;
    sole-host-mirror) echo 'var r=__HARNESS_REPORT__();var ok=r.hostInstalled&&r.owner==="shelveshub"&&r.specs.indexOf("deck-shelves")>=0&&r.shelvesTabPresent&&/DECK SHELVES EDITOR/.test(r.shelvesTabText)&&r.openHub;(ok?"PASS ":"FAIL ")+JSON.stringify(r)+(window.__HARNESS_ERROR__?(" ERR="+window.__HARNESS_ERROR__):"")' ;;
    sole-host-fallback) echo 'var r=__HARNESS_REPORT__();var fu=r.fallbackUi;var uiOk=!!(fu&&fu.panel&&!fu.coexistNote&&fu.download&&fu.update&&fu.updateToggles>=1&&fu.sections.indexOf("sec-updates")>=0&&fu.sections.indexOf("sec-troubleshooting")>=0&&fu.sections.indexOf("sec-config")>=0&&fu.version);var ok=r.hostInstalled&&r.owner==="shelveshub"&&r.specs.length===0&&r.shelvesTabPresent&&uiOk&&r.errors.length===0;(ok?"PASS ":"FAIL ")+JSON.stringify(r)+(window.__HARNESS_ERROR__?(" ERR="+window.__HARNESS_ERROR__):"")' ;;
    coexist-late)     echo 'var r=__HARNESS_REPORT__();var ok=r.bridge&&!r.hostInstalled&&r.shelvesTabPresent;(ok?"PASS ":"FAIL ")+JSON.stringify(r)+(window.__HARNESS_ERROR__?(" ERR="+window.__HARNESS_ERROR__):"")' ;;
    coexist-native)   echo 'var r=__HARNESS_REPORT__();var ok=r.bridge&&!r.hostInstalled&&r.owner==="decky"&&r.qamOwner==="shelveshub"&&r.shelvesTabPresent&&/DECK SHELVES EDITOR/.test(r.shelvesTabText)&&r.openHub&&r.errors.length===0;(ok?"PASS ":"FAIL ")+JSON.stringify(r)' ;;
    coexist-fallback-native) echo 'var r=__HARNESS_REPORT__();var fu=r.fallbackUi;var uiOk=!!(fu&&fu.panel&&fu.coexistNote&&!fu.download&&fu.update&&fu.updateToggles>=1&&fu.sections.indexOf("sec-updates")>=0&&fu.version);var ok=r.bridge&&!r.hostInstalled&&r.specs.length===0&&r.shelvesTabPresent&&uiOk&&r.errors.length===0;(ok?"PASS ":"FAIL ")+JSON.stringify(r)' ;;
    coexist-idle) echo 'var r=__HARNESS_REPORT__();var idle=r.idle||{observers:0,live:{}};var ms=Object.keys(idle.live||{}).map(function(k){return idle.live[k];});var minMs=ms.length?Math.min.apply(null,ms):Infinity;var ok=r.bridge&&r.shelvesTabPresent&&(idle.observers<=4)&&(minMs>=1000)&&r.errors.length===0;(ok?"PASS ":"FAIL ")+JSON.stringify({idle:idle,minMs:(minMs===Infinity?"none":minMs),bridge:r.bridge,tab:r.shelvesTabPresent,errors:r.errors})' ;;
    coop-mirror)      echo 'var r=__HARNESS_REPORT__();var ok=r.hostInstalled&&r.owner==="shelveshub"&&r.bridge&&r.qamOwner==="shelveshub"&&r.specs.indexOf("deck-shelves")>=0&&r.shelvesTabPresent&&/DECK SHELVES EDITOR/.test(r.shelvesTabText)&&r.openHub&&r.errors.length===0;(ok?"PASS ":"FAIL ")+JSON.stringify(r)+(window.__HARNESS_ERROR__?(" ERR="+window.__HARNESS_ERROR__):"")' ;;
    coop-fallback)    echo 'var r=__HARNESS_REPORT__();var fu=r.fallbackUi;var uiOk=!!(fu&&fu.panel&&fu.coexistNote&&!fu.download&&fu.update&&fu.updateToggles>=1&&fu.sections.indexOf("sec-updates")>=0&&fu.version);var ok=r.hostInstalled&&r.owner==="shelveshub"&&r.specs.length===0&&r.shelvesTabPresent&&uiOk&&r.errors.length===0;(ok?"PASS ":"FAIL ")+JSON.stringify(r)+(window.__HARNESS_ERROR__?(" ERR="+window.__HARNESS_ERROR__):"")' ;;
  esac
}

# Fold the per-scenario files into one JSON record (the QA-lab evidence shape:
# ts / kind / os / arch / browser / counts / scenarios[] with each full report).
write_evidence() {
  [[ -n "$JSON_OUT" ]] || return 0
  mkdir -p "$(dirname "$JSON_OUT")"
  python3 - "$EVIDENCE_DIR" "$JSON_OUT" "$BROWSER_BIN" <<'PY'
import json, os, platform, sys, time
src, out, browser = sys.argv[1:4]
scenarios = []
for name in sorted(f[:-len(".result")] for f in os.listdir(src) if f.endswith(".result")):
    with open(os.path.join(src, name + ".result")) as f:
        result = f.read().strip()
    report = None
    try:
        with open(os.path.join(src, name + ".report")) as f:
            v = json.loads(f.read())
        report = json.loads(v) if isinstance(v, str) else v
    except Exception:
        pass
    scenarios.append({"name": name, "result": result, "report": report})
passed = sum(1 for s in scenarios if s["result"] == "PASS")
record = {
    "ts": time.strftime("%Y-%m-%d_%H-%M-%S"),
    "kind": "runtime-scenarios",
    "os": platform.system().lower(),
    "arch": platform.machine(),
    "browser": os.path.basename(browser),
    "passed": passed,
    "failed": len(scenarios) - passed,
    "total": len(scenarios),
    "scenarios": scenarios,
}
with open(out, "w") as f:
    json.dump(record, f, indent=2)
    f.write("\n")
print(f"[i] Evidence written to {out}")
PY
}

run_scenario() {
  local sc="$1"
  local udir; udir="$(mktemp -d)"
  # shellcheck disable=SC2086
  "$BROWSER_BIN" $HEADLESS_FLAG $SANDBOX_FLAGS --remote-debugging-port="$PORT" --user-data-dir="$udir" \
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
  if [[ -n "$JSON_OUT" ]]; then
    "$DEVTOOLS" --port "$PORT" --target harness eval 'JSON.stringify(__HARNESS_REPORT__())' >"$EVIDENCE_DIR/$sc.report" 2>/dev/null
  fi
  kill "$pid" 2>/dev/null; wait "$pid" 2>/dev/null
  rm -rf "$udir"
  if echo "$out" | grep -q '"PASS'; then
    echo PASS >"$EVIDENCE_DIR/$sc.result"
    printf '  \033[32mPASS\033[0m  %s\n' "$sc"
    return 0
  fi
  echo FAIL >"$EVIDENCE_DIR/$sc.result"
  printf '  \033[31mFAIL\033[0m  %s\n        %s\n' "$sc" "$out"
  return 1
}

echo "[i] Running scenarios…"
FAILED=0
for sc in coexist-mirror coexist-fallback sole-host sole-host-mirror sole-host-fallback coexist-late coexist-native coexist-fallback-native coexist-idle coop-mirror coop-fallback; do
  run_scenario "$sc" || FAILED=$((FAILED + 1))
done
write_evidence

echo ""
if [[ "$FAILED" -eq 0 ]]; then
  echo "[OK] all scenarios passed"
  exit 0
fi
echo "[X] $FAILED scenario(s) failed"
exit 1
