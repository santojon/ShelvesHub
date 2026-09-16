# Cross-platform simulation harness for ShelvesHub.
#
# Runs the daemon and its runtime against a headless Chromium inside a clean
# Linux image — so the Linux build, the CDP injection loop and the runtime's
# behaviour are all validated without a Steam Deck. The image only carries the
# toolchain + a browser; the repo is mounted (or copied) and built at run time,
# and a cargo cache volume keeps rebuilds fast.
#
# Build for the host architecture:
#   docker build -f docker/Dockerfile -t shelveshub-harness .
# Multi-arch (x86_64 + arm64) needs buildx/QEMU:
#   docker buildx build --platform linux/amd64,linux/arm64 -f docker/Dockerfile .
#
# The default base is Debian-based (glibc). Override BASE_IMAGE to test another
# distro's glibc / service-manager assumptions, e.g. a different Debian/Ubuntu tag.
ARG BASE_IMAGE=rust:1-slim-bookworm
FROM ${BASE_IMAGE}

# Chromium (the headless browser the harness drives), python3 (the static file
# server the runtime harness serves the mock over), and curl/ca-certificates
# (React fetch + DevTools probing).
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      chromium python3 curl ca-certificates \
 && rm -rf /var/lib/apt/lists/*

# The harness resolves the browser via $BROWSER; Chromium as root needs the
# sandbox opt-outs (see HARNESS_NO_SANDBOX in the harness scripts).
ENV BROWSER=/usr/bin/chromium \
    HEADLESS=1 \
    HARNESS_NO_SANDBOX=1 \
    CARGO_TERM_COLOR=never

WORKDIR /work
COPY docker/entrypoint.sh /usr/local/bin/harness-entrypoint.sh
RUN chmod +x /usr/local/bin/harness-entrypoint.sh

# The repo is expected at /work (mounted for local runs, or `COPY . /work` in a
# self-contained CI build). Cargo output goes to /work/target on the cache volume.
ENTRYPOINT ["/usr/local/bin/harness-entrypoint.sh"]
