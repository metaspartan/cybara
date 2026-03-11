# Cybara Production Guide

This guide covers the production surfaces that are ready today: CLI release installs, the Tauri desktop release flow, runtime data layout, backups, updates, and operator best practices.

## Supported production surfaces

- CLI release binaries from GitHub Releases
- Web UI served by the Cybara Bun runtime
- Tauri desktop releases with signed updater artifacts
- native SwiftUI macOS app bundles from GitHub Releases

## Install

### CLI

Latest release:

```bash
curl -fsSL https://raw.githubusercontent.com/metaspartan/cybara/main/install.sh | bash
```

Pinned release:

```bash
curl -fsSL https://raw.githubusercontent.com/metaspartan/cybara/main/install.sh | bash -s -- --version 1.0.186
```

Useful installer env vars:

- `CYBARA_VERSION`: install a pinned release tag instead of `latest`
- `CYBARA_INSTALL_DIR`: override the target directory
- `CYBARA_RELEASE_REPOSITORY`: point at a fork or alternate release repo

### Desktop

Use GitHub Releases for production desktop installs.

- Tauri desktop builds are the only desktop surface with in-app updater support today.
- Native SwiftUI macOS bundles use the same `127.0.0.1:4269` local gateway contract and UI surface, but updates are manual through GitHub Releases.
- The native macOS publish path can codesign and notarize release bundles when the Apple signing/notary secrets are configured in GitHub Actions.

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
cybara update --version 1.0.186
```

### Desktop

Official Tauri release builds support:

1. `Settings -> Desktop Updates`
2. `Check Now`
3. `Install And Restart`

Native SwiftUI macOS bundles do not yet self-update in app. Update them by downloading the latest GitHub Release bundle.

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
- `.github/workflows/publish-desktop.yml`

The production desktop updater also requires:

- `TAURI_SIGNING_PUBLIC_KEY`
- `TAURI_SIGNING_PRIVATE_KEY`
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`

The native macOS release path optionally uses:

- `APPLE_DEVELOPER_ID_CERTIFICATE_P12`
- `APPLE_DEVELOPER_ID_CERTIFICATE_PASSWORD`
- `APPLE_DEVELOPER_ID_SIGNING_IDENTITY`
- `APPLE_KEYCHAIN_PASSWORD`
- `APPLE_ID`
- `APPLE_APP_SPECIFIC_PASSWORD`
- `APPLE_TEAM_ID`
