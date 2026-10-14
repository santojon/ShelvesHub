#!/bin/bash
# Hard deploy on macOS: build the release binary, install it over the running
# service (reinstall-safe), then RESTART Steam (quit + relaunch Big Picture) so a
# fresh renderer picks it up — the desktop counterpart to deck-deploy-hard.sh.
set -euo pipefail
cd "$(dirname "$0")/.."

INSTALL_DIR="$HOME/.local/share/shelveshub"

echo "[i] Building release binary…"
cargo build --release --quiet

echo "[i] Installing over ${INSTALL_DIR} ..."
mkdir -p "$INSTALL_DIR"
cp target/release/shelveshub "$INSTALL_DIR/shelveshub"
chmod +x "$INSTALL_DIR/shelveshub"
# Ship the injected runtime and boot assets too (the managed bundle is left
# alone — the daemon owns its own download).
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

echo "[i] Restarting Steam (quit + relaunch Big Picture)…"
osascript -e 'quit app "Steam"' 2>/dev/null || true
for _ in $(seq 1 20); do
  pgrep -x steam_osx >/dev/null 2>&1 || break
  sleep 0.5
done
pkill -x steam_osx 2>/dev/null || true
sleep 1
open "steam://open/bigpicture"

echo "[OK] Hard deploy done — Steam is relaunching into Big Picture."
