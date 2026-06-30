# Cybara Desktop Client

Cybara is available as a native desktop application built with [Tauri](https://tauri.app/), providing a lightweight, secure, and performant experience.

This document covers the production desktop release paths for both the Tauri desktop app and the native SwiftUI macOS shell in `apps/macos/Cybara`.

## Features

- **Native Performance**: Built with Rust, minimal resource usage
- **Native Notifications**: OS-level alerts for important events
- **Web Terminal**: Full PTY terminal accessible from the UI (auto-enabled in dev)
- **Offline Capable**: Local model support via Ollama
- **Cross-Platform**: macOS (Apple Silicon & Intel), Linux (x64 & arm64), Windows (x64 and arm64)
- **Bundled UI**: All assets embedded in the app bundle

## Installation

### From Releases

Download the latest release from [GitHub Releases](https://github.com/metaspartan/cybara/releases):

| Platform | File |
|----------|------|
| macOS (Apple Silicon) | `Cybara_x.x.x_aarch64.dmg` |
| macOS (Intel) | `Cybara_x.x.x_x64.dmg` |
| macOS native SwiftUI (Apple Silicon) | `Cybara-native-macos-arm64-x.y.z.zip` |
| macOS native SwiftUI (Intel) | `Cybara-native-macos-x86_64-x.y.z.zip` |
| Linux (x64) | `cybara_x.x.x_amd64.deb` / `.rpm` / `.AppImage` |
| Linux (arm64) | `cybara_x.x.x_arm64.deb` / `.rpm` / `.AppImage` |
| Windows (x64) | `Cybara_x.x.x_x64-setup.exe` |

## Desktop Auto Updates

Official release builds include a signed updater channel backed by GitHub Releases:

- open `Settings -> Desktop Updates`
- click `Check Now`
- click `Install And Restart` when a newer version is available

The updater consumes the `latest.json` artifact uploaded by the desktop publish workflow and relaunches the app after install.

The native SwiftUI macOS bundles do not use the Tauri updater. Update those by downloading the latest bundle zip from GitHub Releases.

### From Source

```bash
# Clone repository
git clone https://github.com/metaspartan/cybara.git
cd cybara

# Install dependencies
bun install

# Build the sidecar (platform-aware)
bun run tauri:sidecar

# Run in development mode (includes --enable-terminal)
bun run tauri:dev

# Build for production
bun run tauri:build

# Build a signed release locally
export TAURI_SIGNING_PUBLIC_KEY='...'
export TAURI_SIGNING_PRIVATE_KEY='...'
export TAURI_SIGNING_PRIVATE_KEY_PASSWORD='...'
bun run tauri:build:release

# Build a native SwiftUI macOS app bundle + zip
bun run native:macos:package
```

### CLI Bootstrap

For macOS/Linux release installs, the repository also ships an `install.sh` bootstrapper that downloads the latest CLI binary from GitHub Releases:

```bash
curl -fsSL https://raw.githubusercontent.com/metaspartan/cybara/main/install.sh | bash
```

To install a pinned CLI release:

```bash
curl -fsSL https://raw.githubusercontent.com/metaspartan/cybara/main/install.sh | bash -s -- --version 1.0.330
```

## Architecture

The native SwiftUI macOS bundle embeds the Cybara sidecar binary and bundles the web UI alongside the shell:

```

Tauri release builds package the same sidecar/runtime contract, but keep the web UI under `Contents/Resources/_up_/ui/dist/` and use the Rust shell executable instead of the SwiftUI shell.
Cybara.app/
├── Contents/
│   ├── MacOS/
│   │   ├── Cybara            # Native SwiftUI shell executable
│   │   └── sidecar/
│   │       ├── cybara        # Sidecar binary (Bun-compiled)
│   │       ├── secp256k1.wasm
│   │       ├── onnxruntime/
│   │       └── ui/dist/
│   ├── Resources/
│   │   └── AppIcon.icns
│   └── Info.plist
```

On launch:
1. The shell attaches to an existing local Cybara gateway on `127.0.0.1:4269` when one is already healthy
2. Otherwise it starts the sidecar binary with `cybara start --enable-terminal`
3. The sidecar starts the HTTP server on port 4269
4. The shell webview navigates to `http://localhost:4269`
5. Tauri release builds can consume `latest.json` for in-app signed updates
6. Native SwiftUI macOS bundles are updated manually from GitHub Releases

## Sidecar Build Script

The `scripts/build-sidecar.ts` auto-detects your platform and compiles:

```bash
bun run tauri:sidecar
```

This creates the correctly-named binary that Tauri expects:
- macOS arm64: `cybara-aarch64-apple-darwin`
- macOS x64: `cybara-x86_64-apple-darwin`
- Linux x64: `cybara-x86_64-unknown-linux-gnu`
- Linux arm64: `cybara-aarch64-unknown-linux-gnu`
- Windows x64: `cybara-x86_64-pc-windows-msvc.exe`
- Windows arm64: `cybara-aarch64-pc-windows-msvc.exe`

## Development

### Prerequisites

- [Rust](https://rustup.rs/) (latest stable)
- [Bun](https://bun.sh/) (v1.0+)
- Xcode Command Line Tools (macOS)
- `libwebkit2gtk-4.1-dev`, `libappindicator3-dev` (Linux)

### Commands

```bash
# Development with hot reload
bun run tauri:dev

# Production build
bun run tauri:build

# Generate release-only updater config
bun run tauri:prepare-release

# Production build with updater artifacts/signatures
bun run tauri:build:release

# Native macOS app bundle + zip artifact
bun run native:macos:package

# Clean build artifacts
cd src-tauri && cargo clean
```

## Configuration

The desktop client uses the same configuration as the CLI/web:

- **Config file**: `~/.cybara/config.json`
- **Database**: `~/.cybara/data/platform.db` (plus `-wal` / `-shm`)
- **Runtime logs directory**: `~/.cybara/logs/`
- **Daemon log file**: `~/.cybara/cybara.log` (when running via `cybara start -d`)
- **Runtime root override**: set `CYBARA_HOME` to move the entire runtime data root
- **Release versioning**: root `package.json`, `ui/package.json`, `src-tauri/Cargo.toml`, and `src-tauri/tauri.conf.json` are synced by `bun run version:sync`
- **Desktop updater**: signed release builds inject updater config through `src-tauri/tauri.release.conf.json`

## Release Workflow Notes

Desktop auto-updates require signing keys in GitHub Actions:

- `TAURI_SIGNING_PUBLIC_KEY`
- `TAURI_SIGNING_PRIVATE_KEY`
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`

The desktop publish workflow generates `src-tauri/tauri.release.conf.json`, enables updater artifacts, signs the updater bundle, and uploads `latest.json` to the tagged GitHub release.

The publish workflow refuses to flip a release from draft to published unless `latest.json` is present on the release. If the signing secrets are missing, `tauri-action` silently skips `latest.json`, so the workflow fails loudly with a maintainer-actionable message instead of shipping a desktop app whose in-app updater 404s forever.

### CLI updater integrity

The compiled CLI binaries published by `release.yml` ship with per-asset `<asset>.sha256` sidecars (plus a combined `checksums.txt`). The `cybara update` command and `install.sh` both fetch the matching sidecar and verify the SHA256 of the downloaded binary before installing it. If no sidecar exists, `cybara update` aborts unless run with `--force`, and `install.sh` warns. This protects the `curl | bash` install path against a tampered or CDN-poisoned asset.

The same workflow also packages native SwiftUI macOS `.app` bundles and uploads zip + `.sha256` artifacts. If Apple signing/notary secrets are configured, those native bundles are also codesigned and notarized before upload.

Optional native macOS signing/notary secrets:

- `APPLE_DEVELOPER_ID_CERTIFICATE_P12`
- `APPLE_DEVELOPER_ID_CERTIFICATE_PASSWORD`
- `APPLE_DEVELOPER_ID_SIGNING_IDENTITY`
- `APPLE_KEYCHAIN_PASSWORD`
- `APPLE_ID`
- `APPLE_APP_SPECIFIC_PASSWORD`
- `APPLE_TEAM_ID`

## Troubleshooting

### App won't start

1. Ensure Cybara backend is running: `cybara status`
2. Check daemon logs (if daemon mode): `cat ~/.cybara/cybara.log`
3. Try starting backend manually: `cybara start`

### Icon not showing

The app icon should display automatically. If missing:
1. Ensure `ui/dist/cybara.png` exists after building
2. Rebuild: `bun run ui:build && bun run tauri:build`

### Build errors on macOS

```bash
# Install Xcode tools
xcode-select --install

# Install Rust
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
```

### Code signing issues

For local development, allow unsigned apps in System Preferences > Security & Privacy.
