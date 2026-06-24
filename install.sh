#!/usr/bin/env bash
set -euo pipefail

REPO="${CYBARA_RELEASE_REPOSITORY:-metaspartan/cybara}"
INSTALL_DIR="${CYBARA_INSTALL_DIR:-$HOME/.local/bin}"
VERSION="${CYBARA_VERSION:-latest}"

while [ $# -gt 0 ]; do
  case "$1" in
    --version)
      if [ $# -lt 2 ]; then
        echo "--version requires a value." >&2
        exit 1
      fi
      VERSION="$2"
      shift 2
      ;;
    --help|-h)
      cat <<'EOF'
Cybara install.sh

Usage:
  install.sh [--version <tag>]

Environment:
  CYBARA_VERSION              Release tag to install (default: latest)
  CYBARA_RELEASE_REPOSITORY   GitHub repository (default: metaspartan/cybara)
  CYBARA_INSTALL_DIR          Target directory (default: ~/.local/bin)
EOF
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      exit 1
      ;;
  esac
done

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
if [ "$VERSION" = "latest" ]; then
  API_URL="https://api.github.com/repos/${REPO}/releases/latest"
else
  VERSION="${VERSION#v}"
  API_URL="https://api.github.com/repos/${REPO}/releases/tags/v${VERSION}"
fi

# Parse the release JSON once: resolve the binary download URL, the release tag,
# and the published SHA256 sidecar URL (if present).
RELEASE_INFO="$(
  curl -fsSL "$API_URL" | python3 - "$ASSET" <<'PY'
import json
import sys

asset_name = sys.argv[1]
data = json.load(sys.stdin)
tag = (data.get("tag_name") or "").lstrip("v")
download_url = None
checksum_url = None
for asset in data.get("assets", []):
    name = asset.get("name")
    if name == asset_name:
        download_url = asset.get("browser_download_url")
    elif name == asset_name + ".sha256":
        checksum_url = asset.get("browser_download_url")
if not download_url:
    raise SystemExit(1)
print(download_url)
print(checksum_url or "")
print(tag or "")
PY
)" || {
  echo "Could not find release asset ${ASSET} in ${REPO} for ${VERSION}." >&2
  exit 1
}

DOWNLOAD_URL="$(printf '%s\n' "$RELEASE_INFO" | sed -n '1p')"
CHECKSUM_URL="$(printf '%s\n' "$RELEASE_INFO" | sed -n '2p')"
RELEASE_TAG="$(printf '%s\n' "$RELEASE_INFO" | sed -n '3p')"
if [ -n "$RELEASE_TAG" ] && [ "$VERSION" = "latest" ]; then
  VERSION="$RELEASE_TAG"
fi

mkdir -p "$INSTALL_DIR"
TMP_FILE="$(mktemp "${TMPDIR:-/tmp}/cybara-install.XXXXXX")"
trap 'rm -f "$TMP_FILE"' EXIT

echo "Downloading ${ASSET} from ${REPO} (${VERSION})..."
curl -fsSL "$DOWNLOAD_URL" -o "$TMP_FILE"

# Verify the SHA256 of the downloaded binary against the published sidecar.
if [ -n "$CHECKSUM_URL" ]; then
  EXPECTED="$(curl -fsSL "$CHECKSUM_URL" | awk '{print $1}' | tr '[:upper:]' '[:lower:]')"
  if [ -n "$EXPECTED" ] && command -v sha256sum >/dev/null 2>&1; then
    ACTUAL="$(sha256sum "$TMP_FILE" | awk '{print $1}')"
  elif [ -n "$EXPECTED" ] && command -v shasum >/dev/null 2>&1; then
    ACTUAL="$(shasum -a 256 "$TMP_FILE" | awk '{print $1}')"
  else
    ACTUAL=""
  fi
  if [ -z "$ACTUAL" ]; then
    echo "Warning: could not compute SHA256; skipping verification." >&2
  elif [ "$ACTUAL" != "$EXPECTED" ]; then
    echo "Checksum verification FAILED — the downloaded asset is corrupted or tampered." >&2
    echo "Expected: $EXPECTED" >&2
    echo "Actual:   $ACTUAL" >&2
    exit 1
  else
    echo "Checksum verified."
  fi
else
  echo "Warning: no SHA256 sidecar found for ${ASSET}; installing unverified." >&2
fi

chmod +x "$TMP_FILE"
mv "$TMP_FILE" "$INSTALL_DIR/cybara"
trap - EXIT

echo "Cybara installed to $INSTALL_DIR/cybara"
if [ -x "$INSTALL_DIR/cybara" ]; then
  "$INSTALL_DIR/cybara" version || true
fi
echo "Make sure $INSTALL_DIR is on your PATH."
