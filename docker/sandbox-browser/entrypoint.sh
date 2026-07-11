#!/usr/bin/env bash
set -euo pipefail

DISPLAY="${DISPLAY:-:99}"
SCREEN_GEOMETRY="${SCREEN_GEOMETRY:-1280x800x24}"
CDP_PORT="${CDP_PORT:-9222}"
VNC_PORT="${VNC_PORT:-5900}"
NOVNC_PORT="${NOVNC_PORT:-6080}"
CHROMIUM_CDP_PORT="${CHROMIUM_CDP_PORT:-9223}"
export DISPLAY

cleanup() {
  pkill -P $$ 2>/dev/null || true
}
trap cleanup EXIT INT TERM

Xvfb "$DISPLAY" -screen 0 "$SCREEN_GEOMETRY" -nolisten tcp &
for _ in $(seq 1 50); do
  if xdpyinfo -display "$DISPLAY" >/dev/null 2>&1; then break; fi
  sleep 0.1
done

fluxbox >/dev/null 2>&1 &

x11vnc -display "$DISPLAY" -rfbport "$VNC_PORT" -forever -shared -nopw -quiet -bg
websockify --web=/usr/share/novnc "$NOVNC_PORT" "localhost:${VNC_PORT}" >/dev/null 2>&1 &
socat "TCP-LISTEN:${CDP_PORT},fork,reuseaddr,bind=0.0.0.0" "TCP:127.0.0.1:${CHROMIUM_CDP_PORT}" &

exec chromium \
  --no-first-run \
  --no-default-browser-check \
  --disable-gpu \
  --no-sandbox \
  --disable-dev-shm-usage \
  --remote-debugging-address=127.0.0.1 \
  --remote-debugging-port="$CHROMIUM_CDP_PORT" \
  --user-data-dir=/tmp/chrome-profile \
  --window-size=1280,800 \
  "about:blank"
