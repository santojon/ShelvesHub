#!/bin/bash

set -e

INSTALL_DIR="/usr/local/shelves-loader"
PLIST_FILE="~/Library/LaunchAgents/com.shelves.loader.plist"

echo "Installing Shelves Loader on macOS..."

# Create install directory if it doesn't exist
mkdir -p "$INSTALL_DIR"
echo "[INFO] Directory $INSTALL_DIR created."

# Copiar binário e bundle
cp loader "$INSTALL_DIR/"
chmod +x "$INSTALL_DIR/loader"
cp -r bundle/* "$INSTALL_DIR/"
cp installer/macOS/com.shelves.loader.plist "$PLIST_FILE"

# Set permissions and load the service with launchctl
chmod 644 "$PLIST_FILE"
launchctl load "$PLIST_FILE"

echo "[SUCCESS] Shelves Loader installed and service loaded successfully on macOS!"