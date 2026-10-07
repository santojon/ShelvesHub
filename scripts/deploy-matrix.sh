#!/usr/bin/env bash
#
# Parametric deploy dispatcher: ONE platform, hub-only or hub+plugin, soft or
# hard. Driven entirely by env from the pnpm matrix (see package.json
# "deploy:<plat>[:plugin][:hard]"). The hub orchestrates; the plugin repo's own
# deploy scripts are called UNCHANGED (never edited from here).
#
#   MX_PLAT    deck | mac | windows | linux | arm      (required)
#   MX_PLUGIN  0 | 1   include the plugin, not just the hub      (default 0)
#   MX_HARD    0 | 1   restart Steam after the push (hard deploy) (default 0)
#
# Targets and the plugin-repo path come from .env (see .env.example):
#   SHELVES_PLUGIN_DIR          path to the Deck-Shelves checkout (default ../Deck-Shelves)
#   <PLAT>_HOST/_USER/_SSH_KEY/_PATH   SSH target for linux/arm (and windows)
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

PLAT="${MX_PLAT:?internal error: MX_PLAT unset}"
PLUGIN="${MX_PLUGIN:-0}"
HARD="${MX_HARD:-0}"
HSFX=""; [[ "$HARD" == 1 ]] && HSFX="-hard"       # hub script suffix
PSFX=""; [[ "$HARD" == 1 ]] && PSFX=":hard"       # plugin pnpm-script suffix

if [[ -f .env ]]; then set -o allexport; # shellcheck disable=SC1091
  source .env; set +o allexport; fi
PLUGIN_DIR="${SHELVES_PLUGIN_DIR:-$ROOT/../Deck-Shelves}"
PLUGIN_DIR="${PLUGIN_DIR/#\~/$HOME}"

tag="deploy:$PLAT"; [[ "$PLUGIN" == 1 ]] && tag="$tag:plugin"; [[ "$HARD" == 1 ]] && tag="$tag:hard"
say(){ echo "[$tag] $*"; }

need_plugin_dir(){ [[ -d "$PLUGIN_DIR" ]] || { echo "error: plugin repo not found at $PLUGIN_DIR — set SHELVES_PLUGIN_DIR in .env"; exit 1; }; }
# Builds the plugin sole-host IIFE; prints ONLY its path on stdout (progress to
# stderr) so callers can capture it with $(build_iife).
build_iife(){ need_plugin_dir; say "building plugin sole-host bundle…" >&2; ( cd "$PLUGIN_DIR" && pnpm run build:release ) >&2; echo "$PLUGIN_DIR/dist/index.iife.js"; }

# Indirect env lookup that stays safe under `set -u` on bash 3.2.
envof(){ eval "printf '%s' \"\${$1:-}\""; }

# ── Generic SSH deploy for a sole host (linux/arm). Mirrors deck-deploy.sh's
#    core (build for arch → rsync binary+runtime+bundle → user service → restart)
#    without the SteamOS-only steam-launcher bounce. Untested until a real target
#    exists; it activates only when <PFX>_HOST is set in .env. ──────────────────
remote_deploy(){
  local pfx="$1" target="$2" arch_env="$3"
  local host user key path
  host="$(envof "${pfx}_HOST")"; user="$(envof "${pfx}_USER")"
  key="$(envof "${pfx}_SSH_KEY")"; path="$(envof "${pfx}_PATH")"
  [[ -n "$host" && -n "$user" ]] || { echo "error: $PLAT target not configured — set ${pfx}_HOST and ${pfx}_USER in .env"; exit 2; }
  key="${key:-$HOME/.ssh/id_rsa}"; key="${key/#\~/$HOME}"
  path="${path:-/home/$user/.local/share/shelveshub}"
  local rsh="ssh -o StrictHostKeyChecking=accept-new"; local ssh=(ssh -o StrictHostKeyChecking=accept-new)
  if [[ -f "$key" ]]; then rsh="$rsh -i $key"; ssh+=(-i "$key"); fi
  ssh+=("$user@$host")

  say "building $target…"
  if [[ -n "$arch_env" ]]; then SHELVES_ARCH="$arch_env" bash "$ROOT/scripts/deck-build.sh"; else bash "$ROOT/scripts/deck-build.sh"; fi
  local bin="target/$target/release/shelveshub"
  [[ -f "$bin" ]] || { echo "error: $bin missing after build"; exit 1; }

  say "deploying to $user@$host:$path …"
  "${ssh[@]}" "mkdir -p '$path/bundle' '$path/runtime/backend' '$path/assets/boot' '/home/$user/.config/systemd/user'"
  rsync -az -e "$rsh" "$bin" "$user@$host:$path/shelveshub"
  rsync -az -e "$rsh" runtime/shelves-host*.js "$user@$host:$path/runtime/"
  rsync -az -e "$rsh" runtime/i18n/ "$user@$host:$path/runtime/i18n/"
  rsync -az -e "$rsh" runtime/backend/ "$user@$host:$path/runtime/backend/"
  rsync -az --ignore-existing -e "$rsh" shelveshub.config.json "$user@$host:$path/shelveshub.config.json"
  if [[ "$PLUGIN" == 1 ]]; then local iife; iife="$(build_iife)"; say "plugin bundle → $path/bundle/index.js"; rsync -az -e "$rsh" "$iife" "$user@$host:$path/bundle/index.js"; fi

  "${ssh[@]}" bash -s <<REMOTE
set -e
export XDG_RUNTIME_DIR="/run/user/\$(id -u)"
export DBUS_SESSION_BUS_ADDRESS="unix:path=\${XDG_RUNTIME_DIR}/bus"
mkdir -p "\$HOME/.steam/steam"; touch "\$HOME/.steam/steam/.cef-enable-remote-debugging" 2>/dev/null || true
cat > "\$HOME/.config/systemd/user/shelveshub.service" <<UNIT
[Unit]
Description=ShelvesHub Service
After=network-online.target
[Service]
ExecStart=$path/shelveshub
Restart=always
RestartSec=10
WorkingDirectory=$path
[Install]
WantedBy=default.target
UNIT
chmod +x "$path/shelveshub" 2>/dev/null || true
systemctl --user daemon-reload
systemctl --user enable --now shelveshub.service
systemctl --user restart shelveshub.service
REMOTE
  if [[ "$HARD" == 1 ]]; then say "restarting Steam on $host…"; "${ssh[@]}" "systemctl --user restart steam-launcher.service 2>/dev/null || (killall steam 2>/dev/null; true)"; fi
  say "done."
}

case "$PLAT" in
  deck)
    if [[ "$PLUGIN" == 1 ]]; then need_plugin_dir; say "plugin → loader on the Deck"; ( cd "$PLUGIN_DIR" && pnpm run "deploy:deck$PSFX" ); fi
    say "hub → Deck"; bash "scripts/deck-deploy$HSFX.sh"
    ;;
  mac)
    if [[ "$PLUGIN" == 1 ]]; then local_iife="$(build_iife)"; say "plugin bundle → hub install"; mkdir -p "$HOME/.local/share/shelveshub/bundle"; cp "$local_iife" "$HOME/.local/share/shelveshub/bundle/index.js"; fi
    say "hub → Mac"; bash "scripts/mac-deploy$HSFX.sh"
    ;;
  linux) remote_deploy LINUX x86_64-unknown-linux-gnu "" ;;
  arm)   remote_deploy ARM   aarch64-unknown-linux-gnu aarch64 ;;
  windows)
    wh="$(envof WIN_HOST)"
    echo "error: windows deploy is not wired yet (no push transport defined; real-hardware item)."
    [[ -n "$wh" ]] && echo "       WIN_HOST is set ($wh) but a Windows push method still has to be implemented." \
                   || echo "       set WIN_HOST/WIN_USER in .env once a Windows target and method exist."
    exit 3
    ;;
  *) echo "error: unknown platform '$PLAT' (expected deck|mac|windows|linux|arm)"; exit 1 ;;
esac
