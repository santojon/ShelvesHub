#!/bin/bash
# One-click installer for SteamOS / Steam Deck
# Usage: bash <(curl -sL https://github.com/santojon/ShelvesHub/releases/latest/download/install-steamos.sh)
set -e

REPO="santojon/ShelvesHub"
INSTALL_DIR="$HOME/.local/share/shelveshub"
SERVICE_DIR="$HOME/.config/systemd/user"
BINARY="shelveshub"

# Pick the package for this CPU (Steam Deck is x86_64; Steam Frame is aarch64).
ARCH="$(uname -m)"
case "$ARCH" in
  x86_64|amd64)   PACKAGE="shelveshub-steamos.tar.gz" ;;
  aarch64|arm64)  PACKAGE="shelveshub-steamos-aarch64.tar.gz" ;;
  *)
    echo "[!] Unsupported architecture: $ARCH"
    echo "    Supported Linux architectures: x86_64, aarch64"
    exit 1
    ;;
esac

echo "=== ShelvesHub — SteamOS Installer ==="
echo "[i] Architecture: $ARCH"

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
  mkdir -p "$INSTALL_DIR/bundle"
  cp -r "$EXTRACTED_DIR/bundle/." "$INSTALL_DIR/bundle/"
fi

if [[ -d "$EXTRACTED_DIR/runtime" ]]; then
  mkdir -p "$INSTALL_DIR/runtime"
  cp -r "$EXTRACTED_DIR/runtime/." "$INSTALL_DIR/runtime/"
fi

# Config file: install it, but never overwrite one the user has already edited.
if [[ -f "$EXTRACTED_DIR/shelveshub.config.json" && ! -f "$INSTALL_DIR/shelveshub.config.json" ]]; then
  cp "$EXTRACTED_DIR/shelveshub.config.json" "$INSTALL_DIR/"
fi

# Optional data-backend payload: auto-detected by the service at <install>/backend.
if [[ -d "$EXTRACTED_DIR/backend" ]]; then
  mkdir -p "$INSTALL_DIR/backend"
  cp -r "$EXTRACTED_DIR/backend/." "$INSTALL_DIR/backend/"
fi
# Keep the uninstaller alongside the install so it's available later.
[[ -f "$EXTRACTED_DIR/installer/uninstall.sh" ]] && cp "$EXTRACTED_DIR/installer/uninstall.sh" "$INSTALL_DIR/" && chmod +x "$INSTALL_DIR/uninstall.sh"

# ── Register user systemd service ─────────────────────────────────────────────
echo "[i] Setting up systemd user service..."
mkdir -p "$SERVICE_DIR"
cp "$EXTRACTED_DIR/installer/shelveshub.service" "$SERVICE_DIR/"

systemctl --user daemon-reload
systemctl --user enable --now shelveshub.service

echo ""
echo "[OK] ShelvesHub installed and running."
echo "     Install path : $INSTALL_DIR"
echo "     Service      : systemctl --user status shelveshub"
