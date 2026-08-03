# Cybara Desktop Client

Cybara is available as a native desktop application built with [Tauri](https://tauri.app/), providing a lightweight, secure, and performant experience.

This document covers the production desktop release paths for both the Tauri desktop app and the native SwiftUI macOS shell in `apps/macos/Cybara`.

## Features

- **Native Performance**: Built with Rust, minimal resource usage
- **Native Notifications**: OS-level alerts for important events
- **Web Terminal**: Full PTY terminal accessible from the UI (auto-enabled in dev)
- **Offline Capable**: Local model support via Ollama and packaged local indexing support through Transformers.js/ONNX assets
- **Cross-Platform**: official Tauri release builds cover macOS Apple Silicon/Intel, Windows x64, and Linux x64; the sidecar builder also maps Linux arm64 and Windows arm64 for custom/source packaging
- **Bundled UI + Runtime Assets**: UI, sidecar, `secp256k1.wasm`, Playwright, the platform computer-use driver, and local embedding runtime assets are embedded in release bundles
- **Integrated Automation**: session-bound browser preview, visible desktop control, and iOS/Android simulator panels keep agent actions inspectable from chat
- **Shared Gateway Controls**: Web/Tauri and native macOS settings expose API-key reveal/rotation, gateway restart, gateway logs, source migration, speech settings, memory providers, and provider plan limits over the same API contract

## Installation

### From Releases

Download the latest release from [GitHub Releases](https://github.com/metaspartan/cybara/releases):

| Platform | File |
|----------|------|
| macOS (Apple Silicon) | `Cybara_x.x.x_aarch64.dmg` |
| macOS (Intel) | `Cybara_x.x.x_x64.dmg` |
| macOS native SwiftUI (Apple Silicon) | `Cybara-native-macos-arm64-x.y.z.zip` |
| Linux (x64) | `cybara_x.x.x_amd64.deb` / `.rpm` / `.AppImage` |
| Windows (x64) | `Cybara_x.x.x_x64-setup.exe` |

### macOS: "Cybara.app is damaged and can't be opened"

macOS shows this when a downloaded app is not notarized by Apple: the OS attaches
a quarantine flag to the download, and on Apple Silicon an app that isn't signed
and notarized is refused with the "damaged" message (there is no right-click →
Open bypass for that specific dialog).

If the release you downloaded is not yet notarized, remove the quarantine flag
after moving the app into `Applications`:

```bash
xattr -dr com.apple.quarantine /Applications/Cybara.app
```

For the native SwiftUI bundle, unzip it first, move `CybaraNative.app` to
`/Applications` (named distinctly so it never collides with the Tauri `Cybara.app`),
then run the same command. This is only needed until the maintainer
publishes notarized builds (see [Signing & Notarization (maintainers)](#signing--notarization-maintainers)).

## Desktop Auto Updates

Official release builds include a signed updater channel backed by GitHub Releases:

- open `Settings -> Desktop Updates`
- click `Check Now`
- click `Install And Restart` when a newer version is available

The Tauri updater consumes the signed `latest.json` artifact uploaded by the release workflow and
relaunches the app after installation.

The native SwiftUI macOS app uses its own GitHub Releases updater from **App -> Check for
Updates...**. It displays download progress, verifies the published SHA256 sidecar, validates the
extracted app with `codesign`, stages the replacement, and relaunches Cybara. It does not consume the
Tauri updater manifest.

## Browser, Desktop, and Simulator Automation

- Browser preview is attached to the active session so navigation, screenshots, and agent cursor
  activity remain visible beside the conversation.
- `computer_use` provides capture, element-aware click, typing, scrolling, dragging, native value
  setting, and app focus through the bundled platform driver. macOS requires Screen Recording and
  Accessibility permission; Windows requires the target app to be visible in the active desktop.
- `mobile_simulator` manages iOS Simulator on macOS and Android Emulator on macOS, Windows, and
  Linux. It supports device discovery and lifecycle, screenshots and previews, taps, swipes, text,
  keys, URLs, app installation, and launch actions.
- iOS lifecycle and screenshots use Xcode `simctl`; direct touch and text input require IDB. Android
  uses the installed SDK and ADB.
- When Lab trajectory capture is enabled, desktop and simulator interactions can be retained with
  screenshots and coordinates for replay, debugging, and multimodal data export.

### From Source

```bash
# Clone repository
git clone https://github.com/metaspartan/cybara.git
cd cybara

# Install dependencies
bun install

# Build the sidecar (platform-aware)
bun run tauri:sidecar

# Cross-build a sidecar for a specific Tauri target when needed
CYBARA_SIDECAR_BUN_TARGET=bun-windows-x64 bun run tauri:sidecar

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

## Signing & Notarization (maintainers)

To ship macOS builds that open without the "damaged" / Gatekeeper prompt, the
apps must be **code-signed with a Developer ID Application certificate and
notarized by Apple** (requires a paid Apple Developer account). Both the Tauri
build and the native SwiftUI build in the release workflow read the same repo
secrets, so you configure them once:

| Secret | Purpose |
|--------|---------|
| `MACOS_CERTIFICATE` | base64 of the Developer ID Application `.p12` |
| `MACOS_CERTIFICATE_PASSWORD` | password for that `.p12` |
| `MACOS_SIGN_IDENTITY` | e.g. `Developer ID Application: Your Name (TEAMID)` |
| `MACOS_NOTARY_API_KEY` | base64 of the App Store Connect API key `.p8` |
| `MACOS_NOTARY_API_KEY_ID` | the API key ID |
| `MACOS_NOTARY_API_ISSUER_ID` | the API key issuer ID |

When these are set, the release workflow signs and notarizes automatically. When
they are absent, it produces unsigned builds (which require the `xattr` step
above). The Tauri bundle ships `src-tauri/entitlements.plist` granting the
bundled Bun sidecar the JIT / library-validation exceptions the hardened runtime
requires, so notarization passes.

### CLI Bootstrap

For macOS/Linux release installs, the repository also ships an `install.sh` bootstrapper that downloads the latest CLI binary from GitHub Releases:

```bash
curl -fsSL https://cybara.ai/install.sh | bash
```

To install a pinned CLI release:

```bash
curl -fsSL https://cybara.ai/install.sh | bash -s -- --version 1.0.818
```

## Architecture

Tauri release builds package the same sidecar/runtime contract and bundle resources from `src-tauri/bin` via `src-tauri/tauri.conf.json`:

- `bin/cybara-*` sidecar executable
- `bin/node_modules` copied into app resources as `node_modules`
- `bin/ui/dist` copied into app resources as `ui/dist`
- `bin/secp256k1.wasm`
- `bin/onnxruntime/<platform>/<arch>` for the target native ONNX binding when available

The native SwiftUI macOS bundle embeds the Cybara sidecar binary and bundles the web UI alongside the shell:

```text
Cybara.app/
├── Contents/
│   ├── MacOS/
│   │   ├── Cybara            # Native SwiftUI shell executable
│   │   └── sidecar/
│   │       ├── cybara        # Sidecar binary (Bun-compiled)
│   │       ├── onnxruntime/
│   │       └── node_modules/
│   ├── Resources/
│   │   ├── AppIcon.icns
│   │   └── sidecar/
│   │       ├── secp256k1.wasm
│   │       └── ui/dist/
│   └── Info.plist
```

On launch:
1. Each desktop shell attaches to a compatible healthy local gateway when one is already available.
2. Otherwise it starts its bundled sidecar with a loopback-only gateway; terminal access remains off until explicitly enabled.
3. Tauri renders the bundled React UI through its webview and uses the gateway's REST and streaming contracts.
4. The native macOS app renders native SwiftUI screens backed by `GatewayClient`; it does not embed the React UI as its primary detail surface.
5. Tauri release builds consume the signed `latest.json` updater channel.
6. Native SwiftUI releases use the checksum-verified native zip updater and relaunch flow.

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

It also copies sidecar runtime assets into `release/`, `src-tauri/bin/`, and the Tauri debug target directory:

- `@huggingface/transformers` dist files
- `onnxruntime-node` dist files plus the target native `napi-v*` binding when the installed package ships one
- `onnxruntime-web` dist files for WASM/Web fallback
- `onnxruntime-common`, `sharp`, `@img`, Playwright packages, and `secp256k1.wasm`

The ONNX binding lookup is N-API-version agnostic and uses `process.platform` / `process.arch`. If the installed `onnxruntime-node` package does not ship a native binding for the target, the sidecar still bundles ONNX Web/WASM fallback assets so local Transformers.js embeddings can degrade gracefully.

## Development

### Prerequisites

- [Rust](https://rustup.rs/) (latest stable)
- [Bun](https://bun.sh/) (v1.0+)
- Xcode Command Line Tools (macOS)
- `libwebkit2gtk-4.1-dev`, `libgtk-3-dev`, `libayatana-appindicator3-dev`, `librsvg2-dev`, `patchelf`, `build-essential`, `libssl-dev` (Linux)

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

The release workflow generates `src-tauri/tauri.release.conf.json`, enables updater artifacts, signs the updater bundle, and uploads `latest.json` to the tagged GitHub release.

The committed Tauri configuration contains a valid development-only updater public key with no endpoints. Release preparation rejects that key and requires the established production public/private keypair from GitHub Actions secrets.

The final publish job refuses to flip a release from draft to published unless `latest.json` is present and passes `scripts/verify-tauri-updater-manifest.ts`. If the signing secrets are missing, `tauri-action` can skip `latest.json`, so the workflow fails loudly with a maintainer-actionable message instead of shipping a desktop app whose in-app updater 404s forever.

### CLI updater integrity

The compiled CLI binaries published by `release.yml` ship with per-asset `<asset>.sha256` sidecars (plus a combined `checksums.txt`). The `cybara update` command and `install.sh` both fetch the matching sidecar and verify the SHA256 of the downloaded binary before installing it. If no sidecar exists, `cybara update` aborts unless run with `--force`, and `install.sh` warns. This protects the `curl | bash` install path against a tampered or CDN-poisoned asset.

The same workflow also packages native SwiftUI macOS `.app` bundles and uploads zip + `.sha256` artifacts. If Apple signing/notary secrets are configured, those native bundles are also codesigned and notarized before upload.

Optional native macOS signing/notary secrets:

- `MACOS_CERTIFICATE`
- `MACOS_CERTIFICATE_PASSWORD`
- `MACOS_SIGN_IDENTITY`
- `MACOS_KEYCHAIN_PASSWORD`
- `MACOS_NOTARY_API_KEY`
- `MACOS_NOTARY_API_KEY_ID`
- `MACOS_NOTARY_API_ISSUER_ID`

## Troubleshooting

### App won't start

1. Ensure Cybara backend is running: `cybara status`
2. Check daemon logs (if daemon mode): `cat ~/.cybara/cybara.log`
3. Try starting backend manually: `cybara start`

### Icon not showing

The app icon should display automatically. If missing:
1. Ensure `ui/dist/cybara.png` exists after building
2. Rebuild: `bun run ui:build && bun run tauri:build`

### Linux: "failed to start the gateway sidecar"

The desktop shell launched fine, but the bundled gateway process it spawns
exited. The gateway is a self-contained binary, so this is almost always the
gateway itself erroring on startup rather than a missing system library.

Get the real error. The failure now carries the gateway's own last output in
the status message, and both of these logs capture it:

- Desktop app log: `~/.local/share/com.cybara.desktop/logs/` (newest file)
- Gateway log: `~/.cybara/logs/`

Or run the app from a terminal with sidecar logging on to watch it live:

```bash
CYBARA_TAURI_LOG_SIDECAR=1 cybara-desktop
```

Also confirm the gateway runs on its own:

```bash
cybara start
```

If `cybara start` works but the desktop app does not, share the two logs above
so the failing line can be identified.

### Build errors on macOS

```bash
# Install Xcode tools
xcode-select --install

# Install Rust
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
```

### Code signing issues

For local development, allow unsigned apps in System Preferences > Security & Privacy.
