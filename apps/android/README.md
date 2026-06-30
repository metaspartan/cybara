# Cybara Android Shell Strategy

Cybara now has an active React Native mobile companion in `apps/mobile` for both iOS and Android. This older Android note is retained to document why the phone app connects to a running gateway instead of embedding the Bun runtime.

## Recommended architecture

- Android app: React Native / Expo app shared with iOS
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
3. Ship the React Native mobile companion using the shared API surface.
4. Only then evaluate a true Android local-node mode.
