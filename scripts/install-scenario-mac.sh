#!/usr/bin/env bash
#
# macOS install / uninstall lifecycle validation, run natively on a macOS runner
# (no Steam, no GUI). Proves install_mac.sh / uninstall_mac.sh lay down and tear
# down the right files, apply the SHELVES_* options on a FIRST install, keep the
# user's settings on a plain uninstall and remove them on --purge, refuse to run
# as root, and write install.log. `launchctl` is stubbed (a recording shim) — the
# LaunchAgent itself is not loaded here; this tests the SCRIPTS, like the Linux
# docker/install-scenario.sh does with a systemctl stub.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

FAILS=0
check() { local label="$1"; shift; if "$@"; then echo "  [ok] $label"; else echo "  [X]  $label"; FAILS=$((FAILS + 1)); fi; }

echo "== macOS install / uninstall lifecycle =="
cargo build --release --quiet || { echo "error: build failed"; exit 1; }

# ── Assemble a release-style package (mirrors release.yml's dist layout) ──────
PKG="$(mktemp -d)"
cp target/release/shelveshub "$PKG/"
cp target/release/shelves-devtools "$PKG/" 2>/dev/null || true
mkdir -p "$PKG/installer" "$PKG/bundle" "$PKG/runtime"
cp -r installer/macOS/. "$PKG/installer/"
cp shelveshub.config.json "$PKG/" 2>/dev/null || true
cp -r bundle/. "$PKG/bundle/" 2>/dev/null || true
cp -r runtime/. "$PKG/runtime/" 2>/dev/null || true

# ── Fake HOME + a recording launchctl stub (no real LaunchAgent under test) ───
FAKEHOME="$(mktemp -d)"
STUB="$(mktemp -d)"
LCLOG="$STUB/launchctl.log"
cat > "$STUB/launchctl" <<'STUBEOF'
#!/usr/bin/env bash
echo "$*" >> "$LCLOG_TARGET"
exit 0
STUBEOF
chmod +x "$STUB/launchctl"

INSTALL_DIR="$FAKEHOME/.local/share/shelveshub"
PLIST="$FAKEHOME/Library/LaunchAgents/com.shelveshub.plist"
SETTINGS_DIR="$FAKEHOME/Library/Application Support/deck-shelves"

run_installer() { # run_installer <script> [script-args...]
  local script="$1"; shift
  ( cd "$PKG" && env HOME="$FAKEHOME" PATH="$STUB:$PATH" LCLOG_TARGET="$LCLOG" bash "$script" "$@" )
}

# ── [0] Root guard: must REFUSE to run as root (only testable where sudo works) ─
if command -v sudo >/dev/null 2>&1 && sudo -n true 2>/dev/null; then
  echo "[0] install_mac.sh refuses root (no override)"
  if sudo env HOME="$FAKEHOME" PATH="$STUB:$PATH" bash "$PKG/installer/install_mac.sh" >/tmp/root.out 2>&1; then
    echo "  [X]  install_mac.sh should have refused to run as root"; FAILS=$((FAILS + 1))
  else
    check "refuses root with an explanation" grep -q "Don't run this as root" /tmp/root.out
    check "left no install dir behind"        test ! -e "$INSTALL_DIR"
  fi
fi

# ── [1] Install (fresh) with the SHELVES_* options exercised ──────────────────
echo "[1] install_mac.sh (fresh, with options)"
: > "$LCLOG"
( cd "$PKG" && env HOME="$FAKEHOME" PATH="$STUB:$PATH" LCLOG_TARGET="$LCLOG" \
    SHELVES_FORCE_OWNER=1 SHELVES_NATIVE_QAM=0 SHELVES_DESKTOP_UI=1 \
    SHELVES_AUTO_UPDATE=1 SHELVES_HUB_PRERELEASE=1 \
    bash installer/install_mac.sh ) >/tmp/install.out 2>&1 \
  || { echo "  install_mac.sh exited non-zero"; cat /tmp/install.out; FAILS=$((FAILS + 1)); }
check "binary installed + executable"   test -x "$INSTALL_DIR/shelveshub"
check "LaunchAgent plist placed"        test -f "$PLIST"
check "plist points at the install dir" grep -q "$INSTALL_DIR" "$PLIST"
check "uninstaller kept alongside"      test -x "$INSTALL_DIR/uninstall_mac.sh"
check "runtime copied"                  test -f "$INSTALL_DIR/runtime/shelves-host.js"
check "config present"                  test -f "$INSTALL_DIR/shelveshub.config.json"
check "install.log written"             test -f "$INSTALL_DIR/install.log"
check "launchctl load issued"           grep -q "load" "$LCLOG"
# Options applied on the fresh install:
check "force_owner flipped on"          grep -q '"force_owner": true'  "$INSTALL_DIR/shelveshub.config.json"
check "native_qam flipped off"          grep -q '"native_qam": false'  "$INSTALL_DIR/shelveshub.config.json"
check "desktop_ui flipped on"           grep -q '"desktop_ui": true'   "$INSTALL_DIR/shelveshub.config.json"
check "prefs seeded"                    test -f "$SETTINGS_DIR/shelveshub.json"
check "hub_prerelease seeded true"      grep -q '"hub_prerelease": true' "$SETTINGS_DIR/shelveshub.json"

# ── [2] Re-install says it kept the existing setup (doesn't look idle) ────────
echo "[2] install_mac.sh (re-install keeps setup)"
run_installer installer/install_mac.sh >/tmp/reinstall.out 2>&1 || true
check "re-install reports kept setup"   grep -q "Existing setup kept" /tmp/reinstall.out

# Seed shared settings to prove a plain uninstall preserves them.
echo '{"kept":true}' > "$SETTINGS_DIR/settings.json"

# ── [3] Uninstall (no --purge → settings preserved) ───────────────────────────
echo "[3] uninstall_mac.sh (keep settings)"
run_installer "$INSTALL_DIR/uninstall_mac.sh" >/tmp/uninstall.out 2>&1 \
  || { echo "  uninstall_mac.sh exited non-zero"; cat /tmp/uninstall.out; FAILS=$((FAILS + 1)); }
check "install dir removed"             test ! -e "$INSTALL_DIR"
check "LaunchAgent plist removed"       test ! -e "$PLIST"
check "shared settings PRESERVED"       test -f "$SETTINGS_DIR/settings.json"

# ── [4] Reinstall, then uninstall --purge → settings removed ──────────────────
echo "[4] uninstall_mac.sh --purge (remove settings)"
run_installer installer/install_mac.sh >/dev/null 2>&1
run_installer "$INSTALL_DIR/uninstall_mac.sh" --purge >/tmp/purge.out 2>&1 \
  || { echo "  purge exited non-zero"; cat /tmp/purge.out; FAILS=$((FAILS + 1)); }
check "install dir removed (purge)"     test ! -e "$INSTALL_DIR"
check "shared settings REMOVED (purge)" test ! -e "$SETTINGS_DIR"

rm -rf "$PKG" "$FAKEHOME" "$STUB"
echo ""
if [[ "$FAILS" -eq 0 ]]; then echo "[OK] macOS install/uninstall lifecycle passed"; else echo "[X] $FAILS check(s) failed"; fi
exit "$FAILS"
