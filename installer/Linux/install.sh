#!/bin/bash
# Installer for generic Linux — a per-USER service (no root), matching SteamOS.
# Run from the extracted package directory: bash installer/install.sh
set -e

INSTALL_DIR="$HOME/.local/share/shelveshub"
SERVICE_DIR="$HOME/.config/systemd/user"
SERVICE_FILE="$SERVICE_DIR/shelveshub.service"
BINARY="shelveshub"

echo "=== ShelvesHub — Linux Installer ==="

# Migrate an older ROOT/system install (/opt + a system unit, which ran the
# daemon as root and put settings in the wrong place) to the per-user service.
if [[ -f /etc/systemd/system/shelveshub.service ]]; then
  echo "[i] Migrating the old system-wide (root) install to a per-user service…"
  sudo systemctl disable --now shelveshub.service 2>/dev/null || true
  sudo rm -f /etc/systemd/system/shelveshub.service
  sudo systemctl daemon-reload 2>/dev/null || true
  if [[ -d /opt/shelveshub && ! -e "$INSTALL_DIR" ]]; then
    mkdir -p "$(dirname "$INSTALL_DIR")"
    sudo cp -r /opt/shelveshub "$INSTALL_DIR" && sudo chown -R "$USER" "$INSTALL_DIR"
  fi
  sudo rm -rf /opt/shelveshub
fi

mkdir -p "$INSTALL_DIR/logs" "$SERVICE_DIR"
cp "$BINARY" "$INSTALL_DIR/"
chmod +x "$INSTALL_DIR/$BINARY"

[[ -d bundle ]] && mkdir -p "$INSTALL_DIR/bundle" && cp -r bundle/. "$INSTALL_DIR/bundle/"
[[ -d runtime ]] && mkdir -p "$INSTALL_DIR/runtime" && cp -r runtime/. "$INSTALL_DIR/runtime/"
# Config file: install it, but never overwrite one the user has already edited.
[[ -f shelveshub.config.json && ! -f "$INSTALL_DIR/shelveshub.config.json" ]] && cp shelveshub.config.json "$INSTALL_DIR/"
# Optional data-backend payload: auto-detected by the service at <install>/backend.
[[ -d backend ]] && mkdir -p "$INSTALL_DIR/backend" && cp -r backend/. "$INSTALL_DIR/backend/"
# Keep the uninstaller alongside the install so it's available later.
[[ -f installer/uninstall.sh ]] && cp installer/uninstall.sh "$INSTALL_DIR/" && chmod +x "$INSTALL_DIR/uninstall.sh"

cp installer/shelveshub.service "$SERVICE_FILE"
chmod 644 "$SERVICE_FILE"

systemctl --user daemon-reload
# Reinstall-safe (upgrade in place): enable for boot, then restart so the
# freshly-copied binary is the one running now (not the old process).
systemctl --user enable shelveshub.service
systemctl --user restart shelveshub.service

# ShelvesHub reaches Steam over its CEF debug port, which Steam only opens when
# this flag file exists — otherwise a fresh install just logs "connection
# refused" and nothing appears. Create it (needs a Steam restart to take effect).
CEF_FLAG_CREATED=0
for steam_root in "$HOME/.steam/steam" "$HOME/.local/share/Steam" \
  "$HOME/.var/app/com.valvesoftware.Steam/.local/share/Steam"; do
  if [[ -d "$steam_root" ]]; then
    touch "$steam_root/.cef-enable-remote-debugging" 2>/dev/null && CEF_FLAG_CREATED=1
  fi
done

echo ""
echo "[OK] ShelvesHub installed and running (per-user service, no root)."
echo "     Install path : $INSTALL_DIR"
echo "     Service      : systemctl --user status shelveshub"
echo ""
echo "── What to do next ──────────────────────────────────────────"
if [[ "$CEF_FLAG_CREATED" == "1" ]]; then
echo "  0. RESTART STEAM once so it opens the debug port ShelvesHub needs."
echo "     Without this restart, nothing appears."
fi
echo "  Open Steam Big Picture, then the Quick Access Menu, and find"
echo "  the ShelvesHub tab. If a plugin loader is already hosting Deck"
echo "  Shelves, ShelvesHub coexists (adds only its tab) and won't"
echo "  replace it — the Home looks unchanged."
