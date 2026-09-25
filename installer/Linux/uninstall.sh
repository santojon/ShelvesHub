#!/bin/bash
# Uninstaller for Linux — mirrors install.sh (a per-USER service).
# Stops and disables the user service and removes the install directory. Also
# cleans up an older system-wide (root) install if one is still present.
#
# Usage: bash uninstall.sh
set -e

INSTALL_DIR="$HOME/.local/share/shelveshub"
SERVICE_FILE="$HOME/.config/systemd/user/shelveshub.service"

echo "=== ShelvesHub — Linux Uninstaller ==="

systemctl --user disable --now shelveshub.service 2>/dev/null || true
rm -f "$SERVICE_FILE"
systemctl --user daemon-reload 2>/dev/null || true
echo "[OK] Stopped + removed the user service."

# Older system-wide (root) install, if it was never migrated.
if [[ -f /etc/systemd/system/shelveshub.service ]]; then
  sudo systemctl disable --now shelveshub.service 2>/dev/null || true
  sudo rm -f /etc/systemd/system/shelveshub.service
  sudo systemctl daemon-reload 2>/dev/null || true
  echo "[OK] Removed the old system-wide service."
fi
[[ -d /opt/shelveshub ]] && sudo rm -rf /opt/shelveshub 2>/dev/null && echo "[OK] Removed /opt/shelveshub." || true

if [[ -d "$INSTALL_DIR" ]]; then
  rm -rf "$INSTALL_DIR"
  echo "[OK] Removed $INSTALL_DIR."
else
  echo "[i] No install directory at $INSTALL_DIR."
fi

echo ""
echo "[i] Per-user Deck Shelves settings (shared with other hosts) were kept:"
echo "    ~/.local/share/deck-shelves"
echo "[OK] ShelvesHub uninstalled."
