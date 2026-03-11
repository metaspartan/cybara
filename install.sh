#!/usr/bin/env bash
set -euo pipefail

REPO="${CYBARA_RELEASE_REPOSITORY:-metaspartan/cybara}"
INSTALL_DIR="${CYBARA_INSTALL_DIR:-$HOME/.local/bin}"

if ! command -v curl >/dev/null 2>&1; then
  echo "curl is required to install Cybara." >&2
  exit 1
fi

if ! command -v python3 >/dev/null 2>&1; then
  echo "python3 is required to parse GitHub release metadata." >&2
  exit 1
fi

OS="$(uname -s | tr '[:upper:]' '[:lower:]')"
ARCH="$(uname -m)"

case "$OS" in
  darwin) PLATFORM="darwin" ;;
  linux) PLATFORM="linux" ;;
  *)
    echo "Unsupported platform: $OS" >&2
    exit 1
    ;;
esac

case "$ARCH" in
  x86_64|amd64) RELEASE_ARCH="x64" ;;
  arm64|aarch64) RELEASE_ARCH="arm64" ;;
  *)
    echo "Unsupported architecture: $ARCH" >&2
    exit 1
    ;;
esac

ASSET="cybara-${PLATFORM}-${RELEASE_ARCH}"
API_URL="https://api.github.com/repos/${REPO}/releases/latest"

DOWNLOAD_URL="$(
  curl -fsSL "$API_URL" | python3 - "$ASSET" <<'PY'
import json
import sys

asset_name = sys.argv[1]
data = json.load(sys.stdin)
for asset in data.get("assets", []):
    if asset.get("name") == asset_name:
        print(asset["browser_download_url"])
        raise SystemExit(0)
raise SystemExit(1)
PY
)" || {
  echo "Could not find release asset ${ASSET} in ${REPO} latest release." >&2
  exit 1
}

mkdir -p "$INSTALL_DIR"
TMP_FILE="$(mktemp "${TMPDIR:-/tmp}/cybara-install.XXXXXX")"
trap 'rm -f "$TMP_FILE"' EXIT

echo "Downloading ${ASSET} from ${REPO}..."
curl -fsSL "$DOWNLOAD_URL" -o "$TMP_FILE"
chmod +x "$TMP_FILE"
mv "$TMP_FILE" "$INSTALL_DIR/cybara"
trap - EXIT

echo "Cybara installed to $INSTALL_DIR/cybara"
echo "Make sure $INSTALL_DIR is on your PATH."
