#!/bin/bash
# Soft deploy on macOS: build the release binary, install it over the running
# service and kick the daemon, WITHOUT restarting Steam. Use when the renderer
# can pick the change up on its own reload; mac-deploy-hard.sh bounces Steam.
set -euo pipefail
cd "$(dirname "$0")/.."

INSTALL_DIR="$HOME/.local/share/shelveshub"

echo "[i] Building release binary…"
cargo build --release --quiet

echo "[i] Installing over ${INSTALL_DIR} ..."
mkdir -p "$INSTALL_DIR"
cp target/release/shelveshub "$INSTALL_DIR/shelveshub"
chmod +x "$INSTALL_DIR/shelveshub"
[[ -d runtime ]] && mkdir -p "$INSTALL_DIR/runtime" && cp -r runtime/. "$INSTALL_DIR/runtime/"
[[ -d assets ]] && mkdir -p "$INSTALL_DIR/assets" && cp -r assets/. "$INSTALL_DIR/assets/"

echo "[i] Restarting the daemon…"
launchctl kickstart -k "gui/$(id -u)/com.shelveshub" 2>/dev/null || true

# The tray companion, when its agent is installed: build it too, stage + rename the
# binary (it may be running), and restart its agent so the menu-bar icon follows the build.
if [[ -f "$HOME/Library/LaunchAgents/com.shelveshub.tray.plist" ]]; then
  echo "[i] Refreshing the tray companion…"
  cargo build --release --quiet --features tray --bin shelveshub-tray
  cp target/release/shelveshub-tray "$INSTALL_DIR/shelveshub-tray.new"
  chmod +x "$INSTALL_DIR/shelveshub-tray.new"
  mv -f "$INSTALL_DIR/shelveshub-tray.new" "$INSTALL_DIR/shelveshub-tray"
  launchctl kickstart -k "gui/$(id -u)/com.shelveshub.tray" 2>/dev/null || true
fi

echo "[OK] Soft deploy done — reload the renderer to pick it up (or run the :hard variant to bounce Steam)."
