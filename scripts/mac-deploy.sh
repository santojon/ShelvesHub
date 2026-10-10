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

echo "[OK] Soft deploy done — reload the renderer to pick it up (or run the :hard variant to bounce Steam)."
