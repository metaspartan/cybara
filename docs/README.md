# Cybara Documentation

Welcome to Cybara, an AI agent platform with modular skills and beautiful UI.

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
bun run build:all

# Start production server (foreground)
bun run start

# Or: build + start in one command
bun run start:prod

# Compile to single binary
bun build src/main.ts --compile --outfile release/cybara

# Run as background daemon
./release/cybara start -d

# Stop daemon
./release/cybara stop

# Check status
./release/cybara status
```

### Available Scripts

| Script | Description |
|--------|-------------|
| `bun run dev` | Build + watch mode (full stack) |
| `bun run build` | Build backend only |
| `bun run build:all` | Build UI + backend + CLI |
| `bun run start` | Start production server |
| `bun run start:prod` | Build all + start |
| `bun run ui:dev` | UI dev server (Vite HMR) |
| `bun run ui:build` | Build UI for production |
| `bun run check` | TypeScript + ESLint + Prettier |


## Documentation

| Guide | Description |
|-------|-------------|
| [Architecture](./architecture.md) | Platform design and data flow |
| [CLI Reference](./cli.md) | Command-line interface |
| [Tools Reference](./tools.md) | 30+ available tools |
| [Skills Guide](./skills.md) | Creating and managing skills |
| [Channels](./channels.md) | Multi-platform messaging |
| [Providers](./providers.md) | AI provider configuration |
| [Configuration](./configuration.md) | Settings and environment |
| [API Reference](./api.md) | REST API endpoints |

## Core Concepts

### Agents
AI entities with configurable personalities, prompts, and tool access. Types:
- **main** - Primary conversational agent
- **research** - Information gathering
- **coder** - Software development
- **planner** - Task breakdown
- **ops** - System administration

### Sessions
Conversation contexts with message history, token tracking, and context management.

### Skills
Modular capabilities loaded from SKILL.md files with eligibility gating.

### Tools
Functions the agent can invoke (file I/O, browser, exec, web search, etc.).

### Channels
Communication interfaces (Telegram, Discord, Slack, WhatsApp, Signal, iMessage, Web).

## Support

- **Issues**: [GitHub Issues](https://github.com/metaspartan/cybara/issues)
- **Docs**: `/docs` in your installation

---

Built with Bun, TypeScript, React, and Playwright.
