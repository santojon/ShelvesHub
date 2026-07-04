#!/usr/bin/env bash
#
# macOS toolchain setup for Shelves Loader, via Homebrew.
#
# Installs everything needed to build, run, debug and cross-compile the loader
# for a Steam Deck from a Mac. Idempotent: safe to re-run. Pass --update to also
# upgrade everything it manages.
#
# Usage (via pnpm):
#   pnpm setup      # install / repair the toolchain
#   pnpm update     # update the toolchain + project deps
#
# Installed: rustup (+ Linux target), zig + cargo-zigbuild (reliable mac->Deck
# cross-compile), the Chromium browser (local debug harness), and the project's
# JS dev deps via pnpm. Set SKIP_CHROMIUM=1 to skip the browser cask.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

UPDATE=0
[[ "${1:-}" == "--update" ]] && UPDATE=1

command -v brew >/dev/null || {
  echo "error: Homebrew is required. Install it from https://brew.sh and re-run."
  exit 1
}

# Install a formula if missing; upgrade it in --update mode.
brew_ensure() {
  local formula="$1"
  if brew list --formula "$formula" >/dev/null 2>&1; then
    echo "[=] $formula already installed"
    [[ "$UPDATE" == "1" ]] && brew upgrade "$formula" >/dev/null 2>&1 || true
  else
    echo "[+] installing $formula"
    brew install "$formula"
  fi
}

cask_ensure() {
  local cask="$1"
  if brew list --cask "$cask" >/dev/null 2>&1; then
    echo "[=] $cask already installed"
    [[ "$UPDATE" == "1" ]] && brew upgrade --cask "$cask" >/dev/null 2>&1 || true
  else
    echo "[+] installing $cask (cask)"
    brew install --cask "$cask"
  fi
}

echo "== Rust toolchain (rustup) =="
# Homebrew's `rustup` formula is keg-only and ships only the `rustup` binary
# (no `rustup-init`); toolchain proxies (cargo/rustc) live in ~/.cargo/bin.
if ! brew list --formula rustup >/dev/null 2>&1; then
  echo "[+] installing rustup via Homebrew"
  brew install rustup
fi
export PATH="$(brew --prefix rustup)/bin:$HOME/.cargo/bin:$PATH"
echo "[i] activating the stable toolchain"
rustup default stable
[[ "$UPDATE" == "1" ]] && rustup update || true
echo "[i] adding Steam Deck (x86_64 Linux) target"
rustup target add x86_64-unknown-linux-gnu >/dev/null 2>&1 || true

# Homebrew's rustup is keg-only: cargo/rustc proxies live in its (un-symlinked)
# bin dir. Persist it on PATH so `pnpm build` etc. work in a fresh shell.
RUSTUP_BIN="$(brew --prefix rustup)/bin"
ZSHRC="$HOME/.zshrc"
if ! grep -q "shelves-loader (rust toolchain)" "$ZSHRC" 2>/dev/null; then
  echo "[+] adding rust toolchain to PATH in $ZSHRC"
  {
    echo ""
    echo "# shelves-loader (rust toolchain) — Homebrew keg-only rustup"
    echo "export PATH=\"$RUSTUP_BIN:\$PATH\""
  } >> "$ZSHRC"
else
  echo "[=] rust toolchain already on PATH in $ZSHRC"
fi

echo "== Cross-compiler (zig + cargo-zigbuild) =="
brew_ensure zig
if ! command -v cargo-zigbuild >/dev/null 2>&1; then
  echo "[+] installing cargo-zigbuild"
  cargo install cargo-zigbuild
elif [[ "$UPDATE" == "1" ]]; then
  echo "[^] updating cargo-zigbuild"
  cargo install cargo-zigbuild --force
else
  echo "[=] cargo-zigbuild already installed"
fi

echo "== Browser for the local debug harness =="
if [[ "${SKIP_CHROMIUM:-0}" == "1" ]]; then
  echo "[i] SKIP_CHROMIUM=1 — skipping browser install"
else
  # Note: the `chromium` cask is deprecated (fails Gatekeeper) and will be
  # disabled in late 2026. It still works once de-quarantined. For a long-term
  # browser, install Google Chrome instead: `brew install --cask google-chrome`
  # (local-debug.sh auto-detects it).
  cask_ensure chromium
  if [[ -d /Applications/Chromium.app ]]; then
    echo "[i] clearing Gatekeeper quarantine on Chromium"
    xattr -dr com.apple.quarantine /Applications/Chromium.app 2>/dev/null || true
  fi
fi

echo "== Node / pnpm =="
brew_ensure pnpm

echo "== Project JS dev dependencies =="
pnpm install

echo "== .env =="
if [[ ! -f .env ]]; then
  cp .env.example .env
  echo "[+] created .env from .env.example — edit DECK_HOST / DECK_USER / DECK_SSH_KEY"
else
  echo "[=] .env already present"
fi

echo
echo "[OK] Toolchain ready. Next:"
echo "  pnpm build           # build loader + shelves-devtools"
echo "  pnpm debug:local     # run the whole stack against a local browser"
echo "  pnpm deck:deploy     # build + deploy + run on your Steam Deck"
