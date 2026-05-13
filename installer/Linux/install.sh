#!/bin/bash

set -e

INSTALL_DIR="/opt/shelves-loader"
SERVICE_FILE="/etc/systemd/system/shelves-loader.service"

echo "Installing Shelves Loader on Linux/SteamOS..."

# Create install directory if it doesn't exist
sudo mkdir -p "$INSTALL_DIR"
echo "[INFO] Directory $INSTALL_DIR created."

# Copy required files
sudo cp loader "$INSTALL_DIR/"
sudo chmod +x "$INSTALL_DIR/loader"
sudo cp -r bundle/* "$INSTALL_DIR/"
sudo cp installer/Linux/shelves-loader.service "$SERVICE_FILE"

# Set proper permissions
sudo chmod 644 "$SERVICE_FILE"

# Register and start the service
sudo systemctl daemon-reload
sudo systemctl enable shelves-loader.service
sudo systemctl start shelves-loader.service

echo "[SUCCESS] Shelves Loader installed and service started!"