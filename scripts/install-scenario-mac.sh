#!/usr/bin/env bash
#
# macOS install / uninstall lifecycle validation, run natively on a macOS runner
# (no Steam, no GUI). Proves install_mac.sh / uninstall_mac.sh lay down and tear
# down the right files, apply the SHELVES_* options on a FIRST install, keep the
# user's settings on a plain uninstall and remove them on --purge, refuse to run
# as root, write install.log, and take the download branch (SHA256SUMS checked, a
# mismatch and a failed download refused) against an offline curl stub.
# `launchctl` is stubbed (a recording shim) — the LaunchAgent itself is not loaded
# here; this tests the SCRIPTS, like the Linux docker/install-scenario.sh does
# with a systemctl stub.
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
# The uninstaller's real pkill would stop a daemon this machine runs from its own install.
printf '#!/usr/bin/env bash\nexit 0\n' > "$STUB/pkill"; chmod +x "$STUB/pkill"
# The same for sudo (install_mac.sh migrates an old root install with it) and for the
# caller's SHELVES_* overrides (a SHELVES_SETTINGS_DIR would be deleted by step [4]).
printf '#!/usr/bin/env bash\nexit 0\n' > "$STUB/sudo"; chmod +x "$STUB/sudo"
for v in $(compgen -e); do [[ "$v" == SHELVES_* ]] && unset "$v"; done

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
    check "refuses root with an explanation" grep -q "installs per-user" /tmp/root.out
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

# ── [5]-[7] Download branch: an offline curl (the stub docker/install-scenario.sh
# uses) serves a fake release, so the package + SHA256SUMS download, a checksum
# mismatch and a failed download run without the network. ─────────────────────
FAKE="$(mktemp -d)"
EMPTY="$(mktemp -d)"   # no ./shelveshub here, so the installer takes the download branch
( cd "$PKG" && COPYFILE_DISABLE=1 tar -czf "$FAKE/shelveshub-macos.tar.gz" . )
( cd "$FAKE" && shasum -a 256 shelveshub-macos.tar.gz > SHA256SUMS )
cat > "$FAKE/api.json" <<'EOF'
{
  "assets": [
    {
      "name": "shelveshub-macos.tar.gz",
      "browser_download_url": "https://example.invalid/dl/shelveshub-macos.tar.gz"
    },
    {
      "name": "SHA256SUMS",
      "browser_download_url": "https://example.invalid/dl/SHA256SUMS"
    }
  ]
}
EOF
echo "Not Found" > "$FAKE/404.html"
# The release API answers api.json; any other URL is served as the file of that
# basename from the fake release. A missing one is a 404: curl's exit 22 under -f,
# else the error page saved as the download, as the real curl does.
cat > "$STUB/curl" <<'STUBEOF'
#!/usr/bin/env bash
out=""; url=""; fail=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    -o) out="$2"; shift 2 ;;
    -H|--connect-timeout|--max-time) shift 2 ;;
    --fail) fail=1; shift ;;
    --*) shift ;;
    -*) [[ "$1" == *f* ]] && fail=1; shift ;;
    *) url="$1"; shift ;;
  esac
done
[[ "$url" == *api.github.com* ]] && { cat "$FAKE_RELEASE/api.json"; exit 0; }
f="$FAKE_RELEASE/$(basename "$url")"
if [[ ! -f "$f" ]]; then [[ "$fail" == 1 ]] && exit 22; f="$FAKE_RELEASE/404.html"; fi
if [[ -n "$out" ]]; then cp "$f" "$out"; else cat "$f"; fi
STUBEOF
chmod +x "$STUB/curl"
absent() { ! grep -q "$1" "$2"; }
download_install() { # download_install <output file>
  ( cd "$EMPTY" && env HOME="$FAKEHOME" PATH="$STUB:$PATH" LCLOG_TARGET="$LCLOG" FAKE_RELEASE="$FAKE" \
      bash "$PKG/installer/install_mac.sh" ) </dev/null >"$1" 2>&1
}

echo "[5] install_mac.sh (download mode: stubbed curl, SHA256SUMS verified)"
rm -rf "$INSTALL_DIR" "$PLIST"
download_install /tmp/download.out || { echo "  download install exited non-zero"; cat /tmp/download.out; FAILS=$((FAILS + 1)); }
check "took the download branch"        grep -q "Fetching latest release" /tmp/download.out
check "checksum verified"               grep -q "Checksum verified" /tmp/download.out
check "binary installed from download"  test -x "$INSTALL_DIR/shelveshub"
check "LaunchAgent plist placed"        test -f "$PLIST"

echo "[6] install_mac.sh aborts on a SHA256SUMS mismatch"
rm -rf "$INSTALL_DIR" "$PLIST"
printf '%064d  shelveshub-macos.tar.gz\n' 0 > "$FAKE/SHA256SUMS"
rc=0; download_install /tmp/mismatch.out || rc=$?
check "install aborted (exit 1)"        test "$rc" -eq 1
check "mismatch reported"               grep -q "Checksum mismatch" /tmp/mismatch.out
check "nothing installed on mismatch"   test ! -e "$INSTALL_DIR/shelveshub"

echo "[7] install_mac.sh fails cleanly when the package download fails"
rm -rf "$INSTALL_DIR" "$PLIST"
rm -f "$FAKE/shelveshub-macos.tar.gz"
rc=0; download_install /tmp/404.out || rc=$?
check "download failure surfaces as curl's exit 22" test "$rc" -eq 22
check "no checksum mismatch reported"   absent "Checksum mismatch" /tmp/404.out
check "nothing installed"               test ! -e "$INSTALL_DIR/shelveshub"

rm -rf "$PKG" "$FAKEHOME" "$STUB" "$FAKE" "$EMPTY"
echo ""
if [[ "$FAILS" -eq 0 ]]; then echo "[OK] macOS install/uninstall lifecycle passed"; else echo "[X] $FAILS check(s) failed"; fi
exit "$FAILS"
