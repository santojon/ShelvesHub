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
