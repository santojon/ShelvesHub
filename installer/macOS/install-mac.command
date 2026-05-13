#!/bin/bash
# Double-click this file in Finder to install Shelves Loader.
# First run: right-click → Open to bypass Gatekeeper.
set -e
cd "$(dirname "$0")"

REPO="santojon/Shelves-Loader"
PACKAGE="shelves-loader-macos.tar.gz"
URL="https://github.com/$REPO/releases/latest/download/$PACKAGE"

echo "=== Shelves Loader — macOS Installer ==="
echo ""
echo "[i] Downloading $PACKAGE..."

T=$(mktemp -d)
trap 'rm -rf "$T"' EXIT

curl -L "$URL" -o "$T/$PACKAGE" --progress-bar
tar -xzf "$T/$PACKAGE" -C "$T"

echo "[i] Installing..."
cd "$T"
bash installer/install_mac.sh

echo ""
echo "Press Enter to close..."
read -r
