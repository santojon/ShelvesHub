#!/usr/bin/env bash
#
# Cross-compile the loader for the Steam Deck (x86_64 SteamOS) from any host.
#
# Prefers cargo-zigbuild (reliable mac/Windows -> Linux glibc cross-compile);
# falls back to a plain `cargo build` for the target if zigbuild is unavailable.
#
# The glibc version is pinned conservatively so the binary runs on stock SteamOS;
# override with DECK_GLIBC if needed.
#
# Usage:  pnpm build:deck     (or)   bash scripts/deck-build.sh
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
export PATH="$HOME/.cargo/bin:$PATH"

TARGET="x86_64-unknown-linux-gnu"
GLIBC="${DECK_GLIBC:-2.31}"

rustup target add "$TARGET" >/dev/null 2>&1 || true

if command -v cargo-zigbuild >/dev/null 2>&1; then
  echo "[i] cross-compiling with cargo-zigbuild (target $TARGET, glibc $GLIBC)..."
  cargo zigbuild --release --target "${TARGET}.${GLIBC}"
else
  echo "[!] cargo-zigbuild not found — falling back to plain cargo build."
  echo "    On macOS this usually fails to link; run 'pnpm setup' to install it."
  cargo build --release --target "$TARGET"
fi

echo "[OK] built target/$TARGET/release/shelveshub"
