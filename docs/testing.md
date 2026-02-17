# Testing Guide

Cybara uses Bun-native automated tests for core backend, CLI, channel adapters, and key UI/Tauri seams.

## Run Everything

```bash
bun test
bun run test:smoke
bun run check
bun run build:all
```

## Focused Test Runs

```bash
# CLI command integration (mocked API server)
bun test tests/cli/commands.test.ts

# Channel adapter and security flows
bun test tests/channels

# API route integration (self-hosted ephemeral server)
bun test tests/api/routes.test.ts

# Browser route contracts (mocked browser manager; no Playwright runtime needed)
bun test tests/api/browser-routes-mocked.test.ts

# Channel security route contracts (mocked channel/security managers)
bun test tests/api/channel-security-routes-mocked.test.ts

# Open URL route contracts (mocked browser opener; validates secure URL gating and error wiring)
bun test tests/api/open-url-route-mocked.test.ts

# API security unit tests (auth/rate-limit/url validation/sanitization)
bun test tests/api/security.test.ts

# UI/Tauri utility seams
bun test tests/ui

# Build script/platform mapping
bun test tests/scripts

# End-to-end smoke flows (live server + CLI/UI/terminal)
bun test tests/e2e

# Chat/session/log/metrics end-to-end contracts (live server)
bun test tests/e2e/chat-logs-metrics-smoke.test.ts

# Stateful CLI + API end-to-end contracts (live server)
bun test tests/e2e/stateful-cli-api-workflow.test.ts

# Persistence + SSE end-to-end resilience checks (live server)
bun test tests/e2e/persistence-and-sse-smoke.test.ts

# Security auth end-to-end checks (production API key + dev localhost bypass)
bun test tests/e2e/security-auth-smoke.test.ts

# CLI auth behavior against production API-key enforcement
bun test tests/e2e/cli-auth-smoke.test.ts

# Runtime guards (path hardcoding, package scripts, UI path resolution)
bun test tests/runtime

# Tauri desktop wiring guards
bun test tests/tauri
```

## Coverage Areas

- Channel adapters: Discord, Telegram webhook, Slack, WhatsApp, Signal, iMessage
- Channel security and pairing flows
- Channel manager lifecycle (start/stop/update/delete/masking)
- CLI command wiring: providers, channels, pairing, MCP, tasks, skills, sessions, memory, logs, subagents
- UI/Tauri utility seam: `openExternal` backend-first with browser fallback
- UI API client contracts: chat/session routes, logs query params, skill execute wiring
- UI auth token helpers and guardrails: shared `apiFetch` bearer injection and no direct `fetch('/api/...')` bypasses
- Tauri sidecar build target mapping
- Browser route contracts (mocked manager): tabs lifecycle, navigate/click/type forwarding, snapshot/screenshot encoding
- Channel security contracts (mocked manager): pairings mapping, verify/reject, allowlist, DM policy config
- Open URL route contracts (mocked opener): valid URL delegation, localhost/private blocking, error-path header consistency
- API security module: auth behavior, rate limiting, URL validation, input sanitization
- API route integration extras: health/live/ready + setup/info, provider catalog + OAuth validation/callback-status, channel type metadata + telegram webhook contracts, MCP lifecycle + registry contracts, LSP status/diagnostics/install validation, tool catalog/execute validation, subagent list/get/spawn/kill contracts, skills categories/status/registry search, task lifecycle, builtin skill execution, IDE/git route contracts (including HOME sandbox sibling-prefix and symlink escape blocking), system prompt/identity persistence, open-url scheme/localhost blocking
- Metrics route resilience: malformed `metrics.metadata` JSON does not break providers/tokens/files/tools endpoints
- Channel/session/task/agent/config JSON resilience: malformed `channels.config`, `session_messages.metadata`, `tasks.config`, `agents.config`, `config.value` (`systemPrompt`/`identity`), and runtime agent prompt config no longer break API recovery/listing/update/start flows
- Live E2E smoke: server startup, CLI↔API calls, UI route serving, terminal REST+WebSocket flow
- Live E2E contracts: chat -> session persistence -> log queries/stats -> metrics dashboards/system status
- Live E2E stateful workflow: CLI provider/config/channels/tasks commands against a real server, plus sessions/memory visibility
- Live E2E resilience: config/memory/channel/task persistence across restart and `/api/sse/status` initial stream event
- Live E2E security auth: production API-key enforcement, header contract (`WWW-Authenticate`), development localhost bypass behavior, stricter chat/OAuth/pairing rate-limit windows, terminal REST/WebSocket auth enforcement, status SSE auth enforcement (including `token` and `api_key` query auth), and rate-limit headers on validation errors
- Live E2E CLI auth: protected command behavior with missing auth, `CYBARA_API_KEY` env auth, `~/.cybara/api_key` fallback, and env-vs-file precedence
- Runtime guards: no hardcoded workspace paths, package script contracts, compiled UI path resolution
- Tauri wiring contracts: sidecar spawn/kill and bundled UI/resources configuration

## Playwright Note

Playwright remains available for browser automation features in runtime, but the automated test suite intentionally prioritizes Bun-compatible tests. This avoids flaky `bunx`/browser-install coupling in CI while still validating feature wiring across CLI, API, and adapter layers.
