#!/usr/bin/env bash
#
# Linux / SteamOS toolchain setup for ShelvesHub.
#
# Installs the Rust toolchain (via the official rustup.rs installer), the Steam
# Deck build target, pnpm (via Corepack), and the project's JS dev deps.
# Idempotent; pass --update to also upgrade what it manages.
#
# Distro-agnostic on purpose: uses rustup.rs + Corepack instead of a package
# manager, so it behaves the same on SteamOS, Arch, Ubuntu, Fedora, etc. All
# user-level — no sudo required (matches the SteamOS read-only root model).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

UPDATE=0
[[ "${1:-}" == "--update" ]] && UPDATE=1

echo "== Rust toolchain (rustup) =="
if ! command -v rustup >/dev/null 2>&1; then
  if command -v curl >/dev/null 2>&1; then
    curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --default-toolchain stable --no-modify-path
  elif command -v wget >/dev/null 2>&1; then
    wget -qO- https://sh.rustup.rs | sh -s -- -y --default-toolchain stable --no-modify-path
  else
    echo "error: need curl or wget to install rustup"; exit 1
  fi
fi
# Make cargo/rustc available in this shell.
[ -f "$HOME/.cargo/env" ] && . "$HOME/.cargo/env"
export PATH="$HOME/.cargo/bin:$PATH"

rustup default stable
[[ "$UPDATE" == "1" ]] && rustup update || true
# Steam Deck is x86_64 Linux — native on x86_64 hosts, harmless to add otherwise.
rustup target add x86_64-unknown-linux-gnu >/dev/null 2>&1 || true
rustup component add clippy rustfmt >/dev/null 2>&1 || true

echo "== Optional cross-compile helper (cargo-zigbuild) =="
if command -v zig >/dev/null 2>&1; then
  if ! command -v cargo-zigbuild >/dev/null 2>&1; then
    cargo install cargo-zigbuild
  elif [[ "$UPDATE" == "1" ]]; then
    cargo install cargo-zigbuild --force
  fi
else
  echo "[i] zig not found — skipping cargo-zigbuild (only needed to cross-build for an older-glibc Deck from a newer host)."
fi

echo "== Node / pnpm =="
if command -v corepack >/dev/null 2>&1; then
  corepack enable >/dev/null 2>&1 || true
  corepack prepare pnpm@latest --activate >/dev/null 2>&1 || true
elif ! command -v pnpm >/dev/null 2>&1; then
  echo "[i] Corepack/pnpm not found. Install Node 20+ (bundles Corepack) or pnpm, then re-run."
fi

echo "== Project JS dev dependencies =="
if command -v pnpm >/dev/null 2>&1; then
  pnpm install
else
  echo "[i] skipped 'pnpm install' (pnpm unavailable)"
fi

echo "== .env =="
if [[ ! -f .env ]]; then
  cp .env.example .env
  echo "[+] created .env from .env.example — edit DECK_HOST / DECK_USER / DECK_SSH_KEY"
else
  echo "[=] .env already present"
fi

echo
echo "[OK] Linux toolchain ready. Next: pnpm build  |  pnpm test  |  pnpm run debug:local"
