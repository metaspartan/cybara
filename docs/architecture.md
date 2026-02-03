# Cybara Architecture

## Overview

Cybara is a Bun/TypeScript AI agent platform with a modular architecture.

```
┌─────────────────────────────────────────────────────────────┐
│                         Web UI (React)                       │
└─────────────────────────────┬───────────────────────────────┘
                              │ REST API
┌─────────────────────────────▼───────────────────────────────┐
│                       API Layer (Hono)                       │
│  /api/chat  /api/agents  /api/skills  /api/browser  ...     │
└─────────────────────────────┬───────────────────────────────┘
                              │
┌─────────────────────────────▼───────────────────────────────┐
│                        Agent Core                            │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐          │
│  │   Session   │  │   Context   │  │   System    │          │
│  │  Manager    │  │  Compactor  │  │   Prompt    │          │
│  └─────────────┘  └─────────────┘  └─────────────┘          │
└─────────────────────────────┬───────────────────────────────┘
                              │
       ┌──────────────────────┼──────────────────────┐
       │                      │                      │
┌──────▼──────┐  ┌────────────▼────────────┐  ┌─────▼─────┐
│   Channels  │  │        Providers        │  │   Tools   │
│ TG/Discord  │  │ OpenAI/Anthropic/etc    │  │  30+ ops  │
└─────────────┘  └─────────────────────────┘  └───────────┘
```

## Core Components

### Agent (`src/core/agent.ts`)
Manages AI agent lifecycle, message processing, and tool execution.

### Session Context (`src/core/session-context.ts`)
Adaptive context window management with 3-tier token estimation:
1. Fast estimate for quick decisions
2. Tiktoken for accurate counts
3. Model-specific adjustments

### System Prompt (`src/core/system-prompt.ts`)
OpenClaw-compatible prompt builder with sections:
- Identity, Tooling, Skills, Memory
- Workspace, Messaging, Reactions
- Sandbox, Documentation, Runtime

### Subagent Registry (`src/core/subagent-registry.ts`)
Tracks spawned background agents with:
- Disk persistence (`~/.cybara/subagent-registry.json`)
- Lifecycle events (start, end, error, archive)
- Announce flow for completion notifications
- Automatic cleanup via sweeper

### Browser Manager (`src/core/browser/pw-manager.ts`)
Playwright-based browser automation:
- Profile isolation
- Element reference system (`[ref=eN]`)
- Visual mode for debugging

## Data Flow

```
User Message → Channel → Session → Agent → Provider → Response
                           │
                           └── Tools (if invoked)
                                   │
                                   └── Browser/Exec/File/etc
```

## Database

SQLite via `better-sqlite3`:
- `agents` - Agent configurations
- `sessions` - Conversation sessions
- `messages` - Message history
- `providers` - AI provider configs
- `skills` - Installed skills
- `config` - Key-value settings

## File Layout

```
src/
├── index.ts              # Entry point
├── api/
│   ├── routes.ts         # Route handlers
│   └── chat.ts           # Chat API
└── core/
    ├── agent.ts          # Agent management
    ├── channels.ts       # Multi-channel
    ├── database.ts       # SQLite
    ├── providers.ts      # AI providers
    ├── system-prompt.ts  # Prompt builder
    ├── session-context.ts # Context management
    ├── subagent-registry.ts # Subagent tracking
    ├── browser/          # Playwright
    ├── skills/           # Skill system
    └── tools/            # Tool handlers
```
