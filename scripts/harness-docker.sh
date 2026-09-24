#!/usr/bin/env bash
#
# Build the ShelvesHub simulation image and run the in-container harness (the
# runtime scenarios + the daemon-injection smoke) against a headless Chromium on
# Linux — cross-platform validation without a Steam Deck.
#
# Usage:
#   scripts/harness-docker.sh                 # host architecture
#   PLATFORM=linux/arm64 scripts/harness-docker.sh   # emulated arm64 (needs QEMU/buildx)
#   BASE_IMAGE=rust:1-slim-bookworm scripts/harness-docker.sh  # pin/override the base
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
IMAGE="${IMAGE:-shelveshub-harness}"
PLATFORM="${PLATFORM:-}"
BASE_IMAGE="${BASE_IMAGE:-rust:1-slim-bookworm}"

command -v docker >/dev/null || { echo "error: docker is required"; exit 1; }
docker info >/dev/null 2>&1 || { echo "error: the Docker daemon is not running"; exit 1; }

PLATFORM_ARGS=()
[[ -n "$PLATFORM" ]] && PLATFORM_ARGS=(--platform "$PLATFORM")

echo "[i] Building $IMAGE (base=$BASE_IMAGE${PLATFORM:+, platform=$PLATFORM})…"
docker build ${PLATFORM_ARGS[@]+"${PLATFORM_ARGS[@]}"} \
  --build-arg "BASE_IMAGE=$BASE_IMAGE" \
  -f "$ROOT/docker/Dockerfile" -t "$IMAGE" "$ROOT"

# Mount the repo read-only at a work copy and keep target/ + cargo caches on named
# volumes so rebuilds across runs are fast. The repo is mounted at /work; cargo
# output and the git-fetched React vendor land on the cache volumes.
# Optionally mount a Deck Shelves checkout so the harness can exercise the plugin's
# cross-OS backend probes UNDER the host on this container's OS/arch. Looked up via
# DECK_SHELVES_ROOT, else a sibling ../Deck-Shelves; absent → that step skips.
PLUGIN_ARGS=()
DS_ROOT="${DECK_SHELVES_ROOT:-$ROOT/../Deck-Shelves}"
if [[ -d "$DS_ROOT/src/backend" ]]; then
  DS_ROOT="$(cd "$DS_ROOT" && pwd)"
  echo "[i] Mounting Deck Shelves backend from $DS_ROOT (plugin-under-host probes enabled)."
  PLUGIN_ARGS=(-v "$DS_ROOT":/deck-shelves:ro -e DECK_SHELVES_ROOT=/deck-shelves)
else
  echo "[i] No Deck Shelves checkout ($DS_ROOT) — plugin-under-host probes will skip."
fi

echo "[i] Running the harness in a container…"
docker run --rm ${PLATFORM_ARGS[@]+"${PLATFORM_ARGS[@]}"} \
  -v "$ROOT":/work \
  -v shelveshub-harness-target:/work/target \
  -v shelveshub-harness-cargo:/usr/local/cargo/registry \
  ${PLUGIN_ARGS[@]+"${PLUGIN_ARGS[@]}"} \
  "$IMAGE"
