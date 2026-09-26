#!/usr/bin/env bash
#
# Install / uninstall lifecycle validation for the SteamOS (user-service) path,
# run inside a Linux container. A plain container has no running systemd, so a
# recording `systemctl` stub stands in — the point is to prove the SCRIPTS lay
# down and tear down the right files, keep the user's settings on a plain
# uninstall, and remove them on --purge (the bugs that actually bite: wrong
# paths, a missing service file, settings clobbered). systemd behaviour itself
# is not under test here.
#
# NOTE: this is the SteamOS/Linux path only. The Windows installer (NSIS + a
# PowerShell scheduled task) cannot run here — Docker on macOS/Linux runs Linux
# containers, and those Windows-only cmdlets need a real Windows host (that stays
# the "Windows real-hardware install test" plan item).
set -uo pipefail

ROOT="${SHELVES_ROOT:-/work}"
cd "$ROOT" || { echo "error: repo not found at $ROOT"; exit 1; }

FAILS=0
check() { # check <label> <test-expr...>
  local label="$1"; shift
  if "$@"; then echo "  [ok] $label"; else echo "  [X]  $label"; FAILS=$((FAILS + 1)); fi
}

echo "== Install / uninstall lifecycle (SteamOS user-service path) =="

# Build the binary (fast if the cache volume is warm) so the package is real.
cargo build --quiet --bin shelveshub || { echo "error: build failed"; exit 1; }

# ── Assemble a release-style package (mirrors release.yml's dist layout) ──────
PKG="$(mktemp -d)"
cp target/debug/shelveshub "$PKG/"
mkdir -p "$PKG/installer" "$PKG/bundle" "$PKG/runtime"
# The whole SteamOS installer dir (install.sh + uninstall.sh + service + .desktop),
# exactly as release.yml lays it into the package.
cp -r installer/SteamOS/. "$PKG/installer/"
cp shelveshub.config.json "$PKG/" 2>/dev/null || true
cp -r bundle/. "$PKG/bundle/" 2>/dev/null || true
cp -r runtime/. "$PKG/runtime/" 2>/dev/null || true

# ── Fake HOME + a recording systemctl stub (no systemd in a plain container) ──
FAKEHOME="$(mktemp -d)"
STUB="$(mktemp -d)"
SCLOG="$STUB/systemctl.log"
cat > "$STUB/systemctl" <<'STUBEOF'
#!/usr/bin/env bash
echo "$*" >> "$SCLOG_TARGET"
exit 0
STUBEOF
chmod +x "$STUB/systemctl"

INSTALL_DIR="$FAKEHOME/.local/share/shelveshub"
SERVICE_DIR="$FAKEHOME/.config/systemd/user"
SETTINGS_DIR="$FAKEHOME/.local/share/deck-shelves"

run_installer() { # run <script> [args...] from the package dir
  local script="$1"; shift
  ( cd "$PKG" && HOME="$FAKEHOME" PATH="$STUB:$PATH" SCLOG_TARGET="$SCLOG" bash "$script" "$@" )
}

# ── Install ───────────────────────────────────────────────────────────────────
echo "[1] install.sh"
: > "$SCLOG"
run_installer installer/install.sh >/tmp/install.out 2>&1 || { echo "  install.sh exited non-zero"; cat /tmp/install.out; FAILS=$((FAILS+1)); }
check "binary installed + executable"   test -x "$INSTALL_DIR/shelveshub"
check "service file placed"             test -f "$SERVICE_DIR/shelveshub.service"
check "uninstaller kept alongside"      test -x "$INSTALL_DIR/uninstall.sh"
check "runtime copied"                  test -f "$INSTALL_DIR/runtime/shelves-host.js"
check "daemon-reload issued"            grep -q "daemon-reload" "$SCLOG"
check "service enabled (persists)"      grep -qE "enable( --now)? shelveshub.service" "$SCLOG"
check "service (re)started"             grep -qE "(restart|start|enable --now) shelveshub.service" "$SCLOG"

# Seed shared settings to prove a plain uninstall preserves them.
mkdir -p "$SETTINGS_DIR"; echo '{"kept":true}' > "$SETTINGS_DIR/settings.json"

# ── Uninstall (no --purge → settings preserved) ───────────────────────────────
echo "[2] uninstall.sh (keep settings)"
: > "$SCLOG"
run_installer "$INSTALL_DIR/uninstall.sh" >/tmp/uninstall.out 2>&1 || { echo "  uninstall.sh exited non-zero"; cat /tmp/uninstall.out; FAILS=$((FAILS+1)); }
check "install dir removed"             test ! -e "$INSTALL_DIR"
check "service file removed"            test ! -e "$SERVICE_DIR/shelveshub.service"
check "service disabled"                grep -q "disable --now shelveshub.service" "$SCLOG"
check "shared settings PRESERVED"       test -f "$SETTINGS_DIR/settings.json"

# ── Reinstall, then uninstall --purge → settings removed ──────────────────────
echo "[3] uninstall.sh --purge (remove settings)"
run_installer installer/install.sh >/dev/null 2>&1
run_installer "$INSTALL_DIR/uninstall.sh" --purge >/tmp/purge.out 2>&1 || { echo "  purge exited non-zero"; cat /tmp/purge.out; FAILS=$((FAILS+1)); }
check "install dir removed (purge)"     test ! -e "$INSTALL_DIR"
check "shared settings REMOVED (purge)" test ! -e "$SETTINGS_DIR"

rm -rf "$PKG" "$FAKEHOME" "$STUB"
echo ""
if [[ "$FAILS" -eq 0 ]]; then echo "[OK] install/uninstall lifecycle passed"; else echo "[X] $FAILS check(s) failed"; fi
exit "$FAILS"
