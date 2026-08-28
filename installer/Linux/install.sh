#!/bin/bash
# Installer for generic Linux (system-wide, requires sudo)
# Run from the extracted package directory: sudo bash installer/install.sh
set -e

INSTALL_DIR="/opt/shelveshub"
SERVICE_FILE="/etc/systemd/system/shelveshub.service"
BINARY="shelveshub"

echo "=== ShelvesHub — Linux Installer ==="

sudo mkdir -p "$INSTALL_DIR"
sudo cp "$BINARY" "$INSTALL_DIR/"
sudo chmod +x "$INSTALL_DIR/$BINARY"

[[ -d bundle ]] && sudo mkdir -p "$INSTALL_DIR/bundle" && sudo cp -r bundle/. "$INSTALL_DIR/bundle/"
[[ -d runtime ]] && sudo mkdir -p "$INSTALL_DIR/runtime" && sudo cp -r runtime/. "$INSTALL_DIR/runtime/"
# Config file: install it, but never overwrite one the user has already edited.
[[ -f shelveshub.config.json && ! -f "$INSTALL_DIR/shelveshub.config.json" ]] && sudo cp shelveshub.config.json "$INSTALL_DIR/"
# Optional data-backend payload: auto-detected by the service at <install>/backend.
[[ -d backend ]] && sudo mkdir -p "$INSTALL_DIR/backend" && sudo cp -r backend/. "$INSTALL_DIR/backend/"

sudo cp installer/shelveshub.service "$SERVICE_FILE"
sudo chmod 644 "$SERVICE_FILE"

sudo systemctl daemon-reload
sudo systemctl enable --now shelveshub.service

echo ""
echo "[OK] ShelvesHub installed and running."
echo "     Install path : $INSTALL_DIR"
echo "     Service      : systemctl status shelveshub"
