<p align="center">
  <img src="cybara.png" alt="Cybara" width="120" />
</p>

<h1 align="center">Cybara</h1>

<p align="center">
  <strong>AI Agent Platform with Beautiful UI & Modular Skills</strong>
</p>

<p align="center">
  <a href="LICENSE.md"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="License: MIT" /></a>
  <img src="https://img.shields.io/badge/runtime-Bun-f9f1e1?logo=bun" alt="Bun" />
  <img src="https://img.shields.io/badge/TypeScript-5.0-blue?logo=typescript" alt="TypeScript" />
  <img src="https://img.shields.io/badge/React-19-61dafb?logo=react" alt="React" />
  <img src="https://img.shields.io/badge/Playwright-browser-2EAD33?logo=playwright" alt="Playwright" />
  <img src="https://img.shields.io/badge/tools-47-green" alt="47 Tools" />
  <img src="https://img.shields.io/badge/AI_providers-20-purple" alt="20 Providers" />
  <img src="https://img.shields.io/badge/desktop-Tauri-orange?logo=tauri" alt="Tauri Desktop" />
</p>

---

## 📚 Documentation

| Guide | Description |
|-------|-------------|
| [Architecture](docs/architecture.md) | Platform design and data flow |
| [CLI Reference](docs/cli.md) | Command-line interface |
| [Desktop App](docs/desktop.md) | Tauri desktop client |
| [Tools Reference](docs/tools.md) | 47 available tools |
| [Skills Guide](docs/skills.md) | Creating and managing skills |
| [Channels](docs/channels.md) | Multi-platform messaging |
| [Providers](docs/providers.md) | AI provider configuration |
| [Configuration](docs/configuration.md) | Settings and environment |
| [API Reference](docs/api.md) | REST API endpoints |
| [Security](docs/security.md) | Self-hosting security model |

---

## ✨ Key Features

### 🤖 Multi-Agent System
- Create specialized agents (main, research, coder, planner, ops, subagent, worker)
- Spawn background sub-agents for parallel task execution
- Agent lifecycle management with session tracking
- OpenClaw-compatible system prompts with adaptive context handling

### 🧩 Modular Skills System
- **SKILL.md format** — YAML frontmatter + markdown instructions
- **4-tier skill discovery**: Bundled → Local → Workspace → Registry
- **Eligibility gating**: OS, environment variables, required binaries
- **Multi-registry support**: ClawdHub, skills.sh, CybaraHub
- **Hot reloading**: File watcher for instant skill updates

### 🔧 Tool System (47 tools)

| Category | Tools |
|----------|-------|
| **File** | `read`, `write`, `edit`, `file_search`, `grep`, `apply_patch` |
| **Process** | `exec`, `process`, `git` |
| **Browser** | `browser`, `web_fetch`, `web_search`, `canvas` |
| **Memory** | `memory_search`, `memory_get`, `memory_save`, `memory_save_durable`, `memory_context` |
| **Sessions** | `sessions_spawn`, `sessions_send`, `sessions_history`, `sessions_list`, `session_status` |
| **Agents** | `agents_list` |
| **Channel** | `message`, `telegram_media`, `nodes` |
| **Media** | `image`, `tts` |
| **Scheduling** | `cron`, `gateway` |
| **Data** | `http`, `data`, `env`, `calc`, `convert`, `clipboard` |
| **Document** | `summarization`, `pdf`, `ocr`, `video_frames` |
| **Weather** | `weather` |
| **LSP** | `lsp_diagnostics`, `lsp_definition`, `lsp_references`, `lsp_hover`, `lsp_languages` |

### 🧠 Memory System
- **Vector Store** with SQLite-backed embeddings (OpenAI, Gemini, Ollama)
- **BM25 hybrid search** combining keyword and semantic relevance
- **Durable Memory** via MEMORY.md file with auto-summarization
- **Heartbeat State** tracking for scheduled service checks
- **Private Sessions** mode excluding memory from sub-agent contexts

### 📚 LSP Code Intelligence
Auto-installs language servers for enhanced code understanding:

| Language | Server | Type |
|----------|--------|------|
| TypeScript/JavaScript | `typescript-language-server` | Bundled |
| Python | `ruff-lsp` | Binary |
| Go | `gopls` | Binary |
| Rust | `rust-analyzer` | Binary |
| Lua | `lua-language-server` | Binary |
| JSON | `vscode-json-languageserver` | Bundled |
| HTML/CSS | `vscode-html-languageserver` | Bundled |
| C/C++ | `clangd` | Binary |
| Java | `jdtls` | Binary |
| Kotlin | `kotlin-language-server` | Binary |
| Swift | `sourcekit-lsp` | System |
| Ruby | `solargraph` | Gem |
| PHP | `intelephense` | NPM |
| Markdown | `marksman` | Binary |
| Zig | `zls` | Binary |

### 🔗 MCP Server Integration
Model Context Protocol support for external tool servers:
- **Auto-discovery** of MCP servers from config
- **Dynamic tool registration** from connected servers
- **Multi-server** concurrent connections
- **Stdio & HTTP transports** supported

### 🛡️ Channel Security
- **DM Policies**: pairing, allowlist, open, disabled
- **Secure Pairing Codes** for user verification
- **Sender Allowlists** with SQLite persistence
- **Rate Limiting** for pairing requests

### 🌐 Browser Automation
- Playwright-based automation with full Chrome control
- **Profile management**: Persistent browser profiles with isolated sessions
- **Visual mode**: Visible Chrome window for debugging or demos
- **Element refs**: OpenClaw-style snapshot with interactive `[ref=eN]` markers
- Actions: click, type, scroll, drag, screenshot, PDF export, JavaScript evaluation

### 💬 Beautiful Web UI (18 pages)
- **Dashboard** — System overview and health metrics
- **Chat** — Real-time conversational interface with agent selector
- **IDE** — Code editor with LSP integration (hover, definitions, diagnostics)
- **Terminal** — Full-featured web terminal with PTY support
- **Skills** — Browse, install, and manage skills with eligibility indicators
- **Memory** — Semantic memory browser and search
- **Agents** — Create and manage AI agents
- **Providers** — Configure AI providers and models (with OAuth flows)
- **Sessions** — Active session monitoring
- **Tasks** — Cron job management with run history
- **Channels** — Multi-channel configuration
- **MCP Servers** — Install and manage MCP tool servers
- **LSP** — Language server installation and status
- **Metrics** — Token usage and performance analytics
- **Logs** — System and agent activity logs
- **Tools** — Tool registry and documentation
- **Settings** — Platform configuration with **10 theme accent colors**
- **Setup** — First-run setup wizard

### 📱 Multi-Channel Support
| Channel | Integration |
|---------|-------------|
| Telegram | Full bot support with command registration |
| Discord | Bot integration |
| Slack | Workspace integration |
| WhatsApp | Meta Business API |
| Signal | via signal-cli |
| iMessage | via BlueBubbles |
| Web | Built-in interface |

### 🔌 20 AI Providers
| Provider | Models |
|----------|--------|
| OpenAI | GPT-5.x, o1, o3 |
| Anthropic | Claude 4.x (Opus, Sonnet, Haiku) |
| Google | Gemini 3 Pro/Flash, Gemini 2.0 |
| Antigravity | Google AI models via OAuth (free tier) |
| xAI | Grok 3, Grok 3 Mini |
| MiniMax | M2.1, VL-01 |
| Moonshot | Kimi K2.5 |
| Kimi Code | Kimi for Coding |
| Qwen Portal | Coder, Vision models (OAuth) |
| Venice AI | Llama 3.3, Qwen3, DeepSeek V3.2, GLM 4.7 |
| Z.ai | GLM 4.7 |
| OpenCode Zen | Full model catalog |
| Synthetic | HuggingFace models |
| Groq | Llama 3.3 70B |
| OpenRouter | Multi-provider routing |
| Ollama | Local models |
| AWS Bedrock | Claude, Titan |
| GitHub Copilot | Integrated models |
| Xiaomi | MiMo v2 Flash |
| Chutes | DeepSeek, Qwen, Llama |
| Qianfan | Baidu ERNIE models |

## 🚀 Installation

```bash
# Clone the repository
git clone https://github.com/metaspartan/cybara.git
cd cybara

# Install dependencies (also installs Playwright)
bun install

# Start development server
bun run dev
```

The platform auto-configures on first run with a setup wizard.

## 📦 Scripts

```bash
bun run dev          # Build + watch mode (backend + UI)
bun run build        # Build backend only
bun run build:all    # Build UI + backend + CLI + main entry
bun run ui:dev       # UI development server (Vite HMR)
bun run ui:build     # Build UI for production
bun run start:prod   # Full production build + start
bun test             # Run Bun test suite
bun run check        # TypeScript + ESLint + Prettier
bun run tauri:dev    # Tauri desktop dev mode (with terminal)
bun run tauri:build  # Tauri desktop production build
bun run package      # Build release binaries
```

## ⚙️ Configuration

### Environment Variables
- `PORT` — Server port (default: 4269)
- `CYBARA_HOME` — Data directory (default: `~/.cybara`)
- `BRAVE_API_KEY` — For web search (optional, falls back to DuckDuckGo)
- `LOG_LEVEL` — Logging verbosity (default: info)

### Workspace Files
Place these in your workspace root for auto-loading:
- `SOUL.md` — Agent personality and tone
- `IDENTITY.md` — Agent identity configuration
- `USER.md` — User preferences and context
- `TOOLS.md` — Custom tool guidance
- `BOOTSTRAP.md` — First-run ritual (deleted after initial setup)
- `MEMORY.md` — Persistent durable memory

## 🔌 API Endpoints

### Chat
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/chat` | Send message to agent (SSE streaming) |
| GET | `/api/chat/sessions` | List sessions |
| GET | `/api/chat/sessions/:id/messages` | Get session messages |
| DELETE | `/api/chat/sessions/:id` | Delete a session |

### Agents
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/agents` | List agents |
| POST | `/api/agents` | Create agent |
| GET | `/api/agents/:id` | Get agent details |
| PUT | `/api/agents/:id` | Update agent |
| DELETE | `/api/agents/:id` | Delete agent |
| POST | `/api/agents/:id/start` | Start agent |
| POST | `/api/agents/:id/stop` | Stop agent |
| GET | `/api/agents/:id/state` | Get agent state |

### Skills
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/skills` | List installed skills |
| GET | `/api/skills/status` | Eligibility status + missing requirements |
| GET | `/api/skills/registry/search` | Search multi-registry |
| POST | `/api/skills/install` | Install from registry |
| POST | `/api/skills/update` | Update all installed skills |
| DELETE | `/api/skills/:name` | Remove a skill |

### Providers
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/providers` | List configured providers |
| GET | `/api/providers/available` | List available types |
| POST | `/api/providers` | Add provider |
| PUT | `/api/providers/:id` | Update provider |
| DELETE | `/api/providers/:id` | Remove provider |
| POST | `/api/providers/:id/test` | Test provider connectivity |
| GET | `/api/providers/:id/models` | List provider's models |
| POST | `/api/providers/oauth/start` | Start OAuth flow |
| POST | `/api/providers/oauth/callback-status` | Poll OAuth callback |

### Browser
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/browser/status` | Browser session status |
| GET | `/api/browser/profiles` | List browser profiles |
| POST | `/api/browser/profiles` | Create profile |
| DELETE | `/api/browser/profiles/:name` | Delete profile |

### Tasks (Cron)
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/tasks` | List scheduled tasks |
| POST | `/api/tasks` | Create task |
| PUT | `/api/tasks/:id` | Update task |
| DELETE | `/api/tasks/:id` | Delete task |
| GET | `/api/tasks/:id/runs` | Get task run history |

### Terminal
| Method | Endpoint | Description |
|--------|----------|-------------|
| WS | `/api/terminal/ws` | WebSocket terminal connection |
| GET | `/api/terminal/sessions` | List active terminals |

### Subagents
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/subagents/spawn` | Spawn new subagent with task |
| GET | `/api/subagents` | List all subagent runs |
| GET | `/api/subagents/:id` | Get subagent details |
| POST | `/api/subagents/:id/kill` | Terminate subagent |

### LSP
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/lsp/status` | LSP server installation status |
| POST | `/api/lsp/install/:language` | Install language server |
| POST | `/api/lsp/uninstall/:language` | Uninstall language server |

### MCP
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/mcp/servers` | List configured MCP servers |
| POST | `/api/mcp/servers` | Add MCP server |
| GET | `/api/mcp/tools` | List tools from all servers |

### System
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/health` | Health check |
| GET | `/api/info` | Platform info and version |
| GET | `/api/status/sse` | SSE event stream |
| GET | `/api/config/:key` | Get config value |
| POST | `/api/config` | Set config values |
| POST | `/api/open-url` | Open URL in default browser |

## 📁 Project Structure

```
├── src/
│   ├── main.ts               # Binary entry point (CLI/server router)
│   ├── index.ts              # HTTP server + WebSocket handler
│   ├── cli.tsx               # Interactive TUI (React/Ink)
│   ├── api/
│   │   ├── routes.ts         # REST API route handlers
│   │   ├── chat.ts           # Chat API + streaming
│   │   ├── terminal.ts       # Web terminal (Python PTY bridge)
│   │   ├── ide-api.ts        # IDE code intelligence API
│   │   ├── git-api.ts        # Git operations API
│   │   ├── security.ts       # Auth, rate limiting, SSRF
│   │   └── queries.ts        # Database query helpers
│   └── core/
│       ├── agent.ts          # Agent management + tool loop
│       ├── channels/         # Multi-channel adapters (7 platforms)
│       ├── database.ts       # SQLite database layer
│       ├── providers.ts      # 20 AI provider definitions
│       ├── system-prompt.ts  # OpenClaw-compatible prompt builder
│       ├── session-context.ts # Adaptive context compaction
│       ├── subagent-registry.ts # Sub-agent spawning + lifecycle
│       ├── scheduler.ts      # Cron/task scheduler
│       ├── cron/             # Cron job store + execution
│       ├── browser/          # Playwright browser automation
│       ├── lsp/              # Language server protocol client
│       ├── memory/           # Vector store + BM25 search
│       ├── skills/           # Skill loader, gating, registry
│       ├── tools/            # 47 tool definitions + 14 handler modules
│       ├── mcp.ts            # MCP client connections
│       ├── mcp-registry.ts   # MCP server registry
│       ├── metrics.ts        # Token usage tracking
│       ├── logger.ts         # Structured logging
│       └── config.ts         # Configuration management
├── ui/                        # React 19 + Vite + TanStack Query
│   └── src/pages/             # 18 page components
├── src-tauri/                 # Tauri desktop shell (Rust)
├── skills/                    # Bundled skills
├── templates/                 # Agent prompt templates
├── scripts/                   # Build + packaging scripts
└── tests/                     # Test suite
```

## 🤝 Telegram Bot Commands

| Command | Description |
|---------|-------------|
| `/start` | Start interacting with the bot |
| `/new` | Create a new agent |
| `/help` | Show available commands |
| `/agents` | List available agents |
| `/status` | Check bot and platform status |
| `/model` | Show/change current model |
| `/think` | Toggle thinking mode |

## 📄 License

MIT — [Carsen Klock](https://github.com/metaspartan)
