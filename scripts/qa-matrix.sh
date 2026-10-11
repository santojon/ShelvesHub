#!/usr/bin/env bash
#
# Cross-platform QA matrix: run the container harness per architecture (amd64 +
# arm64 under QEMU) and the native scenario harness on this machine, each writing
# structured evidence under site/reports/qa/evidence/, then assemble
# site/reports/qa/matrix.json — one cell per platform × kind with an honest
# status (tested / partial / not-run / blocked / manual). See docs/qa-lab.md.
#
# Usage:  scripts/qa-matrix.sh                    # amd64 + arm64 containers + host harness
#         QA_ARCHES="arm64" scripts/qa-matrix.sh  # one architecture
#         QA_ARCHES="" scripts/qa-matrix.sh       # host harness only (no Docker)
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
EVIDENCE="$ROOT/site/reports/qa/evidence"
mkdir -p "$EVIDENCE"
ARCHES="${QA_ARCHES-amd64 arm64}"

for arch in $ARCHES; do
  echo "[i] Container harness: linux/$arch"
  PLATFORM="linux/$arch" IMAGE="shelveshub-harness-$arch" QA_EVIDENCE=1 \
    bash "$ROOT/scripts/harness-docker.sh" \
    || echo "[!] linux/$arch harness failed — recorded in the evidence"
done

HOST_OS="$(uname -s | tr '[:upper:]' '[:lower:]')"
echo "[i] Host harness: $HOST_OS/$(uname -m)"
HARNESS_JSON="$EVIDENCE/scenarios-host-$HOST_OS-$(uname -m).json" bash "$ROOT/scripts/harness.sh" \
  || echo "[!] host harness failed — recorded in the evidence"

node "$ROOT/scripts/ci/qa-matrix.mjs"
