#!/bin/bash
set -euo pipefail

BINARY="${1:?Standalone CLI binary path is required}"
chmod +x "$BINARY"
export HOME="${CYBARA_SMOKE_HOME:-${RUNNER_TEMP:-/tmp}/cybara-standalone-smoke-home}"
mkdir -p "$HOME"

"$BINARY" version
"$BINARY" start -d

ready=0
for attempt in {1..15}; do
  if "$BINARY" status; then
    ready=1
    break
  fi
  sleep 2
done

if [ "$ready" -ne 1 ]; then
  "$BINARY" daemon-logs || true
  "$BINARY" stop || true
  exit 1
fi

"$BINARY" stop
