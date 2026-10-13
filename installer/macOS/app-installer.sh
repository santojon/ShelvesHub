#!/bin/bash
# Executable payload for "Install ShelvesHub.app": downloads the latest macOS
# package and runs its installer, with native dialogs for feedback. Double-click
# the .app in Finder (first run: right-click -> Open to bypass Gatekeeper).
REPO="santojon/ShelvesHub"
PACKAGE="shelveshub-macos.tar.gz"
URL="https://github.com/$REPO/releases/latest/download/$PACKAGE"
SUMS_URL="https://github.com/$REPO/releases/latest/download/SHA256SUMS"

fail() {
  osascript -e "display alert \"ShelvesHub Installer\" message \"$1\" as critical" >/dev/null 2>&1
  exit 1
}

osascript -e 'display notification "Downloading ShelvesHub…" with title "ShelvesHub Installer"' >/dev/null 2>&1

T=$(mktemp -d) || fail "Could not create a temporary folder."
trap 'rm -rf "$T"' EXIT

curl -fL "$URL" -o "$T/$PACKAGE" >/dev/null 2>&1 || fail "Download failed — check your internet connection."
# Integrity: the installer inside the package skips its own download (and with it
# the checksum step), so verify here against the release's SHA256SUMS when present.
if curl -fsSL "$SUMS_URL" -o "$T/SHA256SUMS" >/dev/null 2>&1; then
  EXPECTED=$(grep " $PACKAGE\$" "$T/SHA256SUMS" | awk '{print $1}')
  ACTUAL=$(shasum -a 256 "$T/$PACKAGE" | awk '{print $1}')
  [[ -z "$EXPECTED" || "$EXPECTED" == "$ACTUAL" ]] \
    || fail "Checksum mismatch for $PACKAGE — the download does not match the release. Nothing was installed."
fi
tar -xzf "$T/$PACKAGE" -C "$T" 2>/dev/null || fail "Could not unpack the download."

# There is no terminal here, so a first install takes every option's default; the
# closing dialog says which (a re-install keeps the existing setup instead).
DEFAULTS="First-install defaults applied: own Quick Access tab on, cooperative hosting off, desktop-client inject off, automatic updates on (pre-releases off), tray companion off. Change any of these in the ShelvesHub tab."
cd "$T" || fail "Temporary folder vanished."
if bash installer/install_mac.sh >"$T/install.log" 2>&1; then
  if grep -q "Existing setup kept" "$T/install.log"; then
    MSG="Installed and running. Your existing setup was kept."
  else
    MSG="Installed and running. $DEFAULTS"
  fi
  osascript -e "display alert \"ShelvesHub\" message \"$MSG\" as informational" >/dev/null 2>&1
else
  cp "$T/install.log" "$HOME/shelveshub-install.log" 2>/dev/null || true
  fail "Install failed. A log was saved to ~/shelveshub-install.log"
fi
