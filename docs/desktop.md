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
| macOS (Universal) | `Cybara_x.x.x_universal.dmg` |
| Linux (x64) | `cybara_x.x.x_amd64.deb` / `.rpm` / `.AppImage` |
| Linux (arm64) | `cybara_x.x.x_arm64.deb` / `.rpm` / `.AppImage` |
| Windows (x64 and arm64) | `Cybara_x.x.x_x64-setup.exe` |

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

# Clean build artifacts
cd src-tauri && cargo clean
```

## Configuration

The desktop client uses the same configuration as the CLI/web:

- **Config file**: `~/.cybara/config.json`
- **Database**: `~/.cybara/data/platform.db` (plus `-wal` / `-shm`)
- **Runtime logs directory**: `~/.cybara/logs/`
- **Daemon log file**: `~/.cybara/cybara.log` (when running via `cybara start -d`)

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
