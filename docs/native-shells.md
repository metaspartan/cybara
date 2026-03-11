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
- can be bundled as a release-ready `Cybara.app` under `release/native-macos/<arch>/`
- can be optionally codesigned and notarized during packaging when Apple signing credentials are configured

This keeps CLI, Tauri, and native macOS aligned on one runtime instead of fragmenting behavior.

## Android

The current Bun-based local runtime should not be forced into Android prematurely.

Recommended near-term path:

- native Kotlin shell
- embedded `WebView`
- connect to a remote or local Cybara gateway over the existing API contract
- add mobile-safe auth/reconnect/push first

Reference: [apps/android/README.md](../apps/android/README.md)

## Why this split matters

- macOS can reuse the compiled local Cybara binary directly
- Android needs API-first parity before a true local node/runtime
- both shells should stay aligned with the same HTTP/WebSocket contracts used by CLI and Tauri
