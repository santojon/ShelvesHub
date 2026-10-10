#!/bin/bash
# One-click installer for macOS
# Usage (online): bash install-mac.sh
# Usage (from extracted package): bash installer/install_mac.sh
set -e

# Per-user by design: refuse root so we never create a root-owned install and a
# LaunchAgent that can't reach your Steam. Override only for automation:
# SHELVES_ALLOW_ROOT=1.
if [[ "${EUID:-$(id -u)}" -eq 0 && "${SHELVES_ALLOW_ROOT:-}" != "1" ]]; then
  echo "[!] Don't run this with sudo. ShelvesHub installs per-user"
  echo "    (~/.local/share/shelveshub) and runs as you so it can reach your Steam."
  echo "    Re-run it as your normal user, without sudo."
  exit 1
fi

REPO="santojon/ShelvesHub"
INSTALL_DIR="$HOME/.local/share/shelveshub"
LAUNCH_AGENTS_DIR="$HOME/Library/LaunchAgents"
PLIST_DEST="$LAUNCH_AGENTS_DIR/com.shelveshub.plist"
BINARY="shelveshub"
PACKAGE="shelveshub-macos.tar.gz"

# Capture the run to a log next to the install so a failure is diagnosable even
# when the terminal closes instantly. Fail-soft. See SteamOS install.sh.
LOGFILE="$INSTALL_DIR/install.log"
if mkdir -p "$INSTALL_DIR" 2>/dev/null && exec > >(tee "$LOGFILE") 2>&1; then
  echo "[i] Full log: $LOGFILE"
fi
trap 'rc=$?; [[ $rc -ne 0 ]] && { echo; echo "[!] Install failed (exit $rc). Full log: $LOGFILE"; }' EXIT

echo "=== ShelvesHub — macOS Installer ==="

# ── Migrate any older system (root) install to the current per-user standard ────
# Removes an old root LaunchDaemon + old /usr/local install and drops root. Your
# Deck Shelves settings live in a separate dir, so this never loses data — and old
# root-owned settings are rescued to yours only when yours don't exist yet.
SETTINGS_DIR="$HOME/Library/Application Support/deck-shelves"
set +e # migration is best-effort — a sudo hiccup must never abort the install
if [[ -f /Library/LaunchDaemons/com.shelveshub.plist || -d /usr/local/shelveshub ]]; then
  echo "[i] Migrating an old system (root) install to the per-user agent…"
  sudo launchctl bootout system /Library/LaunchDaemons/com.shelveshub.plist 2>/dev/null \
    || sudo launchctl unload /Library/LaunchDaemons/com.shelveshub.plist 2>/dev/null
  sudo rm -f /Library/LaunchDaemons/com.shelveshub.plist
  if [[ -f /usr/local/shelveshub/shelveshub.config.json && ! -f "$INSTALL_DIR/shelveshub.config.json" ]]; then
    mkdir -p "$INSTALL_DIR"
    sudo cp /usr/local/shelveshub/shelveshub.config.json "$INSTALL_DIR/" && sudo chown "$USER" "$INSTALL_DIR/shelveshub.config.json"
  fi
  if [[ ! -d "$SETTINGS_DIR" && -d "/var/root/Library/Application Support/deck-shelves" ]]; then
    mkdir -p "$(dirname "$SETTINGS_DIR")"
    sudo cp -r "/var/root/Library/Application Support/deck-shelves" "$SETTINGS_DIR" && sudo chown -R "$USER" "$SETTINGS_DIR"
    echo "[i] Rescued your Deck Shelves settings from the old root install."
  fi
  sudo rm -rf /usr/local/shelveshub
fi
set -e

if [[ -f "$BINARY" ]]; then
  echo "[i] Binary found locally, skipping download."
  EXTRACTED_DIR="."
else
  echo "[i] Fetching latest release from GitHub..."
  API_JSON=$(curl -sL "https://api.github.com/repos/$REPO/releases/latest")
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
  curl -sL "$DOWNLOAD_URL" -o "$TMPDIR/$PACKAGE"

  # Integrity: verify the download against the release's SHA256SUMS when present.
  if [[ -n "$SUMS_URL" ]]; then
    curl -sL "$SUMS_URL" -o "$TMPDIR/SHA256SUMS"
    EXPECTED=$(grep " $PACKAGE\$" "$TMPDIR/SHA256SUMS" | awk '{print $1}')
    ACTUAL=$(shasum -a 256 "$TMPDIR/$PACKAGE" | awk '{print $1}')
    if [[ -n "$EXPECTED" && "$EXPECTED" != "$ACTUAL" ]]; then
      echo "[!] Checksum mismatch for $PACKAGE — aborting (expected $EXPECTED, got $ACTUAL)."
      exit 1
    fi
    [[ -n "$EXPECTED" ]] && echo "[i] Checksum verified."
  fi

  tar -xzf "$TMPDIR/$PACKAGE" -C "$TMPDIR"
  EXTRACTED_DIR="$TMPDIR"
fi

mkdir -p "$INSTALL_DIR/logs" "$LAUNCH_AGENTS_DIR"

cp "$EXTRACTED_DIR/$BINARY" "$INSTALL_DIR/"
chmod +x "$INSTALL_DIR/$BINARY"

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
# (an upgrade must not clobber your choices). Say so, so a re-run doesn't look like
# it did nothing.
if [[ "$CONFIG_WAS_FRESH" != 1 && -f "$PREFS_JSON" ]]; then
  echo "[i] Existing setup kept — ShelvesHub is already configured on this machine."
  echo "    Change any option anytime in the ShelvesHub tab (Quick Access Menu)."
fi
if [[ "$CONFIG_WAS_FRESH" == 1 ]]; then
  [[ -t 0 ]] && { echo ""; echo "── Optional setup (press Enter for the default) ──"; }
  FORCE=$(ask "${SHELVES_FORCE_OWNER:-}" "Host Deck Shelves even if a plugin loader is present (cooperative)?" n)
  NQAM=$(ask  "${SHELVES_NATIVE_QAM:-}"  "Add ShelvesHub's own Quick Access tab?" y)
  DESK=$(ask  "${SHELVES_DESKTOP_UI:-}"  "Also inject into the plain desktop client (experimental)?" n)
  [[ "$FORCE" == 1 ]] && sed -i '' 's/"force_owner": false/"force_owner": true/' "$CONFIG_JSON"
  [[ "$NQAM"  == 0 ]] && sed -i '' 's/"native_qam": true/"native_qam": false/'   "$CONFIG_JSON"
  [[ "$DESK"  == 1 ]] && sed -i '' 's/"desktop_ui": false/"desktop_ui": true/'   "$CONFIG_JSON"
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
# Optional data-backend payload: auto-detected by the service at <install>/backend.
[[ -d "$EXTRACTED_DIR/backend" ]] && mkdir -p "$INSTALL_DIR/backend" && cp -r "$EXTRACTED_DIR/backend/." "$INSTALL_DIR/backend/"
# Boot-animation source cuts — the daemon reads them from <install>/assets/boot
# when the boot_movie toggle installs the movie into Steam's own startup slots.
[[ -d "$EXTRACTED_DIR/assets" ]] && mkdir -p "$INSTALL_DIR/assets" && cp -r "$EXTRACTED_DIR/assets/." "$INSTALL_DIR/assets/"
# Keep the uninstaller alongside the install so it's available later.
[[ -f "$EXTRACTED_DIR/installer/uninstall_mac.sh" ]] && cp "$EXTRACTED_DIR/installer/uninstall_mac.sh" "$INSTALL_DIR/" && chmod +x "$INSTALL_DIR/uninstall_mac.sh"

# Optional tray companion (opt-in, OFF by default): a menu-bar icon over the
# daemon's local RPC. Installs only when the package ships the binary AND the
# user opts in; a user LaunchAgent (Aqua session) starts it at login.
install_tray() {
  if [[ ! -f "$EXTRACTED_DIR/shelveshub-tray" ]]; then
    echo "[i] Tray companion not bundled in this package — skipping."
    return
  fi
  cp "$EXTRACTED_DIR/shelveshub-tray" "$INSTALL_DIR/"; chmod +x "$INSTALL_DIR/shelveshub-tray"
  local plist="$LAUNCH_AGENTS_DIR/com.shelveshub.tray.plist"
  cat > "$plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>com.shelveshub.tray</string>
  <key>ProgramArguments</key><array><string>$INSTALL_DIR/shelveshub-tray</string></array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><false/>
  <key>ProcessType</key><string>Interactive</string>
</dict></plist>
EOF
  chmod 644 "$plist"
  launchctl unload "$plist" 2>/dev/null || true
  launchctl load "$plist" 2>/dev/null || true
  launchctl kickstart -k "gui/$(id -u)/com.shelveshub.tray" 2>/dev/null || true
  echo "[i] Tray companion installed and started (menu-bar icon)."
}
TRAY=$(ask "${SHELVES_TRAY:-}" "Install the ShelvesHub tray companion (menu-bar icon)?" n)
[[ "$TRAY" == 1 ]] && install_tray

# Generate the agent with the real install path (a user LaunchAgent runs as the
# user, so it lives under $HOME — never root-owned /usr/local).
sed "s|__INSTALL_DIR__|$INSTALL_DIR|g" "$EXTRACTED_DIR/installer/com.shelveshub.plist" > "$PLIST_DEST"
chmod 644 "$PLIST_DEST"
# Reinstall-safe (upgrade in place): `launchctl load` is a no-op when the agent
# is already loaded, which would leave the OLD daemon running with the previous
# binary. Unload first, load fresh, then kickstart so the new binary is the one
# running immediately — no reboot/re-login needed.
launchctl unload "$PLIST_DEST" 2>/dev/null || true
launchctl load "$PLIST_DEST"
launchctl kickstart -k "gui/$(id -u)/com.shelveshub" 2>/dev/null || true

# ShelvesHub reaches Steam over its CEF debug port, which Steam only opens when
# this flag file exists. Create it so a fresh install works (needs a Steam
# restart to take effect).
CEF_FLAG_CREATED=0
STEAM_SUPPORT="$HOME/Library/Application Support/Steam"
if [[ -d "$STEAM_SUPPORT" ]]; then
  touch "$STEAM_SUPPORT/.cef-enable-remote-debugging" 2>/dev/null && CEF_FLAG_CREATED=1
fi

echo ""
echo "[OK] ShelvesHub installed and running."
echo "     Install path : $INSTALL_DIR"
echo "     Service      : launchctl list | grep shelves"
echo ""
echo "── What to do next ──────────────────────────────────────────"
if [[ "$CEF_FLAG_CREATED" == "1" ]]; then
echo "  0. RESTART STEAM once so it opens the debug port ShelvesHub needs"
echo "     (quit Steam fully, then reopen). Without this, nothing appears."
fi
echo "  Open Steam Big Picture, then the Quick Access Menu, and find"
echo "  the ShelvesHub tab. If a plugin loader is already hosting Deck"
echo "  Shelves, ShelvesHub coexists (adds only its tab) and won't"
echo "  replace it — the Home looks unchanged."
