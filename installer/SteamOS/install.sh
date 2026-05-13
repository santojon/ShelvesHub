#!/bin/bash
# One-click installer for SteamOS / Steam Deck
# Usage: bash <(curl -sL https://github.com/santojon/Shelves-Loader/releases/latest/download/install-steamos.sh)
set -e

REPO="santojon/Shelves-Loader"
INSTALL_DIR="$HOME/.local/share/shelves-loader"
SERVICE_DIR="$HOME/.config/systemd/user"
BINARY="loader"
PACKAGE="shelves-loader-steamos.tar.gz"

echo "=== Shelves Loader — SteamOS Installer ==="

# ── Resolve download URL ───────────────────────────────────────────────────────
if [[ -f "$BINARY" ]]; then
  # Running from an already-extracted package — skip download
  echo "[i] Binary found locally, skipping download."
  EXTRACTED_DIR="."
else
  echo "[i] Fetching latest release from GitHub..."
  API_URL="https://api.github.com/repos/$REPO/releases/latest"
  DOWNLOAD_URL=$(curl -sL "$API_URL" \
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

# ── Install binary and bundle ──────────────────────────────────────────────────
echo "[i] Installing to $INSTALL_DIR..."
mkdir -p "$INSTALL_DIR"

cp "$EXTRACTED_DIR/$BINARY" "$INSTALL_DIR/"
chmod +x "$INSTALL_DIR/$BINARY"

if [[ -d "$EXTRACTED_DIR/bundle" ]]; then
  cp -r "$EXTRACTED_DIR/bundle/." "$INSTALL_DIR/bundle/"
fi

# ── Register user systemd service ─────────────────────────────────────────────
echo "[i] Setting up systemd user service..."
mkdir -p "$SERVICE_DIR"
cp "$EXTRACTED_DIR/installer/shelves-loader.service" "$SERVICE_DIR/"

systemctl --user daemon-reload
systemctl --user enable --now shelves-loader.service

echo ""
echo "[OK] Shelves Loader installed and running."
echo "     Install path : $INSTALL_DIR"
echo "     Service      : systemctl --user status shelves-loader"
