# Cybara Documentation

Cybara is a self-hosted agent workspace built around one Bun gateway. Persistent sessions, live tool activity, plans, artifacts, approvals, provider routing, and usage metrics stay available across Web/Tauri, native macOS, CLI/TUI, mobile, ACP, and messaging channels. Agents can work through repositories, terminals, browsers, desktops, and mobile simulators; gain capabilities from plugins, skills, MCP servers, and encrypted account apps; and produce replayable evaluations or training data in the Lab.

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
# Build a local release/cybara binary plus release UI assets
bun run package

# Run as background daemon
./release/cybara start -d

# Stop daemon
./release/cybara stop

# Check status
./release/cybara status
```

For release installs, updates, backups, and production operator guidance, see [Production Guide](./production.md).

### Desktop

```bash
# Development mode (includes terminal support)
bun run tauri:dev

# Production build (Tauri installers/packages for the host platform)
bun run tauri:build

# Production build with signed updater config
bun run tauri:build:release

# Native SwiftUI macOS app bundle
bun run native:macos:package

# React Native mobile companion
bun run mobile:dev
bun run mobile:ios
bun run mobile:android
bun run mobile:expo-check
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
| `bun run test:smoke` | CI smoke suite |
| `bun run check` | TypeScript + ESLint + Biome format check |
| `bun run check:ci` | Release quality gate |
| `bun run tauri:dev` | Tauri desktop dev mode |
| `bun run tauri:build` | Tauri desktop production build |
| `bun run tauri:build:release` | Tauri build with release updater config |
| `bun run tauri:sidecar` | Build platform sidecar and bundled sidecar runtime assets |
| `bun run native:macos:package` | Package the native SwiftUI macOS app bundle |
| `bun run native:macos:run` | Build UI + sidecar, then run the native SwiftUI macOS shell |
| `bun run mobile:dev` | Start the React Native mobile companion with Expo |
| `bun run mobile:expo-check` | Verify React Native/Expo dependency compatibility |
| `bun run mobile:typecheck` | Type-check the mobile companion |
| `bun run package` | Build local release/cybara binary and release UI assets |


## Documentation

| Guide | Description |
|-------|-------------|
| [Architecture](./architecture.md) | Platform design and data flow |
| [Agent Runtime](./agent-runtime.md) | Prompt composition, tool policy, memory, planning, and subagents |
| [CLI Reference](./cli.md) | Command-line interface |
| [Plugins](./plugins.md) | Installable plugin runtime and manifests |
| [Lab](./lab.md) | Trajectories, golden replays, benchmarks, and training-data exports |
| [Tools Reference](./tools.md) | Built-in tools, compatibility aliases, and execution contracts |
| [Skills Guide](./skills.md) | Creating and managing skills |
| [Channels](./channels.md) | Multi-platform messaging |
| [Providers](./providers.md) | Hosted, OAuth, local, gateway, and proxy providers |
| [Configuration](./configuration.md) | Settings and environment |
| [Production](./production.md) | Release installs, updates, backups, and operator guidance |
| [API Reference](./api.md) | REST API endpoints |
| [Desktop](./desktop.md) | Tauri + native macOS desktop release paths |
| [Native Shells](./native-shells.md) | SwiftUI macOS shell and mobile-shell strategy |
| [Mobile App](../apps/mobile/README.md) | React Native iOS/Android companion app |
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
Persistent conversation contexts with message history, grouped live activity, queueing, steering, stopping, forking, reverting, multi-chat panes, token tracking, and adaptive context compaction.

### Providers and Pools
Hosted, OAuth, gateway, proxy, and local providers can expose dynamically discovered models. Named account pools group multiple configured accounts for usage-balanced or priority routing, and agents or model-router routes can target those pools directly.

### Skills
Modular capabilities loaded from SKILL.md files with eligibility gating (OS, env, binaries).

### Tools
Built-in tools cover file I/O, browser and desktop automation, iOS/Android simulators, process execution, web research, memory, artifacts, data processing, LSP, scheduling, media generation, planning, dynamic tool discovery, wallet operations, and channels. Compatibility aliases normalize common calling conventions. Stable tool profiles, toolsets, explicit allowlists, and inherited policy determine the effective subset offered to a model.

### Plugins and Account Apps
Plugins can contribute skills, commands, hooks, MCP servers, providers, channels, and encrypted account apps. Account apps default to read-only access where supported, while write operations still pass through normal approval policy.

### Lab
The Lab captures replayable agent and computer-use trajectories, promotes selected runs to golden regression cases, executes objective benchmark suites, and exports curated data for analysis, supervised fine-tuning, sequence distillation, and multimodal workflows.

### Nearby
Nearby is an opt-in LAN transfer surface for pairing Cybara installations and moving sanitized sessions between them without exposing the gateway publicly.

### Channels
Communication interfaces include Telegram, Discord, Slack, WhatsApp, Signal, iMessage, Matrix, Mattermost, Microsoft Teams, Feishu/Lark, DingTalk, WeCom, Zulip, LINE, Google Chat, IRC, ntfy, Twitch, Nextcloud, Synology, Zalo, Home Assistant, Web, Webhook, SMS, and Email.

### Memory
Vector store with hybrid BM25 search, durable MEMORY.md, and daily logs.

### Providers
Built-in integrations cover popular providers including OpenAI, Anthropic, Google Gemini, xAI Grok, Z.AI, MiniMax, Kimi, Qwen, DeepSeek, and OpenRouter, plus local runtimes such as Ollama and vLLM. Supported model lists are discovered dynamically when available.

### Router + Provider Plans
Router strategies include weighted, round-robin, lowest-cost, priority, and mixture-of-agents. Provider plan monitoring can track local usage against coding-plan presets, manual limits, rolling 5-hour/week windows, monthly budgets, and router enforcement.

### Source Migration
Supported agent imports, including OpenCode, are available through `cybara migrate`, `/api/migrations/*`, Web/Tauri settings, mobile settings, and native macOS settings. Dry runs preview conversations, memories, instructions, skills, providers, speech settings, and opt-in API-key imports before writing.

### Speech
Shared speech settings cover local, operating-system, and cloud voices, native and provider-backed transcription, and managed or full-duplex hands-free conversation across Web/Tauri, mobile, native macOS, and the speech tools.

### Security
API key authentication, rate limiting, SSRF protection, path sandboxing. See [Security](./security.md).

## Support

- **Issues**: [GitHub Issues](https://github.com/metaspartan/cybara/issues)
- **Docs**: `/docs` in your installation

---

Built with Bun, TypeScript, React, Tauri, and Playwright.
