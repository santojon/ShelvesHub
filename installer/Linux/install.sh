#!/bin/bash
# Installer for generic Linux — a per-USER service (no root), matching SteamOS.
# Run from the extracted package directory: bash installer/install.sh
set -e

# Per-user by design: refuse root so we never create a root-owned install that
# can't reach your Steam. (Migration below still uses sudo for the few commands
# that need it.) Override only for a deliberate system image: SHELVES_ALLOW_ROOT=1.
if [[ "${EUID:-$(id -u)}" -eq 0 && "${SHELVES_ALLOW_ROOT:-}" != "1" ]]; then
  echo "[!] Don't run this as root/sudo. ShelvesHub installs per-user"
  echo "    (~/.local/share/shelveshub) and runs as you so it can reach your Steam."
  echo "    Re-run it as your normal user, without sudo."
  exit 1
fi

INSTALL_DIR="$HOME/.local/share/shelveshub"
SERVICE_DIR="$HOME/.config/systemd/user"
SERVICE_FILE="$SERVICE_DIR/shelveshub.service"
BINARY="shelveshub"

# Capture the run to a log next to the install so a failure is diagnosable even
# when the terminal closes instantly. Fail-soft. See SteamOS install.sh.
LOGFILE="$INSTALL_DIR/install.log"
if mkdir -p "$INSTALL_DIR" 2>/dev/null && exec > >(tee "$LOGFILE") 2>&1; then
  echo "[i] Full log: $LOGFILE"
fi
trap 'rc=$?; [[ $rc -ne 0 ]] && { echo; echo "[!] Install failed (exit $rc). Full log: $LOGFILE"; }' EXIT

echo "=== ShelvesHub — Linux Installer ==="

# Migrate any older ROOT/system install (/opt + a system unit, which ran the daemon
# as root) to the current per-user service, and DROP root. Your Deck Shelves settings
# live in a separate dir, so removing the old install never loses data — and if the
# root install kept settings under root's home, they're rescued to yours (only when
# yours don't exist yet, so nothing you have is ever overwritten).
SETTINGS_DIR="${SHELVES_SETTINGS_DIR:-${XDG_DATA_HOME:-$HOME/.local/share}/deck-shelves}"
set +e # migration is best-effort — a sudo hiccup must never abort the install
if [[ -f /etc/systemd/system/shelveshub.service || -d /opt/shelveshub ]]; then
  echo "[i] Migrating an old system-wide (root) install to the per-user service…"
  sudo systemctl disable --now shelveshub.service 2>/dev/null
  sudo rm -f /etc/systemd/system/shelveshub.service
  sudo systemctl daemon-reload 2>/dev/null
  if [[ -f /opt/shelveshub/shelveshub.config.json && ! -f "$INSTALL_DIR/shelveshub.config.json" ]]; then
    mkdir -p "$INSTALL_DIR"
    sudo cp /opt/shelveshub/shelveshub.config.json "$INSTALL_DIR/" && sudo chown "$USER" "$INSTALL_DIR/shelveshub.config.json"
  fi
  if [[ ! -d "$SETTINGS_DIR" && -d /root/.local/share/deck-shelves ]]; then
    mkdir -p "$(dirname "$SETTINGS_DIR")"
    sudo cp -r /root/.local/share/deck-shelves "$SETTINGS_DIR" && sudo chown -R "$USER" "$SETTINGS_DIR"
    echo "[i] Rescued your Deck Shelves settings from the old root install."
  fi
  sudo rm -rf /opt/shelveshub
fi
set -e

mkdir -p "$INSTALL_DIR/logs" "$SERVICE_DIR"
cp "$BINARY" "$INSTALL_DIR/"
chmod +x "$INSTALL_DIR/$BINARY"

[[ -d bundle ]] && mkdir -p "$INSTALL_DIR/bundle" && cp -r bundle/. "$INSTALL_DIR/bundle/"
[[ -d runtime ]] && mkdir -p "$INSTALL_DIR/runtime" && cp -r runtime/. "$INSTALL_DIR/runtime/"
# Config file: install it, but never overwrite one the user has already edited.
CONFIG_WAS_FRESH=0
if [[ -f shelveshub.config.json && ! -f "$INSTALL_DIR/shelveshub.config.json" ]]; then
  cp shelveshub.config.json "$INSTALL_DIR/"; CONFIG_WAS_FRESH=1
fi

# ── Optional setup choices ─────────────────────────────────────────────────────
# Read from the environment (works with `curl | bash`) and, on a terminal, ask.
# Applied only on a FIRST install; everything stays editable in the ShelvesHub tab.
CONFIG_JSON="$INSTALL_DIR/shelveshub.config.json"
PREFS_JSON="$SETTINGS_DIR/shelveshub.json"
ask() {
  local v="$1" q="$2" d="$3" reply
  case "$v" in 1|y|Y|yes|true|on) echo 1; return;; 0|n|N|no|false|off) echo 0; return;; esac
  if [[ -t 0 ]]; then
    local hint="[y/N]"; [[ "$d" == y ]] && hint="[Y/n]"
    read -r -p "  $q $hint " reply </dev/tty || reply=""
    reply="${reply:-$d}"; [[ "$reply" =~ ^[Yy] ]] && echo 1 || echo 0
  else
    [[ "$d" == y ]] && echo 1 || echo 0
  fi
}
b() { [[ "$1" == 1 ]] && echo true || echo false; }
# Re-install: options are set on the FIRST install and never silently reconfigured
# (an upgrade must not clobber your choices). Say so, so a re-run doesn't look idle.
if [[ "$CONFIG_WAS_FRESH" != 1 && -f "$PREFS_JSON" ]]; then
  echo "[i] Existing setup kept — ShelvesHub is already configured on this device."
  echo "    Change any option anytime in the ShelvesHub tab (Quick Access Menu)."
fi
if [[ "$CONFIG_WAS_FRESH" == 1 ]]; then
  [[ -t 0 ]] && { echo ""; echo "── Optional setup (press Enter for the default) ──"; }
  FORCE=$(ask "${SHELVES_FORCE_OWNER:-}" "Host Deck Shelves even if a plugin loader is present (cooperative)?" n)
  NQAM=$(ask  "${SHELVES_NATIVE_QAM:-}"  "Add ShelvesHub's own Quick Access tab?" y)
  DESK=$(ask  "${SHELVES_DESKTOP_UI:-}"  "Also inject into the plain desktop client (experimental)?" n)
  [[ "$FORCE" == 1 ]] && sed -i 's/"force_owner": false/"force_owner": true/' "$CONFIG_JSON"
  [[ "$NQAM"  == 0 ]] && sed -i 's/"native_qam": true/"native_qam": false/'   "$CONFIG_JSON"
  [[ "$DESK"  == 1 ]] && sed -i 's/"desktop_ui": false/"desktop_ui": true/'   "$CONFIG_JSON"
fi
if [[ ! -f "$PREFS_JSON" ]]; then
  AUTO=$(ask "${SHELVES_AUTO_UPDATE:-}" "Enable automatic updates?" y)
  if [[ "$AUTO" == 1 ]]; then
    AHUB=$(ask  "${SHELVES_AUTO_UPDATE_HUB:-}"    "  Auto-update ShelvesHub itself?" y)
    APLUG=$(ask "${SHELVES_AUTO_UPDATE_PLUGIN:-}" "  Auto-update Deck Shelves?" y)
    HPRE=$(ask  "${SHELVES_HUB_PRERELEASE:-}"     "  Include ShelvesHub pre-releases?" n)
    PPRE=$(ask  "${SHELVES_PLUGIN_PRERELEASE:-}"  "  Include Deck Shelves pre-releases?" n)
  else
    AHUB=1; APLUG=1; HPRE=0; PPRE=0
  fi
  mkdir -p "$SETTINGS_DIR"
  cat > "$PREFS_JSON" <<EOF
{
  "auto_update": $(b "$AUTO"),
  "auto_update_hub": $(b "$AHUB"),
  "auto_update_plugin": $(b "$APLUG"),
  "hub_prerelease": $(b "$HPRE"),
  "plugin_prerelease": $(b "$PPRE")
}
EOF
fi
# Optional data-backend payload: auto-detected by the service at <install>/backend.
[[ -d backend ]] && mkdir -p "$INSTALL_DIR/backend" && cp -r backend/. "$INSTALL_DIR/backend/"
# Boot-animation source cuts — read from <install>/assets/boot by the boot_movie toggle.
[[ -d assets ]] && mkdir -p "$INSTALL_DIR/assets" && cp -r assets/. "$INSTALL_DIR/assets/"
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
