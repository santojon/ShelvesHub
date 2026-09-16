#!/bin/bash
# One-click uninstaller for macOS — mirrors install_mac.sh. Stops and removes the
# user LaunchAgent and the install directory. Leaves your Deck Shelves settings
# (shared with other hosts) and Steam's CEF debug flag in place unless --purge.
#
# Usage: bash uninstall_mac.sh [--purge]
set -e

INSTALL_DIR="$HOME/.local/share/shelveshub"
PLIST="$HOME/Library/LaunchAgents/com.shelveshub.plist"
SETTINGS_DIR="$HOME/Library/Application Support/deck-shelves"
CEF_FLAG="$HOME/Library/Application Support/Steam/.cef-enable-remote-debugging"
PURGE=0
[[ "$1" == "--purge" ]] && PURGE=1

echo "=== ShelvesHub — macOS Uninstaller ==="

# Stop + unload the LaunchAgent (ignore if not loaded), then remove it.
if [[ -f "$PLIST" ]]; then
  launchctl unload "$PLIST" 2>/dev/null || true
  rm -f "$PLIST"
  echo "[OK] Removed LaunchAgent (com.shelveshub)."
else
  echo "[i] No LaunchAgent found."
fi

# Stop any running instance started outside the agent.
pkill -x shelveshub 2>/dev/null || true

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
  echo "     Restart Steam so it stops exposing the debug port."
else
  echo ""
  echo "[i] Kept (remove manually if you want a clean slate):"
  echo "    - Deck Shelves settings (shared with other hosts): $SETTINGS_DIR"
  echo "    - Steam CEF debug flag (only if you enabled it):    $CEF_FLAG"
  echo "    Re-run with --purge to remove both (then restart Steam)."
fi

echo "[OK] ShelvesHub uninstalled."
