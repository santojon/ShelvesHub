# Valve's native ARM64 Steam client in a container, headless, with its Chromium
# debug port exposed — the closest stand-in for an ARM64 Steam device the lab has.
# Software rendering (no GPU), a virtual X display, no gamepad: it proves the client
# boots, the debug port answers, and the daemon discovers and injects into it.
# The client itself is fetched at first start into the Steam volume, never baked in.
FROM debian:bookworm-slim

ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates curl python3 procps lsof socat pciutils xvfb xauth x11vnc dbus-x11 \
      libgl1-mesa-dri libglx-mesa0 libegl-mesa0 libgbm1 libdrm2 libxshmfence1 libvulkan1 mesa-vulkan-drivers \
      libnss3 libnspr4 libxtst6 libcups2 libasound2 libxkbcommon0 libxkbcommon-x11-0 libxcomposite1 \
      libxdamage1 libxrandr2 libxss1 libxcursor1 libxi6 libxfixes3 libxext6 libxrender1 libxinerama1 \
      libpango-1.0-0 libcairo2 libatk1.0-0 libatk-bridge2.0-0 libgtk-3-0 libibus-1.0-5 libnm0 \
      libpipewire-0.3-0 libpulse0 libdbus-1-3 libudev1 libusb-1.0-0 fonts-dejavu-core \
      libgtk2.0-0 libegl1 libgles2 libva2 libva-x11-2 libva-drm2 libvdpau1 libopenal1 libsdl2-2.0-0 \
    && rm -rf /var/lib/apt/lists/*

# The Steam root is a named volume mounted here; creating the directory owned by the
# user lets the first mount of an empty volume inherit that ownership.
RUN useradd -m -u 1000 -s /bin/bash steam \
    && mkdir -p /home/steam/.local/share/Steam \
    && chown -R steam:steam /home/steam
COPY --chmod=755 fetch-client.py entrypoint.sh /usr/local/bin/

USER steam
WORKDIR /home/steam
ENV DISPLAY=:99 LIBGL_ALWAYS_SOFTWARE=1 HOME=/home/steam
EXPOSE 8081 5900
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
