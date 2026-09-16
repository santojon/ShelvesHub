#!/bin/bash
# Double-click this file in Finder to uninstall ShelvesHub.
# First run: right-click → Open to bypass Gatekeeper.
# Your shared Deck Shelves settings are kept unless you run with --purge.
set -e
cd "$(dirname "$0")"

REPO="santojon/ShelvesHub"
PACKAGE="shelveshub-macos.tar.gz"
URL="https://github.com/$REPO/releases/latest/download/$PACKAGE"

echo "=== ShelvesHub — macOS Uninstaller ==="
echo ""
echo "[i] Fetching the uninstaller ($PACKAGE)..."

T=$(mktemp -d)
trap 'rm -rf "$T"' EXIT

curl -L "$URL" -o "$T/$PACKAGE" --progress-bar
tar -xzf "$T/$PACKAGE" -C "$T"

echo "[i] Uninstalling..."
cd "$T"
bash installer/uninstall_mac.sh "$@"

echo ""
echo "Press Enter to close..."
read -r
