#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "$0")/.." && pwd)"

node_supports_knip() {
  local node_bin="$1"
  [ -x "$node_bin" ] || return 1
  local version
  version="$("$node_bin" --version 2>/dev/null)" || return 1
  local major minor
  major="${version#v}"
  major="${major%%.*}"
  minor="${version#v*.}"
  minor="${minor%%.*}"
  case "$major" in
    "" | *[!0-9]* | 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14 | 15 | 16 | 17 | 18 | 19 | 20 | 21)
      return 1
      ;;
  esac
  if [ "$major" -gt 22 ]; then
    return 0
  fi
  [ "$major" -eq 22 ] && [ "$minor" -ge 12 ]
}

resolve_knip_node() {
  local path_node
  if command -v node >/dev/null 2>&1; then
    path_node="$(command -v node)"
    if node_supports_knip "$path_node"; then
      echo "$path_node"
      return 0
    fi
  fi
  local candidate best=""
  for candidate in "$HOME"/.nvm/versions/node/v*/bin/node; do
    [ -x "$candidate" ] || continue
    if node_supports_knip "$candidate"; then
      best="$candidate"
    fi
  done
  if [ -n "$best" ]; then
    echo "$best"
    return 0
  fi
  return 1
}

knip_node="$(resolve_knip_node || true)"
if [ -z "$knip_node" ]; then
  echo "error: knip requires Node >= 22.12 (require(esm) support). Update the Node on PATH or install a newer Node via nvm." >&2
  exit 1
fi

exec "$knip_node" "$repo_root/node_modules/knip/dist/cli.js" "$@"
