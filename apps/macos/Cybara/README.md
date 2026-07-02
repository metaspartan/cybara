# Cybara macOS App

This is the native SwiftUI macOS app for Cybara. It launches the same local server contract used by the Tauri app so the runtime stays aligned across desktop surfaces.

## What it does

- resolves a Cybara sidecar binary from:
  - `CYBARA_NATIVE_SIDECAR_PATH`
  - `cybara` on `PATH`
- `src-tauri/bin/cybara-aarch64-apple-darwin`
- `src-tauri/bin/cybara-x86_64-apple-darwin`
- `release/cybara`
- attaches to an existing local Cybara gateway on `http://127.0.0.1:4269` when one is already running
- otherwise starts `cybara start --enable-terminal` with `PORT=4269` and `CYBARA_HOST=127.0.0.1`
- waits for `http://127.0.0.1:4269/api/health`
- renders the Cybara web UI in a native `WKWebView`
- keeps the Bun sidecar as the shared runtime instead of forking app-specific logic
- injects a `window.__CYBARA_NATIVE__` bridge so the web UI can recognize the native macOS host
- supports native external-link handling, notification permission / delivery, and workspace folder picking via the bridge

## Build

```bash
bun run native:macos:build
```

## Package A Native `.app`

```bash
bun run native:macos:package
```

This assembles a real `Cybara.app` bundle under `release/native-macos/<arch>/` and embeds:

- the SwiftUI shell executable
- the compiled `cybara` sidecar binary under `Contents/MacOS/sidecar/`
- `ui/dist` and `secp256k1.wasm` under `Contents/Resources/sidecar/`
- `onnxruntime` native libraries under `Contents/MacOS/sidecar/onnxruntime/`
- a generated `AppIcon.icns`

The packaged app uses the same `127.0.0.1:4269` local gateway contract as the Tauri app.

## Run

```bash
bun run native:macos:run
```

## Notes

- This app is intentionally thin: the Bun sidecar remains the shared runtime so CLI, Tauri, and SwiftUI stay aligned in production.
- The target local gateway contract is the same one Tauri uses: `127.0.0.1:4269`.
- Tagged desktop releases can now publish zipped native macOS app bundles alongside the Tauri installers.
- If `CYBARA_MACOS_SIGN_IDENTITY` is set, the bundle is codesigned during packaging.
- If `CYBARA_MACOS_NOTARY_KEYCHAIN_PROFILE` is also set, the package script submits the zip for notarization, staples the `.app`, and then writes the final release zip.
- If you want to point at a different binary or port:

```bash
export CYBARA_NATIVE_SIDECAR_PATH=/absolute/path/to/cybara
export CYBARA_NATIVE_PORT=4269
```
