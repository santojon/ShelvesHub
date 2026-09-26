#!/bin/bash
# One-click installer for SteamOS / Steam Deck
# Usage: bash <(curl -sL https://github.com/santojon/ShelvesHub/releases/latest/download/install-steamos.sh)
set -e

REPO="santojon/ShelvesHub"
INSTALL_DIR="$HOME/.local/share/shelveshub"
SERVICE_DIR="$HOME/.config/systemd/user"
BINARY="shelveshub"

# Pick the package for this CPU (Steam Deck is x86_64; ARM64 devices are aarch64).
ARCH="$(uname -m)"
case "$ARCH" in
  x86_64|amd64)   PACKAGE="shelveshub-steamos.tar.gz" ;;
  aarch64|arm64)  PACKAGE="shelveshub-steamos-aarch64.tar.gz" ;;
  *)
    echo "[!] Unsupported architecture: $ARCH"
    echo "    Supported Linux architectures: x86_64, aarch64"
    exit 1
    ;;
esac

echo "=== ShelvesHub — SteamOS Installer ==="
echo "[i] Architecture: $ARCH"

# ── Resolve download URL ───────────────────────────────────────────────────────
if [[ -f "$BINARY" ]]; then
  # Running from an already-extracted package — skip download
  echo "[i] Binary found locally, skipping download."
  EXTRACTED_DIR="."
else
  echo "[i] Fetching latest release from GitHub..."
  API_URL="https://api.github.com/repos/$REPO/releases/latest"
  DOWNLOAD_URL=$(curl -sL "$API_URL" \
    | grep '"browser_download_url"' \
    | grep "$PACKAGE" \
    | cut -d'"' -f4)

  if [[ -z "$DOWNLOAD_URL" ]]; then
    echo "[!] Could not find $PACKAGE in the latest release."
    echo "    Download manually from: https://github.com/$REPO/releases/latest"
    exit 1
  fi

  TMPDIR=$(mktemp -d)
  trap 'rm -rf "$TMPDIR"' EXIT

  echo "[i] Downloading $PACKAGE..."
  curl -sL "$DOWNLOAD_URL" -o "$TMPDIR/$PACKAGE"
  tar -xzf "$TMPDIR/$PACKAGE" -C "$TMPDIR"
  EXTRACTED_DIR="$TMPDIR"
fi

# ── Install binary and bundle ──────────────────────────────────────────────────
echo "[i] Installing to $INSTALL_DIR..."
mkdir -p "$INSTALL_DIR"

cp "$EXTRACTED_DIR/$BINARY" "$INSTALL_DIR/"
chmod +x "$INSTALL_DIR/$BINARY"

if [[ -d "$EXTRACTED_DIR/bundle" ]]; then
  mkdir -p "$INSTALL_DIR/bundle"
  cp -r "$EXTRACTED_DIR/bundle/." "$INSTALL_DIR/bundle/"
fi

if [[ -d "$EXTRACTED_DIR/runtime" ]]; then
  mkdir -p "$INSTALL_DIR/runtime"
  cp -r "$EXTRACTED_DIR/runtime/." "$INSTALL_DIR/runtime/"
fi

# Config file: install it, but never overwrite one the user has already edited.
if [[ -f "$EXTRACTED_DIR/shelveshub.config.json" && ! -f "$INSTALL_DIR/shelveshub.config.json" ]]; then
  cp "$EXTRACTED_DIR/shelveshub.config.json" "$INSTALL_DIR/"
fi

# Optional data-backend payload: auto-detected by the service at <install>/backend.
if [[ -d "$EXTRACTED_DIR/backend" ]]; then
  mkdir -p "$INSTALL_DIR/backend"
  cp -r "$EXTRACTED_DIR/backend/." "$INSTALL_DIR/backend/"
fi
# Boot-animation source cuts — the daemon reads them from <install>/assets/boot
# when the boot_movie toggle installs the movie into Steam's own startup slots.
if [[ -d "$EXTRACTED_DIR/assets" ]]; then
  mkdir -p "$INSTALL_DIR/assets"
  cp -r "$EXTRACTED_DIR/assets/." "$INSTALL_DIR/assets/"
fi
# Keep the uninstaller alongside the install so it's available later.
[[ -f "$EXTRACTED_DIR/installer/uninstall.sh" ]] && cp "$EXTRACTED_DIR/installer/uninstall.sh" "$INSTALL_DIR/" && chmod +x "$INSTALL_DIR/uninstall.sh"

# ── Register user systemd service ─────────────────────────────────────────────
echo "[i] Setting up systemd user service..."
mkdir -p "$SERVICE_DIR"
cp "$EXTRACTED_DIR/installer/shelveshub.service" "$SERVICE_DIR/"

systemctl --user daemon-reload
# Reinstall-safe (upgrade in place): `enable --now` only STARTS an inactive unit,
# so an already-running service would keep the OLD binary. Enable for boot, then
# restart so the freshly-copied binary is the one running now.
systemctl --user enable shelveshub.service
systemctl --user restart shelveshub.service

# ShelvesHub reaches Steam over its CEF debug port, which Steam only opens when
# this flag file exists. Without it a fresh install just logs "connection
# refused" forever and nothing appears — so create it (needs a Steam restart).
CEF_FLAG_CREATED=0
for steam_root in "$HOME/.steam/steam" "$HOME/.local/share/Steam"; do
  if [[ -d "$steam_root" ]]; then
    touch "$steam_root/.cef-enable-remote-debugging" 2>/dev/null && CEF_FLAG_CREATED=1
  fi
done

echo ""
echo "[OK] ShelvesHub installed and running."
echo "     Install path : $INSTALL_DIR"
echo "     Service      : systemctl --user status shelveshub"
echo ""
echo "── What to do next ──────────────────────────────────────────"
if [[ "$CEF_FLAG_CREATED" == "1" ]]; then
echo "  0. RESTART STEAM once (Steam menu → Exit, then reopen) so it opens"
echo "     the debug port ShelvesHub needs. Without this restart, nothing"
echo "     will appear."
fi
echo "  1. Return to Gaming Mode."
echo "  2. Open the Quick Access Menu (the '…' button on the right)."
echo "  3. Find the ShelvesHub tab — its own panel. The Deck Shelves"
echo "     editor opens from there too."

# Coexistence heads-up: if a plugin loader is already hosting Deck Shelves, the
# host deliberately coexists (adds only its tab) and does NOT replace/update that
# copy — so the Home looks unchanged. Detect it by the loader's plugin dir; keep
# the message neutral (no loader name).
if [[ -d "$HOME/homebrew/plugins" ]]; then
  _ds_via_loader=""
  for _p in "$HOME/homebrew/plugins/"*; do
    case "$(basename "$_p" | tr '[:upper:] ' '[:lower:]-')" in
      *deck-shelves*|*deckshelves*) _ds_via_loader="1" ;;
    esac
  done
  echo ""
  echo "  [i] A plugin loader is installed on this device."
  if [[ -n "$_ds_via_loader" ]]; then
    echo "      Deck Shelves is already installed through it, so it stays the"
    echo "      host: ShelvesHub coexists (adds only its tab) and will NOT"
    echo "      replace or update that copy — the Home behaves as before, and"
    echo "      Deck Shelves updates through the loader. To hand Deck Shelves to"
    echo "      ShelvesHub instead, see the ShelvesHub tab and the docs."
  else
    echo "      No Deck Shelves was found under it, so ShelvesHub will host"
    echo "      Deck Shelves itself."
  fi
fi
