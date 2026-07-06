# Cybara Android Shell Strategy

Cybara now has an active React Native mobile companion in `apps/mobile` for both iOS and Android. This older Android note is retained to document why the phone app connects to a running gateway instead of embedding the Bun runtime.

## Current architecture

- Android app: React Native / Expo app shared with iOS
- Runtime target: connect to a local or remote Cybara gateway over the same HTTP/WebSocket APIs used by CLI and desktop
- Local-node mode: not implemented in this repo; Android uses a remote gateway instead of embedding the Bun runtime

## Why this is different from macOS

- The macOS native shell can reuse the compiled local Cybara binary directly.
- Android cannot reliably reuse the current Bun binary/runtime stack the same way.
- The current Android path is API parity first through `apps/mobile`, not a separate Android-native runtime.

## Implemented companion scope

- connect to a local or remote gateway through QR/paste/manual setup
- store a revocable per-device token instead of the root gateway API key
- operate sessions, agents, providers, tools, approvals, wallet policy, channels, tasks, memory, terminal/log entrypoints, and settings summaries through gateway APIs
- share the same Expo/React Native codebase as iOS

## Release path

Use [../mobile/README.md](../mobile/README.md) for development, pairing, and release CI details.
