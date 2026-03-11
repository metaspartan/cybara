# Cybara Android Shell Strategy

Cybara should have an Android client, but it should not pretend the current Bun sidecar can run natively on Android unchanged.

## Recommended architecture

- Android app: native Kotlin UI with `WebView` for the existing Cybara web surface
- Runtime target: connect to a local or remote Cybara gateway over the same HTTP/WebSocket APIs used by CLI and desktop
- Optional future mode: package a dedicated Android-native companion service only after the core runtime is split from Bun-only assumptions

## Why this is different from macOS

- The macOS native shell can reuse the compiled local Cybara binary directly.
- Android cannot reliably reuse the current Bun binary/runtime stack the same way.
- The correct path is API parity first, then a platform-native companion/runtime when the core is refactored for it.

## MVP features

- sign in / connect to local or remote Cybara node
- native shell chrome around embedded web UI
- notifications and share-sheet entrypoints
- background reconnect and session recovery
- optional voice and push surfaces later

## Next implementation track

1. Stabilize CLI/Tauri/native-shell HTTP contracts.
2. Add explicit mobile-safe auth/session APIs.
3. Scaffold a Kotlin `WebView` shell using the shared API surface.
4. Only then evaluate a true Android local-node mode.
