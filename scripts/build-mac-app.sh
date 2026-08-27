#!/usr/bin/env bash
#
# Assemble "Install ShelvesHub.app" — a clickable macOS installer app carrying
# the ShelvesHub icon. Output: <dist>/Install ShelvesHub.app (+ a .zip for the
# GitHub release, since a .app is a directory). macOS only (needs iconutil for
# the .icns, produced by scripts/gen-icons.sh).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUTDIR="${1:-$ROOT/dist}"
APP_NAME="Install ShelvesHub"
APP="$OUTDIR/$APP_NAME.app"
ICNS="$ROOT/assets/icons/icon.icns"

[[ -f "$ICNS" ]] || bash "$ROOT/scripts/gen-icons.sh"
[[ -f "$ICNS" ]] || { echo "error: $ICNS missing (macOS + iconutil required to build the .icns)"; exit 1; }

mkdir -p "$OUTDIR"
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"

cp "$ICNS" "$APP/Contents/Resources/icon.icns"
cp "$ROOT/installer/macOS/app-installer.sh" "$APP/Contents/MacOS/installer"
chmod +x "$APP/Contents/MacOS/installer"

cat > "$APP/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key><string>Install ShelvesHub</string>
  <key>CFBundleDisplayName</key><string>Install ShelvesHub</string>
  <key>CFBundleIdentifier</key><string>com.shelveshub.installer</string>
  <key>CFBundleVersion</key><string>1.0</string>
  <key>CFBundleShortVersionString</key><string>1.0</string>
  <key>CFBundleExecutable</key><string>installer</string>
  <key>CFBundleIconFile</key><string>icon</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>LSMinimumSystemVersion</key><string>10.13</string>
  <key>NSHighResolutionCapable</key><true/>
</dict>
</plist>
PLIST

# Refresh Finder's icon cache for the freshly written bundle.
touch "$APP"

# Zip for the release (ditto preserves the bundle bits).
if command -v ditto >/dev/null 2>&1; then
  ( cd "$OUTDIR" && ditto -c -k --sequesterRsrc --keepParent "$APP_NAME.app" "$APP_NAME.app.zip" )
  echo "[OK] $APP"
  echo "     $OUTDIR/$APP_NAME.app.zip"
else
  echo "[OK] $APP  (ditto unavailable — skipped .zip)"
fi
