#!/bin/bash
# Combined-host performance run: restart Steam, then measure how long until the
# renderer is up and until Deck Shelves is active, for the COMBINED host (a plugin
# loader + ShelvesHub on the Deck, or the sole host on macOS). Repeatable with
# --loop N, which doubles as the driver for the plugin's restart gate.
#
# Phases per run:
#   ui    — Steam CEF endpoint (:PORT /json) answers "big picture" (renderer up)
#   ready — READY_EXPR evaluates true in the renderer (Deck Shelves active)
#
# Usage:
#   scripts/combined-host-run.sh <deck|mac> [--loop N] [--timeout S] [--ready-expr JS]
#
# Deck uses .env (DECK_HOST/DECK_USER/DECK_SSH_KEY + DECK_CDP_HOST/PORT via the
# devtools eval); macOS drives the local Steam and :8080. No device state is
# changed beyond a Steam restart (the project's sanctioned recovery).
set -uo pipefail
cd "$(dirname "$0")/.."

TARGET="${1:-}"; shift || true
LOOPS=1; TIMEOUT=120
# Deck readiness comes from the daemon's own settle marker in journalctl (CDP eval
# isn't reachable over the LAN without a tunnel); mac/local readiness uses a CDP eval.
READY_EXPR='(!!window.__SHELVES_HOST__) || (!!window.__DECK_SHELVES_OWNER__) || !!document.querySelector("#deck-shelves-home-root")'
READY_LOG_PATTERN='Coexisting with|Bundle active in renderer'
RUN_START=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --loop) LOOPS="$2"; shift 2 ;;
    --timeout) TIMEOUT="$2"; shift 2 ;;
    --ready-expr) READY_EXPR="$2"; shift 2 ;;
    --ready-log) READY_LOG_PATTERN="$2"; shift 2 ;;
    *) echo "unknown arg: $1" >&2; exit 2 ;;
  esac
done
[[ "$TARGET" == "deck" || "$TARGET" == "mac" ]] || { echo "usage: combined-host-run.sh <deck|mac> [--loop N] [--timeout S] [--ready-expr JS] [--ready-log RE]" >&2; exit 2; }

now_ms() { python3 -c 'import time;print(int(time.time()*1000))'; }

set -o allexport; [[ -f .env ]] && source .env; set +o allexport
PORT="${SHELVES_CEF_PORT:-8080}"

ssh_deck() {
  local key="${DECK_SSH_KEY:-$HOME/.ssh/id_rsa}"; key="${key/#\~/$HOME}"
  local opts=(-o StrictHostKeyChecking=accept-new -o ConnectTimeout=6)
  [[ -f "$key" ]] && opts+=(-i "$key")
  ssh "${opts[@]}" "$DECK_USER@$DECK_HOST" "$@"
}

restart_steam() {
  if [[ "$TARGET" == "deck" ]]; then
    ssh_deck 'export XDG_RUNTIME_DIR=/run/user/$(id -u); export DBUS_SESSION_BUS_ADDRESS=unix:path=$XDG_RUNTIME_DIR/bus; systemctl --user restart steam-launcher.service' >/dev/null 2>&1
  else
    osascript -e 'quit app "Steam"' >/dev/null 2>&1 || true
    for _ in $(seq 1 20); do pgrep -x steam_osx >/dev/null 2>&1 || break; sleep 0.5; done
    pkill -x steam_osx >/dev/null 2>&1 || true
    sleep 1
    open "steam://open/bigpicture"
  fi
}

ui_up() {
  if [[ "$TARGET" == "deck" ]]; then
    ssh_deck "curl -sf http://127.0.0.1:$PORT/json 2>/dev/null | grep -qi 'big picture'"
  else
    curl -sf "http://127.0.0.1:$PORT/json" 2>/dev/null | grep -qi 'big picture'
  fi
}

ready() {
  if [[ "$TARGET" == "deck" ]]; then
    # The daemon logs the settle marker once the fresh renderer is claimed/coexisting.
    ssh_deck "journalctl --user -u shelveshub --since '@$RUN_START' --no-pager 2>/dev/null | grep -qiE '$READY_LOG_PATTERN'"
  else
    local out
    out=$(pnpm -s run local:eval -- "$READY_EXPR" 2>/dev/null)
    printf '%s' "$out" | grep -qx 'true'
  fi
}

# Wait for `fn` to succeed; echo elapsed ms, or "-" on timeout.
wait_ms() {
  local fn="$1" t0 el
  t0=$(now_ms)
  while :; do
    if "$fn"; then echo $(( $(now_ms) - t0 )); return 0; fi
    el=$(( ($(now_ms) - t0) / 1000 ))
    (( el >= TIMEOUT )) && { echo "-"; return 1; }
    sleep 2
  done
}

echo "[i] combined-host run · target=$TARGET · loops=$LOOPS · timeout=${TIMEOUT}s"
if [[ "$TARGET" == "deck" ]]; then echo "[i] ready: daemon log /$READY_LOG_PATTERN/"; else echo "[i] ready: eval $READY_EXPR"; fi
printf '%-5s %-10s %-12s %-10s %s\n' "run" "ui(ms)" "ready(ms)" "total(ms)" "result"

ok=0; declare -a readies=()
for i in $(seq 1 "$LOOPS"); do
  r0=$(now_ms)
  RUN_START=$(date +%s)
  restart_steam
  ui=$(wait_ms ui_up) || { printf '%-5s %-10s %-12s %-10s %s\n' "$i" "-" "-" "-" "FAIL(ui)"; continue; }
  rd=$(wait_ms ready)
  tot=$(( $(now_ms) - r0 ))
  if [[ "$rd" == "-" ]]; then
    printf '%-5s %-10s %-12s %-10s %s\n' "$i" "$ui" "-" "$tot" "FAIL(ready)"
  else
    printf '%-5s %-10s %-12s %-10s %s\n' "$i" "$ui" "$rd" "$tot" "OK"
    ok=$((ok+1)); readies+=("$rd")
  fi
done

echo "[i] success: $ok/$LOOPS"
if (( ${#readies[@]} > 0 )); then
  sorted=$(printf '%s\n' "${readies[@]}" | sort -n)
  n=${#readies[@]}
  min=$(printf '%s' "$sorted" | head -1)
  max=$(printf '%s' "$sorted" | tail -1)
  med=$(printf '%s' "$sorted" | sed -n "$(( (n+1)/2 ))p")
  echo "[i] ready(ms): min=$min median=$med max=$max"
fi
(( ok == LOOPS ))
