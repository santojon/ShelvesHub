#!/usr/bin/env bash
#
# Build every release artifact THIS machine can produce, into ./releases/
# (gitignored), mirroring the dist layout of .github/workflows/release.yml. For
# validating a release locally before tagging — not a substitute for the CI
# build (notably: the shipped Windows binary is msvc; here it is a gnu
# cross-compile, and macOS is this host's arch, not a universal binary).
#
# Needs: a Rust toolchain with the targets below, cargo-zigbuild + zig for the
# Linux/Windows cross-compiles (from `pnpm setup`), and makensis for setup.exe.
# Each target is best-effort: a missing toolchain skips that artifact.
#
# Usage:
#   scripts/build-release-local.sh
#   GLIBC=2.35 scripts/build-release-local.sh   # override the Linux glibc floor
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
export PATH="$HOME/.cargo/bin:$PATH"
OUT="releases"
GLIBC="${GLIBC:-2.31}"

rm -rf "$OUT"; mkdir -p "$OUT"

bin_build() { # bin_build <target> <zig|native>
  local t="$1" mode="$2"
  if [[ "$mode" == native ]]; then cargo build --release --quiet; return $?; fi
  cargo zigbuild --release --quiet --target "${t}.${GLIBC}" 2>/dev/null \
    || cargo zigbuild --release --quiet --target "$t"
}

assemble() { # assemble <target|native> <package> <installer_dir> <binext> <tar|zip>
  local t="$1" pkg="$2" idir="$3" ext="$4" arc="$5" bindir
  [[ "$t" == native ]] && bindir="target/release" || bindir="target/$t/release"
  [[ -f "$bindir/shelveshub$ext" ]] || { echo "  [skip] $pkg (no binary at $bindir)"; return 1; }
  local d; d="$(mktemp -d)"
  mkdir -p "$d/bundle" "$d/runtime" "$d/installer" "$d/assets/boot"
  cp "$bindir/shelveshub$ext" "$d/"
  cp "$bindir/shelves-devtools$ext" "$d/" 2>/dev/null || true
  cp shelveshub.config.json "$d/"
  cp assets/boot/deck_startup.webm assets/boot/deck_startup_1280x800.webm "$d/assets/boot/"
  cp -r bundle/. "$d/bundle/"
  cp -r runtime/. "$d/runtime/"
  cp -r "$idir/." "$d/installer/"
  if [[ "$arc" == zip ]]; then ( cd "$d" && zip -qr "$ROOT/$OUT/$pkg" . )
  else ( cd "$d" && tar -czf "$ROOT/$OUT/$pkg" . ); fi
  rm -rf "$d"; echo "  [ok]   $pkg"
}

echo "== macOS ($(uname -m)) =="
if bin_build native native; then
  assemble native shelveshub-macos.tar.gz installer/macOS "" tar
  bash scripts/build-mac-app.sh "$ROOT/$OUT" >/dev/null 2>&1 \
    && echo "  [ok]   Install ShelvesHub.app(.zip)" || echo "  [skip] mac app (iconutil required)"
fi

echo "== Linux / SteamOS x86_64 =="
if bin_build x86_64-unknown-linux-gnu zig; then
  assemble x86_64-unknown-linux-gnu shelveshub-steamos.tar.gz installer/SteamOS "" tar
  assemble x86_64-unknown-linux-gnu shelveshub-linux.tar.gz   installer/Linux   "" tar
fi

echo "== Linux / SteamOS aarch64 =="
if bin_build aarch64-unknown-linux-gnu zig; then
  assemble aarch64-unknown-linux-gnu shelveshub-steamos-aarch64.tar.gz installer/SteamOS "" tar
  assemble aarch64-unknown-linux-gnu shelveshub-linux-aarch64.tar.gz   installer/Linux   "" tar
fi

echo "== Windows x86_64 (gnu — local substitute for the msvc release) =="
if bin_build x86_64-pc-windows-gnu zig; then
  assemble x86_64-pc-windows-gnu shelveshub-windows.zip installer/Windows ".exe" zip
  if command -v makensis >/dev/null 2>&1; then
    nb="$(mktemp -d)"; mkdir -p "$nb/payload"
    cp target/x86_64-pc-windows-gnu/release/shelveshub.exe "$nb/payload/"
    cp target/x86_64-pc-windows-gnu/release/shelves-devtools.exe "$nb/payload/" 2>/dev/null || true
    cp -r bundle "$nb/payload/bundle"; cp -r runtime "$nb/payload/runtime"
    cp shelveshub.config.json "$nb/payload/"
    cp installer/Windows/register-task.ps1 installer/Windows/apply-setup.ps1 installer/Windows/migrate.ps1 "$nb/payload/"
    cp installer/Windows/shelveshub.nsi "$nb/"; cp assets/icons/icon.ico "$nb/icon.ico"
    ( cd "$nb" && makensis shelveshub.nsi >/dev/null 2>&1 && cp shelveshub-setup.exe "$ROOT/$OUT/" ) \
      && echo "  [ok]   shelveshub-setup.exe" || echo "  [skip] setup.exe (makensis failed)"
    rm -rf "$nb"
  else
    echo "  [skip] setup.exe (makensis not found)"
  fi
else
  echo "  [skip] Windows (cross-compile failed — the msvc release needs a Windows runner)"
fi

echo "== one-click installers =="
cp installer/SteamOS/shelveshub.desktop  "$OUT/shelveshub.desktop"
cp installer/Linux/shelveshub.desktop    "$OUT/shelveshub-linux.desktop"
cp installer/macOS/install-mac.command   "$OUT/install-mac.command"   2>/dev/null || true
cp installer/Windows/install-windows.bat "$OUT/install-windows.bat"   2>/dev/null || true
echo "  [ok]   launchers copied"

echo "== SHA256SUMS =="
( cd "$OUT" && shasum -a 256 $(ls *.tar.gz *.zip *.exe 2>/dev/null) > SHA256SUMS && echo "  [ok]   SHA256SUMS" )

echo "== done — artifacts in ./$OUT =="
ls -la "$OUT"
