# Cybara Mobile

Cybara Mobile is the React Native companion app for iOS and Android. It does not run the Cybara runtime locally on the phone; it connects to a Cybara gateway already running from the CLI, Tauri desktop app, native macOS app, or hosted server.

## Design Direction

- dark theme by default
- Liquid Glass-inspired translucent surfaces, grouped controls, and interactive glass buttons
- compact operator dashboard instead of a marketing screen
- remote-first feature coverage for sessions, agents, providers, tools, approvals, wallet policy, channels, tasks, memory, terminal, logs, and settings

## Development

```bash
bun run mobile:dev
bun run mobile:ios
bun run mobile:android
bun run mobile:expo-check
bun run mobile:typecheck
bun run test:mobile
```

`mobile:expo-check` is part of `bun run check:ci`. Keep the React Native, React, and native Expo modules on the versions Expo reports as compatible; using newer registry versions before the matching Expo runtime is available can produce a red screen with a React Native JavaScript/native version mismatch.

## Connect A Device

On the machine running Cybara:

```bash
cybara mobile connect --url http://192.168.1.20:4269 --device "Carsen iPhone"
```

Scan the QR code from the mobile app, or paste the emitted payload. The payload uses the
`cybara-mobile-connect-v1` contract and includes the gateway URL plus a revocable per-device token,
not the root gateway API key.

You can also create and manage pairings from the Web UI/Tauri `Mobile` page. Revoke or remove a
device there, or from the CLI:

```bash
cybara mobile list
cybara mobile revoke <device-id>
cybara mobile remove <device-id>
```

For LAN devices, make sure the gateway is reachable from the phone. Localhost only works from the same machine; use the host LAN IP or a trusted tunnel for remote access.

## Release CI

The GitHub release workflow builds mobile Expo update bundles for both iOS and Android on the self-hosted Linux runner and attaches them to the release as `cybara-mobile-expo-<tag>.tar.gz`. Store-signed IPA/APK production builds still require the normal Apple/Google signing credentials, so those remain a separate distribution step.
