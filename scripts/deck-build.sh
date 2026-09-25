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

# Target arch: x86_64 (Steam Deck, default) or aarch64 (ARM64 devices). Set with
# SHELVES_ARCH=aarch64 (or `pnpm build:arm64`).
ARCH="${SHELVES_ARCH:-x86_64}"
case "$ARCH" in
  x86_64)         TARGET="x86_64-unknown-linux-gnu" ;;
  aarch64|arm64)  TARGET="aarch64-unknown-linux-gnu" ;;
  *) echo "error: unsupported SHELVES_ARCH: $ARCH (use x86_64 or aarch64)" >&2; exit 1 ;;
esac
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
