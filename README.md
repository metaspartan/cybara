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
  <img src="https://img.shields.io/badge/tools-35%2B-green" alt="35+ Tools" />
  <img src="https://img.shields.io/badge/AI_providers-17%2B-purple" alt="17+ Providers" />
  <img src="https://img.shields.io/badge/desktop-Tauri-orange?logo=tauri" alt="Tauri Desktop" />
</p>

---

## 📚 Documentation

| Guide | Description |
|-------|-------------|
| [Architecture](docs/architecture.md) | Platform design and data flow |
| [CLI Reference](docs/cli.md) | Command-line interface |
| [Desktop App](docs/desktop.md) | Tauri desktop client |
| [Tools Reference](docs/tools.md) | 35+ available tools |
| [Skills Guide](docs/skills.md) | Creating and managing skills |
| [Channels](docs/channels.md) | Multi-platform messaging |
| [Providers](docs/providers.md) | AI provider configuration |
| [Configuration](docs/configuration.md) | Settings and environment |
| [API Reference](docs/api.md) | REST API endpoints |

---

## ✨ Key Features

### 🤖 Multi-Agent System
- Create specialized agents (main, research, coder, planner, ops, subagent, worker)
- Spawn background sub-agents for parallel task execution
- Agent lifecycle management with session tracking
- OpenClaw-compatible system prompts with adaptive context handling

### 🧩 Modular Skills System
- **SKILL.md format** - YAML frontmatter + markdown instructions
- **4-tier skill discovery**: Bundled → Local → Workspace → Registry
- **Eligibility gating**: OS, environment variables, required binaries
- **Multi-registry support**: ClawdHub, skills.sh, CybaraHub
- **Hot reloading**: File watcher for instant skill updates

### 🔧 Tool System (35+ tools)

| Category | Tools |
|----------|-------|
| **File** | `read`, `write`, `edit`, `file_search`, `grep`, `apply_patch` |
| **Process** | `exec`, `process`, `git` |
| **Browser** | `browser`, `web_fetch`, `web_search` |
| **Memory** | `memory_search`, `memory_get`, `memory_save`, `memory_context` |
| **Sessions** | `sessions_spawn`, `sessions_send`, `sessions_history`, `sessions_list`, `session_status` |
| **Channel** | `message`, `telegram_media`, `canvas`, `nodes` |
| **Media** | `image`, `tts` |
| **Core** | `cron`, `gateway`, `agents_list`, `heartbeat_state` |
| **Skills** | `summarization`, `video_frames`, `ocr`, `pdf`, `calc` |
| **LSP** | `lsp_symbols`, `lsp_definitions`, `lsp_diagnostics`, `lsp_hover` |

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

### 💬 Beautiful Web UI (17 pages)
- **Dashboard** - System overview and health metrics
- **Chat** - Real-time conversational interface with agent selector
- **IDE** - Code editor with LSP integration (hover, definitions, diagnostics)
- **Skills** - Browse, install, and manage skills with eligibility indicators
- **Memory** - Semantic memory browser and search
- **Agents** - Create and manage AI agents
- **Providers** - Configure AI providers and models
- **Sessions** - Active session monitoring
- **Tasks** - Cron job management with run history
- **Channels** - Multi-channel configuration
- **MCP Servers** - Install and manage MCP tool servers
- **LSP** - Language server installation and status
- **Metrics** - Token usage and performance analytics
- **Logs** - System and agent activity logs
- **Tools** - Tool registry and documentation
- **Settings** - Platform configuration with **10 theme accent colors**

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

### 🔌 17+ AI Providers
| Provider | Models |
|----------|--------|
| OpenAI | GPT-5.x, o1, o3 |
| Anthropic | Claude 4.x (Opus, Sonnet, Haiku) |
| Google | Gemini 3 Pro/Flash, Gemini 2.0 |
| MiniMax | M2.1, VL-01 |
| Moonshot | Kimi K2.5 |
| Kimi Code | Kimi for Coding |
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
| Qwen Portal | Coder, Vision models |

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
bun run dev        # Build + watch mode (backend + UI)
bun run build      # Build backend only
bun run ui:dev     # UI development server (Vite HMR)
bun run ui:build   # Build UI for production
bun run start:prod # Full production build + start
bun run check      # TypeScript + ESLint + Prettier
```

## ⚙️ Configuration

### Environment Variables
- `PORT` - Server port (default: 4269)
- `BRAVE_API_KEY` - For web search (optional, falls back to DuckDuckGo)

### Workspace Files
Place these in your workspace root for auto-loading:
- `SOUL.md` - Agent personality and tone
- `IDENTITY.md` - Agent identity configuration
- `USER.md` - User preferences and context
- `TOOLS.md` - Custom tool guidance
- `BOOTSTRAP.md` - First-run ritual (deleted after initial setup)

## 🔌 API Endpoints

### Chat
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/chat` | Send message to agent |
| GET | `/api/chat/sessions` | List sessions |
| GET | `/api/chat/sessions/:id/messages` | Get session messages |

### Agents
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/agents` | List agents |
| POST | `/api/agents` | Create agent |
| POST | `/api/agents/:id/start` | Start agent |
| POST | `/api/agents/:id/stop` | Stop agent |

### Skills
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/skills/status` | Eligibility status + missing requirements |
| GET | `/api/skills/registry/search` | Search multi-registry |
| POST | `/api/skills/install` | Install from registry |
| POST | `/api/skills/update` | Update all installed skills |

### Providers
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/providers` | List configured providers |
| GET | `/api/providers/available` | List available types |
| POST | `/api/providers` | Add provider |

### Browser
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/browser/status` | Browser session status |
| GET | `/api/browser/profiles` | List browser profiles |
| POST | `/api/browser/profiles` | Create profile |

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
| GET | `/api/mcp/tools` | List tools from all MCP servers |

## 📁 Project Structure

```
├── src/
│   ├── index.ts              # Main entry point
│   ├── api/
│   │   ├── routes.ts         # API route handlers (1381 lines)
│   │   └── chat.ts           # Chat API implementation
│   └── core/
│       ├── agent.ts          # Agent management (1160 lines)
│       ├── channels.ts       # Multi-channel support
│       ├── database.ts       # SQLite database
│       ├── providers.ts      # 17+ AI providers (928 lines)
│       ├── system-prompt.ts  # OpenClaw-compatible prompts
│       ├── session-context.ts # Adaptive context compaction
│       ├── subagent-registry.ts # Sub-agent spawning
│       ├── browser/
│       │   ├── pw-manager.ts  # Playwright management
│       │   └── profiles.ts    # Browser profile isolation
│       ├── skills/
│       │   ├── loader.ts      # SKILL.md parsing + file watcher
│       │   ├── gating.ts      # Eligibility checks
│       │   └── registry.ts    # Multi-registry manager
│       └── tools/
│           ├── index.ts       # Tool definitions
│           └── handlers/      # 12 handler modules
├── ui/                        # React + Vite + TanStack Query
│   └── src/pages/             # 14 page components
├── skills/                    # Bundled skills
└── templates/                 # Agent templates
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

MIT
