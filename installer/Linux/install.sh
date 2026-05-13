#!/bin/bash
# Installer for generic Linux (system-wide, requires sudo)
# Run from the extracted package directory: sudo bash installer/install.sh
set -e

INSTALL_DIR="/opt/shelves-loader"
SERVICE_FILE="/etc/systemd/system/shelves-loader.service"
BINARY="loader"

echo "=== Shelves Loader — Linux Installer ==="

sudo mkdir -p "$INSTALL_DIR"
sudo cp "$BINARY" "$INSTALL_DIR/"
sudo chmod +x "$INSTALL_DIR/$BINARY"

[[ -d bundle ]] && sudo cp -r bundle/. "$INSTALL_DIR/bundle/"

sudo cp installer/shelves-loader.service "$SERVICE_FILE"
sudo chmod 644 "$SERVICE_FILE"

sudo systemctl daemon-reload
sudo systemctl enable --now shelves-loader.service

echo ""
echo "[OK] Shelves Loader installed and running."
echo "     Install path : $INSTALL_DIR"
echo "     Service      : systemctl status shelves-loader"
