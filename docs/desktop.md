# Cybara Desktop Client

Cybara is available as a native desktop application built with [Tauri](https://tauri.app/), providing a lightweight, secure, and performant experience.

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
| Linux (x64) | `cybara_x.x.x_amd64.deb` / `.rpm` / `.AppImage` |
| Linux (arm64) | `cybara_x.x.x_arm64.deb` / `.rpm` / `.AppImage` |
| Windows (x64) | `Cybara_x.x.x_x64-setup.exe` |

## Desktop Auto Updates

Official release builds include a signed updater channel backed by GitHub Releases:

- open `Settings -> Desktop Updates`
- click `Check Now`
- click `Install And Restart` when a newer version is available

The updater consumes the `latest.json` artifact uploaded by the desktop publish workflow and relaunches the app after install.

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
```

### CLI Bootstrap

For macOS/Linux release installs, the repository also ships an `install.sh` bootstrapper that downloads the latest CLI binary from GitHub Releases:

```bash
curl -fsSL https://raw.githubusercontent.com/metaspartan/cybara/main/install.sh | bash
```

## Architecture

The desktop client embeds the Cybara sidecar binary and bundles the web UI as resources:

```
Cybara.app/
├── Contents/
│   ├── MacOS/
│   │   ├── cybara-desktop     # Tauri shell (Rust)
│   │   └── cybara-<triple>    # Sidecar binary (Bun-compiled)
│   ├── Resources/
│   │   ├── icon.icns
│   │   └── _up_/ui/dist/      # Bundled web UI
│   │       ├── index.html
│   │       ├── cybara.png      # App icon
│   │       └── assets/         # JS, CSS
│   └── Info.plist
```

On launch:
1. Tauri shell starts the sidecar binary with `cybara start`
2. Sidecar starts the HTTP server on port 4269
3. Sidecar finds `ui/dist/` in `Resources/_up_/ui/dist/`
4. Tauri webview navigates to `http://localhost:4269`
5. On close, Tauri kills the sidecar process
6. On update checks, the desktop app consults GitHub Releases `latest.json` and can download/install the signed updater package

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

# Clean build artifacts
cd src-tauri && cargo clean
```

## Configuration

The desktop client uses the same configuration as the CLI/web:

- **Config file**: `~/.cybara/config.json`
- **Database**: `~/.cybara/data/platform.db` (plus `-wal` / `-shm`)
- **Runtime logs directory**: `~/.cybara/logs/`
- **Daemon log file**: `~/.cybara/cybara.log` (when running via `cybara start -d`)
- **Release versioning**: root `package.json`, `ui/package.json`, `src-tauri/Cargo.toml`, and `src-tauri/tauri.conf.json` are synced by `bun run version:sync`
- **Desktop updater**: signed release builds inject updater config through `src-tauri/tauri.release.conf.json`

## Release Workflow Notes

Desktop auto-updates require signing keys in GitHub Actions:

- `TAURI_SIGNING_PUBLIC_KEY`
- `TAURI_SIGNING_PRIVATE_KEY`
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`

The desktop publish workflow generates `src-tauri/tauri.release.conf.json`, enables updater artifacts, signs the updater bundle, and uploads `latest.json` to the tagged GitHub release.

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
