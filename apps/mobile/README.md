# Cybara Mobile

Cybara Mobile is the React Native companion app for iOS and Android. It does not run the Cybara runtime locally on the phone; it connects to a Cybara gateway already running from the CLI, Tauri desktop app, native macOS app, or hosted server.

## Design Direction

- system appearance by default with light and dark overrides
- Liquid Glass-inspired translucent surfaces, grouped controls, and interactive glass buttons
- compact operator dashboard instead of a marketing screen
- remote-first feature coverage for sessions, agents, providers, provider plan limits, metrics, speech settings, tools, approvals, wallet policy, channels, tasks, memory, terminal, gateway logs, gateway restart, and settings

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
cybara mobile connect --code --url http://192.168.1.20:4269 --device "Carsen iPhone"
```

Scan the QR code from the mobile app, or paste the emitted payload. The preferred payload uses the
`cybara-mobile-pair-v1` contract with a short-lived one-time code; after redemption the phone
receives a revocable per-device token, not the root gateway API key. Legacy
`cybara-mobile-connect-v1` direct-token payloads remain supported for CLI compatibility.

You can also create and manage pairings from the Web UI/Tauri `Mobile` page or the native macOS
Mobile screen. QR creation is blocked until the gateway has local network access enabled or a ready
Remote Access URL. Revoke or remove a device there, or from the CLI:

```bash
cybara mobile list
cybara mobile revoke <device-id>
cybara mobile remove <device-id>
```

For LAN devices, make sure the gateway is reachable from the phone. Localhost only works from the
same machine; the pairing payload should use the host LAN IP. Start the gateway with LAN access
enabled, for example `cybara start --expose` or `CYBARA_HOST=0.0.0.0 cybara start`, and confirm
Safari/Chrome on the phone can open `http://<gateway-lan-ip>:4269/api/health` before scanning. On
iOS, allow Cybara's Local Network permission when prompted; if it was denied, re-enable it in iOS
Settings.

For remote devices, configure Settings → Gateway → Remote Access with a private mesh URL
(Tailscale, ZeroTier, NetBird) or a public HTTPS tunnel/custom domain. Public remote URLs require
the Cybara gateway password before QR pairing is enabled. The mobile app normalizes pasted/QR
gateway URLs and stores only the revocable device token.

## Gateway Compatibility

Mobile is a remote API client and does not bundle or manage a Cybara gateway, so it does not require exact gateway release equality. During authenticated connection verification it reads the gateway's API compatibility metadata when available. Legacy gateways without that metadata remain supported through the existing authenticated sessions contract. A future breaking gateway API can declare a newer minimum client API version, producing a clear update-required error instead of a generic connection failure.

## Runtime Coverage

The app talks to the same gateway API used by Web/Tauri and native macOS. Current mobile surfaces
include:

- chat sessions with queueing, steering, live activity/tool-call timelines, workspace selection, and session persistence
- dashboard metrics, provider/model/token summaries, provider plan status, and gateway health
- provider, agent, memory, speech, terminal, logs, wallet policy, channel, task, and mobile-device settings
- gateway API-key display/rotation, gateway restart, and paged system-log reads when the paired device has the required scope

## Release CI

The GitHub release workflow builds mobile Expo update bundles for both iOS and Android and attaches them to the release as `cybara-mobile-expo-<tag>.tar.gz`.

Tagged releases also run best-effort native store builds:

- Android: `expo prebuild --platform android --no-install`, then Gradle. Without signing secrets it produces an installable debug APK. With `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, and `ANDROID_KEY_PASSWORD`, it also builds a signed AAB/APK. With `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON`, the signed AAB is uploaded to the Google Play internal track.
- iOS: `expo prebuild --platform ios --no-install`, `pod install --repo-update`, then Xcode archive. Without Apple signing secrets it produces an unsigned inspection IPA. With `APPLE_CERTIFICATE_BASE64`, `APPLE_CERTIFICATE_PASSWORD`, `APPLE_PROVISIONING_PROFILE_BASE64`, and `APPLE_TEAM_ID`, it builds a signed App Store IPA for bundle id `com.ck.cybara`. With `ASC_API_KEY_BASE64`, `ASC_API_KEY_ID`, and `ASC_API_ISSUER_ID`, it retries transient App Store Connect/TestFlight upload failures and uploads the signed IPA to TestFlight when Apple's service accepts it. If Apple returns repeated server-side 5xx errors, the job keeps the signed IPA attached to the GitHub release for a manual retry.

Expo/React Native release jobs use Bun for package scripts, plus a real Node runtime where Expo, CocoaPods, and Gradle tooling require one on `PATH`.

## Push Notification Builds

Remote notifications use Expo Push Service with FCM on Android and APNs on iOS. Native builds require an Expo project and platform credentials before they are releasable:

- Set the GitHub Actions secret `EXPO_PROJECT_ID` to the EAS project UUID. The dynamic Expo config writes it to `extra.eas.projectId` for token registration.
- Download the Android Firebase client configuration for `com.ck.cybara`, encode it with `base64`, and store it as `FIREBASE_GOOGLE_SERVICES_JSON_BASE64`. This is separate from the Google Play publishing service account.
- Upload an FCM V1 service-account key for the same Firebase project to the Expo project credentials.
- Use an iOS provisioning profile for `com.ck.cybara` that contains `aps-environment`, and upload a valid APNs key to the Expo project credentials.

For local native builds, provide `EXPO_PROJECT_ID` and set `FIREBASE_GOOGLE_SERVICES_FILE=./google-services.json` when building Android. `google-services.json` is ignored by Git and must not be copied into release archives.
