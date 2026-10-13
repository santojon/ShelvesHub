#!/bin/bash
# Installer for generic Linux — a per-USER service (no root), matching SteamOS.
# Usage (online): bash <(curl -sL https://github.com/santojon/ShelvesHub/releases/latest/download/install-linux.sh)
# Usage (from extracted package): bash installer/install.sh
set -e

# Per-user by design: refuse root so we never create a root-owned install that
# can't reach your Steam. (Migration below still uses sudo for the few commands
# that need it.) Override only for a deliberate system image: SHELVES_ALLOW_ROOT=1.
if [[ "${EUID:-$(id -u)}" -eq 0 && "${SHELVES_ALLOW_ROOT:-}" != "1" ]]; then
  echo "[!] Don't run this as root/sudo. ShelvesHub installs per-user"
  echo "    (~/.local/share/shelveshub) and runs as you so it can reach your Steam."
  echo "    Re-run it as your normal user, without sudo."
  exit 1
fi

REPO="santojon/ShelvesHub"
INSTALL_DIR="$HOME/.local/share/shelveshub"
SERVICE_DIR="$HOME/.config/systemd/user"
SERVICE_FILE="$SERVICE_DIR/shelveshub.service"
BINARY="shelveshub"

# Capture the run to a log next to the install so a failure is diagnosable even
# when the terminal closes instantly. Fail-soft. See SteamOS install.sh.
LOGFILE="$INSTALL_DIR/install.log"
if mkdir -p "$INSTALL_DIR" 2>/dev/null && exec > >(tee "$LOGFILE") 2>&1; then
  echo "[i] Full log: $LOGFILE"
fi
trap 'rc=$?; [[ $rc -ne 0 ]] && { echo; echo "[!] Install failed (exit $rc). Full log: $LOGFILE"; }' EXIT

# Pick the package for this CPU (x86_64 desktops; ARM64 devices are aarch64).
ARCH="$(uname -m)"
case "$ARCH" in
  x86_64|amd64)   PACKAGE="shelveshub-linux.tar.gz" ;;
  aarch64|arm64)  PACKAGE="shelveshub-linux-aarch64.tar.gz" ;;
  *)
    echo "[!] Unsupported architecture: $ARCH"
    echo "    Supported Linux architectures: x86_64, aarch64"
    exit 1
    ;;
esac

echo "=== ShelvesHub — Linux Installer ==="
echo "[i] Architecture: $ARCH"

# Migrate any older ROOT/system install (/opt + a system unit, which ran the daemon
# as root) to the current per-user service, and DROP root. Your Deck Shelves settings
# live in a separate dir, so removing the old install never loses data — and if the
# root install kept settings under root's home, they're rescued to yours (only when
# yours don't exist yet, so nothing you have is ever overwritten).
SETTINGS_DIR="${SHELVES_SETTINGS_DIR:-${XDG_DATA_HOME:-$HOME/.local/share}/deck-shelves}"
set +e # migration is best-effort — a sudo hiccup must never abort the install
if [[ -f /etc/systemd/system/shelveshub.service || -d /opt/shelveshub ]]; then
  echo "[i] Migrating an old system-wide (root) install to the per-user service…"
  sudo systemctl disable --now shelveshub.service 2>/dev/null
  sudo rm -f /etc/systemd/system/shelveshub.service
  sudo systemctl daemon-reload 2>/dev/null
  if [[ -f /opt/shelveshub/shelveshub.config.json && ! -f "$INSTALL_DIR/shelveshub.config.json" ]]; then
    mkdir -p "$INSTALL_DIR"
    sudo cp /opt/shelveshub/shelveshub.config.json "$INSTALL_DIR/" && sudo chown "$USER" "$INSTALL_DIR/shelveshub.config.json"
  fi
  # Rescue the old root install's settings when the per-user store doesn't exist yet.
  # The old system unit ran with WorkingDirectory=/opt/shelveshub and no HOME, so the
  # daemon's store could land off-canonical at /opt/shelveshub/.local/share/deck-shelves;
  # also check root's home. First match wins — copied before /opt is removed below.
  if [[ ! -d "$SETTINGS_DIR" ]]; then
    for _old in /opt/shelveshub/.local/share/deck-shelves /root/.local/share/deck-shelves; do
      if [[ -d "$_old" ]]; then
        mkdir -p "$(dirname "$SETTINGS_DIR")"
        sudo cp -r "$_old" "$SETTINGS_DIR" && sudo chown -R "$USER" "$SETTINGS_DIR"
        echo "[i] Rescued your Deck Shelves settings from the old root install ($_old)."
        break
      fi
    done
  fi
  sudo rm -rf /opt/shelveshub
fi
set -e

# ── Resolve download URL ───────────────────────────────────────────────────────
if [[ -f "$BINARY" ]]; then
  # Running from an already-extracted package — skip download
  echo "[i] Binary found locally, skipping download."
  EXTRACTED_DIR="."
else
  echo "[i] Fetching latest release from GitHub..."
  API_URL="https://api.github.com/repos/$REPO/releases/latest"
  API_JSON=$(curl -sL "$API_URL")
  DOWNLOAD_URL=$(echo "$API_JSON" | grep '"browser_download_url"' | grep "$PACKAGE" | cut -d'"' -f4)
  SUMS_URL=$(echo "$API_JSON" | grep '"browser_download_url"' | grep 'SHA256SUMS"' | cut -d'"' -f4)

  if [[ -z "$DOWNLOAD_URL" ]]; then
    echo "[!] Could not find $PACKAGE in the latest release."
    echo "    Download manually from: https://github.com/$REPO/releases/latest"
    exit 1
  fi

  TMPDIR=$(mktemp -d)
  trap 'rc=$?; rm -rf "$TMPDIR"; [[ $rc -ne 0 ]] && { echo; echo "[!] Install failed (exit $rc). Full log: $LOGFILE"; }' EXIT

  echo "[i] Downloading $PACKAGE..."
  curl -fsL "$DOWNLOAD_URL" -o "$TMPDIR/$PACKAGE"

  # Integrity: verify the download against the release's SHA256SUMS when present.
  if [[ -n "$SUMS_URL" ]]; then
    curl -fsL "$SUMS_URL" -o "$TMPDIR/SHA256SUMS"
    EXPECTED=$(grep " $PACKAGE\$" "$TMPDIR/SHA256SUMS" | awk '{print $1}')
    ACTUAL=$(sha256sum "$TMPDIR/$PACKAGE" | awk '{print $1}')
    if [[ -n "$EXPECTED" && "$EXPECTED" != "$ACTUAL" ]]; then
      echo "[!] Checksum mismatch for $PACKAGE — aborting (expected $EXPECTED, got $ACTUAL)."
      exit 1
    fi
    [[ -n "$EXPECTED" ]] && echo "[i] Checksum verified."
  fi

  tar -xzf "$TMPDIR/$PACKAGE" -C "$TMPDIR"
  EXTRACTED_DIR="$TMPDIR"
fi

# ── Install binary and bundle ──────────────────────────────────────────────────
echo "[i] Installing to $INSTALL_DIR..."
mkdir -p "$INSTALL_DIR/logs" "$SERVICE_DIR"
# Stage next to the running binary and rename over it: a plain cp onto a running
# executable can fail with "Text file busy"; a rename never does, and the service
# is restarted onto the new file below.
cp "$EXTRACTED_DIR/$BINARY" "$INSTALL_DIR/$BINARY.new"
chmod +x "$INSTALL_DIR/$BINARY.new"
mv -f "$INSTALL_DIR/$BINARY.new" "$INSTALL_DIR/$BINARY"

[[ -d "$EXTRACTED_DIR/bundle" ]] && mkdir -p "$INSTALL_DIR/bundle" && cp -r "$EXTRACTED_DIR/bundle/." "$INSTALL_DIR/bundle/"
[[ -d "$EXTRACTED_DIR/runtime" ]] && mkdir -p "$INSTALL_DIR/runtime" && cp -r "$EXTRACTED_DIR/runtime/." "$INSTALL_DIR/runtime/"
# Config file: install it, but never overwrite one the user has already edited.
CONFIG_WAS_FRESH=0
if [[ -f "$EXTRACTED_DIR/shelveshub.config.json" && ! -f "$INSTALL_DIR/shelveshub.config.json" ]]; then
  cp "$EXTRACTED_DIR/shelveshub.config.json" "$INSTALL_DIR/"; CONFIG_WAS_FRESH=1
fi

# ── Optional setup choices ─────────────────────────────────────────────────────
# Read from the environment (works with `curl | bash`) and, on a terminal, ask.
# Applied only on a FIRST install; everything stays editable in the ShelvesHub tab.
CONFIG_JSON="$INSTALL_DIR/shelveshub.config.json"
PREFS_JSON="$SETTINGS_DIR/shelveshub.json"
ask() {
  local v="$1" q="$2" d="$3" reply
  case "$v" in 1|y|Y|yes|true|on) echo 1; return;; 0|n|N|no|false|off) echo 0; return;; esac
  if [[ -t 0 ]]; then
    local hint="[y/N]"; [[ "$d" == y ]] && hint="[Y/n]"
    read -r -p "  $q $hint " reply </dev/tty || reply=""
    reply="${reply:-$d}"; [[ "$reply" =~ ^[Yy] ]] && echo 1 || echo 0
  else
    [[ "$d" == y ]] && echo 1 || echo 0
  fi
}
b() { [[ "$1" == 1 ]] && echo true || echo false; }
# Re-install: options are set on the FIRST install and never silently reconfigured
# (an upgrade must not clobber your choices). Say so, so a re-run doesn't look idle.
if [[ "$CONFIG_WAS_FRESH" != 1 && -f "$PREFS_JSON" ]]; then
  echo "[i] Existing setup kept — ShelvesHub is already configured on this device."
  echo "    Change any option anytime in the ShelvesHub tab (Quick Access Menu)."
fi
if [[ "$CONFIG_WAS_FRESH" == 1 ]]; then
  [[ -t 0 ]] && { echo ""; echo "── Optional setup (press Enter for the default) ──"; }
  FORCE=$(ask "${SHELVES_FORCE_OWNER:-}" "Host Deck Shelves even if a plugin loader is present (cooperative)?" n)
  NQAM=$(ask  "${SHELVES_NATIVE_QAM:-}"  "Add ShelvesHub's own Quick Access tab?" y)
  DESK=$(ask  "${SHELVES_DESKTOP_UI:-}"  "Also inject into the plain desktop client (experimental)?" n)
  [[ "$FORCE" == 1 ]] && sed -i 's/"force_owner": false/"force_owner": true/' "$CONFIG_JSON"
  [[ "$NQAM"  == 0 ]] && sed -i 's/"native_qam": true/"native_qam": false/'   "$CONFIG_JSON"
  [[ "$DESK"  == 1 ]] && sed -i 's/"desktop_ui": false/"desktop_ui": true/'   "$CONFIG_JSON"
fi
if [[ ! -f "$PREFS_JSON" ]]; then
  AUTO=$(ask "${SHELVES_AUTO_UPDATE:-}" "Enable automatic updates?" y)
  if [[ "$AUTO" == 1 ]]; then
    AHUB=$(ask  "${SHELVES_AUTO_UPDATE_HUB:-}"    "  Auto-update ShelvesHub itself?" y)
    APLUG=$(ask "${SHELVES_AUTO_UPDATE_PLUGIN:-}" "  Auto-update Deck Shelves?" y)
    HPRE=$(ask  "${SHELVES_HUB_PRERELEASE:-}"     "  Include ShelvesHub pre-releases?" n)
    PPRE=$(ask  "${SHELVES_PLUGIN_PRERELEASE:-}"  "  Include Deck Shelves pre-releases?" n)
  else
    AHUB=1; APLUG=1; HPRE=0; PPRE=0
  fi
  mkdir -p "$SETTINGS_DIR"
  cat > "$PREFS_JSON" <<EOF
{
  "auto_update": $(b "$AUTO"),
  "auto_update_hub": $(b "$AHUB"),
  "auto_update_plugin": $(b "$APLUG"),
  "hub_prerelease": $(b "$HPRE"),
  "plugin_prerelease": $(b "$PPRE")
}
EOF
fi
# Optional tray companion (opt-in, OFF by default): a desktop menu-bar icon that
# shows hosting state and offers quick actions over the daemon's local RPC. Only
# installs when the package ships the binary AND the user opts in; degrades to a
# clear note otherwise. Autostart is an XDG entry (desktop sessions only).
install_tray() {
  if [[ ! -f "$EXTRACTED_DIR/shelveshub-tray" ]]; then
    echo "[i] Tray companion not bundled in this package — skipping."
    return
  fi
  # Stage + rename, like the daemon binary: the tray may be running right now.
  cp "$EXTRACTED_DIR/shelveshub-tray" "$INSTALL_DIR/shelveshub-tray.new"
  chmod +x "$INSTALL_DIR/shelveshub-tray.new"
  mv -f "$INSTALL_DIR/shelveshub-tray.new" "$INSTALL_DIR/shelveshub-tray"
  mkdir -p "$HOME/.config/autostart"
  cat > "$HOME/.config/autostart/shelveshub-tray.desktop" <<EOF
[Desktop Entry]
Type=Application
Name=ShelvesHub Tray
Exec=$INSTALL_DIR/shelveshub-tray
X-GNOME-Autostart-enabled=true
EOF
  echo "[i] Tray companion installed — it starts on your next desktop login."
}
TRAY=$(ask "${SHELVES_TRAY:-}" "Install the ShelvesHub tray companion (desktop menu-bar icon)?" n)
[[ "$TRAY" == 1 ]] && install_tray

# Optional data-backend payload: auto-detected by the service at <install>/backend.
[[ -d "$EXTRACTED_DIR/backend" ]] && mkdir -p "$INSTALL_DIR/backend" && cp -r "$EXTRACTED_DIR/backend/." "$INSTALL_DIR/backend/"
# Boot-animation source cuts — read from <install>/assets/boot by the boot_movie toggle.
[[ -d "$EXTRACTED_DIR/assets" ]] && mkdir -p "$INSTALL_DIR/assets" && cp -r "$EXTRACTED_DIR/assets/." "$INSTALL_DIR/assets/"
# Keep the uninstaller alongside the install so it's available later.
[[ -f "$EXTRACTED_DIR/installer/uninstall.sh" ]] && cp "$EXTRACTED_DIR/installer/uninstall.sh" "$INSTALL_DIR/" && chmod +x "$INSTALL_DIR/uninstall.sh"

cp "$EXTRACTED_DIR/installer/shelveshub.service" "$SERVICE_FILE"
chmod 644 "$SERVICE_FILE"

systemctl --user daemon-reload
# Reinstall-safe (upgrade in place): enable for boot, then restart so the
# freshly-copied binary is the one running now (not the old process).
systemctl --user enable shelveshub.service
systemctl --user restart shelveshub.service

# ShelvesHub reaches Steam over its CEF debug port, which Steam only opens when
# this flag file exists — otherwise a fresh install just logs "connection
# refused" and nothing appears. Create it (needs a Steam restart to take effect).
CEF_FLAG_CREATED=0
for steam_root in "$HOME/.steam/steam" "$HOME/.local/share/Steam" \
  "$HOME/.var/app/com.valvesoftware.Steam/.local/share/Steam"; do
  if [[ -d "$steam_root" ]]; then
    touch "$steam_root/.cef-enable-remote-debugging" 2>/dev/null && CEF_FLAG_CREATED=1
  fi
done

echo ""
echo "[OK] ShelvesHub installed and running (per-user service, no root)."
echo "     Install path : $INSTALL_DIR"
echo "     Service      : systemctl --user status shelveshub"
echo ""
echo "── What to do next ──────────────────────────────────────────"
if [[ "$CEF_FLAG_CREATED" == "1" ]]; then
echo "  0. RESTART STEAM once so it opens the debug port ShelvesHub needs."
echo "     Without this restart, nothing appears."
fi
echo "  Open Steam Big Picture, then the Quick Access Menu, and find"
echo "  the ShelvesHub tab. If a plugin loader is already hosting Deck"
echo "  Shelves, ShelvesHub coexists (adds only its tab) and won't"
echo "  replace it — the Home looks unchanged."
