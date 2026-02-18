# Cybara Documentation

Welcome to Cybara — a self-hosted AI agent platform with modular skills, browser automation, multi-channel messaging, and a beautiful web UI.

## Quick Start

```bash
# Clone & Install
git clone https://github.com/metaspartan/cybara.git && cd cybara
bun install
```

### Development

```bash
# Full dev mode (backend + UI with watch)
bun run dev

# UI only with hot reload
bun run ui:dev

# Backend only with watch
bun run --watch src/index.ts
```

### Production

```bash
# Build everything (UI + backend + CLI)
bun run package

# Run as background daemon
./release/cybara start -d

# Stop daemon
./release/cybara stop

# Check status
./release/cybara status
```

### Desktop (Tauri)

```bash
# Development mode (includes terminal support)
bun run tauri:dev

# Production build (macOS .dmg, Linux .deb/.rpm/.appimage)
bun run tauri:build
```

See [Desktop Guide](./desktop.md) for platform-specific build info.

### Available Scripts

| Script | Description |
|--------|-------------|
| `bun run dev` | Build + watch mode (full stack) |
| `bun run build` | Build backend only |
| `bun run build:all` | Build UI + backend + CLI + main entry |
| `bun run start` | Start production server |
| `bun run start:prod` | Build all + start |
| `bun run ui:dev` | UI dev server (Vite HMR) |
| `bun run ui:build` | Build UI for production |
| `bun test` | Run Bun test suite |
| `bun run check` | TypeScript + ESLint + Prettier |
| `bun run tauri:dev` | Tauri desktop dev mode |
| `bun run tauri:build` | Tauri desktop production build |
| `bun run package` | Build release binaries |


## Documentation

| Guide | Description |
|-------|-------------|
| [Architecture](./architecture.md) | Platform design and data flow |
| [CLI Reference](./cli.md) | Command-line interface |
| [Tools Reference](./tools.md) | 48 available tools |
| [Skills Guide](./skills.md) | Creating and managing skills |
| [Channels](./channels.md) | Multi-platform messaging |
| [Providers](./providers.md) | 26 AI provider configurations |
| [Configuration](./configuration.md) | Settings and environment |
| [API Reference](./api.md) | REST API endpoints |
| [Desktop](./desktop.md) | Tauri desktop client |
| [Security](./security.md) | Self-hosting security model |
| [Testing](./testing.md) | Automated test strategy and commands |

## Core Concepts

### Agents
AI entities with configurable personalities, prompts, and tool access. Types:
- **main** — Primary conversational agent
- **research** — Information gathering
- **coder** — Software development
- **planner** — Task breakdown
- **ops** — System administration
- **subagent** — Background worker
- **worker** — Task-specific agent

### Sessions
Conversation contexts with message history, token tracking, and adaptive context compaction.

### Skills
Modular capabilities loaded from SKILL.md files with eligibility gating (OS, env, binaries).

### Tools
48 functions the agent can invoke: file I/O, browser, exec, web search, memory, data processing, LSP, scheduling, and more.

### Channels
Communication interfaces: Telegram, Discord, Slack, WhatsApp, Signal, iMessage, Web.

### Memory
Vector store with hybrid BM25 search, durable MEMORY.md, and daily logs.

### Providers
26 AI providers: OpenAI, Anthropic, Google, Antigravity (OAuth), xAI, MiniMax, Moonshot, Kimi Code, Qwen (OAuth), Venice, Groq, OpenRouter, Ollama, Bedrock, GitHub Copilot, Synthetic, OpenCode Zen, Chutes, Xiaomi, Qianfan, and additional gateway/proxy integrations.

### Security
API key authentication, rate limiting, SSRF protection, path sandboxing. See [Security](./security.md).

## Support

- **Issues**: [GitHub Issues](https://github.com/metaspartan/cybara/issues)
- **Docs**: `/docs` in your installation

---

Built with Bun, TypeScript, React, Tauri, and Playwright.
