#!/bin/bash
# One-click installer for macOS
# Usage (online): bash install-mac.sh
# Usage (from extracted package): bash installer/install_mac.sh
set -e

REPO="santojon/ShelvesHub"
INSTALL_DIR="$HOME/.local/share/shelveshub"
LAUNCH_AGENTS_DIR="$HOME/Library/LaunchAgents"
PLIST_DEST="$LAUNCH_AGENTS_DIR/com.shelveshub.plist"
BINARY="shelveshub"
PACKAGE="shelveshub-macos.tar.gz"

echo "=== ShelvesHub — macOS Installer ==="

if [[ -f "$BINARY" ]]; then
  echo "[i] Binary found locally, skipping download."
  EXTRACTED_DIR="."
else
  echo "[i] Fetching latest release from GitHub..."
  DOWNLOAD_URL=$(curl -sL "https://api.github.com/repos/$REPO/releases/latest" \
    | grep '"browser_download_url"' \
    | grep "$PACKAGE" \
    | cut -d'"' -f4)

  if [[ -z "$DOWNLOAD_URL" ]]; then
    echo "[!] Could not find $PACKAGE in the latest release."
    echo "    Download manually from: https://github.com/$REPO/releases/latest"
    exit 1
  fi

  TMPDIR=$(mktemp -d)
  trap 'rm -rf "$TMPDIR"' EXIT

  echo "[i] Downloading $PACKAGE..."
  curl -sL "$DOWNLOAD_URL" -o "$TMPDIR/$PACKAGE"
  tar -xzf "$TMPDIR/$PACKAGE" -C "$TMPDIR"
  EXTRACTED_DIR="$TMPDIR"
fi

mkdir -p "$INSTALL_DIR/logs" "$LAUNCH_AGENTS_DIR"

cp "$EXTRACTED_DIR/$BINARY" "$INSTALL_DIR/"
chmod +x "$INSTALL_DIR/$BINARY"

[[ -d "$EXTRACTED_DIR/bundle" ]] && mkdir -p "$INSTALL_DIR/bundle" && cp -r "$EXTRACTED_DIR/bundle/." "$INSTALL_DIR/bundle/"
[[ -d "$EXTRACTED_DIR/runtime" ]] && mkdir -p "$INSTALL_DIR/runtime" && cp -r "$EXTRACTED_DIR/runtime/." "$INSTALL_DIR/runtime/"
# Config file: install it, but never overwrite one the user has already edited.
[[ -f "$EXTRACTED_DIR/shelveshub.config.json" && ! -f "$INSTALL_DIR/shelveshub.config.json" ]] && cp "$EXTRACTED_DIR/shelveshub.config.json" "$INSTALL_DIR/"
# Optional data-backend payload: auto-detected by the service at <install>/backend.
[[ -d "$EXTRACTED_DIR/backend" ]] && mkdir -p "$INSTALL_DIR/backend" && cp -r "$EXTRACTED_DIR/backend/." "$INSTALL_DIR/backend/"
# Keep the uninstaller alongside the install so it's available later.
[[ -f "$EXTRACTED_DIR/installer/uninstall_mac.sh" ]] && cp "$EXTRACTED_DIR/installer/uninstall_mac.sh" "$INSTALL_DIR/" && chmod +x "$INSTALL_DIR/uninstall_mac.sh"

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
