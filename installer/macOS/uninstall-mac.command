#!/bin/bash
# Double-click this file in Finder to uninstall ShelvesHub.
# First run: right-click → Open to bypass Gatekeeper.
# Your shared Deck Shelves settings are kept unless you run with --purge.
set -e
cd "$(dirname "$0")"

REPO="santojon/ShelvesHub"
PACKAGE="shelveshub-macos.tar.gz"
URL="https://github.com/$REPO/releases/latest/download/$PACKAGE"
SUMS_URL="https://github.com/$REPO/releases/latest/download/SHA256SUMS"

echo "=== ShelvesHub — macOS Uninstaller ==="
echo ""
echo "[i] Fetching the uninstaller ($PACKAGE)..."

T=$(mktemp -d)
trap 'rm -rf "$T"' EXIT

curl -fL "$URL" -o "$T/$PACKAGE" --progress-bar

# Integrity: the uninstaller runs from the download, so verify it against the
# release's SHA256SUMS when present.
if curl -fsSL "$SUMS_URL" -o "$T/SHA256SUMS"; then
  EXPECTED=$(grep " $PACKAGE\$" "$T/SHA256SUMS" | awk '{print $1}')
  ACTUAL=$(shasum -a 256 "$T/$PACKAGE" | awk '{print $1}')
  if [[ -n "$EXPECTED" && "$EXPECTED" != "$ACTUAL" ]]; then
    echo "[!] Checksum mismatch for $PACKAGE — aborting (expected $EXPECTED, got $ACTUAL)."
    exit 1
  fi
  [[ -n "$EXPECTED" ]] && echo "[i] Checksum verified."
fi
tar -xzf "$T/$PACKAGE" -C "$T"

echo "[i] Uninstalling..."
cd "$T"
bash installer/uninstall_mac.sh "$@"

echo ""
echo "Press Enter to close..."
read -r
