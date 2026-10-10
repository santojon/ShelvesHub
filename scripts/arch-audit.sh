#!/bin/bash
# Assert an ELF binary's machine type matches the expected architecture, so an
# arm64 release never silently ships an x86-only binary (or vice versa). Uses
# `readelf` when present, else `file`. Usage: arch-audit.sh <binary> <aarch64|x86_64>
set -euo pipefail

bin="${1:?usage: arch-audit.sh <binary> <aarch64|x86_64>}"
expect="${2:?expected arch: aarch64 or x86_64}"
[[ -f "$bin" ]] || { echo "::error::arch-audit: $bin not found"; exit 1; }

if command -v readelf >/dev/null 2>&1; then
  machine=$(readelf -h "$bin" | awk -F: '/Machine:/{gsub(/^[ \t]+/,"",$2);print $2;exit}')
else
  machine=$(file -b "$bin")
fi

case "$expect" in
  aarch64) grep -qiE "aarch64|arm" <<<"$machine" || { echo "::error::arch-audit: $bin is '$machine', expected aarch64"; exit 1; } ;;
  x86_64)  grep -qiE "x86-64|x86_64|amd64|advanced micro" <<<"$machine" || { echo "::error::arch-audit: $bin is '$machine', expected x86_64"; exit 1; } ;;
  *) echo "::error::arch-audit: unknown expected arch '$expect'"; exit 1 ;;
esac

echo "arch-audit OK: $bin -> $machine ($expect)"
