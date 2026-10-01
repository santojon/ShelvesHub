#!/usr/bin/env bash
#
# Regenerate installer / app icon rasters from assets/icon.svg.
#
# Produces assets/icons/: PNGs at standard sizes, icon.ico (Windows) and, on
# macOS, icon.icns. Run whenever assets/icon.svg changes.
#
# Requires: rsvg-convert (SVG->PNG) + Python Pillow (.ico). macOS also uses the
# built-in iconutil for .icns. On pnpm setup these come from Homebrew (librsvg)
# and pip (Pillow).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SVG="$ROOT/assets/icon.svg"                     # transparent — site favicon / general
INSTALLER_SVG="$ROOT/assets/icon-installer.svg" # same graphic on the site background
OUT="$ROOT/assets/icons"

command -v rsvg-convert >/dev/null || { echo "error: rsvg-convert required (brew install librsvg)"; exit 1; }
[[ -f "$SVG" ]] || { echo "error: $SVG missing"; exit 1; }
[[ -f "$INSTALLER_SVG" ]] || { echo "error: $INSTALLER_SVG missing"; exit 1; }
mkdir -p "$OUT"

SIZES=(16 32 48 64 128 256 512 1024)

echo "[i] Rendering transparent PNGs from $SVG ..."
for s in "${SIZES[@]}"; do
  rsvg-convert -w "$s" -h "$s" "$SVG" -o "$OUT/icon-${s}.png"
done

# Installer icons (.ico / .icns) carry the site background so a GUI installer /
# Finder never shows the icon on plain white. Rendered from icon-installer.svg
# into a temp dir; the transparent icon-*.png above are untouched.
echo "[i] Rendering installer PNGs (with the site background) from $INSTALLER_SVG ..."
ITMP="$(mktemp -d)"; trap 'rm -rf "$ITMP"' EXIT
for s in "${SIZES[@]}"; do
  rsvg-convert -w "$s" -h "$s" "$INSTALLER_SVG" -o "$ITMP/icon-${s}.png"
done

echo "[i] Building icon.ico (Windows installer) ..."
python3 - "$ITMP" "$OUT" <<'PY'
import sys
from PIL import Image
src, out = sys.argv[1], sys.argv[2]
sizes = [16, 32, 48, 64, 128, 256]
base = Image.open(f"{src}/icon-256.png").convert("RGBA")
base.save(f"{out}/icon.ico", format="ICO", sizes=[(s, s) for s in sizes])
print("    wrote icon.ico")
PY

if command -v iconutil >/dev/null 2>&1; then
  echo "[i] Building icon.icns (macOS installer app) ..."
  ISET="$OUT/icon.iconset"; rm -rf "$ISET"; mkdir -p "$ISET"
  cp "$ITMP/icon-16.png"   "$ISET/icon_16x16.png"
  cp "$ITMP/icon-32.png"   "$ISET/icon_16x16@2x.png"
  cp "$ITMP/icon-32.png"   "$ISET/icon_32x32.png"
  cp "$ITMP/icon-64.png"   "$ISET/icon_32x32@2x.png"
  cp "$ITMP/icon-128.png"  "$ISET/icon_128x128.png"
  cp "$ITMP/icon-256.png"  "$ISET/icon_128x128@2x.png"
  cp "$ITMP/icon-256.png"  "$ISET/icon_256x256.png"
  cp "$ITMP/icon-512.png"  "$ISET/icon_256x256@2x.png"
  cp "$ITMP/icon-512.png"  "$ISET/icon_512x512.png"
  cp "$ITMP/icon-1024.png" "$ISET/icon_512x512@2x.png"
  iconutil -c icns "$ISET" -o "$OUT/icon.icns"
  rm -rf "$ISET"
else
  echo "[i] iconutil not found (macOS only) — skipping icon.icns"
fi

echo "[OK] icons written to $OUT"
ls -1 "$OUT"
