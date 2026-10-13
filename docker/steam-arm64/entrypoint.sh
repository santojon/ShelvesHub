#!/usr/bin/env bash
#
# Steam ARM64 lab entrypoint. Modes:
#   boot   (default) fetch the client when missing, start it headless with the debug
#          port on, run the daemon against it, write the evidence record and stop.
#          LAB_KEEP=1 keeps Steam up until the container stops.
#   login  the same, plus a VNC server on :5900 so a person can sign in once; the
#          session stays in the Steam volume and later runs reuse it.
#   shell  an interactive shell with the display up.
#
# Environment: STEAM_CHANNEL (stable|publicbeta), STEAM_FLAGS (client flags),
# LAB_WAIT_SECS (budget for the first start, which downloads the rest of the client),
# LAB_DESKTOP_UI (1 = also inject into the desktop client), LAB_VNC_PASSWORD,
# QA_EVIDENCE_DIR (where the JSON record goes), SHELVES_ROOT (the staged hub).
set -uo pipefail
MODE="${1:-boot}"
S="$HOME/.local/share/Steam"
D="$S/steamrtarm64"
CHANNEL="${STEAM_CHANNEL:-stable}"
# The flags Valve's client runs with on ARM devices; no sandbox and software compositing in a container.
FLAGS="${STEAM_FLAGS:--deckard -steamos3 -gamepadui -no-cef-sandbox -cef-disable-gpu -cef-disable-gpu-compositing}"
WAIT="${LAB_WAIT_SECS:-1500}"
HUB="${SHELVES_ROOT:-/shelveshub}"
LOGS=/tmp/lab
mkdir -p "$LOGS"
export STEAMOS=1 LANG=C.UTF-8 XDG_RUNTIME_DIR="/tmp/xdg-$(id -u)"
mkdir -p -m 700 "$XDG_RUNTIME_DIR"
declare -A STEP=([client-boot]=skipped [login]=skipped [inject]=skipped [backend]=skipped [bundle-boot]=skipped)
CLIENT_VERSION="" LOGIN_PROBE="" SYSINFO="" BACKEND_STATUS="" MISSING_LIBS=""

targets() { curl -sf -m 5 http://127.0.0.1:8080/json 2>/dev/null; }
sjc_eval() { "$HUB/shelves-devtools" --port 8080 --target SharedJSContext eval "$1" 2>/dev/null; }

record() {
  [[ -n "${QA_EVIDENCE_DIR:-}" ]] || return 0
  mkdir -p "$QA_EVIDENCE_DIR"
  STEPS="$(for k in client-boot login inject backend bundle-boot; do printf '%s=%s\n' "$k" "${STEP[$k]}"; done)" \
  TARGETS="$(targets || true)" FLAGS="$FLAGS" CHANNEL="$CHANNEL" CLIENT_VERSION="$CLIENT_VERSION" \
  SYSINFO="$SYSINFO" LOGIN_PROBE="$LOGIN_PROBE" BACKEND="$BACKEND_STATUS" MISSING_LIBS="$MISSING_LIBS" \
  python3 - "$QA_EVIDENCE_DIR/steam-container-$(uname -m).json" <<'PY'
import json, os, sys, time
steps = dict(line.split("=", 1) for line in os.environ["STEPS"].splitlines() if "=" in line)
try:
    raw = json.loads(os.environ.get("TARGETS") or "[]")
except ValueError:
    raw = []
targets = [{"title": t.get("title", ""), "url": t.get("url", "")[:120], "type": t.get("type", "")} for t in raw]
def gamepad_gate(ts):
    for t in ts:
        title, url = t["title"].lower(), t["url"].lower()
        if "big picture" in title or title.startswith(("mainmenu", "quickaccess")) or "gamepad" in url:
            return True
    return False
def decode(value):
    try:
        value = json.loads(value)
        return json.loads(value) if isinstance(value, str) else value
    except ValueError:
        return value or None
# Only what describes the client and the platform; nothing that identifies the machine.
SYSTEM_KEYS = ("sOSName", "sKernelVersion", "nSteamVersion", "sSteamBuildDate", "sSteamAPI", "sCPUName",
               "sVideoCardName", "eGamingDeviceType", "bIsUnsupportedPrototypeHardware", "eHardwareVariant_DoNotUse")
system_info = decode(os.environ.get("SYSINFO", ""))
if isinstance(system_info, dict):
    system_info = {k: system_info[k] for k in SYSTEM_KEYS if k in system_info}
record = {
    "ts": time.strftime("%Y-%m-%d_%H-%M-%S"), "kind": "steam-container", "os": "linux",
    "arch": os.uname().machine, "channel": os.environ["CHANNEL"],
    "client_manifest": os.environ["CLIENT_VERSION"], "flags": os.environ["FLAGS"],
    "overall": "FAIL" if "fail" in steps.values() else "PASS", "steps": steps,
    "gamepad_gate": gamepad_gate(targets), "targets": targets,
    "session": decode(os.environ.get("LOGIN_PROBE", "")),
    "backend": decode(os.environ.get("BACKEND", "")),
    "system_info": system_info,
    "missing_libraries": os.environ.get("MISSING_LIBS", "").split(),
}
with open(sys.argv[1], "w") as out:
    json.dump(record, out, indent=2)
    out.write("\n")
print(f"[evidence] {sys.argv[1]} ({record['overall']})")
PY
}

# ── display, session bus, debug-port forward (Steam binds it to loopback only) ──
Xvfb :99 -screen 0 1280x800x24 -nolisten tcp >"$LOGS/xvfb.log" 2>&1 &
for _ in $(seq 1 40); do [[ -S /tmp/.X11-unix/X99 ]] && break; sleep 0.25; done
eval "$(dbus-launch --sh-syntax)"
socat TCP-LISTEN:8081,fork,reuseaddr TCP:127.0.0.1:8080 >/dev/null 2>&1 &
if [[ "$MODE" == "login" ]]; then
  x11vnc -display :99 -forever -shared -rfbport 5900 -passwd "${LAB_VNC_PASSWORD:-shelves}" >"$LOGS/x11vnc.log" 2>&1 &
  echo "[login] VNC on localhost:5900 (password: ${LAB_VNC_PASSWORD:-shelves}) — sign in once, with a test account."
  echo "        The session stays in the Steam volume and later runs reuse it."
fi
[[ "$MODE" == "shell" ]] && exec bash

# ── the client ───────────────────────────────────────────────────────────────
CLIENT_VERSION="$(python3 /usr/local/bin/fetch-client.py "$S" "$CHANNEL" | tee /dev/stderr | sed -n 's/^manifest .* version //p')"
[[ -x "$D/steam" ]] || { echo "[client] the client program is missing after the fetch"; STEP[client-boot]=fail; record; exit 1; }
mkdir -p "$HOME/.steam" "$HOME/.config/openvr"
ln -sfn "$S" "$HOME/.steam/steam"
ln -sfn "$S" "$HOME/.steam/root"
ln -sfn "$S/linuxarm64" "$HOME/.steam/sdkarm64"
[[ -e "$HOME/.config/openvr/openvrpaths.vrpath" ]] \
  || printf '{"config":[],"external_drivers":null,"jsonid":"vrpathreg","log":[],"runtime":[],"version":1}\n' \
    >"$HOME/.config/openvr/openvrpaths.vrpath"
touch "$S/.cef-enable-remote-debugging"

# Valve's first start verifies the files and downloads the rest of the client, then
# exits to restart itself; later starts skip the check. A client that restarted itself
# is waited for; starts are bounded.
supervise() {
  local n=0 extra
  while (( n < ${LAB_MAX_STARTS:-6} )); do
    extra=""
    [[ -f "$S/linuxarm64/steamclient.so" ]] && extra="-noverifyfiles -norepairfiles"
    echo "[client] start $((n + 1)): ./steam $FLAGS $extra" >>"$LOGS/steam.log"
    # shellcheck disable=SC2086
    ( cd "$D" && exec ./steam $FLAGS $extra ) >>"$LOGS/steam.log" 2>&1
    echo "[client] exited with status $?" >>"$LOGS/steam.log"
    sleep 5
    while pgrep -u "$(id -u)" -x steam >/dev/null; do sleep 2; done
    n=$((n + 1))
  done
}
supervise &
SUPERVISOR=$!

echo "[client] waiting for Steam's debug port (the first start downloads about 1 GB)…"
deadline=$(( $(date +%s) + WAIT ))
last=""
while (( $(date +%s) < deadline )); do
  if targets | grep -q '"SharedJSContext"'; then STEP[client-boot]=pass; break; fi
  kill -0 "$SUPERVISOR" 2>/dev/null || break
  line="$(tail -n 1 "$S/logs/bootstrap_log.txt" 2>/dev/null | cut -c1-140)"
  [[ -n "$line" && "$line" != "$last" ]] && { echo "  $line"; last="$line"; }
  sleep 5
done
MISSING_LIBS="$(grep -ahoE '[A-Za-z0-9_.+-]+\.so[.0-9]*: cannot open shared object file' "$S"/logs/*.txt "$S"/logs/*.log "$LOGS/steam.log" 2>/dev/null \
  | sed 's/: cannot open.*//' | sort -u | tr '\n' ' ')"
[[ -n "$MISSING_LIBS" ]] && echo "[client] missing libraries: $MISSING_LIBS"
if [[ "${STEP[client-boot]}" != "pass" ]]; then
  STEP[client-boot]=fail
  if kill -0 "$SUPERVISOR" 2>/dev/null; then
    echo "[client] no shared context on the debug port within ${WAIT}s; the client's last output:"
  else
    echo "[client] the client stopped before its debug port answered; its last output:"
  fi
  tail -n 25 "$LOGS/steam.log"
  record
  exit 1
fi
echo "[client] up — targets: $(targets | python3 -c 'import json,sys;print(", ".join(t.get("title","") for t in json.load(sys.stdin)))')"

# ── session + system info, read from the shared context ──────────────────────
sleep "${LAB_SETTLE_SECS:-20}"
if [[ -x "$HUB/shelves-devtools" ]]; then
  LOGIN_PROBE="$(sjc_eval '(function(){try{var u=window.App&&App.m_CurrentUser;var id=String((u&&u.strSteamID)||"");var onLogin=location.pathname.indexOf("/routes/login")===0;return JSON.stringify({signedIn:!onLogin&&id!==""&&id!=="0",steamId:id&&id!=="0"?"set":"none",route:location.pathname});}catch(e){return JSON.stringify({error:String(e)});}})()')"
  SYSINFO="$(sjc_eval 'SteamClient.System.GetSystemInfo().then(function(i){return JSON.stringify(i);})')"
  echo "$LOGIN_PROBE" | grep -q 'signedIn\\":true' && STEP[login]=pass
fi
echo "[session] signed in: ${STEP[login]}"

# ── the daemon against this client ───────────────────────────────────────────
if [[ -x "$HUB/shelveshub" ]]; then
  export SHELVES_SETTINGS_DIR="$HOME/.local/share/deck-shelves"
  mkdir -p "$SHELVES_SETTINGS_DIR"
  # The lab never touches the signed-in account's synced settings.
  [[ -f "$SHELVES_SETTINGS_DIR/shelveshub.json" ]] || echo '{"config_sync": false}' >"$SHELVES_SETTINGS_DIR/shelveshub.json"
  echo "[daemon] starting the hub against 127.0.0.1:8080"
  ( cd "$HUB" && SHELVES_CEF_PORT=8080 SHELVES_DESKTOP_UI="${LAB_DESKTOP_UI:-0}" SHELVES_OWNER_SETTLE_SECS=0 \
      SHELVES_INTERVAL_SECS=5 exec ./shelveshub ) >"$LOGS/hub.log" 2>&1 &
  for _ in $(seq 1 36); do
    grep -q "Bundle active in renderer" "$LOGS/hub.log" && { STEP[inject]=pass; break; }
    sleep 5
  done
  [[ "${STEP[inject]}" == "pass" ]] || { STEP[inject]=fail; echo "[daemon] no 'Bundle active' line; its log:"; tail -n 20 "$LOGS/hub.log"; }
  sleep 10
  token="$(cat "$HOME/.local/share/shelveshub/.rpc-token" 2>/dev/null)"
  BACKEND_STATUS="$(curl -sf -m 10 -H "Authorization: Bearer $token" -H 'content-type: application/json' \
      -d '{"method":"getBackendStatus","args":null}' http://127.0.0.1:60123/ 2>/dev/null)"
  if echo "$BACKEND_STATUS" | grep -q '"running":true'; then STEP[backend]=pass; else STEP[backend]=fail; fi
  # Without a session the plugin has no library to boot into, so a missing instance is not a defect then.
  if [[ "$(sjc_eval '!!window.__DECK_SHELVES_INSTANCE__')" == "true" ]]; then STEP[bundle-boot]=pass
  elif [[ "${STEP[login]}" == "pass" ]]; then STEP[bundle-boot]=fail; fi
  grep -E "\[loader\]|\[backend\]|\[main\] Version" "$LOGS/hub.log" | tail -n 12
fi

record
echo "[lab] client-boot=${STEP[client-boot]} login=${STEP[login]} inject=${STEP[inject]} backend=${STEP[backend]} bundle-boot=${STEP[bundle-boot]}"
if [[ "${LAB_KEEP:-0}" == "1" || "$MODE" == "login" ]]; then
  echo "[lab] keeping Steam up — stop the container to end"
  wait "$SUPERVISOR"
fi
( cd "$D" && ./steam -shutdown ) >/dev/null 2>&1
sleep 8
