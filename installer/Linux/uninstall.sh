#!/bin/bash
# Uninstaller for Linux — mirrors install.sh (system-level service under sudo).
# Stops and disables the system service and removes the install directory.
#
# Usage: bash uninstall.sh
set -e

INSTALL_DIR="/opt/shelveshub"
SERVICE_FILE="/etc/systemd/system/shelveshub.service"

echo "=== ShelvesHub — Linux Uninstaller ==="

sudo systemctl disable --now shelveshub.service 2>/dev/null || true
sudo rm -f "$SERVICE_FILE"
sudo systemctl daemon-reload 2>/dev/null || true
echo "[OK] Stopped + removed the system service."

if [[ -d "$INSTALL_DIR" ]]; then
  sudo rm -rf "$INSTALL_DIR"
  echo "[OK] Removed $INSTALL_DIR."
else
  echo "[i] No install directory at $INSTALL_DIR."
fi

echo ""
echo "[i] Per-user Deck Shelves settings (shared with other hosts) were kept:"
echo "    ~/.local/share/deck-shelves"
echo "[OK] ShelvesHub uninstalled."
