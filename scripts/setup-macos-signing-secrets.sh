#!/usr/bin/env bash
#
# Upload the macOS code-signing + notarization secrets used by the
# `build-native-macos` job in .github/workflows/release.yml to GitHub.
#
# This script does NOT create any Apple credentials — those must be generated
# from your Apple Developer account first (see PREREQUISITES below). It only
# base64-encodes the two key files and pushes all seven secrets via `gh`.
#
# Prerequisites (one-time, done in Apple's portals — cannot be automated):
#
#   1. Developer ID Application certificate
#      - https://developer.apple.com/account/resources/certificates
#      - Create a "Developer ID Application" cert, install it in Keychain,
#        then export it (with its private key) as a .p12 with a password.
#      - Find the identity string with:
#          security find-identity -v -p codesigning
#        It looks like: "Developer ID Application: Your Name (TEAMID)"
#
#   2. App Store Connect API key (for notarytool)
#      - https://appstoreconnect.apple.com/access/integrations/api
#      - Create a key with the "Developer" role, download the .p8 (once!),
#        and note the Key ID and Issuer ID.
#
# Usage:
#   P12_PATH=~/cybara-devid.p12 \
#   P12_PASSWORD='…' \
#   SIGN_IDENTITY='Developer ID Application: Your Name (TEAMID)' \
#   ASC_KEY_PATH=~/AuthKey_XXXX.p8 \
#   ASC_KEY_ID=XXXXXXXXXX \
#   ASC_ISSUER_ID=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx \
#   ./scripts/setup-macos-signing-secrets.sh
#
# A random keychain password is generated for you unless KEYCHAIN_PASSWORD is set.

set -euo pipefail

REPO="${REPO:-metaspartan/cybara}"

require() {
  local name="$1"
  if [[ -z "${!name:-}" ]]; then
    echo "❌ Missing required variable: $name" >&2
    echo "   See the header of this script for usage." >&2
    exit 1
  fi
}

require P12_PATH
require P12_PASSWORD
require SIGN_IDENTITY
require ASC_KEY_PATH
require ASC_KEY_ID
require ASC_ISSUER_ID

[[ -f "$P12_PATH" ]] || { echo "❌ P12 not found: $P12_PATH" >&2; exit 1; }
[[ -f "$ASC_KEY_PATH" ]] || { echo "❌ ASC key not found: $ASC_KEY_PATH" >&2; exit 1; }

command -v gh >/dev/null || { echo "❌ gh CLI not found" >&2; exit 1; }
gh auth status >/dev/null 2>&1 || { echo "❌ gh not authenticated (run: gh auth login)" >&2; exit 1; }

KEYCHAIN_PASSWORD="${KEYCHAIN_PASSWORD:-$(openssl rand -base64 24)}"

echo "📦 Uploading macOS signing secrets to $REPO …"

base64 < "$P12_PATH" | gh secret set MACOS_CERTIFICATE --repo "$REPO"
printf '%s' "$P12_PASSWORD"     | gh secret set MACOS_CERTIFICATE_PASSWORD --repo "$REPO"
printf '%s' "$SIGN_IDENTITY"    | gh secret set MACOS_SIGN_IDENTITY --repo "$REPO"
printf '%s' "$KEYCHAIN_PASSWORD" | gh secret set MACOS_KEYCHAIN_PASSWORD --repo "$REPO"
base64 < "$ASC_KEY_PATH"        | gh secret set MACOS_NOTARY_API_KEY --repo "$REPO"
printf '%s' "$ASC_KEY_ID"       | gh secret set MACOS_NOTARY_API_KEY_ID --repo "$REPO"
printf '%s' "$ASC_ISSUER_ID"    | gh secret set MACOS_NOTARY_API_ISSUER_ID --repo "$REPO"

echo "✅ Done. All 7 secrets set. Next tagged release will sign + notarize the native app."
echo "   Verify with: gh secret list --repo $REPO"
