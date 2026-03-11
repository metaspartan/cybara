# Cybara vs OpenClaw Gap Audit

Comparison baseline:

- OpenClaw checkout: `.research/openclaw` at `061b8258`
- Cybara checkout: current workspace state

## Summary

Cybara is already stronger in a few areas:

- built-in IDE and code-review workflow
- local wallet / on-chain tooling
- Bun-first single-repo developer flow

OpenClaw is ahead on platform breadth and product polish:

- much wider channel/plugin ecosystem
- stronger onboarding and doctor/update workflows
- mature release-channel/versioning story
- macOS/iOS/Android node architecture
- real telephony plugin stack with provider backends

## Major Gaps

### 1. Install / update / release lifecycle

OpenClaw already has:

- a date/version release cadence
- `openclaw update`
- documented install/update channels
- desktop packaging discipline around release artifacts

Cybara was missing:

- automatic version increments on `main`
- a CLI self-update path
- a bootstrap installer for release binaries
- consistent version reporting across API/CLI/Tauri

This pass adds the foundation:

- `bun run version:print`
- `bun run version:sync`
- automatic main-branch version/tag workflow
- `cybara update`
- `install.sh`
- shared runtime version reporting
- signed Tauri desktop updater wiring
- GitHub-release-backed desktop update UI in Settings

### 2. Plugin / extension ecosystem

OpenClaw exposes a real plugin SDK and ships many optional integrations as installable extensions.

Cybara today has bundled tools/skills/channels, but not a first-class external plugin runtime. This is the single biggest platform gap if the goal is “all the features they have and more”.

Recommendation:

1. Define a Cybara plugin manifest and lifecycle.
2. Support installing plugins from local paths and GitHub/npm specs.
3. Move optional/high-churn integrations behind that boundary.

### 3. Channel breadth

OpenClaw supports a much larger matrix of messaging surfaces and node/device endpoints.

Cybara currently focuses on:

- Telegram
- Discord
- Slack
- WhatsApp
- Signal
- iMessage / BlueBubbles
- Web chat

Recommendation:

1. Keep the current built-ins stable.
2. Add new channels through a plugin boundary, not directly into core.

### 4. Voice / telephony

OpenClaw has a provider-backed voice-call extension with Twilio/Telnyx/Plivo plus webhook/media-stream handling.

Cybara now has:

- `phone`
- `voice_call`
- macOS FaceTime dialing
- local `say`-based spoken prompts
- mock mode for agent workflows/tests

Cybara still does not have:

- webhook-driven PSTN provider sessions
- remote audio streaming / transcription loop
- telephony carrier configuration surface

Recommendation:

1. Treat the current macOS voice flow as `local-assist`.
2. Add a provider-backed telephony plugin separately.

### 5. Desktop / node architecture

OpenClaw has a broader “device node” model across macOS, iOS, and Android.

Cybara’s Tauri desktop app is currently a shell around the Bun sidecar and web UI. That is a good base, but not yet a device-node platform.

Recommendation:

1. Stabilize Tauri first.
2. Add desktop-local command/camera/notification primitives only after updater/release health is solid.

## Immediate Priorities

### P0

- stabilize Linux/Tauri runtime performance
- unify CLI and desktop update UX beyond Settings
- plugin runtime design for optional integrations

### P1

- onboarding wizard parity
- richer doctor/repair flows
- plugin runtime design

### P2

- telephony provider plugin
- expanded channel catalog
- desktop/mobile node architecture

## Changes Landed In This Pass

- shared version/build info wiring
- automatic version sync/tag workflow for `main`
- CLI self-update command
- release-binary install script
- signed Tauri updater workflow + desktop update UI
- Linux/Tauri performance mode to reduce heavy glass effects
- desktop sidecar log throttling in release builds
- global pointer affordance for clickable IDE/UI controls
