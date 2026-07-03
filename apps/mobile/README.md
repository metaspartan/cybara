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

The GitHub release workflow builds mobile Expo update bundles for both iOS and Android and attaches them to the release as `cybara-mobile-expo-<tag>.tar.gz`.

Tagged releases also run best-effort native store builds:

- Android: `expo prebuild --platform android --no-install`, then Gradle. Without signing secrets it produces an installable debug APK. With `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, and `ANDROID_KEY_PASSWORD`, it also builds a signed AAB/APK. With `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON`, the signed AAB is uploaded to the Google Play internal track.
- iOS: `expo prebuild --platform ios --no-install`, `pod install --repo-update`, then Xcode archive. Without Apple signing secrets it produces an unsigned inspection IPA. With `APPLE_CERTIFICATE_BASE64`, `APPLE_CERTIFICATE_PASSWORD`, `APPLE_PROVISIONING_PROFILE_BASE64`, and `APPLE_TEAM_ID`, it builds a signed App Store IPA for bundle id `com.ck.cybara`. With `ASC_API_KEY_BASE64`, `ASC_API_KEY_ID`, and `ASC_API_ISSUER_ID`, it uploads that IPA to TestFlight.

Expo/React Native release jobs use Bun for package scripts, plus a real Node runtime where Expo, CocoaPods, and Gradle tooling require one on `PATH`.
