#!/usr/bin/env bash
#
# Install / uninstall lifecycle validation for the SteamOS and generic-Linux
# (user-service) paths, run inside a Linux container. A plain container has no
# running systemd, so a recording `systemctl` stub stands in — the point is to
# prove the SCRIPTS lay down and tear down the right files, keep the user's
# settings on a plain uninstall, and remove them on --purge (the bugs that
# actually bite: wrong paths, a missing service file, settings clobbered).
# systemd behaviour itself is not under test here. The Linux leg adds a stubbed
# `curl` so the download branch, its SHA256SUMS check and a failed download run
# offline, and an upgrade over a running daemon.
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

echo "== Install / uninstall lifecycle (SteamOS + generic Linux user-service paths) =="

# Build the binary (fast if the cache volume is warm) so the package is real.
cargo build --quiet --bin shelveshub || { echo "error: build failed"; exit 1; }

# ── Assemble a release-style package (mirrors release.yml's dist layout) ──────
PKG="$(mktemp -d)"
cp target/debug/shelveshub "$PKG/"
# A stand-in tray companion binary so the opt-in tray step can prove the installer
# lays it down + writes autostart. Default-off runs (steps [1]-[4]) must NOT install
# it (no SHELVES_TRAY), which also checks the opt-in stays off by default.
printf '#!/bin/sh\nexit 0\n' > "$PKG/shelveshub-tray"; chmod +x "$PKG/shelveshub-tray"
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
# A plain container runs as root and may have no `sudo`; the installers use it for
# the root→user migration. Stub it as a passthrough (we are already root) so the
# migration path runs deterministically.
cat > "$STUB/sudo" <<'STUBEOF'
#!/usr/bin/env bash
exec "$@"
STUBEOF
chmod +x "$STUB/sudo"

INSTALL_DIR="$FAKEHOME/.local/share/shelveshub"
SERVICE_DIR="$FAKEHOME/.config/systemd/user"
SETTINGS_DIR="$FAKEHOME/.local/share/deck-shelves"

run_installer() { # run <script> [args...] from the package dir
  # A plain container runs as root; this laydown test only proves the SCRIPTS
  # place/remove the right files, so bypass the per-user root guard here (the
  # guard itself is checked separately in [0] below).
  local script="$1"; shift
  ( cd "$PKG" && HOME="$FAKEHOME" PATH="$STUB:$PATH" SCLOG_TARGET="$SCLOG" \
      SHELVES_ALLOW_ROOT=1 bash "$script" "$@" )
}

# ── Root guard (only meaningful when we are actually root, e.g. in CI) ────────
# The installer must REFUSE to run as root WITHOUT the override, so a user who
# `sudo`s it gets an explanation instead of a root-owned install.
if [[ "$(id -u)" -eq 0 ]]; then
  echo "[0] install.sh refuses root (no override)"
  if ( cd "$PKG" && HOME="$FAKEHOME" PATH="$STUB:$PATH" bash installer/install.sh \
        >/tmp/root.out 2>&1 ); then
    echo "  [X]  install.sh should have refused to run as root"; FAILS=$((FAILS + 1))
  else
    check "refuses root with an explanation" grep -q "Don't run this as root" /tmp/root.out
    check "left no install dir behind"        test ! -e "$INSTALL_DIR"
  fi
fi

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

# ── Root→user settings migration: the old root unit ran with
# WorkingDirectory=/opt/shelveshub and no HOME, so its settings could land
# off-canonical at /opt/shelveshub/.local/share/deck-shelves. The installer must
# rescue them to the per-user store and remove /opt. ───────────────────────────
echo "[4] root→user settings migration (off-canonical /opt)"
rm -rf "$INSTALL_DIR" "$SERVICE_DIR" "$SETTINGS_DIR"
mkdir -p /opt/shelveshub/.local/share/deck-shelves
echo '{"migrated":true}' > /opt/shelveshub/.local/share/deck-shelves/settings.json
run_installer installer/install.sh >/tmp/mig.out 2>&1 || { echo "  migrate install exited non-zero"; cat /tmp/mig.out; FAILS=$((FAILS+1)); }
check "settings rescued from /opt to canonical" test -f "$SETTINGS_DIR/settings.json"
check "rescued content preserved"               grep -q migrated "$SETTINGS_DIR/settings.json"
check "/opt removed by migration"               test ! -d /opt/shelveshub

# ── Tray companion opt-in ([5]): default-off, then installed with SHELVES_TRAY=1,
# then removed on uninstall. The autostart entry lives OUTSIDE the install dir. ──
AUTOSTART="$FAKEHOME/.config/autostart/shelveshub-tray.desktop"
echo "[5a] tray stays OFF by default"
rm -rf "$INSTALL_DIR" "$SERVICE_DIR" "$AUTOSTART"
run_installer installer/install.sh >/tmp/tray0.out 2>&1 || { echo "  install exited non-zero"; FAILS=$((FAILS+1)); }
check "no tray binary without opt-in"   test ! -e "$INSTALL_DIR/shelveshub-tray"
check "no autostart without opt-in"      test ! -e "$AUTOSTART"

echo "[6] tray installed with SHELVES_TRAY=1, removed on uninstall"
rm -rf "$INSTALL_DIR" "$SERVICE_DIR" "$AUTOSTART"
( cd "$PKG" && HOME="$FAKEHOME" PATH="$STUB:$PATH" SCLOG_TARGET="$SCLOG" \
    SHELVES_ALLOW_ROOT=1 SHELVES_TRAY=1 bash installer/install.sh >/tmp/tray1.out 2>&1 ) || { echo "  tray install exited non-zero"; FAILS=$((FAILS+1)); }
check "tray binary installed + executable" test -x "$INSTALL_DIR/shelveshub-tray"
check "autostart entry written"            test -f "$AUTOSTART"
check "autostart points at the binary"     grep -q "$INSTALL_DIR/shelveshub-tray" "$AUTOSTART"
run_installer "$INSTALL_DIR/uninstall.sh" >/tmp/trayun.out 2>&1 || { echo "  uninstall exited non-zero"; FAILS=$((FAILS+1)); }
check "autostart removed on uninstall"     test ! -e "$AUTOSTART"
check "tray binary removed (install dir)"  test ! -e "$INSTALL_DIR/shelveshub-tray"

# ── Generic Linux installer ([7]-[13]): installer/Linux over the same stubs, plus
# the paths the SteamOS leg never reaches — an upgrade over a RUNNING daemon, the
# download branch (a stubbed curl serving a fake release with SHA256SUMS, then a
# corrupted SHA256SUMS and a missing package) and --purge under a redirected
# settings dir. The daemon runs with the stub on PATH too, so its first-boot
# backend obtain stays offline. ─────────────────────────────────────────────────
PKG_LINUX="$(mktemp -d)"
cp target/debug/shelveshub "$PKG_LINUX/"
mkdir -p "$PKG_LINUX/installer" "$PKG_LINUX/bundle" "$PKG_LINUX/runtime"
cp -r installer/Linux/. "$PKG_LINUX/installer/"
cp shelveshub.config.json "$PKG_LINUX/" 2>/dev/null || true
cp -r bundle/. "$PKG_LINUX/bundle/" 2>/dev/null || true
cp -r runtime/. "$PKG_LINUX/runtime/" 2>/dev/null || true

# A fake release with both package names (the container is x86_64 or aarch64 and
# the installer picks by `uname -m`); the API JSON keeps GitHub's one-field-per-
# line shape the installers grep.
FAKE="$(mktemp -d)"
( cd "$PKG_LINUX" && tar -czf "$FAKE/shelveshub-linux.tar.gz" . )
cp "$FAKE/shelveshub-linux.tar.gz" "$FAKE/shelveshub-linux-aarch64.tar.gz"
( cd "$FAKE" && sha256sum shelveshub-linux.tar.gz shelveshub-linux-aarch64.tar.gz > SHA256SUMS )
cat > "$FAKE/api.json" <<'EOF'
{
  "assets": [
    {
      "name": "shelveshub-linux.tar.gz",
      "browser_download_url": "https://example.invalid/dl/shelveshub-linux.tar.gz"
    },
    {
      "name": "shelveshub-linux-aarch64.tar.gz",
      "browser_download_url": "https://example.invalid/dl/shelveshub-linux-aarch64.tar.gz"
    },
    {
      "name": "SHA256SUMS",
      "browser_download_url": "https://example.invalid/dl/SHA256SUMS"
    }
  ]
}
EOF
# An offline curl: the release API answers api.json; any other URL is served as
# the file of that basename from the fake release (missing → curl's exit 22).
cat > "$STUB/curl" <<'STUBEOF'
#!/usr/bin/env bash
out=""; url=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    -o) out="$2"; shift 2 ;;
    -H|--connect-timeout|--max-time) shift 2 ;;
    -*) shift ;;
    *) url="$1"; shift ;;
  esac
done
[[ "$url" == *api.github.com* ]] && { cat "$FAKE_RELEASE/api.json"; exit 0; }
f="$FAKE_RELEASE/$(basename "$url")"
[[ -f "$f" ]] || exit 22
if [[ -n "$out" ]]; then cp "$f" "$out"; else cat "$f"; fi
STUBEOF
chmod +x "$STUB/curl"

absent() { ! grep -q "$1" "$2"; }      # a line must NOT appear in a file
quiet() { "$@" >/dev/null 2>&1; }       # a command must succeed, output dropped
fails() { ! "$@" >/dev/null 2>&1; }     # a command must exit non-zero
run_linux() { # run_linux <cwd> <script> [args...] — the generic-Linux package's scripts
  local cwd="$1" script="$2"; shift 2
  ( cd "$cwd" && HOME="$FAKEHOME" PATH="$STUB:$PATH" SCLOG_TARGET="$SCLOG" FAKE_RELEASE="$FAKE" \
      SHELVES_ALLOW_ROOT=1 bash "$script" "$@" )
}

echo "[7] Linux install.sh (package mode)"
rm -rf "$INSTALL_DIR" "$SERVICE_DIR" "$SETTINGS_DIR"; : > "$SCLOG"
run_linux "$PKG_LINUX" installer/install.sh >/tmp/linux-install.out 2>&1 || { echo "  install.sh exited non-zero"; cat /tmp/linux-install.out; FAILS=$((FAILS+1)); }
check "binary installed + executable"       test -x "$INSTALL_DIR/shelveshub"
check "no staged .new left behind"          test ! -e "$INSTALL_DIR/shelveshub.new"
check "service file placed"                 test -f "$SERVICE_DIR/shelveshub.service"
check "uninstaller kept alongside"          test -x "$INSTALL_DIR/uninstall.sh"
check "runtime copied"                      test -f "$INSTALL_DIR/runtime/shelves-host.js"
check "prefs seeded"                        test -f "$SETTINGS_DIR/shelveshub.json"
check "service enabled (persists)"          grep -q "enable shelveshub.service" "$SCLOG"
check "service restarted"                   grep -q "restart shelveshub.service" "$SCLOG"

echo "[8] Linux install.sh over a RUNNING daemon (stage + rename, no 'Text file busy')"
HOME="$FAKEHOME" PATH="$STUB:$PATH" FAKE_RELEASE="$FAKE" SHELVES_CEF_PORT=1 \
  SHELVES_RPC_ADDR=127.0.0.1:60999 "$INSTALL_DIR/shelveshub" >/tmp/linux-daemon.out 2>&1 &
DPID=$!
sleep 2
check "daemon running before the upgrade"   kill -0 "$DPID"
rc=0; run_linux "$PKG_LINUX" installer/install.sh >/tmp/linux-upgrade.out 2>&1 || rc=$?
check "re-install succeeds while the daemon runs" test "$rc" -eq 0
check "no 'Text file busy' in the output"   absent "Text file busy" /tmp/linux-upgrade.out
check "re-install reports kept setup"       grep -q "Existing setup kept" /tmp/linux-upgrade.out
check "binary replaced (same bytes as the package)" cmp -s "$PKG_LINUX/shelveshub" "$INSTALL_DIR/shelveshub"
check "no staged .new left behind"          test ! -e "$INSTALL_DIR/shelveshub.new"
kill "$DPID" 2>/dev/null; wait "$DPID" 2>/dev/null

echo "[9] Linux install.sh (download mode: stubbed curl, SHA256SUMS verified)"
rm -rf "$INSTALL_DIR" "$SERVICE_DIR" "$SETTINGS_DIR"
EMPTY="$(mktemp -d)"   # no ./shelveshub here, so the installer takes the download branch
run_linux "$EMPTY" "$PKG_LINUX/installer/install.sh" >/tmp/linux-download.out 2>&1 || { echo "  download install exited non-zero"; cat /tmp/linux-download.out; FAILS=$((FAILS+1)); }
check "took the download branch"            grep -q "Fetching latest release" /tmp/linux-download.out
check "picked the package for $(uname -m)"  grep -qE "Downloading shelveshub-linux(-aarch64)?\.tar\.gz" /tmp/linux-download.out
check "checksum verified"                   grep -q "Checksum verified" /tmp/linux-download.out
check "binary installed from the download"  test -x "$INSTALL_DIR/shelveshub"
check "service file placed (download)"      test -f "$SERVICE_DIR/shelveshub.service"
check "uninstaller kept (download)"         test -x "$INSTALL_DIR/uninstall.sh"

echo "[10] Linux install.sh aborts on a SHA256SUMS mismatch"
rm -rf "$INSTALL_DIR" "$SERVICE_DIR" "$SETTINGS_DIR"
sed -i 's/^[0-9a-f]\{8\}/00000000/' "$FAKE/SHA256SUMS"
rc=0; run_linux "$EMPTY" "$PKG_LINUX/installer/install.sh" >/tmp/linux-mismatch.out 2>&1 || rc=$?
check "install aborted (exit 1)"            test "$rc" -eq 1
check "mismatch reported"                   grep -q "Checksum mismatch" /tmp/linux-mismatch.out
check "nothing installed on mismatch"       test ! -e "$INSTALL_DIR/shelveshub"

echo "[11] Linux install.sh fails cleanly when the package download fails"
rm -f "$FAKE"/shelveshub-linux*.tar.gz
rc=0; run_linux "$EMPTY" "$PKG_LINUX/installer/install.sh" >/tmp/linux-404.out 2>&1 || rc=$?
check "download failure surfaces as curl's exit 22" test "$rc" -eq 22
check "no checksum mismatch reported"       absent "Checksum mismatch" /tmp/linux-404.out
check "nothing installed"                   test ! -e "$INSTALL_DIR/shelveshub"

echo "[12] uninstall.sh --purge honours XDG_DATA_HOME / SHELVES_SETTINGS_DIR and clears the CEF flags"
rm -rf "$INSTALL_DIR" "$SERVICE_DIR" "$SETTINGS_DIR"
XDG="$FAKEHOME/xdg-data"
( cd "$PKG_LINUX" && HOME="$FAKEHOME" XDG_DATA_HOME="$XDG" PATH="$STUB:$PATH" SCLOG_TARGET="$SCLOG" \
    SHELVES_ALLOW_ROOT=1 bash installer/install.sh >/dev/null 2>&1 )
check "prefs seeded under XDG_DATA_HOME"    test -f "$XDG/deck-shelves/shelveshub.json"
mkdir -p "$SETTINGS_DIR"; echo '{"other":true}' > "$SETTINGS_DIR/settings.json"
STEAM_ROOTS=("$FAKEHOME/.steam/steam" "$FAKEHOME/.local/share/Steam" \
  "$FAKEHOME/.var/app/com.valvesoftware.Steam/.local/share/Steam")
for root in "${STEAM_ROOTS[@]}"; do mkdir -p "$root"; touch "$root/.cef-enable-remote-debugging"; done
( cd "$PKG_LINUX" && HOME="$FAKEHOME" XDG_DATA_HOME="$XDG" PATH="$STUB:$PATH" SCLOG_TARGET="$SCLOG" \
    bash "$INSTALL_DIR/uninstall.sh" --purge >/tmp/linux-purge.out 2>&1 ) || { echo "  purge exited non-zero"; cat /tmp/linux-purge.out; FAILS=$((FAILS+1)); }
check "install dir removed (purge)"         test ! -e "$INSTALL_DIR"
check "purge removed the XDG settings dir"  test ! -e "$XDG/deck-shelves"
check "purge left the default settings dir alone" test -f "$SETTINGS_DIR/settings.json"
for root in "${STEAM_ROOTS[@]}"; do
  check "CEF flag removed under ${root#"$FAKEHOME"/}" test ! -e "$root/.cef-enable-remote-debugging"
done
CUSTOM="$FAKEHOME/custom-settings"
( cd "$PKG_LINUX" && HOME="$FAKEHOME" SHELVES_SETTINGS_DIR="$CUSTOM" PATH="$STUB:$PATH" SCLOG_TARGET="$SCLOG" \
    SHELVES_ALLOW_ROOT=1 bash installer/install.sh >/dev/null 2>&1 )
check "prefs seeded under SHELVES_SETTINGS_DIR" test -f "$CUSTOM/shelveshub.json"
( cd "$PKG_LINUX" && HOME="$FAKEHOME" SHELVES_SETTINGS_DIR="$CUSTOM" PATH="$STUB:$PATH" SCLOG_TARGET="$SCLOG" \
    bash "$INSTALL_DIR/uninstall.sh" --purge >/dev/null 2>&1 )
check "purge removed SHELVES_SETTINGS_DIR"  test ! -e "$CUSTOM"
check "purge left the default dir alone (again)" test -f "$SETTINGS_DIR/settings.json"

echo "[13] arch-audit.sh accepts the built binary's architecture and rejects the other"
if command -v readelf >/dev/null 2>&1 || command -v file >/dev/null 2>&1; then
  case "$(uname -m)" in aarch64|arm64) OK=aarch64; BAD=x86_64 ;; *) OK=x86_64; BAD=aarch64 ;; esac
  check "audit passes for $OK"              quiet bash scripts/arch-audit.sh target/debug/shelveshub "$OK"
  check "audit rejects $BAD"                fails bash scripts/arch-audit.sh target/debug/shelveshub "$BAD"
else
  echo "  [i] neither readelf nor file is installed here — skipped"
fi

rm -rf "$PKG" "$PKG_LINUX" "$FAKE" "$EMPTY" "$FAKEHOME" "$STUB"
echo ""
if [[ "$FAILS" -eq 0 ]]; then echo "[OK] install/uninstall lifecycle passed"; else echo "[X] $FAILS check(s) failed"; fi
exit "$FAILS"
