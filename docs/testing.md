# Testing Guide

Cybara uses Bun-native automated tests for core backend, API routes, CLI, channel adapters, runtime packaging, mobile helpers, and key UI/Tauri seams. Core modules have dedicated unit tests covering pure logic (prompt caching, path policy, error classification, rate-limit/credential rotation, retry, kanban orchestration, media-generation registry, planning tools, workspace indexing, embedding batching, and versioning helpers).

## Run Everything

```bash
bun run test           # all unit/integration tests (core, api, channels, cli, runtime, mobile, ui)
bun run test:core      # core unit tests only (fast, no network)
bun run test:smoke     # CI gate: core + runtime + security + e2e
bun run test:smoke:full # broader live E2E smoke suite
bun run check          # typecheck + lint + format check
bun run check:ci       # release quality gate
bun run build:all
```

## Supply Chain Checks

```bash
bun run audit:root
bun run audit:ui
bun run audit:mobile
bun run tauri:audit
bun run security:osv
bun run audit:ci
```

## Focused Test Runs

```bash
# Core unit tests for the new engine modules
bun test tests/core/prompt-cache.test.ts
bun test tests/core/path-policy.test.ts
bun test tests/core/error-classifier.test.ts
bun test tests/core/rate-limit-tracker.test.ts
bun test tests/core/credential-pool.test.ts
bun test tests/core/retry.test.ts
bun test tests/core/kanban.test.ts
bun test tests/core/media-generation.test.ts
bun test tests/core/planning-tools.test.ts
bun test tests/core/versioning-helpers.test.ts
bun test tests/core/source-migration.test.ts
bun test tests/core/provider-plans.test.ts
bun test tests/core/memory-providers.test.ts
bun test tests/core/router.test.ts

# CLI command integration (mocked API server)
bun test tests/cli/commands.test.ts

# Channel adapter and security flows
bun test tests/channels

# API route integration (self-hosted ephemeral server)
bun test tests/api/routes.test.ts

# Speech, gateway controls, source migration, and provider-plan API client contracts
bun test tests/api/routes.test.ts
bun test tests/ui/api-client.test.ts
bun test tests/mobile/api-client.test.ts

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

# React Native mobile companion helpers
bun run test:mobile
bun run mobile:expo-check
bun run mobile:typecheck

# Build script/platform mapping
bun test tests/scripts

# Sidecar runtime packaging and import guards
bun test tests/scripts/build-sidecar.test.ts tests/core/sidecar-startup-imports.test.ts

# End-to-end smoke flows (live server + CLI/UI/terminal)
bun test tests/e2e

# Real browser IDE smoke (builds UI, starts an isolated server, opens and switches .ts files)
RUN_BROWSER_E2E=1 bun test tests/e2e/ide-web-ui-browser-smoke.test.ts

# Chat/session/log/metrics end-to-end contracts (live server)
bun test tests/e2e/chat-logs-metrics-smoke.test.ts

# Chat queue, steering, live activity, and remount persistence regression checks
bun test tests/api/chat-session-serialization.test.ts tests/ui/chat-live-activity-persistence.test.ts

# Stateful CLI + API end-to-end contracts (live server)
bun test tests/e2e/stateful-cli-api-workflow.test.ts

# Persistence + SSE end-to-end resilience checks (live server)
bun test tests/e2e/persistence-and-sse-smoke.test.ts

# Security auth end-to-end checks (production API key + dev localhost bypass)
bun test tests/e2e/security-auth-smoke.test.ts

# CLI auth behavior against production API-key enforcement
bun test tests/e2e/cli-auth-smoke.test.ts

# Runtime guards (path hardcoding, package scripts, UI path resolution, IDE hook order)
bun test tests/runtime

# Tauri desktop wiring guards
bun test tests/tauri

# Native macOS wiring and parity guards
bun test tests/runtime/native-macos-shell-wiring.test.ts tests/runtime/native-macos-speech-settings.test.ts

# Agent/tool governance guardrails (circular import, allowlist, permissions)
bun test tests/core/tool-schema-import.test.ts tests/core/agent-tool-allowlist.test.ts tests/core/tool-permissions.test.ts
```

## Coverage Areas

- Channel adapters: Discord, Telegram webhook, Slack, WhatsApp, Signal, iMessage
- Slack mention security: `app_mention` now enforces pairing/allowlist checks (no access-policy bypass via mentions)
- Agent/tool guardrails: lazy built-in tool import stability, agent tool allowlist enforcement, optional permission enforcement contexts
- Channel security and pairing flows
- Channel manager lifecycle (start/stop/update/delete/masking)
- CLI command wiring: providers, channels, pairing, MCP, tasks, skills, sessions, memory, logs, subagents
- CLI/TUI source wiring: direct status, metrics, providers, router, sessions, logs, mobile, tasks, and skills panels stay listed in source and docs
- UI/Tauri utility seam: `openExternal` backend-first with browser fallback
- React Native mobile companion: gateway payload parsing, API auth/fallback behavior, profile persistence, and mobile app script wiring/typecheck
- React Native mobile companion: provider plan settings/status, speech settings, memory providers, gateway restart/logs, metrics snapshots, and LAN pairing URL normalization
- Native macOS shell: gateway attach/start/restart, migration controls, speech settings, provider plan status, and sidecar packaging/signing seams
- UI API client contracts: chat/session routes, logs query params, skill execute wiring
- Chat queue/steering: pending-message ordering, edit/delete/reorder, steer injection history order, session remount persistence, live activity grouping, and hidden-tool-call serialization
- IDE React regression guard: `CodeViewer` keeps top-level hooks before loading/error/empty render returns, preventing React error #300 (`Rendered fewer hooks than expected`)
- UI auth token helpers and guardrails: shared `apiFetch` bearer injection and no direct `fetch('/api/...')` bypasses
- Tauri sidecar build target mapping
- Browser route contracts (mocked manager): tabs lifecycle, navigate/click/type forwarding, snapshot/screenshot encoding
- Channel security contracts (mocked manager): pairings mapping, verify/reject, allowlist, DM policy config
- Open URL route contracts (mocked opener): valid URL delegation, localhost/private blocking, error-path header consistency
- API security module: auth behavior, rate limiting, URL validation, input sanitization
- API route integration extras: health/live/ready + setup/info, provider catalog + OAuth validation/callback-status, channel type metadata + telegram webhook contracts, MCP lifecycle + registry contracts, LSP status/diagnostics/install validation, tool catalog/execute validation, subagent list/get/spawn/kill contracts, skills categories/status/registry search, task lifecycle, builtin skill execution, IDE/git route contracts (including HOME sandbox sibling-prefix and symlink escape blocking), system prompt/identity persistence, open-url scheme/localhost blocking
- Metrics route resilience: malformed `metrics.metadata` JSON does not break providers/tokens/files/tools endpoints; large dashboard routes are guarded by cached/prewarmed route contracts and token-analysis/time-series performance checks
- Source migration: OpenClaw/Hermes dry-run/apply flows, skill conflict modes, memory/persona/provider/speech import reporting, and CLI/API/native settings wiring
- Provider plan monitoring: config normalization, preset suggestions, local usage windows, router enforcement constraints, and Web/mobile/native UI wiring
- Speech: shared settings normalization, native dictation mode behavior, server transcription validation, ElevenLabs provider testing, Web/Tauri chat dictation controls, mobile speech route, and native macOS speech settings
- Channel/session/task/agent/config JSON resilience: malformed `channels.config`, `session_messages.metadata`, `tasks.config`, `agents.config`, `config.value` (`systemPrompt`/`identity`), and runtime agent prompt config no longer break API recovery/listing/update/start flows
- Telegram command behavior: `/model` and `/memory` summary/search command contracts
- Cross-channel management command routing: adapter-level `/model` execution path regression checks (Slack + shared command layer)
- Live E2E smoke: server startup, CLI↔API calls, UI route serving, terminal REST+WebSocket flow
- Live E2E contracts: chat -> session persistence -> log queries/stats -> metrics dashboards/system status
- Live E2E stateful workflow: CLI provider/config/channels/tasks commands against a real server, plus sessions/memory visibility
- Live E2E resilience: config/memory/channel/task persistence across restart and `/api/sse/status` initial stream event
- Live E2E security auth: production API-key enforcement, header contract (`WWW-Authenticate`), development localhost bypass behavior, stricter chat/OAuth/pairing rate-limit windows, terminal REST/WebSocket auth enforcement, status SSE auth enforcement (including `token` and `api_key` query auth), and rate-limit headers on validation errors
- Live E2E CLI auth: protected command behavior with missing auth, `CYBARA_API_KEY` env auth, `~/.cybara/api_key` fallback, and env-vs-file precedence
- Opt-in browser E2E: `RUN_BROWSER_E2E=1 bun test tests/e2e/ide-web-ui-browser-smoke.test.ts` builds the UI, starts a live isolated server, completes setup, opens a TypeScript file in `/ide`, switches to another TypeScript file through the explorer, and fails on React hook-order/runtime errors
- Runtime guards: no hardcoded workspace paths, package script contracts, compiled UI path resolution
- Sidecar runtime packaging: Tauri sidecar target mapping, dynamic ONNX `napi-v*` binding discovery, packaged `CYBARA_RESOURCE_DIR` runtime lookup, and lazy imports for `@huggingface/transformers` / ONNX Runtime
- Tauri wiring contracts: sidecar spawn/kill and bundled UI/resources configuration
- Supply chain checks: Bun audit for root/UI packages, Cargo audit for desktop crates, and OSV source scanning for lockfile advisories

## Playwright Note

Playwright remains available for browser automation features in runtime. The default automated suite intentionally prioritizes Bun-compatible tests to avoid flaky browser-install coupling in CI while still validating feature wiring across CLI, API, and adapter layers. For release and open-source readiness checks, run the opt-in real browser smoke with `RUN_BROWSER_E2E=1 bun test tests/e2e/ide-web-ui-browser-smoke.test.ts`.
