# Testing Guide

Cybara uses Bun-native automated tests for core backend, CLI, channel adapters, and key UI/Tauri seams.

## Run Everything

```bash
bun test
bun run check
bun run build:all
```

## Focused Test Runs

```bash
# CLI command integration (mocked API server)
bun test tests/cli/commands.test.ts

# Channel adapter and security flows
bun test tests/channels

# API route integration (requires running API server on localhost:4269)
bun test tests/api/routes.test.ts

# UI/Tauri utility seams
bun test tests/ui

# Build script/platform mapping
bun test tests/scripts
```

## Coverage Areas

- Channel adapters: Discord, Telegram webhook, Slack, WhatsApp, Signal, iMessage
- Channel security and pairing flows
- Channel manager lifecycle (start/stop/update/delete/masking)
- CLI command wiring: providers, channels, pairing, MCP, tasks, skills, sessions, memory, logs, subagents
- UI/Tauri utility seam: `openExternal` backend-first with browser fallback
- Tauri sidecar build target mapping

## Playwright Note

Playwright remains available for browser automation features in runtime, but the automated test suite intentionally prioritizes Bun-compatible tests. This avoids flaky `bunx`/browser-install coupling in CI while still validating feature wiring across CLI, API, and adapter layers.
