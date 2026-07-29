# Native Shells

Cybara uses native shells where platform integration benefits from native controls while preserving
one gateway API contract across clients.

## macOS

The new SwiftUI shell lives in [apps/macos/Cybara/README.md](../apps/macos/Cybara/README.md).

Design:

- native SwiftUI navigation, chat, management, settings, terminal, wallet, Lab, and environment surfaces
- the same loopback gateway contract used by Tauri, accessed through the typed native `GatewayClient`
- attachment to a compatible healthy local gateway or managed startup of the bundled sidecar
- native notifications, external-link handling, workspace folder selection, deep links, and persisted window position and size
- release-ready `CybaraNative.app` packaging with the compiled sidecar, bundled UI resources for gateway access, `secp256k1.wasm`, sidecar packages, and local Transformers.js/ONNX assets
- optional codesigning and notarization when Apple release credentials are configured
- bounded sidecar crash recovery with a visible failure state when restart attempts are exhausted
- `cybara://` deep links for focus, gateway restart, and opening the gateway UI in a browser
- GitHub Releases update checks with progress, SHA256 verification, `codesign` validation, staged replacement, and automatic relaunch

The native app does not embed the React web UI as its main detail surface. Native screens consume the
same REST and streaming contracts, which keeps runtime behavior aligned without duplicating the agent
engine.

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

The mobile companion now lives in [apps/mobile/README.md](../apps/mobile/README.md). It is a React Native / Expo app for iOS and Android with a system-aware Liquid Glass-inspired interface and explicit light and dark appearance overrides.

The mobile companion:

- connect to a remote or local Cybara gateway over the existing HTTP/WebSocket API contract
- pair by scanning or pasting the QR payload from `cybara mobile connect`, or from the Web UI/Tauri
  `Mobile` page
- manage and revoke paired mobile devices from the Web UI/Tauri `Mobile` page or the
  `cybara mobile list|revoke|remove` CLI commands
- manage sessions, agents, providers, provider plan limits, metrics, speech settings, tools/approvals, wallet policy, channels, tasks, memory, terminal/log entrypoints, gateway controls, and settings summaries
- keep API-first parity before attempting any local mobile runtime
- use mobile push-notification settings for chat and task completion alerts

Release CI exports Expo bundles for iOS and Android on every release run, and tagged releases also run best-effort native Android/iOS builds. Signed Android AAB/APK, iOS IPA, Google Play internal-track upload, and TestFlight upload are enabled only when the relevant store signing/App Store Connect secrets are configured.

The older Android-only note remains in [apps/android/README.md](../apps/android/README.md), but the active implementation track is React Native so iOS and Android share the same companion surface.

## Why this split matters

- macOS can reuse the compiled local Cybara binary directly
- mobile needs API-first parity before a true local node/runtime
- both shells should stay aligned with the same HTTP/WebSocket contracts used by CLI and Tauri
