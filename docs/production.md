# Cybara Production Guide

This guide covers the production surfaces that are ready today: CLI release installs, Tauri desktop releases, native macOS bundles, React Native mobile release artifacts, runtime data layout, backups, updates, and operator best practices.

## Supported production surfaces

- CLI release binaries from GitHub Releases
- Web UI served by the Cybara Bun runtime
- Tauri desktop releases with signed updater artifacts
- native SwiftUI macOS app bundles from GitHub Releases
- React Native Expo update bundles from GitHub Releases
- Android APK/AAB and iOS IPA/TestFlight builds when store signing secrets are configured

## Install

### CLI

Latest release:

```bash
curl -fsSL https://cybara.ai/install.sh | bash
```

Pinned release:

```bash
curl -fsSL https://cybara.ai/install.sh | bash -s -- --version 1.0.818
```

Useful installer env vars:

- `CYBARA_VERSION`: install a pinned release tag instead of `latest`
- `CYBARA_INSTALL_DIR`: override the target directory
- `CYBARA_RELEASE_REPOSITORY`: point at a fork or alternate release repo

### Desktop

Use GitHub Releases for production desktop installs.

- Tauri desktop builds are the only desktop surface with in-app updater support today.
- Native SwiftUI macOS bundles use the same `127.0.0.1:4269` local gateway contract and UI surface, but updates are manual through GitHub Releases. The current release workflow packages native macOS arm64.
- The native macOS publish path can codesign and notarize release bundles when the Apple signing/notary secrets are configured in GitHub Actions.

### Mobile

Use the React Native companion from `apps/mobile`.

- Expo update bundles are uploaded to tagged GitHub Releases as `cybara-mobile-expo-<tag>.tar.gz`.
- Android release builds upload APK artifacts; when Android signing secrets are present, the workflow also builds an AAB and can publish it to the Google Play internal track.
- iOS release builds upload an IPA; when Apple distribution/profile secrets and App Store Connect API secrets are present, the workflow uploads the signed IPA to TestFlight.
- The mobile app remains remote-first: it connects to an existing Cybara gateway through QR/token pairing rather than embedding the Bun runtime on-device.

## Runtime data

Cybara stores operator state under `~/.cybara` by default.

Override that root with:

```bash
export CYBARA_HOME=/srv/cybara
```

Common paths:

- `$CYBARA_HOME/api_key`
- `$CYBARA_HOME/config.json`
- `$CYBARA_HOME/data/platform.db`
- `$CYBARA_HOME/logs/`
- `$CYBARA_HOME/plugins/`
- `$CYBARA_HOME/skills/`

## Updates

### CLI

```bash
cybara update
cybara update --version 1.0.818
```

### Desktop

Official Tauri release builds support:

1. `Settings -> Desktop Updates`
2. `Check Now`
3. `Install And Restart`

Update native SwiftUI macOS bundles by downloading the latest GitHub Release bundle.

## Backups

Back up at minimum:

- `$CYBARA_HOME/config.json`
- `$CYBARA_HOME/api_key`
- `$CYBARA_HOME/data/platform.db*`
- `$CYBARA_HOME/memory/`
- `$CYBARA_HOME/skills/`
- `$CYBARA_HOME/plugins/`

Before a manual migration or host move, stop the app/daemon first so the SQLite database is cleanly flushed.

## Plugin trust model

Plugins are local code execution boundaries, not sandboxes.

Treat installed plugins the same way you would treat any trusted local code:

- install only from sources you trust
- review plugin manifests and contributed skill content before install
- prefer workspace-local plugins for project-scoped behavior
- use production hosts conservatively until plugin signatures/integrity metadata exist

## Production operator checklist

1. Keep Cybara bound to localhost unless you explicitly need LAN access.
2. Set a strong `CYBARA_API_KEY` before exposing Cybara to anything outside localhost.
3. Use `CYBARA_HOME` to place runtime data on a known, backed-up volume.
4. Back up SQLite and config data before upgrades.
5. Keep agent wallet access disabled unless the workflow truly requires it.
6. Treat plugin installs as privileged changes.
7. Prefer the Tauri desktop release builds for end-user production desktop deployment.

## Release management

Version sync and release metadata are driven by:

- `bun run version:print`
- `bun run version:sync`
- `.github/workflows/main-version-tag.yml`
- `.github/workflows/release.yml`

The production desktop updater also requires:

- `TAURI_SIGNING_PUBLIC_KEY`
- `TAURI_SIGNING_PRIVATE_KEY`
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`

The native macOS release path optionally uses:

- `MACOS_CERTIFICATE`
- `MACOS_CERTIFICATE_PASSWORD`
- `MACOS_SIGN_IDENTITY`
- `MACOS_KEYCHAIN_PASSWORD`
- `MACOS_NOTARY_API_KEY`
- `MACOS_NOTARY_API_KEY_ID`
- `MACOS_NOTARY_API_ISSUER_ID`

Mobile store builds optionally use:

- `ANDROID_KEYSTORE_BASE64`
- `ANDROID_KEYSTORE_PASSWORD`
- `ANDROID_KEY_ALIAS`
- `ANDROID_KEY_PASSWORD`
- `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON`
- `APPLE_CERTIFICATE_BASE64`
- `APPLE_CERTIFICATE_PASSWORD`
- `APPLE_PROVISIONING_PROFILE_BASE64`
- `APPLE_TEAM_ID`
- `ASC_API_KEY_BASE64`
- `ASC_API_KEY_ID`
- `ASC_API_ISSUER_ID`

The final release publish job downloads and validates `latest.json` before publishing the draft release. This keeps Tauri in-app updates from shipping with missing or incomplete updater metadata.
