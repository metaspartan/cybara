# Cybara Desktop Client

Cybara is available as a native desktop application built with [Tauri](https://tauri.app/), providing a lightweight, secure, and performant experience.

## Features

- **Native Performance**: Built with Rust, minimal resource usage
- **System Tray**: Quick access and background operation
- **Native Notifications**: OS-level alerts for important events
- **Offline Capable**: Local model support via Ollama
- **Cross-Platform**: macOS (Apple Silicon & Intel)

## Installation

### From Releases

Download the latest release from [GitHub Releases](https://github.com/metaspartan/cybara/releases):

| Platform | File |
|----------|------|
| macOS (Apple Silicon) | `Cybara_x.x.x_aarch64.dmg` |
| macOS (Intel) | `Cybara_x.x.x_x64.dmg` |
| macOS (Universal) | `Cybara_x.x.x_universal.dmg` |

### From Source

```bash
# Clone repository
git clone https://github.com/metaspartan/cybara.git
cd cybara

# Install dependencies
bun install

# Run in development mode
bun run tauri:dev

# Build for production
bun run tauri:build
```

## Architecture

The desktop client wraps the Cybara web UI in a Tauri webview:

```
┌─────────────────────────────────────┐
│         Tauri Window                │
│  ┌───────────────────────────────┐  │
│  │     React Web UI (Vite)       │  │
│  │  ┌─────────────────────────┐  │  │
│  │  │  Dashboard │ Chat │ ... │  │  │
│  │  └─────────────────────────┘  │  │
│  └───────────────────────────────┘  │
│         ↕ IPC Bridge                │
│  ┌───────────────────────────────┐  │
│  │    Rust Backend (Tauri)       │  │
│  │  - System tray                │  │
│  │  - Native notifications       │  │
│  │  - File system access         │  │
│  └───────────────────────────────┘  │
└─────────────────────────────────────┘
         ↕ HTTP/WebSocket
┌─────────────────────────────────────┐
│      Cybara Backend (Bun)           │
│  - Agent orchestration              │
│  - AI provider routing              │
│  - Tool execution                   │
└─────────────────────────────────────┘
```

## Development

### Prerequisites

- [Rust](https://rustup.rs/) (latest stable)
- [Bun](https://bun.sh/) (v1.0+)
- Xcode Command Line Tools (macOS)

### Commands

```bash
# Development with hot reload
bun run tauri:dev

# Production build
bun run tauri:build

# Clean build artifacts
cd src-tauri && cargo clean
```

### Project Structure

```
src-tauri/
├── Cargo.toml          # Rust dependencies
├── tauri.conf.json     # Tauri configuration
├── src/
│   └── main.rs         # Rust entry point
└── icons/              # App icons
```

## Configuration

The desktop client uses the same configuration as the CLI/web:

- **Config file**: `~/.cybara/config.json`
- **Database**: `~/.cybara/cybara.db`
- **Logs**: `~/.cybara/cybara.log`

## Troubleshooting

### App won't start

1. Ensure Cybara backend is running: `cybara status`
2. Check logs: `cat ~/.cybara/cybara.log`
3. Try starting backend manually: `cybara start`

### Build errors on macOS

```bash
# Install Xcode tools
xcode-select --install

# Install Rust
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
```

### Code signing issues

For local development, allow unsigned apps in System Preferences > Security & Privacy.
