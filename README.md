<p align="center">
  <img src="cybara.png" alt="Cybara" width="120" />
</p>

<h1 align="center">Cybara</h1>

<p align="center">
  <strong>Self-hosted AI agent platform for real work: code, channels, browser automation, and on-chain execution.</strong>
</p>

<p align="center">
  Cybara combines a Bun-based agent runtime with a web UI, CLI, desktop shells, mobile companion,
  encrypted local wallet controls, channel adapters, MCP support, and a broad tool layer. Run agents
  that can code, automate browsers, manage messaging workflows, and execute wallet operations while
  keeping operator control in the loop.
</p>

<p align="center">
  <a href="https://github.com/metaspartan/cybara/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/metaspartan/cybara/ci.yml?branch=main&label=CI&logo=github" alt="CI" /></a>
  <a href="LICENSE.md"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="License: MIT" /></a>
  <a href="https://github.com/metaspartan/cybara/releases"><img src="https://img.shields.io/github/v/release/metaspartan/cybara?include_prereleases&display_name=tag&sort=semver" alt="Release" /></a>
  <a href="https://github.com/metaspartan/cybara/releases"><img src="https://img.shields.io/github/downloads/metaspartan/cybara/total?label=downloads" alt="Total Downloads" /></a>
  <img src="https://img.shields.io/badge/runtime-Bun-f9f1e1?logo=bun" alt="Bun" />
  <img src="https://img.shields.io/badge/language-TypeScript-blue?logo=typescript" alt="TypeScript" />
  <img src="https://img.shields.io/badge/ui-React_19-61dafb?logo=react" alt="React" />
  <img src="https://img.shields.io/badge/desktop-Tauri-orange?logo=tauri" alt="Tauri Desktop" />
  <img src="https://img.shields.io/badge/mobile-React_Native-61dafb?logo=react" alt="React Native Mobile" />
</p>

---

## What Cybara Is

Cybara is an agent operating system for developers and operators who want one stack for:

- AI chat and multi-agent orchestration
- local and remote tool execution
- browser and API automation
- secure messaging channels across platforms including Telegram, Discord, Slack, WhatsApp, Signal, iMessage, Matrix, Mattermost, Microsoft Teams, Feishu/Lark, DingTalk, WeCom, Zulip, LINE, Google Chat, IRC, ntfy, Twitch, Nextcloud, Synology, Zalo, Home Assistant, Web, Webhook, SMS, and Email
- encrypted wallet operations across ETH/BTC/SOL with policy controls

If you need an agent platform that can plan, execute, verify, and report with strong operator control, Cybara is built for that.

---

## Capability Snapshot

- A broad built-in tool library with compatibility aliases and intent-aware exposure, so agents receive only the relevant allowed subset for a turn
- A broad provider catalog with dynamic model discovery (`src/core/providers.ts`), including Azure OpenAI, Azure AI Foundry, Anthropic on Vertex AI, and Google Gemini on Vertex AI
- Channel adapters for the major messaging platforms (`src/core/channels/adapters`)
- Model provider router with weighted / round-robin / lowest-cost / priority / mixture-of-agents strategies, circuit breaker, rate limits, spend caps, and coding-plan limit awareness
- Mixture of Agents (MoA): fan a turn out to several proposer agents and synthesize one answer — available both as a `mixture_of_agents` tool and as a router strategy
- Self-improving skills: agents can codify a verified multi-step procedure with `skill_save`, and the loader picks it up for future sessions
- ACP (Agent Client Protocol) server so editors like Zed can drive an agent (`cybara acp`)
- A web UI with dashboard, chat, IDE, terminal, tools, MCP, mobile pairing, wallet, and settings surfaces
- Bundled skills (`skills/`), including fal.ai media guidance and mactop hardware monitoring when available on macOS
- Anthropic prompt caching, multi-key credential pools + rate-limit rotation, and a centralized LLM error taxonomy
- Smart context compaction (token-aware chunking + structured summaries with identifier preservation)
- Project instruction and context loading for `AGENTS.md`, `SOUL.md`, `IDENTITY.md`, `USER.md`, and `TOOLS.md` at the selected workspace root
- Interactive tool approval with per-session/persistent allowlists, filesystem checkpoint/snapshot+rollback, and transform hooks (tool_result/llm_output/terminal_output)
- Token streaming to the UI (real-time assistant text deltas via WebSocket)
- MCP host mode (expose cybara's tools to other MCP clients) + MCP client (consume external servers)
- Local workspace indexing with lexical search plus optional local Transformers.js embeddings; packaged desktop sidecars bundle Transformers.js, ONNX Runtime native binaries when available, and ONNX Web/WASM fallback assets
- Source migration from supported legacy agent installations with dry-run previews, conflict handling, skill/memory import, and opt-in secret import
- Shared speech settings for TTS via system/ElevenLabs/OpenAI and STT via native dictation or OpenAI-compatible transcription
- Gateway operator controls for localhost auth policy, API-key reveal/rotation, gateway restart, and log viewing
- Media generation (image/video/music) via swappable provider registry, dynamic tool discovery, a tool-calling code sandbox, desktop control with safety hardening, and a multi-agent kanban orchestration tier
- Tauri desktop app + native SwiftUI macOS app + React Native mobile companion + Bun server/CLI runtime

---

## Quick Start (Bun-Only)

Cybara uses **Bun only** for install, run, and test flows.

```bash
# Clone
git clone https://github.com/metaspartan/cybara.git
cd cybara

# Install dependencies
bun install

# Start full dev stack (backend + built UI + watch)
bun run dev
```

Then open:

- UI: `http://localhost:4269`
- API health: `http://localhost:4269/api/health`

## Install CLI From Releases

For a release binary install on macOS/Linux:

```bash
curl -fsSL https://raw.githubusercontent.com/metaspartan/cybara/main/install.sh | bash
```

To pin a specific release:

```bash
curl -fsSL https://raw.githubusercontent.com/metaspartan/cybara/main/install.sh | bash -s -- --version 1.0.818
```

Then update later with:

```bash
cybara update              # verify SHA256, then download + install
cybara update --check      # just report whether a newer release exists (non-zero if stale)
cybara update --force      # reinstall even when already current
```

Every CLI release ships with per-asset SHA256 sidecars; `cybara update` and `install.sh` both verify the checksum before installing, and refuse an unverified binary unless you pass `--force`.

The desktop app now checks the same GitHub release channel from `Settings -> Desktop Updates` and can install signed app updates in place.

Production deployment guidance: [docs/production.md](docs/production.md)

## Desktop And Native Apps

Cybara ships two desktop shells over the same Bun sidecar/runtime contract:

- Tauri desktop for macOS, Windows, and Linux, including signed updater artifacts through GitHub Releases
- Native SwiftUI macOS shell in `apps/macos/Cybara`, packaged as a `.app` bundle with the compiled sidecar, web UI, `secp256k1.wasm`, and local indexing runtime assets

```bash
bun run tauri:dev            # Tauri desktop dev mode
bun run tauri:build          # Tauri production build
bun run tauri:build:release  # Tauri build with updater config/signatures
bun run native:macos:run     # Build UI + sidecar, then run the SwiftUI shell
bun run native:macos:package # Build native SwiftUI .app + zip
```

See [docs/desktop.md](docs/desktop.md) and [apps/macos/Cybara/README.md](apps/macos/Cybara/README.md).

## Mobile Companion

Cybara Mobile is a dark Liquid Glass-inspired React Native app for iOS and Android. It connects to a Cybara gateway already running from CLI, Tauri/Web UI, native macOS, or a hosted deployment, then manages remote sessions and operator settings.

```bash
bun run mobile:dev
bun run mobile:ios
bun run mobile:android
bun run mobile:expo-check

# on the device running Cybara
cybara mobile connect --url http://192.168.1.20:4269 --device "Carsen iPhone"
```

The CLI and Web UI/Tauri `Mobile` page create QR pairings with revocable per-device tokens, so a phone can be revoked without rotating the root gateway API key. Pairing can use LAN access or a configured remote access URL from Settings → Gateway, including private mesh networks such as Tailscale/ZeroTier/NetBird or password-protected HTTPS tunnels. The mobile surface covers gateway health, sessions, agents, providers, provider plan limits, metrics, speech settings, tool approvals, wallet policy, channels, tasks, memory, terminal/log entrypoints, gateway controls, and settings summaries. See [apps/mobile/README.md](apps/mobile/README.md).

Release CI exports Expo bundles for iOS and Android and can also build signed Android AAB/APK and iOS IPA/TestFlight artifacts when the relevant store signing secrets are configured.

---

## Docker

Build and run a production container:

```bash
docker build -t cybara:latest .
docker run --rm -p 4269:4269 \
  -e CYBARA_API_KEY=cybara_dev_key \
  -v ~/.cybara:/root/.cybara \
  cybara:latest
```

Then open `http://localhost:4269`.

---

## Core Features

### Multi-Agent Runtime

- Multiple agent types (`main`, `research`, `coder`, `planner`, `ops`, `subagent`, `worker`)
- Subagent spawning and lifecycle management
- Session-aware execution with persistence and recovery
- Agent tool allowlist and permission enforcement support

### Tooling Layer

Tool categories currently shipped:

- `file`: read/write/edit/search/grep/workspace_index/apply_patch — with a hard path-safety deny-list (credentials, SSH keys, `.env`) enforced before every write
- `process`: exec/process/git
- `browser`: browser/web_fetch/web_search/canvas
- `memory`: search/get/save/context/durable save
- `core`: sessions/agents/artifacts/wallet/http/env/data/nodes/clipboard/cron/gateway/etc.
- `lsp`: diagnostics/definition/references/hover/languages
- `media`: image/tts + **image_generate** / **video_generate** / **music_generate** via a swappable provider registry (OpenAI, fal.ai with `FAL_KEY` or `FAL_API_KEY`)
- `skill`: calc/convert/pdf/ocr/summarization/video_frames/weather/mactop + **skill_save** (agents codify a successful procedure as a reusable skill for future sessions)
- `channel`: message/telegram_media
- `planning`: **todo** (session task-list with status discipline) + **clarify** (structured multi-choice questions to the user)
- `discovery`: **tool_search** / **tool_describe** / **tool_call** (dynamic discovery over built-in + MCP + skills) + **execute_code** (run code that calls cybara tools programmatically)
- `media`: **computer_use** (background desktop control via cua-driver — capture/click/type/scroll/drag without stealing the cursor)
- `orchestration`: the **kanban** multi-agent tier — show/list/complete/block/heartbeat/comment/create/unblock/link for durable task graphs — plus **mixture_of_agents** (fan out to N proposer agents, synthesize one answer)

See full reference: [docs/tools.md](docs/tools.md)

### Execution Sandboxing

- Configurable command sandbox for `exec`/`git` tool calls
- Auto provider selection:
  - Apple Silicon: `sandbox-exec`
  - Linux: `podman`
  - Cross-platform container fallback: `docker`
- Configurable network mode (`allow` or `deny`) for sandboxed execution
- Managed via Settings UI (`Command Sandbox`) or config key `sandbox_runtime`

### Encrypted Wallet + Crypto Automation

- Local encrypted BIP39 vault (24-word seed phrase)
- Multi-chain addresses and balances: ETH, BTC, SOL
- Native transfers + token transfers (ERC-20/SPL)
- Transaction history and receive/send flows
- On-chain operations:
  - ETH contract calls
  - Solana program instructions
  - Uniswap (v2/v3) + Jupiter swap paths
  - Oracle/price quote flows (Chainlink/Pyth/Jupiter)
  - x402 payment flow support (v1/v2 patterns)
- Agent wallet access toggle (off by default) with policy controls

### Channels + Pairing Security

Adapters (26):

- Telegram, Discord, Slack, WhatsApp (`whatsapp-web.js`), Signal (`signal-cli`), iMessage (BlueBubbles)
- Matrix, Mattermost, Microsoft Teams, Feishu/Lark, DingTalk, WeCom, Zulip, LINE, Google Chat, IRC, ntfy, Twitch, Nextcloud, Synology, Zalo, Home Assistant
- Web chat, Webhook (inbound — signed triggers from CI, monitoring, forms; HMAC-SHA256 verified), SMS (Twilio), Email (SMTP send + IMAP poll)

Inbound webhook adapters verify signatures with constant-time comparison (`crypto.timingSafeEqual`).

DM policy modes:

- `pairing`
- `allowlist`
- `open`
- `disabled`

### Mobile Pairing Security

- Expiring one-time pairing codes (10-minute default TTL, single-use, rate-limited)
- Named roles map to capability scopes: `full` / `standard` / `readonly`
- Per-device scopes gate what a paired device may do: `chat`, `manage`, `read`, `wallet`, `terminal` — so a phone can be granted chat access without wallet or terminal
- Device tokens are stored hashed (SHA-256) and compared in constant time; any device can be revoked without rotating the root gateway API key

### UI + Desktop

- Web UI covering agents, channels, providers, routing, tools, wallet, logs, metrics, tasks, sessions, IDE, terminal, setup, artifacts, skills, MCP servers, LSP, chat, dashboard, memory, mobile pairing, source migration, speech settings, and gateway controls
- Tauri desktop app with sidecar server wiring, bundled runtime resources, and in-app signed update checks via GitHub Releases
- Native SwiftUI macOS app in `apps/macos/Cybara` that reuses the same local Cybara sidecar contract and can be packaged into a signed/notarized `.app` bundle

### Provider Layer

Cybara supports popular providers including OpenAI, Anthropic, Google Gemini, xAI Grok, Z.AI, MiniMax, Kimi, Qwen, DeepSeek, and OpenRouter, plus local runtimes such as Ollama and vLLM. Model lists are discovered dynamically when supported.

Provider plan monitoring tracks local usage against manual limits or provider-specific coding-plan presets. The router can enforce rolling 5-hour, rolling-week, and monthly windows for flat coding plans, while pay-as-you-go routes can use token pricing and monthly budgets for spend-aware routing.

Multi-key **credential pools** (`ANTHROPIC_API_KEY`, `_2`, `_3`, …) rotate automatically on rate-limit/auth errors, and **Anthropic prompt caching** (`cache_control`) is applied to every Claude request for ~75% input-token savings on multi-turn sessions.

See provider details: [docs/providers.md](docs/providers.md)

### MCP Host + Client

Cybara both **consumes** external MCP servers (extending agent capabilities) and **exposes itself** as an MCP server so other clients can call cybara's tools:

- **Consume** (client): register servers in Settings → MCP or via the CLI; tools are automatically exposed to agents
- **Host** (server): run `cybara mcp serve` to expose built-in tools to MCP clients over stdio JSON-RPC

MCP server management and registry integration:

- **MCP Server Management**: Install, configure, start, stop, and manage MCP servers via UI or CLI
- **MCP Registry Integration**: Browse and install servers from multiple registries:
  - Official MCP registry
  - [MCP.so](https://mcp.so) registry
  - [Smithery](https://smithery.ai) registry
  - Bun-compatible package installation
- **Popular Pre-configured Servers**: Filesystem, GitHub, GitLab, PostgreSQL, SQLite, Puppeteer, Brave Search, Google Maps, Slack, Fetch, Obsidian, Raycast, and more
- **Tool Exposure**: MCP server tools are automatically exposed to agents with full JSON-RPC communication

UI: Dedicated MCP Servers page in the web interface (`/mcp-servers`)
CLI: `cybara mcp list`, `cybara mcp search <query>`, `cybara mcp install <package>`, `cybara mcp popular`, `cybara mcp serve`

---

## Common Scripts

```bash
bun run dev          # Full dev flow
bun run build        # Build backend
bun run build:all    # Build UI + backend + CLI + main
bun run start        # Run built backend
bun run start:prod   # Build all then run
bun run package      # Build local release/cybara + release UI assets

bun test             # Full test suite
bun run test:smoke   # Runtime + API + E2E smoke
bun run test:smoke:full  # Broader live E2E smoke suite
RUN_BROWSER_E2E=1 bun test tests/e2e/ide-web-ui-browser-smoke.test.ts  # Real browser IDE smoke
bun run check        # Typecheck + lint + format check
bun run check:loc    # Enforce max TS/TSX file size
bun run check:ci     # CI gate (typecheck + lint + loc + Expo mobile check + smoke + deadcode report)

bun run tauri:dev    # Desktop dev mode
bun run tauri:sidecar # Build the platform sidecar and bundled sidecar runtime assets
bun run tauri:build  # Desktop production build
bun run tauri:prepare-release   # Generate signed updater config from env
bun run tauri:build:release     # Build desktop app with updater artifacts
bun run native:macos:build      # Build the SwiftUI macOS app shell from source
bun run native:macos:run        # Build UI + sidecar, then run the SwiftUI shell
bun run native:macos:package    # Package the native SwiftUI macOS app bundle
bun run mobile:typecheck        # Type-check React Native companion
bun run test:mobile             # Mobile helper tests
```

---

## API Highlights

Cybara exposes a broad REST API and streaming interfaces.

Common surfaces:

- Chat & sessions: `/api/chat`, `/api/sessions` (legacy `/api/chat/sessions` remains supported)
- Agents/providers/channels/tasks/skills/memory/mcp
- Router and provider plans: `/api/router/*`, `/api/provider-plans/*`
- Wallet and dapp routes under `/api/wallet/*`
- Migration and speech: `/api/migrations/*`, `/api/speech/*`
- Gateway administration: `/api/auth/*`, `/api/system/restart`
- Browser + terminal automation endpoints
- Status streams:
  - SSE: `/api/sse/status`
  - WebSocket: `/api/ws/status`

Full reference: [docs/api.md](docs/api.md)

---

## CLI Highlights

```bash
cybara chat
cybara chat --agent agent-codex --workspace ~/Documents/GitHub/cybara
cybara chat steer <session-id> <pending-id>
cybara tui chat
cybara tui usage
cybara tui providers
cybara tui router
cybara tui channels
cybara tui memory
cybara tui tools
cybara status
cybara gateway logs --tail 100
cybara models <provider-id>
cybara doctor
cybara provider available
cybara completion zsh
cybara channels
cybara wallet status
cybara wallet swap --venue uniswap_v3 --token LINK --amount-eth 0.2
cybara wallet x402 --url https://merchant.example/x402/resource --dry-run
cybara subagent spawn "Research X and return a summary"
cybara subagent wait <run-id> --timeout 120
cybara mcp list
cybara mcp search <query>
cybara mcp install <package>
cybara migrate sources
cybara migrate --from <source> --apply --preset user-data
```

The terminal chat supports the same session-oriented workflow as the app clients: history reload,
queued follow-ups while a run is active, steering, pending-message edit/delete/reorder, agent
switching, workspace switching, markdown emphasis, and grouped tool/activity output.

Full CLI reference: [docs/cli.md](docs/cli.md)

---

## Agent Runtime Contract

Cybara builds each model request from the effective runtime state rather than one static prompt:

- the selected agent, provider/model, workspace, channel, sandbox, and approval mode
- only tools that survive agent selection, intent routing, permission checks, and runtime availability
- eligible skill descriptions with on-demand `SKILL.md` loading
- bounded memory recall and workspace instruction files
- session plans, subagent context, token budgets, and context-compaction state

Tool policy and sandbox enforcement remain authoritative even if prompt text or untrusted content
claims otherwise. See [Agent Runtime and Prompt Architecture](docs/agent-runtime.md) for the
implemented contract.

---

## Documentation

| Guide | Description |
|-------|-------------|
| [Architecture](docs/architecture.md) | Platform design and data flow |
| [API](docs/api.md) | REST and streaming API |
| [Agent Runtime](docs/agent-runtime.md) | Prompt composition, tools, memory, planning, and subagents |
| [CLI](docs/cli.md) | Command reference |
| [Channels](docs/channels.md) | Channel setup and in-channel commands |
| [Configuration](docs/configuration.md) | Runtime config and environment |
| [Desktop](docs/desktop.md) | Tauri desktop app and native macOS release paths |
| [Native Shells](docs/native-shells.md) | SwiftUI macOS and mobile-shell strategy |
| [Mobile App](apps/mobile/README.md) | React Native iOS/Android companion |
| [Production](docs/production.md) | Release installs, updates, signing, and operator guidance |
| [Providers](docs/providers.md) | Provider setup and models |
| [Security](docs/security.md) | Auth, sandboxing, and safeguards |
| [Skills](docs/skills.md) | Skill authoring and lifecycle |
| [Testing](docs/testing.md) | Test strategy and run commands |
| [Tools](docs/tools.md) | Tool contracts and usage |

---

## Project Structure

```text
src/
  api/                  # REST routes, chat, terminal, IDE/git API, security
  core/                 # agents, tools, wallet, channels, providers, memory, LSP, scheduler
  cli.tsx               # CLI/TUI entry
  index.ts              # server entry
ui/
  src/pages/            # UI pages
src-tauri/              # Tauri desktop shell
apps/mobile/            # React Native iOS/Android companion
apps/macos/Cybara/      # Native SwiftUI macOS shell
docs/                   # product and technical docs
tests/                  # Bun test suites (unit/integration/e2e)
.github/workflows/      # CI, release, security, and platform build workflows
```

---

## License

MIT — [Carsen Klock](https://github.com/metaspartan)
