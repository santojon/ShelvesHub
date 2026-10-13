#!/bin/bash
# Uninstaller for Linux — mirrors install.sh (a per-USER service).
# Stops and disables the user service and removes the install directory. Also
# cleans up an older system-wide (root) install if one is still present. Leaves
# your Deck Shelves settings (shared with other hosts) and Steam's CEF debug flag
# in place unless --purge.
#
# Usage: bash uninstall.sh [--purge]
set -e

INSTALL_DIR="$HOME/.local/share/shelveshub"
SERVICE_FILE="$HOME/.config/systemd/user/shelveshub.service"
# Resolved the same way install.sh does, so --purge removes the directory the
# install actually used.
SETTINGS_DIR="${SHELVES_SETTINGS_DIR:-${XDG_DATA_HOME:-$HOME/.local/share}/deck-shelves}"
PURGE=0
[[ "$1" == "--purge" ]] && PURGE=1

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

# Tray companion (opt-in): stop it and remove its autostart entry. The binary
# itself lives under $INSTALL_DIR and goes with the directory removal below.
pkill -f "$INSTALL_DIR/shelveshub-tray" 2>/dev/null || true
[[ -f "$HOME/.config/autostart/shelveshub-tray.desktop" ]] \
  && rm -f "$HOME/.config/autostart/shelveshub-tray.desktop" \
  && echo "[OK] Removed the tray autostart entry." || true

if [[ -d "$INSTALL_DIR" ]]; then
  rm -rf "$INSTALL_DIR"
  echo "[OK] Removed $INSTALL_DIR."
else
  echo "[i] No install directory at $INSTALL_DIR."
fi

# The same Steam roots install.sh touches (including the Flatpak one).
STEAM_ROOTS=("$HOME/.steam/steam" "$HOME/.local/share/Steam" \
  "$HOME/.var/app/com.valvesoftware.Steam/.local/share/Steam")
if [[ "$PURGE" -eq 1 ]]; then
  rm -rf "$SETTINGS_DIR" 2>/dev/null || true
  for steam_root in "${STEAM_ROOTS[@]}"; do
    rm -f "$steam_root/.cef-enable-remote-debugging" 2>/dev/null || true
  done
  echo "[OK] Purged Deck Shelves settings and Steam's CEF debug flag."
  echo "     Restart Steam so it stops exposing the debug port."
else
  echo ""
  echo "[i] Kept (remove manually for a clean slate):"
  echo "    - Deck Shelves settings (shared): $SETTINGS_DIR"
  echo "    - Steam CEF debug flag:           <steam root>/.cef-enable-remote-debugging"
  echo "    Re-run with --purge to remove both (then restart Steam)."
fi

echo "[OK] ShelvesHub uninstalled."
