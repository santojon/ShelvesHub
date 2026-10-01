#!/bin/bash
# One-click installer for SteamOS / Steam Deck
# Usage: bash <(curl -sL https://github.com/santojon/ShelvesHub/releases/latest/download/install-steamos.sh)
set -e

# Per-user by design: refuse root so we never create a root-owned install that
# can't reach your Steam. (Migration below still uses sudo where it must.)
# Override only for a deliberate system image: SHELVES_ALLOW_ROOT=1.
if [[ "${EUID:-$(id -u)}" -eq 0 && "${SHELVES_ALLOW_ROOT:-}" != "1" ]]; then
  echo "[!] Don't run this as root/sudo. ShelvesHub installs per-user"
  echo "    (~/.local/share/shelveshub) and runs as you so it can reach your Steam."
  echo "    Re-run it as your normal user (the 'deck' user), without sudo."
  exit 1
fi

REPO="santojon/ShelvesHub"
INSTALL_DIR="$HOME/.local/share/shelveshub"

# Capture the whole run to a log next to the install, so a failure is diagnosable
# even when the terminal window closes instantly (e.g. launched from Game Mode /
# without an interactive shell — common on console-first devices). Fail-soft: if
# the tee redirect can't be set up, keep going with plain output.
LOGFILE="$INSTALL_DIR/install.log"
if mkdir -p "$INSTALL_DIR" 2>/dev/null && exec > >(tee "$LOGFILE") 2>&1; then
  echo "[i] Full log: $LOGFILE"
fi
# On any early exit, say so clearly and point at the log (the terminal may have
# already vanished, but the file remains). The download branch re-arms this to
# also clean its temp dir.
trap 'rc=$?; [[ $rc -ne 0 ]] && { echo; echo "[!] Install failed (exit $rc). Full log: $LOGFILE"; }' EXIT
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

# ── Migrate any older ROOT/system install to the current per-user standard ──────
# Removes an old system unit + /opt and drops root. Your Deck Shelves settings live
# in a separate dir, so this never loses data — and old root-owned settings are
# rescued to yours only when yours don't exist yet (never overwrites what you have).
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

# ── Resolve download URL ───────────────────────────────────────────────────────
if [[ -f "$BINARY" ]]; then
  # Running from an already-extracted package — skip download
  echo "[i] Binary found locally, skipping download."
  EXTRACTED_DIR="."
else
  echo "[i] Fetching latest release from GitHub..."
  API_URL="https://api.github.com/repos/$REPO/releases/latest"
  API_JSON=$(curl -sL "$API_URL")
  DOWNLOAD_URL=$(echo "$API_JSON" | grep '"browser_download_url"' | grep "$PACKAGE" | cut -d'"' -f4)
  SUMS_URL=$(echo "$API_JSON" | grep '"browser_download_url"' | grep 'SHA256SUMS"' | cut -d'"' -f4)

  if [[ -z "$DOWNLOAD_URL" ]]; then
    echo "[!] Could not find $PACKAGE in the latest release."
    echo "    Download manually from: https://github.com/$REPO/releases/latest"
    exit 1
  fi

  TMPDIR=$(mktemp -d)
  trap 'rc=$?; rm -rf "$TMPDIR"; [[ $rc -ne 0 ]] && { echo; echo "[!] Install failed (exit $rc). Full log: $LOGFILE"; }' EXIT

  echo "[i] Downloading $PACKAGE..."
  curl -sL "$DOWNLOAD_URL" -o "$TMPDIR/$PACKAGE"

  # Integrity: verify the download against the release's SHA256SUMS when present.
  if [[ -n "$SUMS_URL" ]]; then
    curl -sL "$SUMS_URL" -o "$TMPDIR/SHA256SUMS"
    EXPECTED=$(grep " $PACKAGE\$" "$TMPDIR/SHA256SUMS" | awk '{print $1}')
    ACTUAL=$(sha256sum "$TMPDIR/$PACKAGE" | awk '{print $1}')
    if [[ -n "$EXPECTED" && "$EXPECTED" != "$ACTUAL" ]]; then
      echo "[!] Checksum mismatch for $PACKAGE — aborting (expected $EXPECTED, got $ACTUAL)."
      exit 1
    fi
    [[ -n "$EXPECTED" ]] && echo "[i] Checksum verified."
  fi

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
CONFIG_WAS_FRESH=0
if [[ -f "$EXTRACTED_DIR/shelveshub.config.json" && ! -f "$INSTALL_DIR/shelveshub.config.json" ]]; then
  cp "$EXTRACTED_DIR/shelveshub.config.json" "$INSTALL_DIR/"
  CONFIG_WAS_FRESH=1
fi

# ── Optional setup choices ─────────────────────────────────────────────────────
# Read from the environment (works with `curl | bash`) and, on an interactive
# terminal, ask. Applied only on a FIRST install (never reconfigure existing
# choices); everything here stays editable later in the ShelvesHub tab.
SETTINGS_DIR="${SHELVES_SETTINGS_DIR:-${XDG_DATA_HOME:-$HOME/.local/share}/deck-shelves}"
CONFIG_JSON="$INSTALL_DIR/shelveshub.config.json"
PREFS_JSON="$SETTINGS_DIR/shelveshub.json"

# ask ENVVAL "Question" DEFAULT(y|n) → prints 1/0. Env wins; else prompt on a TTY;
# else the default. Accepts 1/y/yes/true/on and 0/n/no/false/off.
ask() {
  local v="$1" q="$2" d="$3" reply
  case "$v" in 1|y|Y|yes|true|on) echo 1; return;; 0|n|N|no|false|off) echo 0; return;; esac
  if [[ -t 0 ]]; then
    local hint="[y/N]"; [[ "$d" == y ]] && hint="[Y/n]"
    read -r -p "  $q $hint " reply </dev/tty || reply=""
    reply="${reply:-$d}"
    [[ "$reply" =~ ^[Yy] ]] && echo 1 || echo 0
  else
    [[ "$d" == y ]] && echo 1 || echo 0
  fi
}
b() { [[ "$1" == 1 ]] && echo true || echo false; }

if [[ "$CONFIG_WAS_FRESH" == 1 ]]; then
  [[ -t 0 ]] && { echo ""; echo "── Optional setup (press Enter for the default) ──"; }
  FORCE=$(ask "${SHELVES_FORCE_OWNER:-}" "Host Deck Shelves even if a plugin loader is present (cooperative)?" n)
  NQAM=$(ask  "${SHELVES_NATIVE_QAM:-}"  "Add ShelvesHub's own Quick Access tab?" y)
  DESK=$(ask  "${SHELVES_DESKTOP_UI:-}"  "Also inject into the plain desktop client (experimental)?" n)
  [[ "$FORCE" == 1 ]] && sed -i 's/"force_owner": false/"force_owner": true/' "$CONFIG_JSON"
  [[ "$NQAM"  == 0 ]] && sed -i 's/"native_qam": true/"native_qam": false/'   "$CONFIG_JSON"
  [[ "$DESK"  == 1 ]] && sed -i 's/"desktop_ui": false/"desktop_ui": true/'   "$CONFIG_JSON"
fi

# Update preferences → seed the hub's shelveshub.json only if absent.
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
