<p align="center">
  <img src="cybara.png" alt="Cybara" width="120" />
</p>

<h1 align="center">Cybara</h1>

<p align="center">
  <strong>Self-hosted AI agent platform for real work: code, channels, browser automation, and on-chain execution.</strong>
</p>

<p align="center">
  Cybara is a production-ready agent operating system that combines a powerful multi-agent runtime with a clean web UI, production-ready CLI, encrypted local wallet controls,
  and a comprehensive tool layer. Deploy autonomous agents that can code, execute browser automation, manage communications across 7 channels, and handle crypto operations—with full operator control.
</p>

<p align="center">
  <a href="https://github.com/metaspartan/cybara/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/metaspartan/cybara/ci.yml?branch=main&label=CI&logo=github" alt="CI" /></a>
  <a href="LICENSE.md"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="License: MIT" /></a>
  <a href="https://github.com/metaspartan/cybara/releases"><img src="https://img.shields.io/github/v/release/metaspartan/cybara?include_prereleases&display_name=tag&sort=semver" alt="Release" /></a>
  <img src="https://img.shields.io/badge/runtime-Bun-f9f1e1?logo=bun" alt="Bun" />
  <img src="https://img.shields.io/badge/language-TypeScript-blue?logo=typescript" alt="TypeScript" />
  <img src="https://img.shields.io/badge/ui-React_19-61dafb?logo=react" alt="React" />
  <img src="https://img.shields.io/badge/tools-71-green" alt="71 Tools" />
  <img src="https://img.shields.io/badge/providers-50-purple" alt="50 Providers" />
  <img src="https://img.shields.io/badge/channels-10-orange" alt="10 Channels" />
  <img src="https://img.shields.io/badge/skills-60+-teal" alt="60+ Skills" />
  <img src="https://img.shields.io/badge/desktop-Tauri-orange?logo=tauri" alt="Tauri Desktop" />
  <img src="https://img.shields.io/badge/mobile-React_Native-61dafb?logo=react" alt="React Native Mobile" />
</p>

---

## What Cybara Is

Cybara is an agent operating system for developers and operators who want one stack for:

- AI chat and multi-agent orchestration
- local and remote tool execution
- browser and API automation
- secure messaging channels (Telegram, Discord, Slack, WhatsApp, Signal, iMessage, Web, plus Webhook, SMS, and Email)
- encrypted wallet operations across ETH/BTC/SOL with policy controls

If you need an agent platform that can plan, execute, verify, and report with strong operator control, Cybara is built for that.

---

## Capability Snapshot

- 71 built-in tools (`src/core/tools/index.ts`)
- 50 built-in provider integrations with dynamic model discovery (`src/core/providers.ts`)
- 10 channel adapters (`src/core/channels/adapters`)
- 21 production UI page components (`ui/src/pages/*.tsx`)
- 60+ bundled skills (`skills/`)
- Anthropic prompt caching, multi-key credential pools + rate-limit rotation, and a centralized LLM error taxonomy
- Smart context compaction (token-aware chunking + structured summaries with identifier preservation)
- Interactive tool approval with per-session/persistent allowlists, filesystem checkpoint/snapshot+rollback, and transform hooks (tool_result/llm_output/terminal_output)
- Token streaming to the UI (real-time assistant text deltas via WebSocket)
- MCP host mode (expose cybara's tools to other MCP clients) + MCP client (consume external servers)
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
curl -fsSL https://raw.githubusercontent.com/metaspartan/cybara/main/install.sh | bash -s -- --version 1.0.330
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

## Mobile Companion

Cybara Mobile is a dark Liquid Glass-inspired React Native app for iOS and Android. It connects to a Cybara gateway already running from CLI, Tauri/Web UI, native macOS, or a hosted deployment, then manages remote sessions and operator settings.

```bash
bun run mobile:dev
bun run mobile:ios
bun run mobile:android

# on the device running Cybara
cybara mobile connect --qr
```

The initial mobile surface covers gateway health, sessions, agents, providers, tool approvals, wallet policy, channels, tasks, memory, terminal/log entrypoints, and settings summaries. See [apps/mobile/README.md](apps/mobile/README.md).

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

### Tooling Layer (71 Tools)

Tool categories currently shipped:

- `file` (7): read/write/edit/search/grep/workspace_index/apply_patch — with a hard path-safety deny-list (credentials, SSH keys, `.env`) enforced before every write
- `process` (3): exec/process/git
- `browser` (4): browser/web_fetch/web_search/canvas
- `memory` (5): search/get/save/context/durable save
- `core` (17): sessions/agents/artifacts/wallet/http/env/data/nodes/clipboard/cron/gateway/etc.
- `lsp` (5): diagnostics/definition/references/hover/languages
- `media` (4): image/tts + **image_generate** / **video_generate** / **music_generate** via a swappable provider registry (OpenAI, fal.ai)
- `skill` (7): calc/convert/pdf/ocr/summarization/video_frames/weather
- `channel` (2): message/telegram_media
- `planning` (2): **todo** (session task-list with status discipline) + **clarify** (structured multi-choice questions to the user)
- `discovery` (4): **tool_search** / **tool_describe** / **tool_call** (dynamic discovery over built-in + MCP + skills) + **execute_code** (run code that calls cybara tools programmatically)
- `media` (1): **computer_use** (background desktop control via cua-driver — capture/click/type/scroll/drag without stealing the cursor)
- `orchestration` (9): the **kanban** multi-agent tier — show/list/complete/block/heartbeat/comment/create/unblock/link for durable task graphs

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

Adapters:

- Telegram
- Discord
- Slack
- WhatsApp (`whatsapp-web.js`)
- Signal (`signal-cli`)
- iMessage (BlueBubbles)
- Web chat
- Webhook (inbound — signed triggers from CI, monitoring, forms; HMAC-SHA256 verified)
- SMS (Twilio)
- Email (SMTP send + IMAP poll)

DM policy modes:

- `pairing`
- `allowlist`
- `open`
- `disabled`

### UI + Desktop

- Web UI with 21 page components for agents, channels, providers, routing, tools, wallet, logs, metrics, tasks, sessions, IDE, terminal, setup, artifacts, skills, MCP servers, LSP, chat, dashboard, and memory
- Tauri desktop app with sidecar server wiring and in-app signed update checks via GitHub Releases
- Native SwiftUI macOS app in `apps/macos/Cybara` that reuses the same local Cybara sidecar contract and can be packaged into a release-ready `.app` bundle

### Provider Layer (50 Built-In Integrations)

Includes the newest frontier models: **GPT-5.5 / GPT-5.4 / GPT-5.3 Codex**, **Claude Opus 4.8 / Fable 5 / Sonnet 4.6**, **Gemini 3.5 Flash / 3.1 Pro**, **GLM-5.2 / GLM-5.1**, **MiniMax M3**, **DeepSeek V4 Pro/Flash**, **Kimi K2.6 / K2.7**, **Grok 4.3 / 4.20**, **Nemotron 3 Ultra**, **Qwen 3.7 Max**, and **MiMo V2.5 Pro**.

Providers: OpenAI, Anthropic, Google, Antigravity, MiniMax (API + OAuth portal), Moonshot (Kimi), Z.AI + Z.AI Coding, DeepSeek, Alibaba DashScope + Coding Plan, xAI, NVIDIA, Qianfan, Together, Hugging Face, Synthetic, Venice, Xiaomi, Cerebras, Cohere, Mistral, DeepInfra, Fireworks, Novita, StepFun, Tencent, Volcengine, BytePlus, GMI, Kilo Code, OpenCode Go, Ollama Cloud, Ollama, vLLM, LiteLLM, Cloudflare AI Gateway, GitHub Copilot, AWS Bedrock, Groq, OpenRouter, OpenCode Zen, Copilot Proxy, OpenAI Codex (ChatGPT OAuth), Chutes, Vercel AI Gateway, and Google Gemini CLI.

Multi-key **credential pools** (`ANTHROPIC_API_KEY`, `_2`, `_3`, …) rotate automatically on rate-limit/auth errors, and **Anthropic prompt caching** (`cache_control`) is applied to every Claude request for ~75% input-token savings on multi-turn sessions.

See provider details: [docs/providers.md](docs/providers.md)

### MCP Host + Client

Cybara both **consumes** external MCP servers (extending agent capabilities) and **exposes itself** as an MCP server so other clients can call cybara's tools:

- **Consume** (client): register servers in Settings → MCP or via the CLI; tools are automatically exposed to agents
- **Host** (server): run `cybara mcp serve` to expose all 71 built-in tools over stdio JSON-RPC (compatible with Claude Desktop, IDEs, and other agents)

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
bun run native:macos:package   # Package the native SwiftUI macOS app bundle
bun run start        # Run built backend
bun run start:prod   # Build all then run

bun test             # Full test suite
bun run test:smoke   # Runtime + API + E2E smoke
RUN_BROWSER_E2E=1 bun test tests/e2e/ide-web-ui-browser-smoke.test.ts  # Real browser IDE smoke
bun run check        # Typecheck + lint + format check
bun run check:loc    # Enforce max TS/TSX file size
bun run check:ci     # CI gate (typecheck + lint + loc + smoke + deadcode report)

bun run tauri:dev    # Desktop dev mode
bun run tauri:build  # Desktop production build
bun run tauri:prepare-release   # Generate signed updater config from env
bun run tauri:build:release     # Build desktop app with updater artifacts
bun run native:macos:build      # Build the SwiftUI macOS app shell from source
bun run package      # Release packaging
```

---

## API Highlights

Cybara exposes a broad REST API and streaming interfaces.

Common surfaces:

- Chat & sessions: `/api/chat`, `/api/sessions` (legacy `/api/chat/sessions` remains supported)
- Agents/providers/channels/tasks/skills/memory/mcp
- Wallet and dapp routes under `/api/wallet/*`
- Browser + terminal automation endpoints
- Status streams:
  - SSE: `/api/sse/status`
  - WebSocket: `/api/ws/status`

Full reference: [docs/api.md](docs/api.md)

---

## CLI Highlights

```bash
cybara chat
cybara status
cybara doctor
cybara provider available
cybara channels
cybara wallet status
cybara wallet swap --venue uniswap_v3 --token LINK --amount-eth 0.2
cybara wallet x402 --url https://merchant.example/x402/resource --dry-run
cybara subagent spawn "Research X and return a summary"
cybara mcp list
cybara mcp search <query>
cybara mcp install <package>
```

Full CLI reference: [docs/cli.md](docs/cli.md)

---

## Documentation

| Guide | Description |
|-------|-------------|
| [Architecture](docs/architecture.md) | Platform design and data flow |
| [API](docs/api.md) | REST and streaming API |
| [CLI](docs/cli.md) | Command reference |
| [Channels](docs/channels.md) | Channel setup and in-channel commands |
| [Configuration](docs/configuration.md) | Runtime config and environment |
| [Desktop](docs/desktop.md) | Tauri desktop app |
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
  src/pages/            # 20 UI pages
src-tauri/              # Tauri desktop shell
docs/                   # product and technical docs
tests/                  # Bun test suites (unit/integration/e2e)
```

---

## License

MIT — [Carsen Klock](https://github.com/metaspartan)
