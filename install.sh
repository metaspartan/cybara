#!/usr/bin/env bash
set -euo pipefail

REPO="${CYBARA_RELEASE_REPOSITORY:-metaspartan/cybara}"
VERSION="${CYBARA_VERSION:-latest}"

if [ -n "${CYBARA_INSTALL_DIR:-}" ]; then
  INSTALL_DIR="$CYBARA_INSTALL_DIR"
elif [ -d /usr/local/bin ] && [ -w /usr/local/bin ]; then
  INSTALL_DIR="/usr/local/bin"
else
  INSTALL_DIR="$HOME/.local/bin"
fi

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

ASSET_SUFFIX="-${PLATFORM}-${RELEASE_ARCH}-cli"
if [ "$VERSION" = "latest" ]; then
  API_URL="https://api.github.com/repos/${REPO}/releases/latest"
else
  VERSION="${VERSION#v}"
  API_URL="https://api.github.com/repos/${REPO}/releases/tags/v${VERSION}"
fi

REL_JSON="$(mktemp "${TMPDIR:-/tmp}/cybara-release.XXXXXX")"
trap 'rm -f "$REL_JSON"' EXIT
if ! curl -fsSL "$API_URL" -o "$REL_JSON"; then
  echo "Could not fetch release metadata from ${API_URL}." >&2
  exit 1
fi

ASSET_URLS="$(
  grep -oE '"browser_download_url"[[:space:]]*:[[:space:]]*"[^"]+"' "$REL_JSON" \
    | sed -E 's/.*"(https[^"]+)".*/\1/'
)"
DOWNLOAD_URL="$(printf '%s\n' "$ASSET_URLS" | grep -E -e "${ASSET_SUFFIX}\$" | head -n 1)"
CHECKSUM_URL="$(printf '%s\n' "$ASSET_URLS" | grep -E -e "${ASSET_SUFFIX}\.sha256\$" | head -n 1)"
RELEASE_TAG="$(
  grep -oE '"tag_name"[[:space:]]*:[[:space:]]*"[^"]+"' "$REL_JSON" \
    | head -n 1 \
    | sed -E 's/.*:[[:space:]]*"v?([^"]+)".*/\1/'
)"
rm -f "$REL_JSON"

if [ -z "$DOWNLOAD_URL" ]; then
  echo "Could not find a CLI release asset (*${ASSET_SUFFIX}) in ${REPO} for ${VERSION}." >&2
  exit 1
fi

if [ -n "$RELEASE_TAG" ] && [ "$VERSION" = "latest" ]; then
  VERSION="$RELEASE_TAG"
fi

mkdir -p "$INSTALL_DIR"
TMP_FILE="$(mktemp "${TMPDIR:-/tmp}/cybara-install.XXXXXX")"
trap 'rm -f "$TMP_FILE"' EXIT

echo "Downloading cybara${ASSET_SUFFIX} from ${REPO} (${VERSION})..."
curl -fL "$DOWNLOAD_URL" -o "$TMP_FILE"
echo

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
  echo "Warning: no SHA256 sidecar found for cybara${ASSET_SUFFIX}; installing unverified." >&2
fi

chmod +x "$TMP_FILE"
mv "$TMP_FILE" "$INSTALL_DIR/cybara"
trap - EXIT

echo "Cybara ${VERSION} installed to $INSTALL_DIR/cybara"

case ":$PATH:" in
  *":$INSTALL_DIR:"*)
    echo
    echo "Get started:"
    echo "  cybara help     - list all commands"
    echo "  cybara start    - launch the gateway in the background"
    echo "  cybara status   - check that it is running"
    ;;
  *)
    case "$(basename "${SHELL:-sh}")" in
      zsh) SHELL_RC="$HOME/.zshrc" ;;
      bash) SHELL_RC="$HOME/.bashrc" ;;
      *) SHELL_RC="$HOME/.profile" ;;
    esac
    PATH_LINE="export PATH=\"$INSTALL_DIR:\$PATH\""
    if ! grep -qsF "$INSTALL_DIR" "$SHELL_RC" 2>/dev/null; then
      printf '\n# Added by the Cybara installer\n%s\n' "$PATH_LINE" >>"$SHELL_RC"
      echo "Added $INSTALL_DIR to your PATH in $SHELL_RC"
    fi
    echo "Activate it now with:  $PATH_LINE"
    echo
    echo "Then get started:"
    echo "  cybara help     - list all commands"
    echo "  cybara start    - launch the gateway in the background"
    echo "  cybara status   - check that it is running"
    ;;
esac
