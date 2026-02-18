# Cybara Architecture

## Overview

Cybara is a Bun/TypeScript AI agent platform with a modular architecture, Tauri desktop client, and React web UI.

```
┌─────────────────────────────────────────────────────────────┐
│                     Web UI (React 19)                        │
│   Dashboard · Chat · IDE · Terminal · Skills · Memory ...    │
└─────────────────────────────┬───────────────────────────────┘
                              │ REST API + WebSocket + SSE
┌─────────────────────────────▼───────────────────────────────┐
│                       API Layer (Bun)                        │
│  /api/chat  /api/agents  /api/skills  /api/terminal  ...    │
└─────────────────────────────┬───────────────────────────────┘
                              │
┌─────────────────────────────▼───────────────────────────────┐
│                        Agent Core                            │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐          │
│  │   Session   │  │   Context   │  │   System    │          │
│  │  Manager    │  │  Compactor  │  │   Prompt    │          │
│  └─────────────┘  └─────────────┘  └─────────────┘          │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐          │
│  │  Scheduler  │  │  Subagent   │  │   Memory    │          │
│  │  (Cron)     │  │  Registry   │  │  (Vector)   │          │
│  └─────────────┘  └─────────────┘  └─────────────┘          │
└─────────────────────────────┬───────────────────────────────┘
                              │
       ┌──────────────────────┼──────────────────────┐
       │                      │                      │
┌──────▼──────┐  ┌────────────▼────────────┐  ┌─────▼─────┐
│   Channels  │  │        Providers        │  │   Tools   │
│ TG/Discord  │  │ 20 providers + OAuth    │  │  47 ops   │
│ Slack/etc.  │  │ + MCP servers           │  │  + MCP    │
└─────────────┘  └─────────────────────────┘  └───────────┘
```

## Core Components

### Entry Points

- **`src/main.ts`** — Binary entry point, routes to CLI or server via command allowlist
- **`src/index.ts`** — HTTP server, WebSocket handler, SSE events, static file serving
- **`src/cli.tsx`** — Interactive TUI using React/Ink (chat, wizard, menus, raw commands)

### Agent (`src/core/agent.ts`)
Manages AI agent lifecycle, message processing, and tool execution loop. Handles streaming responses, tool call parsing, and multi-turn conversations.

### Session Context (`src/core/session-context.ts`)
Adaptive context window management with 3-tier token estimation:
1. Fast estimate for quick decisions
2. Tiktoken for accurate counts
3. Model-specific adjustments

### System Prompt (`src/core/system-prompt.ts`)
Cybara-compatible prompt builder with sections:
- Identity, Tooling, Skills, Memory
- Workspace, Messaging, Reactions
- Sandbox, Documentation, Runtime

### Subagent Registry (`src/core/subagent-registry.ts`)
Tracks spawned background agents with:
- Disk persistence (`~/.cybara/subagent-registry.json`)
- Lifecycle events (start, end, error, archive)
- Announce flow for completion notifications
- Automatic cleanup via sweeper

### Scheduler (`src/core/scheduler.ts`)
Cron-based task scheduling with:
- Persistent cron job store (`src/core/cron/`)
- Run history tracking
- Agent-linked execution

### Browser Manager (`src/core/browser/pw-manager.ts`)
Playwright-based browser automation:
- Profile isolation with persistent user data dirs
- Element reference system (`[ref=eN]`) for AI interaction
- Visual mode for debugging
- PDF export and screenshot capture

### Memory System (`src/core/memory/`)
- Vector store with SQLite-backed embeddings
- BM25 hybrid search (keyword + semantic)
- Durable MEMORY.md for persistent facts
- Daily log files for session context

### MCP Integration (`src/core/mcp.ts`)
Model Context Protocol client:
- Stdio and HTTP/SSE transports
- Dynamic tool registration
- Multi-server concurrent connections
- Server registry (`src/core/mcp-registry.ts`)

## API Layer

### `src/api/routes.ts`
Main REST API handler with endpoints for agents, providers, skills, browser, channels, memory, cron, MCP, LSP, metrics, config, and OAuth.

### `src/api/chat.ts`
Chat API with SSE streaming, tool execution loop, and session management.

### `src/api/terminal.ts`
Web terminal backend using Python's PTY module via `Bun.spawn`. Creates real pseudo-terminals with character echo, prompt display, colors, line editing, and resize support.

### `src/api/security.ts`
API key authentication, rate limiting, SSRF protection, and security headers.

### `src/api/ide-api.ts`
IDE code intelligence API for file operations, Git status, and LSP integration.

## Data Flow

```
User Message → Channel/UI → Session → Agent → Provider → Response
                               │
                               ├── Tools (if invoked)
                               │       │
                               │       └── Browser/Exec/File/Memory/etc.
                               │
                               └── Subagent (if spawned)
                                       │
                                       └── Independent session → Report back
```

## Database

SQLite via `better-sqlite3`:
- `agents` — Agent configurations
- `sessions` — Conversation sessions
- `messages` — Message history
- `providers` — AI provider configs (encrypted API keys)
- `skills` — Installed skills
- `config` — Key-value settings
- `cron_jobs` — Scheduled tasks
- `cron_runs` — Task execution history

## File Layout

```
src/
├── main.ts                # Binary entry point (CLI/server router)
├── index.ts               # HTTP server + WebSocket + SSE
├── cli.tsx                # Interactive TUI (React/Ink)
├── api/
│   ├── routes.ts          # REST API route handlers
│   ├── chat.ts            # Chat API + streaming
│   ├── terminal.ts        # Web terminal (Python PTY bridge)
│   ├── ide-api.ts         # IDE code intelligence
│   ├── git-api.ts         # Git operations
│   ├── security.ts        # Auth + rate limiting + SSRF
│   └── queries.ts         # DB query helpers
└── core/
    ├── agent.ts           # Agent management + tool loop
    ├── channels/          # 7 channel adapters
    ├── database.ts        # SQLite layer
    ├── providers.ts       # 20 AI provider definitions
    ├── system-prompt.ts   # Prompt builder
    ├── session-context.ts # Context management
    ├── subagent-registry.ts # Subagent tracking
    ├── scheduler.ts       # Task scheduler
    ├── cron/              # Cron store + execution
    ├── browser/           # Playwright automation
    ├── lsp/               # Language server client
    ├── memory/            # Vector store + search
    ├── skills/            # Skill system
    ├── tools/             # 47 tools + 14 handler modules
    ├── mcp.ts             # MCP client
    ├── mcp-registry.ts    # MCP server registry
    ├── metrics.ts         # Token tracking
    ├── logger.ts          # Structured logging
    └── config.ts          # Configuration
```
