#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "$0")/.." && pwd)"

node_supports_knip() {
  local node_bin="$1"
  [ -n "$node_bin" ] || return 1
  local version
  version="$("$node_bin" --version 2>/dev/null)" || return 1
  [ -n "$version" ] || return 1
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

knip_node_candidates() {
  command -v node 2>/dev/null || true
  command -v node.exe 2>/dev/null || true
  if command -v cmd.exe >/dev/null 2>&1; then
    local windows_node
    windows_node="$(cmd.exe /c where node 2>/dev/null | tr -d '\r' | head -n 1)"
    if [ -n "$windows_node" ]; then
      if command -v wslpath >/dev/null 2>&1; then
        wslpath -u "$windows_node" 2>/dev/null || true
      fi
      echo "$windows_node"
    fi
  fi
  local candidate
  for candidate in "$HOME"/.nvm/versions/node/v*/bin/node; do
    [ -f "$candidate" ] && echo "$candidate"
  done
  return 0
}

resolve_knip_node() {
  local candidate
  while IFS= read -r candidate; do
    [ -n "$candidate" ] || continue
    if node_supports_knip "$candidate"; then
      echo "$candidate"
      return 0
    fi
  done <<CANDIDATES
$(knip_node_candidates)
CANDIDATES
  return 1
}

knip_node_is_windows() {
  case "$1" in
    *.exe) return 0 ;;
    [A-Za-z]:/*) return 0 ;;
    [A-Za-z]:\\*) return 0 ;;
  esac
  return 1
}

knip_cli_path() {
  local cli_path="$repo_root/node_modules/knip/dist/cli.js"
  if knip_node_is_windows "$1" && command -v wslpath >/dev/null 2>&1; then
    local windows_cli_path
    windows_cli_path="$(wslpath -w "$cli_path" 2>/dev/null || true)"
    if [ -n "$windows_cli_path" ]; then
      echo "$windows_cli_path"
      return 0
    fi
  fi
  echo "$cli_path"
}

knip_node="$(resolve_knip_node || true)"
if [ -z "$knip_node" ]; then
  echo "error: knip requires Node >= 22.12 (require(esm) support). Update the Node on PATH or install a newer Node via nvm." >&2
  exit 1
fi

exec "$knip_node" "$(knip_cli_path "$knip_node")" "$@"
