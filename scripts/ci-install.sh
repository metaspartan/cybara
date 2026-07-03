#!/usr/bin/env bash
# Resilient `bun install` for CI.
#
# GitHub-hosted runners start with a cold package cache, so every job
# re-downloads tarballs. Occasionally a tarball arrives corrupted and bun aborts
# with "IntegrityCheckFailed" even though the lockfile hash matches the registry.
# Retry with a cache purge between attempts to ride out these transient failures.
#
# Usage: bash scripts/ci-install.sh [bun install args...]
#   run from the directory whose dependencies should be installed.
set -uo pipefail

attempts="${CI_INSTALL_ATTEMPTS:-3}"
for i in $(seq 1 "$attempts"); do
  if bun install "$@"; then
    exit 0
  fi

  if [ "$i" -ge "$attempts" ]; then
    break
  fi

  echo "::warning::bun install failed (attempt ${i}/${attempts}); removing partial install state, clearing cache, and retrying"
  if [ -d node_modules ]; then
    rm -rf node_modules
  fi
  bun pm cache rm || true
  sleep $((i * 5))
done

echo "::error::bun install failed after ${attempts} attempts"
exit 1
