#!/bin/bash
# One-click uninstaller for SteamOS / Steam Deck — mirrors install.sh. Stops and
# disables the user systemd service and removes the install directory. Leaves your
# Deck Shelves settings (shared with other hosts) and Steam's CEF debug flag in
# place unless --purge.
#
# Usage: bash uninstall.sh [--purge]
set -e

INSTALL_DIR="$HOME/.local/share/shelveshub"
SERVICE_DIR="$HOME/.config/systemd/user"
SERVICE="shelveshub.service"
SETTINGS_DIR="$HOME/.local/share/deck-shelves"
CEF_FLAG="$HOME/.steam/steam/.cef-enable-remote-debugging"
PURGE=0
[[ "$1" == "--purge" ]] && PURGE=1

echo "=== ShelvesHub — SteamOS Uninstaller ==="

systemctl --user disable --now "$SERVICE" 2>/dev/null || true
rm -f "$SERVICE_DIR/$SERVICE"
systemctl --user daemon-reload 2>/dev/null || true
echo "[OK] Stopped + removed the user service."

if [[ -d "$INSTALL_DIR" ]]; then
  rm -rf "$INSTALL_DIR"
  echo "[OK] Removed $INSTALL_DIR."
else
  echo "[i] No install directory at $INSTALL_DIR."
fi

if [[ "$PURGE" -eq 1 ]]; then
  rm -rf "$SETTINGS_DIR" 2>/dev/null || true
  rm -f "$CEF_FLAG" 2>/dev/null || true
  echo "[OK] Purged Deck Shelves settings and Steam's CEF debug flag."
  echo "     Restart Steam (systemctl --user restart steam-launcher) so it stops exposing the debug port."
else
  echo ""
  echo "[i] Kept (remove manually for a clean slate):"
  echo "    - Deck Shelves settings (shared): $SETTINGS_DIR"
  echo "    - Steam CEF debug flag:           $CEF_FLAG"
  echo "    Re-run with --purge to remove both."
fi

echo "[OK] ShelvesHub uninstalled."
