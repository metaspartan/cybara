# Native Shells

Cybara now has a clearer native-shell strategy instead of treating every client as a Tauri-only concern.

## macOS

The new SwiftUI shell lives in [apps/macos/Cybara/README.md](../apps/macos/Cybara/README.md).

Design:

- native SwiftUI chrome with glass-style UI
- `WKWebView` rendering the existing Cybara web surface
- targets the same local Cybara gateway contract used by Tauri: `http://127.0.0.1:4269`
- attaches to an existing local gateway if one is already running
- otherwise launches the same local Cybara binary / sidecar flow used by Tauri
- waits on `http://127.0.0.1:4269/api/health`
- injects `window.__CYBARA_NATIVE__` so the React app can distinguish the native macOS host from plain web
- supports native notification permission / delivery, external-link handling, and workspace folder picking through that bridge
- can be bundled as a release-ready `Cybara.app` under `release/native-macos/<arch>/`, including the compiled sidecar, web UI, `secp256k1.wasm`, sidecar `node_modules`, and local Transformers.js/ONNX runtime assets
- can be optionally codesigned and notarized during packaging when Apple signing credentials are configured
- auto-restarts the managed sidecar on an unexpected crash (capped exponential backoff, then surfaces a failure)
- handles `cybara://` deep links — `cybara://` / `cybara://open` (focus), `cybara://restart` (restart gateway), `cybara://browser` (open web UI)
- persists window position/size across launches (frame autosave)
- checks GitHub Releases for newer versions on launch and via **App ▸ Check for Updates…** (no auto-install — opens the release page)

This keeps CLI, Tauri, and native macOS aligned on one runtime instead of fragmenting behavior.

### Testing

Pure logic (`SidecarCore`, `UpdateCore`) is covered by an XCTest target:

```bash
swift test --package-path apps/macos/Cybara
```

### Release signing (CI)

The `build-native-macos` job in [.github/workflows/release.yml](../.github/workflows/release.yml)
builds, signs, and notarizes the app on `macos-26`. It is best-effort and gated on
these GitHub Actions secrets — if they're absent it still produces an unsigned build.
The current release matrix packages arm64:

| Secret | Purpose |
| --- | --- |
| `MACOS_CERTIFICATE` | base64 of the Developer ID Application `.p12` |
| `MACOS_CERTIFICATE_PASSWORD` | password for that `.p12` |
| `MACOS_SIGN_IDENTITY` | identity string, e.g. `Developer ID Application: Name (TEAMID)` |
| `MACOS_KEYCHAIN_PASSWORD` | password for the ephemeral CI keychain |
| `MACOS_NOTARY_API_KEY` | base64 of the App Store Connect API key `.p8` |
| `MACOS_NOTARY_API_KEY_ID` | App Store Connect key ID |
| `MACOS_NOTARY_API_ISSUER_ID` | App Store Connect issuer ID |

Locally, packaging signs when `CYBARA_MACOS_SIGN_IDENTITY` is set and notarizes when
`CYBARA_MACOS_NOTARY_KEYCHAIN_PROFILE` (a `notarytool store-credentials` profile) is also set.

## Mobile: iOS + Android

The mobile companion now lives in [apps/mobile/README.md](../apps/mobile/README.md). It is a React Native / Expo app for iOS and Android with a dark Liquid Glass-inspired interface.

Recommended near-term path:

- connect to a remote or local Cybara gateway over the existing HTTP/WebSocket API contract
- pair by scanning or pasting the QR payload from `cybara mobile connect`, or from the Web UI/Tauri
  `Mobile` page
- manage and revoke paired mobile devices from the Web UI/Tauri `Mobile` page or the
  `cybara mobile list|revoke|remove` CLI commands
- manage sessions, agents, providers, tools/approvals, wallet policy, channels, tasks, memory, terminal/log entrypoints, and settings summaries
- keep API-first parity before attempting any local mobile runtime
- add platform push notifications and deeper native share-sheet flows after the remote management foundation is stable

Release CI exports Expo bundles for iOS and Android on every release run, and tagged releases also run best-effort native Android/iOS builds. Signed Android AAB/APK, iOS IPA, Google Play internal-track upload, and TestFlight upload are enabled only when the relevant store signing/App Store Connect secrets are configured.

The older Android-only note remains in [apps/android/README.md](../apps/android/README.md), but the active implementation track is React Native so iOS and Android share the same companion surface.

## Why this split matters

- macOS can reuse the compiled local Cybara binary directly
- mobile needs API-first parity before a true local node/runtime
- both shells should stay aligned with the same HTTP/WebSocket contracts used by CLI and Tauri
