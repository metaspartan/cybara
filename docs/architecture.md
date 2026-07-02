# Cybara Architecture

## Overview

Cybara is a Bun + TypeScript agent platform with:

- React web UI (`ui/`)
- Tauri desktop shell (`src-tauri/`)
- Bun sidecar/server (`src/`)

Current platform shape in this repo:

- Provider integrations with dynamic model discovery (`src/core/providers.ts`)
- Built-in tool schemas (`src/core/tools/index.ts`)
- Channel adapters for the major messaging platforms (`src/core/channels/adapters/`)
- Tool handler modules (`src/core/tools/handlers/`)

## Runtime Topology

```text
React UI / Tauri Desktop / External Channels
                  |
                  v
            Bun HTTP Server
      (REST + status SSE + terminal WS)
                  |
                  v
              Agent Core
      (session + prompt + tool loop)
                  |
      +-----------+------------+
      |           |            |
      v           v            v
    Tools      Providers     Channels
```

Transport model:

- REST for primary app APIs (`/api/*`)
- SSE for status events (`/api/sse/status`)
- WebSocket for terminal streaming (`/api/terminal/ws`)

## Entry Points

- `src/main.ts`
  - Binary entry and CLI/server router.
  - Handles daemon lifecycle (`cybara.pid`, optional `cybara.log`).
- `src/index.ts`
  - Starts Bun server.
  - Wires REST route handling, status SSE endpoint, terminal WebSocket upgrades, static UI serving.
- `src/cli.tsx`
  - Interactive terminal UI/commands.

## API Layer

- `src/api/routes.ts`
  - Main REST route multiplexer for providers, agents, sessions, channels, IDE, skills, memory, cron, MCP, metrics, config, OAuth, and diagnostics.
- `src/api/chat.ts`
  - Chat/session orchestration.
  - Returns JSON chat responses with optional `thinking`, `tool_calls`, and `process_activities`.
  - Persists sessions/messages and session titles.
- `src/api/terminal.ts`
  - PTY-backed terminal control endpoints.
- `src/api/ide-api.ts`
  - IDE file and code-intelligence operations.
- `src/api/security.ts`
  - API key auth, security headers, rate limiting, SSRF controls.

## Agent Core

- `src/core/agent.ts`
  - Provider invocation orchestration.
  - Tool execution loop with hooks/status updates.
  - Tool-call normalization across Anthropic-style and OpenAI-compatible flows.
- `src/core/system-prompt.ts`
  - Constructs system prompt sections from runtime context (workspace, tools, permissions, channel state, etc.).
- `src/core/session-context.ts`
  - Session persistence, context compaction, token budgeting.
- `src/core/session-title.ts`
  - Model-assisted session title derivation/normalization.
- `src/core/status.ts`
  - Live status fanout (thinking/generating/tool states) to SSE clients.

## Tools

Defined in `src/core/tools/index.ts`, executed via handlers in `src/core/tools/handlers/`.

Major families:

- File/process/runtime: `read`, `write`, `edit`, `grep`, `apply_patch`, `exec`, `process`, `env`
- Web/browser: `browser`, `web_fetch`, `web_search`, `http`
- Memory/artifacts: `memory_*`, `artifacts`
- Session/agent orchestration: `sessions_*`, `session_status`, `agents_list`
- Channel/media: `message`, `telegram_media`, `image`, `tts`, `video_frames`
- Dev/analysis: `git`, `lsp_*`, `pdf`, `ocr`, `data`, `calc`, `convert`

## Providers

Provider registry lives in `src/core/providers.ts`.

Supported auth patterns:

- API key providers
- OAuth providers (redirect/device code depending on provider)
- Local/self-hosted endpoints (for example Ollama)

Canonical discovery:

- API: `GET /api/providers/available`
- CLI: `cybara provider models <provider-id>`

## Channels

Channel adapters are in `src/core/channels/adapters/`:

- telegram
- discord
- slack
- signal
- whatsapp
- imessage
- web

Common command handling and session controls are implemented in `src/core/channels/commands.ts`.

## Data & Persistence

- Root data dir: `~/.cybara`
- Primary SQLite DB: `~/.cybara/data/platform.db`
- Related SQLite files: `platform.db-wal`, `platform.db-shm`
- Other runtime dirs: `~/.cybara/logs`, `~/.cybara/memory`, `~/.cybara/secure`

Core DB tables include:

- `agents`
- `sessions`
- `messages`
- `providers`
- `skills`
- `config`
- `cron_jobs`
- `cron_runs`

## High-Level File Layout

```text
src/
  main.ts                 # binary entry + daemon lifecycle
  index.ts                # Bun server (REST/SSE/WS/static)
  cli.tsx                 # CLI/TUI entry
  api/
    routes.ts             # API route handlers
    chat.ts               # chat/session orchestration
    terminal.ts           # PTY backend API
    ide-api.ts            # IDE API
    git-api.ts            # Git API
    security.ts           # auth/security
  core/
    agent.ts              # agentic execution loop
    providers.ts          # provider registry
    tools/
      index.ts            # tool schemas
      handlers/           # handler implementations
    channels/             # adapters + command parsing
    database.ts           # SQLite layer
    session-context.ts    # session persistence/compaction
    session-title.ts      # model-assisted title generation
    system-prompt.ts      # prompt assembly
    memory/               # memory store and helpers
    scheduler.ts          # cron/task scheduling
    status.ts             # live status broadcast
```
