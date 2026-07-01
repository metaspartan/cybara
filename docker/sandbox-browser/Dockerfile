FROM debian:bookworm-slim

ENV DEBIAN_FRONTEND=noninteractive \
    DISPLAY=:99 \
    SCREEN_GEOMETRY=1280x800x24 \
    CDP_PORT=9222 \
    VNC_PORT=5900 \
    NOVNC_PORT=6080

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    chromium \
    fonts-liberation \
    fluxbox \
    novnc \
    websockify \
    x11vnc \
    xvfb \
    ca-certificates \
    dumb-init \
  && rm -rf /var/lib/apt/lists/*

COPY entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

# CDP (Chrome DevTools Protocol) and noVNC (browser-viewable desktop).
EXPOSE 9222 6080

ENTRYPOINT ["/usr/bin/dumb-init", "--"]
CMD ["/usr/local/bin/entrypoint.sh"]
