#!/bin/bash
# Executable payload for "Install ShelvesHub.app": downloads the latest macOS
# package and runs its installer, with native dialogs for feedback. Double-click
# the .app in Finder (first run: right-click -> Open to bypass Gatekeeper).
REPO="santojon/ShelvesHub"
PACKAGE="shelveshub-macos.tar.gz"
URL="https://github.com/$REPO/releases/latest/download/$PACKAGE"

fail() {
  osascript -e "display alert \"ShelvesHub Installer\" message \"$1\" as critical" >/dev/null 2>&1
  exit 1
}

osascript -e 'display notification "Downloading ShelvesHub…" with title "ShelvesHub Installer"' >/dev/null 2>&1

T=$(mktemp -d) || fail "Could not create a temporary folder."
trap 'rm -rf "$T"' EXIT

curl -fL "$URL" -o "$T/$PACKAGE" >/dev/null 2>&1 || fail "Download failed — check your internet connection."
tar -xzf "$T/$PACKAGE" -C "$T" 2>/dev/null || fail "Could not unpack the download."

cd "$T" || fail "Temporary folder vanished."
if bash installer/install_mac.sh >"$T/install.log" 2>&1; then
  osascript -e 'display alert "ShelvesHub" message "Installed and running." as informational' >/dev/null 2>&1
else
  cp "$T/install.log" "$HOME/shelveshub-install.log" 2>/dev/null || true
  fail "Install failed. A log was saved to ~/shelveshub-install.log"
fi
