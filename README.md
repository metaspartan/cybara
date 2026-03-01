<p align="center">
  <img src="cybara.png" alt="Cybara" width="120" />
</p>

<h1 align="center">Cybara</h1>

<p align="center">
  <strong>Self-hosted AI agent platform for real work: code, channels, browser automation, and on-chain execution.</strong>
</p>

<p align="center">
  Cybara combines a powerful multi-agent runtime with a clean web UI, a production-ready CLI, encrypted local wallet controls,
  and a broad tool layer so one platform can run your workflows end-to-end.
</p>

<p align="center">
  <a href="LICENSE.md"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="License: MIT" /></a>
  <img src="https://img.shields.io/badge/runtime-Bun-f9f1e1?logo=bun" alt="Bun" />
  <img src="https://img.shields.io/badge/language-TypeScript-blue?logo=typescript" alt="TypeScript" />
  <img src="https://img.shields.io/badge/ui-React_19-61dafb?logo=react" alt="React" />
  <img src="https://img.shields.io/badge/tools-49-green" alt="49 Tools" />
  <img src="https://img.shields.io/badge/providers-33-purple" alt="33 Providers" />
  <img src="https://img.shields.io/badge/channels-7-orange" alt="7 Channels" />
  <img src="https://img.shields.io/badge/desktop-Tauri-orange?logo=tauri" alt="Tauri Desktop" />
</p>

---

## What Cybara Is

Cybara is an agent operating system for developers and operators who want one stack for:

- AI chat and multi-agent orchestration
- local and remote tool execution
- browser and API automation
- secure messaging channels (Telegram, Discord, Slack, WhatsApp, Signal, iMessage, Web)
- encrypted wallet operations across ETH/BTC/SOL with policy controls

If you need an agent platform that can plan, execute, verify, and report with strong operator control, Cybara is built for that.

---

## Capability Snapshot

- 49 built-in tools (`src/core/tools/index.ts`)
- 33 built-in provider integrations (`src/core/providers.ts`)
- 7 channel adapters (`src/core/channels/adapters`)
- 20 production UI pages (`ui/src/pages/*.tsx`)
- 75 automated Bun test files (`tests/**/*.test.ts`)
- Tauri desktop app + Bun server/CLI runtime

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

---

## Core Features

### Multi-Agent Runtime

- Multiple agent types (`main`, `research`, `coder`, `planner`, `ops`, `subagent`, `worker`)
- Subagent spawning and lifecycle management
- Session-aware execution with persistence and recovery
- Agent tool allowlist and permission enforcement support

### Tooling Layer (49 Tools)

Tool categories currently shipped:

- `file` (6): read/write/edit/search/patch
- `process` (3): exec/process/git
- `browser` (4): browser/web_fetch/web_search/canvas
- `memory` (5): search/get/save/context/durable save
- `core` (15): sessions/agents/artifacts/http/env/data/wallet/etc.
- `lsp` (5): diagnostics/definition/references/hover/languages
- `media` (2): image/tts
- `skill` (7): calc/convert/pdf/ocr/summarization/video_frames/weather
- `channel` (2): message/telegram_media

See full reference: [docs/tools.md](docs/tools.md)

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

DM policy modes:

- `pairing`
- `allowlist`
- `open`
- `disabled`

### UI + Desktop

- Web UI with 20 pages for agents, channels, providers, tools, wallet, logs, metrics, tasks, sessions, IDE, terminal, setup, and artifacts
- Tauri desktop app with sidecar server wiring

### Provider Layer (33 Built-In Integrations)

Includes OpenAI, Anthropic, Google AI, Antigravity, MiniMax (API + OAuth portal), Moonshot, Kimi Code, Qwen Portal, Together, Hugging Face, Synthetic, Venice, Xiaomi, Ollama, vLLM, LiteLLM, Cloudflare AI Gateway, GitHub Copilot, AWS Bedrock, Groq, OpenRouter, OpenCode Zen, Z.AI variants, OpenAI Codex, Chutes, Vercel AI Gateway, Google Gemini CLI, Copilot Proxy, xAI, Baidu Qianfan, and NVIDIA.

See provider details: [docs/providers.md](docs/providers.md)

---

## Common Scripts

```bash
bun run dev          # Full dev flow
bun run build        # Build backend
bun run build:all    # Build UI + backend + CLI + main
bun run start        # Run built backend
bun run start:prod   # Build all then run

bun test             # Full test suite
bun run test:smoke   # Runtime + API + E2E smoke
bun run check        # Typecheck + lint + format check

bun run tauri:dev    # Desktop dev mode
bun run tauri:build  # Desktop production build
bun run package      # Release packaging
```

---

## API Highlights

Cybara exposes a broad REST API and streaming interfaces.

Common surfaces:

- Chat & sessions: `/api/chat`, `/api/chat/sessions`, `/api/sessions`
- Agents/providers/channels/tasks/skills/memory
- Wallet and dapp routes under `/api/wallet/*`
- Browser + terminal automation endpoints
- SSE status stream: `/api/sse/status`

Full reference: [docs/api.md](docs/api.md)

---

## CLI Highlights

```bash
cybara chat
cybara status
cybara provider available
cybara channels
cybara wallet status
cybara wallet swap --venue uniswap_v3 --token LINK --amount-eth 0.2
cybara wallet x402 --url https://merchant.example/x402/resource --dry-run
cybara subagent spawn "Research X and return a summary"
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
  src/pages/            # 19 UI pages
src-tauri/              # Tauri desktop shell
docs/                   # product and technical docs
tests/                  # Bun test suites (unit/integration/e2e)
```

---

## License

MIT — [Carsen Klock](https://github.com/metaspartan)
