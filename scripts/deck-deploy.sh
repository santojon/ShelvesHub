#!/usr/bin/env bash
#
# Build, deploy and run ShelvesHub directly on a Steam Deck over SSH.
#
# Reads connection settings from .env (see .env.example). Builds the loader for
# SteamOS (x86_64 Linux), syncs the binary + bundle to the Deck, enables Steam's
# CEF remote-debugging, installs the user systemd service, and restarts it.
#
# Usage:
#   scripts/deck-deploy.sh              # build + deploy + (re)start service
#   scripts/deck-deploy.sh --no-build   # deploy a previously-built binary
#   BUNDLE=examples/bundle/shelves-example.js scripts/deck-deploy.sh
#
# Prereqs are installed by `pnpm setup` (rustup + Linux target, zig +
# cargo-zigbuild for cross-compiling, rsync/ssh ship with macOS).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

# ── Load .env ───────────────────────────────────────────────────────────────
[[ -f .env ]] || { echo "error: .env not found (copy .env.example)"; exit 1; }
set -o allexport; # shellcheck disable=SC1091
source .env; set +o allexport

: "${DECK_HOST:?set DECK_HOST in .env}"
: "${DECK_USER:?set DECK_USER in .env}"
DECK_SSH_KEY="${DECK_SSH_KEY:-$HOME/.ssh/id_rsa}"
DECK_SSH_KEY="${DECK_SSH_KEY/#\~/$HOME}" # expand leading ~
REMOTE_HOME_DIR="${DECK_DEPLOY_PATH:-/home/$DECK_USER/.local/share/shelveshub}"
TARGET="x86_64-unknown-linux-gnu"
BUNDLE="${BUNDLE:-bundle/index.js}"
# Use the key file only if it exists; otherwise rely on the ssh agent / defaults.
# (Built incrementally to stay safe under `set -u` on macOS's bash 3.2.)
SSH=(ssh -o StrictHostKeyChecking=accept-new)
RSH="ssh -o StrictHostKeyChecking=accept-new"
if [[ -f "$DECK_SSH_KEY" ]]; then
  SSH+=(-i "$DECK_SSH_KEY")
  RSH="$RSH -i $DECK_SSH_KEY"
fi
SSH+=("$DECK_USER@$DECK_HOST")

# ── Build ───────────────────────────────────────────────────────────────────
if [[ "${1:-}" != "--no-build" ]]; then
  bash "$ROOT/scripts/deck-build.sh"
fi
BIN="target/$TARGET/release/shelveshub"
[[ -f "$BIN" ]] || { echo "error: $BIN missing (build first, or drop --no-build)"; exit 1; }

# ── Deploy binary + host runtime + bundle ───────────────────────────────────
echo "[i] Deploying to $DECK_USER@$DECK_HOST:$REMOTE_HOME_DIR ..."
"${SSH[@]}" "mkdir -p '$REMOTE_HOME_DIR/bundle' '$REMOTE_HOME_DIR/runtime/backend' '$REMOTE_HOME_DIR/assets/boot' '/home/$DECK_USER/.config/systemd/user'"
rsync -az -e "$RSH" "$BIN" "$DECK_USER@$DECK_HOST:$REMOTE_HOME_DIR/shelveshub"
rsync -az -e "$RSH" runtime/shelves-host.js "$DECK_USER@$DECK_HOST:$REMOTE_HOME_DIR/runtime/shelves-host.js"
rsync -az -e "$RSH" runtime/i18n/ "$DECK_USER@$DECK_HOST:$REMOTE_HOME_DIR/runtime/i18n/"
rsync -az -e "$RSH" runtime/backend/ "$DECK_USER@$DECK_HOST:$REMOTE_HOME_DIR/runtime/backend/"
rsync -az -e "$RSH" "$BUNDLE" "$DECK_USER@$DECK_HOST:$REMOTE_HOME_DIR/bundle/index.js"
# Optional boot-animation sources (both cuts; the daemon picks the Deck's 1280x800).
rsync -az -e "$RSH" assets/boot/deck_startup.webm assets/boot/deck_startup_1280x800.webm "$DECK_USER@$DECK_HOST:$REMOTE_HOME_DIR/assets/boot/"
# Seed the config only if absent — never overwrite a device-side edit. The hub's
# advanced-config editor writes this file and the daemon reads it as authoritative,
# so a redeploy must keep the user's values (interval, native_qam, …).
rsync -az --ignore-existing -e "$RSH" shelveshub.config.json "$DECK_USER@$DECK_HOST:$REMOTE_HOME_DIR/shelveshub.config.json"

# Generate the user service pointing at the actual deploy path (the static unit
# assumes ~/.local/share/shelveshub, which may differ from DECK_DEPLOY_PATH).
# Editable config keys (native_qam, owner_settle_secs, force_owner) come from the
# config FILE so the hub's config editor can change them persistently — env would
# override the file every boot. They are forced via env ONLY when the caller
# exports the var (a deliberate sole-mode test), never by default.
{
  echo "[Unit]"
  echo "Description=ShelvesHub Service"
  echo "After=network-online.target"
  echo ""
  echo "[Service]"
  echo "Environment=SHELVES_PRELOAD=${SHELVES_PRELOAD:-0}"
  if [[ -n "${SHELVES_NATIVE_QAM:-}" ]]; then echo "Environment=SHELVES_NATIVE_QAM=$SHELVES_NATIVE_QAM"; fi
  if [[ -n "${SHELVES_OWNER_SETTLE_SECS:-}" ]]; then echo "Environment=SHELVES_OWNER_SETTLE_SECS=$SHELVES_OWNER_SETTLE_SECS"; fi
  if [[ -n "${SHELVES_FORCE_OWNER:-}" ]]; then echo "Environment=SHELVES_FORCE_OWNER=$SHELVES_FORCE_OWNER"; fi
  echo "ExecStart=$REMOTE_HOME_DIR/shelveshub"
  echo "Restart=always"
  echo "RestartSec=10"
  echo "WorkingDirectory=$REMOTE_HOME_DIR"
  echo ""
  echo "[Install]"
  echo "WantedBy=default.target"
} | "${SSH[@]}" "cat > /home/$DECK_USER/.config/systemd/user/shelveshub.service"

# ── Enable Steam CEF remote debugging + (re)start the service ───────────────
echo "[i] Enabling CEF remote debugging and (re)starting service..."
"${SSH[@]}" "chmod +x '$REMOTE_HOME_DIR/shelveshub' 2>/dev/null || true"
"${SSH[@]}" bash -s <<'REMOTE'
set -e
# Make `systemctl --user` reachable over a non-interactive SSH session.
export XDG_RUNTIME_DIR="/run/user/$(id -u)"
export DBUS_SESSION_BUS_ADDRESS="unix:path=${XDG_RUNTIME_DIR}/bus"
# Steam exposes the CEF DevTools endpoint (port 8080) only when this file exists.
mkdir -p "$HOME/.steam/steam"
touch "$HOME/.steam/steam/.cef-enable-remote-debugging"
systemctl --user daemon-reload
systemctl --user enable --now shelveshub.service
systemctl --user restart shelveshub.service
echo "[remote] service status:"
systemctl --user --no-pager status shelveshub.service | head -n 8 || true
REMOTE

echo
echo "[OK] Deployed. Notes:"
echo "  • If you just enabled CEF debugging for the first time, fully restart Steam"
echo "    on the Deck so the :8080 DevTools endpoint comes up."
echo "  • Tail logs:   ssh $DECK_USER@$DECK_HOST 'journalctl --user -u shelveshub -f'"
echo "  • Debug from here: scripts/deck-tunnel.sh   then   shelves-devtools targets"
