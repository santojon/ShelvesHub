#!/usr/bin/env bash
#
# Daemon scenario harness: the real daemon's collapse -> recovery -> notice path,
# proven WITHOUT Steam.
#
# A headless Chromium stands in for Steam's CEF. Page A
# (examples/daemon-harness/shared-context.html) is titled "SharedJSContext", the
# renderer the daemon injects into; page B (big-picture.html) is one of Steam's UI
# windows. Closing B is what the daemon sees when Steam tears its windows down (the
# black screen): only the shared context is left. Each scenario starts a fresh
# browser profile and a fresh daemon (target/debug/shelveshub, 1 s ticks) and
# asserts on the daemon's log and on the runtime it injected into page A.
#
# Scenarios (3):
#   recovered    - B closes -> collapse #1, collapse #2 + the threshold error ->
#                  "Recovery command launched" -> collapse #3 and #4 (the command
#                  reopens B through the DevTools HTTP API four seconds later, while
#                  the collapse ticks on) -> "Steam UI windows are back" -> the
#                  recovered notice lands in the runtime's notification center; the
#                  threshold error and the launch each appear exactly once
#   recovery-off - the same with SHELVES_RECOVER_CMD=off -> "Auto-recovery disabled",
#                  no command, injection stays paused while collapsed; the threshold
#                  error and the opt-out line appear once while the collapse is held
#                  through #4; B is then reopened by hand and still no recovered
#                  notice arrives
#   booting      - page A only, no window ever -> "still bringing up its UI windows",
#                  never a collapse line, nothing injected: page A is read with no
#                  host runtime and no injection marker
#
# The daemon runs sealed off: its own HOME, settings, hub store (updates and settings
# sync off), RPC token file and RPC port; a config file of its own that names the same
# recovery command as SHELVES_RECOVER_CMD (never the shipped one, where an empty
# recover_cmd means the platform's real recovery: Steam quit and reopened, or its
# session restarted); a local stand-in bundle it takes as is (no download); the
# backend pointed at an empty directory (no obtain; its runner refuses the directory
# and exits); and a target filter on a token only this run's page A carries, so it
# never evaluates anything in a real Steam, not even through its fallback debugging
# ports (8080/8081). The first directory on its PATH holds stand-ins for the tools a
# platform's recovery runs (launchctl, systemctl, open, osascript, pkill, killall,
# steam): each only records its call, and a scenario fails when the daemon made one,
# the read-only unit query of its Linux device probe aside. The daemon leads its own
# process group, so nothing it launched outlives the scenario. Every scenario checks
# the bundle and backend lines of the log, and that the daemon is still running once
# its checks are done.
#
# Usage:  scripts/harness-daemon.sh                        (headless)
#         HEADLESS=0 scripts/harness-daemon.sh             (show the browser window)
#         HARNESS_JSON=path.json scripts/harness-daemon.sh (also write per-scenario evidence)
#         HARNESS_NO_SANDBOX=1 scripts/harness-daemon.sh   (containers / root)
#         DAEMON_HARNESS_CDP_PORT / DAEMON_HARNESS_RPC_PORT / DAEMON_HARNESS_HTTP_PORT
#         move the ports (defaults 9555 / 60177 / 8577, clear of scripts/harness.sh
#         and of an installed service); the ports in use are printed at the start.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PAGES_DIR="$ROOT/examples/daemon-harness"
CDP_PORT="${DAEMON_HARNESS_CDP_PORT:-9555}"
RPC_PORT="${DAEMON_HARNESS_RPC_PORT:-60177}"
HTTP_PORT="${DAEMON_HARNESS_HTTP_PORT:-8577}"
HEADLESS="${HEADLESS:-1}"
JSON_OUT="${HARNESS_JSON:-}"
CDP="http://127.0.0.1:$CDP_PORT"
# Only this run's page A carries the token in its URL: it is the daemon's target
# filter (SHELVES_TARGET) and the target every page read below uses.
RUN_TOKEN="daemon-harness-$$-$RANDOM"
PAGE_A="http://127.0.0.1:$HTTP_PORT/shared-context.html?LANGUAGE=english&run=$RUN_TOKEN"
PAGE_B="http://127.0.0.1:$HTTP_PORT/big-picture.html"
PAGE_B_TITLE="Steam Big Picture Mode"
# The recovery command brings the window back the way a Steam restart would, a few
# ticks later: the collapse goes on past the launch, so a second launch would show.
RECOVER_CMD="sleep 4; curl -s -o /dev/null -X PUT \"$CDP/json/new?$PAGE_B\""
# What a platform's own recovery runs; stand-ins for these lead the daemon's PATH.
PLATFORM_TOOLS=(launchctl systemctl open osascript pkill killall steam)
# The one call let through: the read-only unit query of the daemon's Linux device probe.
UNIT_PROBE="systemctl --user cat steam-launcher.service"

for tool in cargo python3 curl; do
  command -v "$tool" >/dev/null || { echo "error: $tool is required"; exit 1; }
done

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
echo "[i] Browser  : $BROWSER_BIN"
echo "[i] Ports    : CDP $CDP_PORT, RPC $RPC_PORT, HTTP $HTTP_PORT"
echo "[i] Building shelveshub + shelves-devtools..."
cargo build --quiet --manifest-path "$ROOT/Cargo.toml" --bin shelveshub --bin shelves-devtools \
  || { echo "build failed"; exit 1; }
BIN_DIR="${CARGO_TARGET_DIR:-$ROOT/target}/debug"
DAEMON="$BIN_DIR/shelveshub"
DEVTOOLS="$BIN_DIR/shelves-devtools"

# A port something already listens on means another run or a service would read our
# pages or hold our RPC port: refuse instead.
port_in_use() { (exec 3<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null; }
for p in "$CDP_PORT" "$RPC_PORT" "$HTTP_PORT"; do
  if port_in_use "$p"; then
    echo "error: port $p is in use (set DAEMON_HARNESS_CDP_PORT / DAEMON_HARNESS_RPC_PORT / DAEMON_HARNESS_HTTP_PORT)"
    exit 1
  fi
done

WORK="$(mktemp -d)"
EVIDENCE_DIR="$WORK/evidence"
mkdir -p "$EVIDENCE_DIR"
HTTP_PID=""
BROWSER_PID=""
DAEMON_PID=""
PROFILE=""

stop_daemon() {
  [[ -n "$DAEMON_PID" ]] || return 0
  # The whole process group the daemon leads: a recovery command it launched goes too.
  kill -- "-$DAEMON_PID" 2>/dev/null || kill "$DAEMON_PID" 2>/dev/null
  wait "$DAEMON_PID" 2>/dev/null
  DAEMON_PID=""
}
# Always after stop_daemon: a daemon that loses the browser probes the fallback ports.
stop_browser() {
  [[ -n "$BROWSER_PID" ]] || return 0
  kill "$BROWSER_PID" 2>/dev/null
  wait "$BROWSER_PID" 2>/dev/null
  # A helper process can outlive its killed parent; they all carry the profile path,
  # and the profile is only removed once they are gone.
  if command -v pkill >/dev/null 2>&1; then
    pkill -f -- "--user-data-dir=$PROFILE" 2>/dev/null
    local left=12
    while (( left > 0 )) && pgrep -f -- "--user-data-dir=$PROFILE" >/dev/null 2>&1; do
      sleep 0.25
      left=$(( left - 1 ))
    done
  fi
  BROWSER_PID=""
}
cleanup() {
  stop_daemon
  stop_browser
  if [[ -n "$HTTP_PID" ]]; then
    kill "$HTTP_PID" 2>/dev/null
    wait "$HTTP_PID" 2>/dev/null
  fi
  rm -rf "$WORK"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

# wait_until <seconds> <command...>: re-run the command every quarter second until it
# succeeds; gives up at once when a started daemon has exited.
wait_until() {
  local left=$(( $1 * 4 ))
  shift
  while (( left > 0 )); do
    "$@" && return 0
    if [[ -n "$DAEMON_PID" ]] && ! kill -0 "$DAEMON_PID" 2>/dev/null; then return 1; fi
    sleep 0.25
    left=$(( left - 1 ))
  done
  return 1
}

# Loopback-only static server over the two harness pages (nothing else in the checkout).
python3 -m http.server "$HTTP_PORT" --bind 127.0.0.1 --directory "$PAGES_DIR" >/dev/null 2>&1 &
HTTP_PID=$!
wait_until 10 curl -sf -o /dev/null "http://127.0.0.1:$HTTP_PORT/shared-context.html" \
  || { echo "error: could not serve on port $HTTP_PORT (set DAEMON_HARNESS_HTTP_PORT)"; exit 1; }

HEADLESS_FLAG="--headless=new"
[[ "$HEADLESS" == "0" ]] && HEADLESS_FLAG=""
# Chromium refuses to run as root without --no-sandbox, and Docker's default
# /dev/shm is too small for it: opt in when running inside a container.
SANDBOX_FLAGS=""
[[ "${HARNESS_NO_SANDBOX:-0}" == "1" ]] && SANDBOX_FLAGS="--no-sandbox --disable-dev-shm-usage"

# page_id <title>: id of the page target with exactly that title (empty when none).
page_id() {
  curl -s "$CDP/json" 2>/dev/null | python3 -c '
import json, sys
try:
    targets = json.load(sys.stdin)
except ValueError:
    targets = []
ids = [t.get("id", "") for t in targets if t.get("type") == "page" and t.get("title") == sys.argv[1]]
print(ids[0] if ids else "")
' "$1"
}
page_up() { [[ -n "$(page_id "$1")" ]]; }
open_page_b() { curl -s -o /dev/null -X PUT "$CDP/json/new?$PAGE_B"; }
close_page() { curl -s -o /dev/null "$CDP/json/close/$1"; }

# What the runtime in page A holds: the host, the notice entry point, the time on the
# daemon's injection marker, and whether the notification center lists the recovered
# notice (worded in any of the shipped languages).
PAGE_PROBE='(function(){var h=window.__SHELVES_HOST__,d=window.__SHELVES_I18N__||{},want={};Object.keys(d).forEach(function(k){var t=d[k]&&d[k].notice_recovered;if(t)want[t]=1;});var l=h&&h.notifications?h.notifications.list():[];var hit=l.some(function(n){return n.source==="hub"&&want[n.body]===1;});var m=window.__SHELVES_LOADER__||{};return (hit?"RECOVERED ":"NONE ")+JSON.stringify({host:!!h,notify:typeof window.__SHELVES_NOTIFY__==="function",injectedAt:m.at||null,notifications:l.map(function(n){return n.title+": "+n.body;})});})()'
page_probe() { "$DEVTOOLS" --host 127.0.0.1 --port "$CDP_PORT" --target "$RUN_TOKEN" eval "$PAGE_PROBE" 2>/dev/null; }
notice_seen() { page_probe | grep -q '^"RECOVERED'; }
host_up() { page_probe | grep -q '"host\\":true'; }
injected_at() { page_probe | sed -n 's/.*\\"injectedAt\\":\([0-9]*\).*/\1/p'; }

# first_line <log> <text> [after]: number of the first line after line `after` holding text.
first_line() { awk -v s="$2" -v a="${3:-0}" 'NR > a && index($0, s) { print NR; exit }' "$1"; }
has_line() { [[ -n "$(first_line "$@")" ]]; }
count_lines() { grep -cF -- "$2" "$1"; }

# in_order <log> <text>...: each text appears after the previous one. Sets ORDER to
# the line numbers, or MISSING to the first text not found in order.
in_order() {
  local log="$1" at=0 n t
  shift
  ORDER=""
  MISSING=""
  for t in "$@"; do
    n="$(first_line "$log" "$t" "$at")"
    if [[ -z "$n" ]]; then MISSING="$t"; return 1; fi
    ORDER="${ORDER:+$ORDER }$n"
    at="$n"
  done
}

REASON=""
SC_DIR=""
# fail <reason>: record why the scenario failed (and the daemon's last word if it exited).
fail() {
  REASON="$1"
  if [[ -n "$DAEMON_PID" ]] && ! kill -0 "$DAEMON_PID" 2>/dev/null; then
    REASON="$1 (the daemon exited: $(tail -n 1 "$SC_DIR/daemon.log" 2>/dev/null))"
  fi
  return 1
}
# note <key> <value>: one asserted fact for the evidence record.
note() { printf '%s\t%s\n' "$1" "$2" >>"$SC_DIR/checks"; }

# prepare <dir>: the sealed world one scenario's daemon runs in.
prepare() {
  local dir="$1" t
  mkdir -p "$dir/home" "$dir/settings" "$dir/backend" "$dir/tmp" "$dir/profile" "$dir/bin"
  # Updates and settings sync off: no release lookups, no roaming writes.
  echo '{ "auto_update": false, "config_sync": false }' >"$dir/hub.json"
  # A stand-in bundle past the daemon's placeholder size, so it is taken as is.
  {
    echo 'window.__DAEMON_HARNESS_BUNDLE_BOOTS__ = (window.__DAEMON_HARNESS_BUNDLE_BOOTS__ || 0) + 1;'
    printf '/*%8192s*/\n' ''
  } >"$dir/bundle.js"
  # Each stand-in only records its call; run_scenario fails on any but UNIT_PROBE.
  for t in "${PLATFORM_TOOLS[@]}"; do
    printf '#!/bin/sh\necho "%s $*" >>"%s"\nexit 0\n' "$t" "$dir/platform-commands" >"$dir/bin/$t"
    chmod +x "$dir/bin/$t"
  done
}

start_browser() {
  PROFILE="$1/profile"
  # shellcheck disable=SC2086
  "$BROWSER_BIN" $HEADLESS_FLAG $SANDBOX_FLAGS --remote-debugging-port="$CDP_PORT" --user-data-dir="$PROFILE" \
    --no-first-run --no-default-browser-check --disable-gpu --disable-extensions \
    --disable-background-networking "$PAGE_A" >/dev/null 2>&1 &
  BROWSER_PID=$!
}

# start_daemon <dir> <recover command>: the real daemon with a clean environment, 1 s
# ticks, the desktop UI allowed (so no Big Picture visibility probe) and no owner
# settle; everything it reads or writes lives in <dir>.
start_daemon() {
  local dir="$1"
  # The file names the command too, so neither source can fall back to the platform's.
  python3 -c 'import json, sys; print(json.dumps({"recover_cmd": sys.argv[1], "native_qam": True}))' "$2" \
    >"$dir/shelveshub.config.json"
  # Job control for this one launch only: the daemon gets a process group of its own.
  set -m
  env -i PATH="$dir/bin:$PATH" HOME="$dir/home" TMPDIR="$dir/tmp" \
    SHELVES_CEF_HOST=127.0.0.1 SHELVES_CEF_PORT="$CDP_PORT" SHELVES_TARGET="$RUN_TOKEN" \
    SHELVES_RPC_HOST=127.0.0.1 SHELVES_RPC_PORT="$RPC_PORT" SHELVES_RPC_TOKEN_FILE="$dir/rpc-token" \
    SHELVES_INTERVAL_SECS=1 SHELVES_DESKTOP_UI=1 SHELVES_OWNER_SETTLE_SECS=0 \
    SHELVES_RECOVER_CMD="$2" \
    SHELVES_HUB_CONFIG="$dir/hub.json" SHELVES_SETTINGS_DIR="$dir/settings" \
    SHELVES_CONFIG_FILE="$dir/shelveshub.config.json" \
    SHELVES_BUNDLE_PATH="$dir/bundle.js" SHELVES_HOST_RUNTIME_PATH="$ROOT/runtime/shelves-host.js" \
    SHELVES_BACKEND_DIR="$dir/backend" \
    SHELVES_BOOT_MOVIE=0 SHELVES_BOOT_MOVIE_FILE="$dir/no-movie.webm" \
    "$DAEMON" </dev/null >"$dir/daemon.log" 2>&1 &
  DAEMON_PID=$!
  set +m
}

# sealed <dir>: the log shows the local bundle taken as is and no backend obtain.
sealed() {
  local log="$1/daemon.log"
  has_line "$log" "Bundle ready via local (" || fail "the daemon did not take the local bundle" || return 1
  ! has_line "$log" "downloading from" || fail "the daemon tried a download" || return 1
  has_line "$log" "backend=$1/backend " || fail "the backend was not the empty test directory" || return 1
  if has_line "$log" "Backend ready via" || has_line "$log" "No backend obtained"; then
    fail "the daemon tried to obtain a backend"
    return 1
  fi
  note bundle "local file taken as is, no download"
  note backend "empty test directory, no obtain"
}

# start_world <dir> <recover command> <with page B>: the browser on page A, page B when
# asked, then the daemon.
start_world() {
  local dir="$1"
  start_browser "$dir"
  wait_until 30 page_up "SharedJSContext" || fail "page A did not load" || return 1
  if [[ "$3" == "1" ]]; then
    open_page_b
    wait_until 15 page_up "$PAGE_B_TITLE" || fail "page B did not open" || return 1
  fi
  start_daemon "$dir" "$2"
}

sc_recovered() {
  local dir="$1" log="$1/daemon.log" back
  start_world "$dir" "$RECOVER_CMD" 1 || return 1
  wait_until 30 has_line "$log" "Bundle active in renderer." || fail "the bundle never went active" || return 1
  sealed "$dir" || return 1
  wait_until 10 host_up || fail "no host runtime in page A" || return 1
  close_page "$(page_id "$PAGE_B_TITLE")"
  wait_until 20 has_line "$log" "Steam UI windows are back" || fail "the UI windows never came back" || return 1
  back="$(first_line "$log" "Steam UI windows are back")"
  wait_until 10 has_line "$log" "Bundle active in renderer." "$back" || fail "hosting did not resume" || return 1
  in_order "$log" "collapse #1;" "collapse #2;" "Steam UI windows have collapsed." \
    "Recovery command launched:" "collapse #3;" "collapse #4;" "Steam UI windows are back" \
    "Bundle active in renderer." \
    || fail "log out of order, missing: $MISSING" || return 1
  note order "collapse #1, collapse #2, threshold error, recovery launched, collapse #3, collapse #4, windows back, active again: log lines $ORDER"
  [[ "$(count_lines "$log" "Recovery command launched:")" == "1" ]] || fail "the recovery command ran more than once" || return 1
  [[ "$(count_lines "$log" "Steam UI windows have collapsed.")" == "1" ]] || fail "the threshold error repeated" || return 1
  note once "one threshold error and one recovery launch over the whole collapse"
  wait_until 10 notice_seen || fail "the recovered notice never reached the runtime" || return 1
  note notice "recovered notice listed by the host's notification center"
}

sc_recovery_off() {
  local dir="$1" log="$1/daemon.log" before collapsed back after
  start_world "$dir" off 1 || return 1
  wait_until 30 has_line "$log" "Bundle active in renderer." || fail "the bundle never went active" || return 1
  sealed "$dir" || return 1
  wait_until 10 host_up || fail "no host runtime in page A" || return 1
  before="$(injected_at)"
  [[ -n "$before" ]] || fail "could not read the injection marker in page A" || return 1
  close_page "$(page_id "$PAGE_B_TITLE")"
  # Held collapsed for a few ticks: the opt-out line once, then the pause goes on.
  wait_until 20 has_line "$log" "collapse #4;" || fail "the collapse was not held" || return 1
  in_order "$log" "collapse #1;" "collapse #2;" "Steam UI windows have collapsed." \
    "Auto-recovery disabled" "collapse #3;" "collapse #4;" \
    || fail "log out of order, missing: $MISSING" || return 1
  note order "collapse #1, collapse #2, threshold error, recovery disabled, collapse #3, collapse #4: log lines $ORDER"
  [[ "$(count_lines "$log" "Steam UI windows have collapsed.")" == "1" ]] || fail "the threshold error repeated" || return 1
  [[ "$(count_lines "$log" "Auto-recovery disabled")" == "1" ]] || fail "the opt-out line repeated" || return 1
  note once "one threshold error and one opt-out line through collapse #4"
  collapsed="$(first_line "$log" "collapse #1;")"
  if has_line "$log" "Bundle not detected" "$collapsed" || has_line "$log" "Host runtime injected." "$collapsed"; then
    fail "injected while collapsed"
    return 1
  fi
  note paused "nothing injected from collapse #1 on"
  # Steam brought back by hand: hosting resumes, and still no recovered notice.
  open_page_b
  wait_until 20 has_line "$log" "Steam UI windows are back" || fail "the UI windows never came back" || return 1
  back="$(first_line "$log" "Steam UI windows are back")"
  wait_until 10 has_line "$log" "Bundle active in renderer." "$back" || fail "hosting did not resume" || return 1
  sleep 2
  ! has_line "$log" "Recovery command launched" || fail "a recovery command ran" || return 1
  host_up || fail "no host runtime in page A after the windows came back" || return 1
  ! notice_seen || fail "a recovered notice arrived with recovery off" || return 1
  after="$(injected_at)"
  [[ "$before" == "$after" ]] || fail "the page was injected again ($before -> $after)" || return 1
  note notice "none (recovery off)"
}

sc_booting() {
  local dir="$1" log="$1/daemon.log" page
  start_world "$dir" off 0 || return 1
  wait_until 10 has_line "$log" "Steam is still bringing up its UI windows" || fail "no boot wait line" || return 1
  sealed "$dir" || return 1
  # A few more fast ticks inside the boot grace: still waiting, never a collapse.
  sleep 4
  ! has_line "$log" "collapse #" || fail "a booting renderer was read as a collapse" || return 1
  if has_line "$log" "Bundle not detected" || has_line "$log" "Host runtime injected."; then
    fail "injected while Steam was still booting"
    return 1
  fi
  [[ "$(count_lines "$log" "Steam is still bringing up its UI windows")" == "1" ]] \
    || fail "the boot wait line repeated" || return 1
  # Read from the page as well, so an injection that logs nothing still fails.
  page="$(page_probe)"
  [[ -n "$page" ]] || fail "could not read page A" || return 1
  [[ "$page" == *'"host\":false'* && "$page" == *'"injectedAt\":null'* ]] \
    || fail "page A was injected while Steam was still booting: $page" || return 1
  note booting "waiting line once, no collapse, nothing injected; page A read with no host runtime and no injection marker"
}

run_scenario() {
  local name="$1" fn="$2" rc ran
  SC_DIR="$WORK/$name"
  REASON=""
  prepare "$SC_DIR"
  : >"$SC_DIR/checks"
  "$fn" "$SC_DIR"
  rc=$?
  # Checks for absent lines after a fixed wait also pass when the daemon died meanwhile.
  if [[ "$rc" -eq 0 ]] && ! kill -0 "$DAEMON_PID" 2>/dev/null; then
    REASON="the daemon exited: $(tail -n 1 "$SC_DIR/daemon.log" 2>/dev/null)"
    rc=1
  fi
  page_probe >"$EVIDENCE_DIR/$name.page"
  stop_daemon
  stop_browser
  # Read once the daemon and everything it launched are gone.
  ran="$(grep -vxF "$UNIT_PROBE" "$SC_DIR/platform-commands" 2>/dev/null | head -n 1)"
  if [[ -n "$ran" ]]; then
    REASON="the daemon ran a platform command: $ran${REASON:+ ($REASON)}"
    rc=1
  elif [[ "$rc" -eq 0 ]]; then
    note platform "no platform command run (stand-ins first on the daemon's PATH)"
  fi
  echo "$name" >>"$EVIDENCE_DIR/order"
  cp "$SC_DIR/daemon.log" "$EVIDENCE_DIR/$name.log" 2>/dev/null
  cp "$SC_DIR/checks" "$EVIDENCE_DIR/$name.checks"
  printf '%s\n' "$REASON" >"$EVIDENCE_DIR/$name.reason"
  if [[ "$rc" -eq 0 ]]; then
    echo PASS >"$EVIDENCE_DIR/$name.result"
    echo "PASS $name"
    return 0
  fi
  echo FAIL >"$EVIDENCE_DIR/$name.result"
  echo "FAIL $name ${REASON:-scenario error}"
  tail -n 12 "$SC_DIR/daemon.log" 2>/dev/null | sed 's/^/        /'
  return 1
}

# Fold the per-scenario files into one JSON record, the QA-lab evidence shape of
# scripts/harness.sh: ts (UTC, ISO 8601) / kind / os / arch / browser / counts /
# scenarios[] with the asserted facts, the page read and the daemon log.
write_evidence() {
  [[ -n "$JSON_OUT" ]] || return 0
  mkdir -p "$(dirname "$JSON_OUT")"
  python3 - "$EVIDENCE_DIR" "$JSON_OUT" "$BROWSER_BIN" <<'PY'
import json, os, platform, sys, time
src, out, browser = sys.argv[1:4]

def read(name, default=""):
    try:
        with open(os.path.join(src, name), encoding="utf-8", errors="replace") as f:
            return f.read()
    except OSError:
        return default

def page(raw):
    try:
        text = json.loads(raw)
        state, _, detail = text.partition(" ")
        return {"notice": state, "runtime": json.loads(detail)}
    except Exception:
        return None

scenarios = []
for name in read("order").split():
    checks = {}
    for line in read(name + ".checks").splitlines():
        key, _, value = line.partition("\t")
        checks[key] = value
    scenarios.append({
        "name": name,
        "result": read(name + ".result").strip(),
        "report": {
            "reason": read(name + ".reason").strip(),
            "checks": checks,
            "page": page(read(name + ".page")),
            "log": read(name + ".log").splitlines()[:200],
        },
    })
passed = sum(1 for s in scenarios if s["result"] == "PASS")
record = {
    "ts": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    "kind": "daemon-scenarios",
    "os": platform.system().lower(),
    "arch": platform.machine(),
    "browser": os.path.basename(browser),
    "passed": passed,
    "failed": len(scenarios) - passed,
    "total": len(scenarios),
    "scenarios": scenarios,
}
with open(out, "w", encoding="utf-8") as f:
    json.dump(record, f, indent=2, ensure_ascii=False)
    f.write("\n")
print(f"[i] Evidence written to {out}")
PY
}

FAILED=0
echo "[i] Running daemon scenarios..."
run_scenario recovered sc_recovered || FAILED=$((FAILED + 1))
run_scenario recovery-off sc_recovery_off || FAILED=$((FAILED + 1))
run_scenario booting sc_booting || FAILED=$((FAILED + 1))
write_evidence

echo ""
if [[ "$FAILED" -eq 0 ]]; then
  echo "[OK] all daemon scenarios passed"
  exit 0
fi
echo "[X] $FAILED daemon scenario(s) failed"
exit 1
