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
# Scenarios (18):
#   coexist-mirror    — foreign loader + a plugin panel → our tab MIRRORS it
#   coexist-fallback  — foreign loader, no plugin panel → our tab shows FALLBACK
#   sole-host         — no loader → host installed, tab present, capabilities live, teardown re-arms the prune
#   sole-host-mirror  — no loader + a plugin panel → host published, panel mirrored
#   sole-host-fallback — no loader, no plugin panel → full fallback (download + config sections)
#   coexist-late      — QAM mounted before the runtime → re-point still lands it
#   coexist-native    — native Steam UI available → mirror + native hub button
#   coexist-fallback-native — native UI available, no plugin → fallback panel after discovery
#   coexist-idle      — combined host settled → no permanent sub-1s poll / observer churn
#   coop-mirror       — loader present + forced ownership → host published, panel mirrored, routes reach the loader's hook
#   coop-fallback     — same, no plugin panel → fallback with the plugin updates delegated
#   coop-bundle       — same + the cooperative-bundle hand-over → self-install capability follows the hand-over
#   sole-host-sidecar — "View logs" opens the sidecar (menu widened), back closes it (narrowed)
#   sole-host-notify  — a toast → hub-view entry + bell badge + Steam's Notifications tab entry (no DOM toast)
#   sole-host-gesture — two D-pad rights open the Logs sidecar; Ctrl+Shift+N opens Notifications
#   sole-host-locale  — LANGUAGE=brazilian in the renderer URL → the hub view reads the pt-BR strings
#   sole-host-config  — the interval stepper stops at the daemon's floor (never sends 0); a refused edit reverts the row
#   sole-host-tabswitch — a plugin panel; leaving the tab and coming back (Steam remounts it) keeps the
#                       hub view opened from the editor and its gestures; an open sidecar is not restored
#
# Before the browser runs, examples/harness/runtime-unit.js evaluates the assembled runtime
# in node for what a page cannot show (teardown re-arm, routes delegation, the locale pick,
# the capabilities, the Quick Access mode, the daemon's bundle boot gate). It is reported as one
# more result, runtime-unit (19 results where node exists; skipped with a notice where it is absent).
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
# React / ReactDOM 18.3.1 are a DEV-TEST dependency only (MIT, Meta) — tracked in this
# repository under examples/harness/vendor/ and re-fetched only if a file is missing; never
# part of the service or any release artifact.
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

# Two harness runs on the same ports read each other's pages, so refuse a debugging
# port something already listens on (set HARNESS_PORT / HARNESS_HTTP_PORT for a second run).
port_in_use() { (exec 3<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null; }
port_in_use "$PORT" && { echo "error: port $PORT is in use (another harness? set HARNESS_PORT)"; exit 1; }

# Static file server, loopback only, over a staging directory that links just the
# two trees the page loads (examples/harness and runtime), so /runtime/shelves-host.js
# and /examples/harness/* stay same-origin while nothing else in the checkout is served.
SERVE_DIR="$(mktemp -d)"
mkdir -p "$SERVE_DIR/examples"
ln -s "$HARNESS_DIR" "$SERVE_DIR/examples/harness"
ln -s "$ROOT/runtime" "$SERVE_DIR/runtime"
python3 -m http.server "$HTTP_PORT" --bind 127.0.0.1 --directory "$SERVE_DIR" >/dev/null 2>&1 &
HTTP_PID=$!
# Per-scenario report + verdict files, folded into HARNESS_JSON at the end.
EVIDENCE_DIR="$(mktemp -d)"
trap 'kill "$HTTP_PID" 2>/dev/null; wait "$HTTP_PID" 2>/dev/null; rm -rf "$EVIDENCE_DIR" "$SERVE_DIR"' EXIT
sleep 0.6
kill -0 "$HTTP_PID" 2>/dev/null || { echo "error: could not serve on port $HTTP_PORT (in use? set HARNESS_HTTP_PORT)"; exit 1; }

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
    # Also: the capabilities read live (tab inserted, sole host self-installs) and a teardown re-arms the nav prune.
    sole-host)        echo 'var r=__HARNESS_REPORT__();var hst=window.__SHELVES_HOST__;var c=r.handshake&&r.handshake.capabilities;var n1=hst.lifecycle.teardown();var n2=hst.lifecycle.teardown();var ok=r.hostInstalled&&r.owner==="shelveshub"&&r.shelvesTabPresent&&!!c&&c.nativeQam===true&&c.selfUpdate===true&&c.coexist===false&&r.canSelfInstall===true&&n1>=1&&n2>=1;(ok?"PASS ":"FAIL ")+JSON.stringify(r)+" teardown="+n1+","+n2+(window.__HARNESS_ERROR__?(" ERR="+window.__HARNESS_ERROR__):"")' ;;
    sole-host-mirror) echo 'var r=__HARNESS_REPORT__();var ok=r.hostInstalled&&r.owner==="shelveshub"&&r.specs.indexOf("deck-shelves")>=0&&r.shelvesTabPresent&&/DECK SHELVES EDITOR/.test(r.shelvesTabText)&&r.openHub;(ok?"PASS ":"FAIL ")+JSON.stringify(r)+(window.__HARNESS_ERROR__?(" ERR="+window.__HARNESS_ERROR__):"")' ;;
    sole-host-fallback) echo 'var r=__HARNESS_REPORT__();var fu=r.fallbackUi;var uiOk=!!(fu&&fu.panel&&!fu.coexistNote&&fu.download&&fu.update&&fu.updateToggles>=1&&fu.sections.indexOf("sec-updates")>=0&&fu.sections.indexOf("sec-troubleshooting")>=0&&fu.sections.indexOf("sec-config")>=0&&fu.version);var ok=r.hostInstalled&&r.owner==="shelveshub"&&r.specs.length===0&&r.shelvesTabPresent&&uiOk&&r.errors.length===0;(ok?"PASS ":"FAIL ")+JSON.stringify(r)+(window.__HARNESS_ERROR__?(" ERR="+window.__HARNESS_ERROR__):"")' ;;
    coexist-late)     echo 'var r=__HARNESS_REPORT__();var ok=r.bridge&&!r.hostInstalled&&r.shelvesTabPresent;(ok?"PASS ":"FAIL ")+JSON.stringify(r)+(window.__HARNESS_ERROR__?(" ERR="+window.__HARNESS_ERROR__):"")' ;;
    # The native pair also proves the native path: discovery landed, and (mirror) the hub button rendered natively.
    coexist-native)   echo 'var r=__HARNESS_REPORT__();var ok=r.bridge&&!r.hostInstalled&&r.owner==="decky"&&r.qamOwner==="shelveshub"&&r.shelvesTabPresent&&/DECK SHELVES EDITOR/.test(r.shelvesTabText)&&r.openHub&&r.nativeUi.discovered&&r.nativeUi.rendered&&r.errors.length===0;(ok?"PASS ":"FAIL ")+JSON.stringify(r)' ;;
    coexist-fallback-native) echo 'var r=__HARNESS_REPORT__();var fu=r.fallbackUi;var uiOk=!!(fu&&fu.panel&&fu.coexistNote&&!fu.download&&fu.update&&fu.updateToggles>=1&&fu.sections.indexOf("sec-updates")>=0&&fu.version);var ok=r.bridge&&!r.hostInstalled&&r.specs.length===0&&r.shelvesTabPresent&&uiOk&&r.nativeUi.discovered&&r.errors.length===0;(ok?"PASS ":"FAIL ")+JSON.stringify(r)' ;;
    coexist-idle) echo 'var r=__HARNESS_REPORT__();var idle=r.idle||{observers:0,live:{}};var ms=Object.keys(idle.live||{}).map(function(k){return idle.live[k];});var minMs=ms.length?Math.min.apply(null,ms):Infinity;var ok=r.bridge&&r.shelvesTabPresent&&(idle.observers<=4)&&(minMs>=1000)&&r.errors.length===0;(ok?"PASS ":"FAIL ")+JSON.stringify({idle:idle,minMs:(minMs===Infinity?"none":minMs),bridge:r.bridge,tab:r.shelvesTabPresent,errors:r.errors})' ;;
    # Cooperation: the loader's copy runs (no self-install), and host.routes reaches the loader's router hook (the mock's spies).
    coop-mirror)      echo 'var r=__HARNESS_REPORT__();var hst=window.__SHELVES_HOST__;var c=r.handshake&&r.handshake.capabilities;var reg=hst.routes.register("/x",function(){});reg.dispose();var p=hst.routes.addPatch("/library/home",function(){});hst.routes.removePatch("/library/home",p);var calls=(window.__HARNESS_ROUTER_CALLS__||[]).join("|");var routed=calls==="addRoute /x|removeRoute /x|addPatch /library/home|removePatch /library/home";var ok=r.hostInstalled&&r.owner==="shelveshub"&&r.bridge&&r.qamOwner==="shelveshub"&&r.specs.indexOf("deck-shelves")>=0&&r.shelvesTabPresent&&/DECK SHELVES EDITOR/.test(r.shelvesTabText)&&r.openHub&&!!c&&c.coexist===true&&c.selfUpdate===false&&r.canSelfInstall===false&&routed&&r.errors.length===0;(ok?"PASS ":"FAIL ")+JSON.stringify(r)+" calls="+calls+(window.__HARNESS_ERROR__?(" ERR="+window.__HARNESS_ERROR__):"")' ;;
    coop-fallback)    echo 'var r=__HARNESS_REPORT__();var fu=r.fallbackUi;var c=r.handshake&&r.handshake.capabilities;var uiOk=!!(fu&&fu.panel&&fu.coexistNote&&!fu.download&&fu.update&&fu.updateToggles>=1&&fu.sections.indexOf("sec-updates")>=0&&fu.version);var ok=r.hostInstalled&&r.owner==="shelveshub"&&r.specs.length===0&&r.shelvesTabPresent&&uiOk&&!!c&&c.selfUpdate===false&&r.canSelfInstall===false&&r.errors.length===0;(ok?"PASS ":"FAIL ")+JSON.stringify(r)+(window.__HARNESS_ERROR__?(" ERR="+window.__HARNESS_ERROR__):"")' ;;
    # The hand-over: the stood-down loader copy's defer signal (stamped by the page) or our copy's boot stamp flips self-install on; neither, off.
    coop-bundle)      echo 'var r=__HARNESS_REPORT__();var hst=window.__SHELVES_HOST__;var c=r.handshake&&r.handshake.capabilities;var offered=!!c&&c.coopBundle===true&&c.selfUpdate===true&&r.canSelfInstall===true;delete window.__DECK_SHELVES_DEFER_TO_HOST__;var cleared=hst.handshake().capabilities.selfUpdate===false&&hst.updates.canSelfInstall()===false;window.__DECK_SHELVES_HOST_BUNDLE_BOOTED__="0.0.1";var booted=hst.handshake().capabilities.selfUpdate===true&&hst.updates.canSelfInstall()===true;var ok=r.hostInstalled&&r.owner==="shelveshub"&&r.bridge&&r.specs.indexOf("deck-shelves")>=0&&r.shelvesTabPresent&&/DECK SHELVES EDITOR/.test(r.shelvesTabText)&&offered&&cleared&&booted&&r.errors.length===0;(ok?"PASS ":"FAIL ")+JSON.stringify({offered:offered,cleared:cleared,booted:booted,caps:c,errors:r.errors})+(window.__HARNESS_ERROR__?(" ERR="+window.__HARNESS_ERROR__):"")' ;;
    # Eight "−" presses from 30: the RPC sees 25…5 then the floor 1 (never 0, nothing below); a refused "+" puts the row back and logs a WARN.
    sole-host-config) echo 'new Promise(function(res){var sec=document.querySelector("[data-fb=\"sec-sec-config\"]");if(!sec)return res("FAIL no config section");sec.click();var minus=function(){return document.querySelector("[data-fb=\"interval_secs−\"]");};var shown=function(){var b=minus();return b&&b.nextSibling?b.nextSibling.textContent:"";};var sent=function(){return (window.__HARNESS_RPC_CALLS__||[]).filter(function(c){return c.method==="setRuntimeConfig"&&c.args&&c.args.key==="interval_secs";}).map(function(c){return c.args.value;}).join(",");};var i=0;setTimeout(function down(){var b=minus();if(!b)return res("FAIL no step button");b.click();if(++i<8)return setTimeout(down,40);setTimeout(function(){var afterDown=sent(),floor=shown();window.__HARNESS_REFUSE_CONFIG__=true;document.querySelector("[data-fb=\"interval_secs+\"]").click();setTimeout(function(){var warned=(window.__SHELVES_LOG__||[]).some(function(e){return e.level==="WARN"&&/setRuntimeConfig interval_secs refused/.test(e.msg);});var errs=__HARNESS_REPORT__().errors;var ok=afterDown==="25,20,15,10,5,1"&&floor==="1"&&sent()==="25,20,15,10,5,1,6"&&shown()==="1"&&warned&&errs.length===0;res((ok?"PASS ":"FAIL ")+JSON.stringify({afterDown:afterDown,floor:floor,sent:sent(),shown:shown(),warned:warned,errors:errs}));},80);},60);},100);})' ;;
    # The hub view's "View logs" title button carries the pt-BR string from the shipped dictionary.
    sole-host-locale) echo 'var r=__HARNESS_REPORT__();var b=document.querySelector("[data-fb=\"open-logs\"]");var title=b?b.getAttribute("title"):"";var ok=r.hostInstalled&&r.owner==="shelveshub"&&r.shelvesTabPresent&&title==="Ver logs"&&r.errors.length===0;(ok?"PASS ":"FAIL ")+JSON.stringify({title:title,href:location.href,errors:r.errors})+(window.__HARNESS_ERROR__?(" ERR="+window.__HARNESS_ERROR__):"")' ;;
    # Interactions are async (RPC stub + React commits), so these return a Promise the eval awaits.
    sole-host-sidecar) echo 'new Promise(function(res){var sec=document.querySelector("[data-fb=\"sec-sec-troubleshooting\"]");if(sec)sec.click();setTimeout(function(){var btn=document.querySelector("[data-fb=\"logs\"]");if(!btn)return res("FAIL no logs button");btn.click();setTimeout(function(){var side=document.querySelector("[data-fb=\"sidecar\"]");var root=document.querySelector(".shelves-hub-root");var expanded=!!(root&&root.getAttribute("data-shelves-expanded")==="1");var rows=document.querySelectorAll("[data-fb=\"sidecar\"] [data-fb=\"logs-view\"]").length;var m1=(window.__HARNESS_COMPOSITOR__||[]).slice();var back=document.querySelector("[data-fb=\"logs-back\"]");if(back)back.click();setTimeout(function(){var closed=!document.querySelector("[data-fb=\"sidecar\"]");var narrow=!!(root&&root.getAttribute("data-shelves-expanded")==="0");var m2=(window.__HARNESS_COMPOSITOR__||[]).slice();var errs=__HARNESS_REPORT__().errors;var ok=!!side&&expanded&&rows===1&&m1.indexOf("QamFriendsExpanded")>=0&&closed&&narrow&&m2[m2.length-1]==="QamFriendsHidden"&&errs.length===0;res((ok?"PASS ":"FAIL ")+JSON.stringify({side:!!side,expanded:expanded,rows:rows,msgs:m2,closed:closed,narrow:narrow,errors:errs}));},150);},300);},100);})' ;;
    sole-host-notify) echo 'new Promise(function(res){var host=window.__SHELVES_HOST__;host.notifications.toast({title:"Hello",body:"World"});var notified=typeof window.__SHELVES_NOTIFY__==="function"&&window.__SHELVES_NOTIFY__("notice_recovered",{});setTimeout(function(){var bell=document.querySelector("[data-fb=\"open-notif\"]");var badge=bell?bell.textContent.trim():"";if(bell)bell.click();setTimeout(function(){var r=__HARNESS_REPORT__();var listed=host.notifications.list().length;var rowsInSide=document.querySelectorAll("[data-fb=\"sidecar\"] [data-fb=\"notif-view\"] [data-fb=\"notif-row\"]").length;var tab=document.querySelector("[data-fb=\"sidecar-tab-notif\"]");var active=!!(tab&&tab.getAttribute("data-active")==="1");var inHub=document.querySelectorAll("[data-fb-panel] > [data-fb=\"notif-row\"]").length;var mode=host.notifications.mode();var ok=listed===2&&notified===true&&badge==="2"&&rowsInSide===2&&active&&inHub===0&&mode==="failed"&&r.errors.length===0;res((ok?"PASS ":"FAIL ")+JSON.stringify({listed:listed,notified:notified,badge:badge,rowsInSide:rowsInSide,active:active,inHub:inHub,mode:mode,errors:r.errors}));},200);},200);})' ;;
    sole-host-gesture) echo 'new Promise(function(res){var pad=window.__HARNESS_PAD__;var row=document.querySelector("[data-fb=\"sec-sec-updates\"]");if(!pad||!row)return res("FAIL pad="+!!pad+" row="+!!row);row.classList.add("shelves-rowfocus");pad(0,23,true);pad(0,23,false);pad(0,23,true);setTimeout(function(){var side1=!!document.querySelector("[data-fb=\"sidecar\"]");var t1=document.querySelector("[data-fb=\"sidecar-tab-logs\"]");var logsActive=!!(t1&&t1.getAttribute("data-active")==="1");var back=document.querySelector("[data-fb=\"logs-back\"]");if(back)back.click();setTimeout(function(){var closed=!document.querySelector("[data-fb=\"sidecar\"]");document.dispatchEvent(new KeyboardEvent("keydown",{key:"N",code:"KeyN",ctrlKey:true,shiftKey:true,bubbles:true,cancelable:true}));setTimeout(function(){var side2=!!document.querySelector("[data-fb=\"sidecar\"]");var t2=document.querySelector("[data-fb=\"sidecar-tab-notif\"]");var notifActive=!!(t2&&t2.getAttribute("data-active")==="1");var errs=__HARNESS_REPORT__().errors;var ok=side1&&logsActive&&closed&&side2&&notifActive&&errs.length===0;res((ok?"PASS ":"FAIL ")+JSON.stringify({side1:side1,logsActive:logsActive,closed:closed,side2:side2,notifActive:notifActive,errors:errs}));},150);},150);},250);})' ;;
    # Leaving our tab unmounts its panel (an open sidecar closes, the menu narrows); coming back shows the hub view again,
    # where two D-pad rights and Ctrl+Shift+L open the sidecar; the back action returns to the editor for good.
    sole-host-tabswitch) echo 'new Promise(function(res){var q=function(s){return document.querySelector(s);};var fb=function(id){return q("[data-fb=\""+id+"\"]");};var hubShown=function(){return !!q("[data-fb-panel]")&&!!fb("back")&&!q(".ds-editor");};var sideTab=function(){var t=q("[data-fb=\"sidecar\"] [data-fb^=\"sidecar-tab-\"][data-active=\"1\"]");return t?t.getAttribute("data-fb"):"";};var keyL=function(){document.dispatchEvent(new KeyboardEvent("keydown",{key:"L",code:"KeyL",ctrlKey:true,shiftKey:true,bubbles:true,cancelable:true}));};var sel=window.__HARNESS_SELECT_TAB__;var open=fb("open-hub");if(!sel||!open)return res("FAIL select="+!!sel+" openHub="+!!open);var s={};open.click();setTimeout(function(){s.opened=hubShown();keyL();setTimeout(function(){s.sideBefore=sideTab();sel(4);setTimeout(function(){var m=window.__HARNESS_COMPOSITOR__||[];s.away=!q("[data-fb-panel]")&&!q("[data-fb=\"sidecar\"]");s.narrowed=m[m.length-1]==="QamFriendsHidden";sel(900);setTimeout(function(){s.back=hubShown();s.sideRestored=!!q("[data-fb=\"sidecar\"]");var pad=window.__HARNESS_PAD__,row=fb("sec-sec-updates");s.pad=!!pad;if(row)row.classList.add("shelves-rowfocus");if(pad){pad(0,23,true);pad(0,23,false);pad(0,23,true);}setTimeout(function(){s.padTab=sideTab();var lb=fb("logs-back");if(lb)lb.click();setTimeout(function(){s.closed=!q("[data-fb=\"sidecar\"]");keyL();setTimeout(function(){s.keyTab=sideTab();var b=fb("back");if(b)b.click();setTimeout(function(){sel(4);sel(900);s.reset=!!q(".ds-editor")&&!q("[data-fb-panel]");s.errors=__HARNESS_REPORT__().errors;var ok=s.opened&&s.sideBefore==="sidecar-tab-logs"&&s.away&&s.narrowed&&s.back&&!s.sideRestored&&s.pad&&s.padTab==="sidecar-tab-logs"&&s.closed&&s.keyTab==="sidecar-tab-logs"&&s.reset&&s.errors.length===0;res((ok?"PASS ":"FAIL ")+JSON.stringify(s));},150);},150);},150);},250);},150);},100);},150);},150);})' ;;
  esac
}

# Fold the per-scenario files into one JSON record (the QA-lab evidence shape:
# ts (UTC, ISO 8601) / kind / os / arch / browser / counts / scenarios[] with each full report).
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
    "ts": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
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
  local url="$PAGE?scenario=$sc"
  # Steam's renderer URL names the client language; the locale scenario carries it the same way.
  [[ "$sc" == "sole-host-locale" ]] && url="$url&LANGUAGE=brazilian"
  # shellcheck disable=SC2086
  "$BROWSER_BIN" $HEADLESS_FLAG $SANDBOX_FLAGS --remote-debugging-port="$PORT" --user-data-dir="$udir" \
    --no-first-run --no-default-browser-check --disable-gpu --disable-extensions \
    --disable-background-networking "$url" >/dev/null 2>&1 &
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

FAILED=0
# The unit layer is one counted result (and an evidence entry), so a broken check turns the run red.
if command -v node >/dev/null 2>&1; then
  echo "[i] Runtime unit checks (node vm)…"
  if node "$HARNESS_DIR/runtime-unit.js" "$ROOT"; then
    echo PASS >"$EVIDENCE_DIR/runtime-unit.result"; printf '  \033[32mPASS\033[0m  runtime-unit\n'
  else
    echo FAIL >"$EVIDENCE_DIR/runtime-unit.result"; printf '  \033[31mFAIL\033[0m  runtime-unit\n'; FAILED=$((FAILED + 1))
  fi
else
  echo "[i] node not found — runtime unit checks skipped"
fi

echo "[i] Running scenarios…"
for sc in coexist-mirror coexist-fallback sole-host sole-host-mirror sole-host-fallback coexist-late coexist-native coexist-fallback-native coexist-idle coop-mirror coop-fallback coop-bundle sole-host-sidecar sole-host-notify sole-host-gesture sole-host-locale sole-host-config sole-host-tabswitch; do
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
