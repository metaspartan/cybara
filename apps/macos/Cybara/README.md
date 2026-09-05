# Cybara macOS App

This is the native SwiftUI macOS app for Cybara. It launches the same local server contract used by the Tauri app so the runtime stays aligned across desktop surfaces.

## What it does

- resolves a Cybara sidecar binary from:
  - `CYBARA_NATIVE_SIDECAR_PATH`
  - `src-tauri/bin/cybara-aarch64-apple-darwin`
  - `src-tauri/bin/cybara-x86_64-apple-darwin`
  - `release/cybara`
  - bundled sidecar paths inside `CybaraNative.app`
  - `cybara` on `PATH` as a last resort, excluding app-bundle executable aliases
- attaches to an existing local Cybara gateway on `http://127.0.0.1:4269` when one is already running
- otherwise starts `cybara start` with `PORT=4269` and `CYBARA_HOST=127.0.0.1`; web terminal access stays off until explicitly enabled
- waits for `http://127.0.0.1:4269/api/health`
- renders native SwiftUI navigation, chat, management, settings, terminal, wallet, Lab, and environment surfaces backed by the typed `GatewayClient`
- keeps the Bun sidecar as the shared runtime instead of forking app-specific agent logic
- supports native external-link handling, notification permission and delivery, workspace folder picking, deep links, and persisted window geometry
- provides native screens for dashboard summaries, chats/sessions, agents, providers and account pools, router and provider plan limits, metrics, tasks, memory providers, wallet, LAN/remote-gated mobile pairing, speech settings, plugins, tools, skills, LSP, source migration, gateway logs, and gateway restart
- can rotate the gateway API key without restarting the sidecar and can restart the gateway when a full sidecar reload is needed
- checks GitHub Releases, downloads the matching native bundle with progress, verifies its SHA256 sidecar and code signature, replaces the app, and relaunches

## Build

```bash
bun run native:macos:build
```

## Package A Native `.app`

```bash
bun run native:macos:package
```

This assembles a real `CybaraNative.app` bundle under `release/native-macos/<arch>/` and embeds:

- the SwiftUI shell executable
- the compiled `cybara` sidecar binary under `Contents/MacOS/sidecar/`
- `ui/dist` and `secp256k1.wasm` under `Contents/Resources/sidecar/`
- `onnxruntime` native libraries under `Contents/Resources/sidecar/onnxruntime/`
- sidecar `node_modules` under `Contents/Resources/sidecar/node_modules/`, including `@huggingface/transformers`, `onnxruntime-node`, `onnxruntime-web`, `onnxruntime-common`, and optional target-architecture `sharp/@img`
- a generated `AppIcon.icns`

The packaged app uses the same `127.0.0.1:4269` local gateway contract as the Tauri app. The sidecar receives `CYBARA_RESOURCE_DIR` so it can resolve bundled UI and local indexing runtime assets from the app bundle instead of relying on the developer checkout.

## Existing Gateway Attachment

At launch, Cybara Native first probes the configured loopback endpoint. A healthy Cybara gateway with a compatible same-major API contract is attached even when its patch release differs from the app. This supports user-managed private-network, SSH, and VPN forwards without requiring lockstep updates.

Cybara Native starts and supervises the bundled sidecar only when the port is available. It never replaces or stops an externally managed gateway. Cross-major versions, missing versions, and incompatible or malformed API compatibility metadata fail closed with explicit client and gateway versions. Update the older component through an official Cybara release before retrying.

## Run

```bash
bun run native:macos:run
```

## Notes

- This app is intentionally thin: the Bun sidecar remains the shared runtime so CLI, Tauri, and SwiftUI stay aligned in production.
- The target local gateway contract is the same one Tauri uses: `127.0.0.1:4269`.
- Web/Tauri, mobile, and native macOS share the same API routes for provider plans, memory providers, source migration, speech settings, gateway logs, and gateway restart.
- Tagged desktop releases can now publish zipped native macOS app bundles alongside the Tauri installers.
- The native shell does not embed the React UI as its primary detail surface; bundled UI assets remain available to the shared gateway and external browser access.
- Local Transformers.js workspace embeddings use the bundled ONNX native binding when available for the host architecture, with ONNX Web/WASM assets bundled as fallback.
- If `CYBARA_MACOS_SIGN_IDENTITY` is set, the bundle is codesigned during packaging.
- If `CYBARA_MACOS_NOTARY_KEYCHAIN_PROFILE` is also set, the package script submits the zip for notarization, staples the `.app`, and then writes the final release zip.
- If you want to point at a different binary or port:

```bash
export CYBARA_NATIVE_SIDECAR_PATH=/absolute/path/to/cybara
export CYBARA_NATIVE_PORT=4269
```
