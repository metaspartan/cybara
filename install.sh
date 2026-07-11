#!/usr/bin/env bash
set -euo pipefail
exec bash -c "$(curl -fsSL https://cybara.ai/install.sh)" install.sh "$@"
