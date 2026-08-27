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
# Optional data-backend payload: auto-detected by the service at <install>/backend.
[[ -d "$EXTRACTED_DIR/backend" ]] && mkdir -p "$INSTALL_DIR/backend" && cp -r "$EXTRACTED_DIR/backend/." "$INSTALL_DIR/backend/"

# Generate the agent with the real install path (a user LaunchAgent runs as the
# user, so it lives under $HOME — never root-owned /usr/local).
sed "s|__INSTALL_DIR__|$INSTALL_DIR|g" "$EXTRACTED_DIR/installer/com.shelveshub.plist" > "$PLIST_DEST"
chmod 644 "$PLIST_DEST"
launchctl load "$PLIST_DEST"

echo ""
echo "[OK] ShelvesHub installed and running."
echo "     Install path : $INSTALL_DIR"
echo "     Service      : launchctl list | grep shelves"
