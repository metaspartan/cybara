# Cybara

A modern AI agent platform with a beautiful React web UI, full tool calling support, modular skills system, browser automation, and multi-channel messaging. Built with Bun for exceptional performance.

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

### 🔧 Tool System (30+ tools)

| Category | Tools |
|----------|-------|
| **File** | `read`, `write`, `edit`, `file_search`, `grep` |
| **Process** | `exec`, `process`, `git` |
| **Browser** | `browser`, `web_fetch`, `web_search` |
| **Memory** | `memory_search`, `memory_get`, `memory_save` |
| **Sessions** | `sessions_spawn`, `sessions_send`, `sessions_history`, `sessions_list`, `session_status` |
| **Channel** | `message`, `telegram_media`, `canvas`, `nodes` |
| **Media** | `image`, `tts` |
| **Core** | `cron`, `gateway`, `agents_list` |
| **Skills** | `summarization`, `video_frames`, `ocr`, `pdf`, `calc` |

### 🌐 Browser Automation
- Playwright-based automation with full Chrome control
- **Profile management**: Persistent browser profiles with isolated sessions
- **Visual mode**: Visible Chrome window for debugging or demos
- **Element refs**: OpenClaw-style snapshot with interactive `[ref=eN]` markers
- Actions: click, type, scroll, drag, screenshot, PDF export, JavaScript evaluation

### 💬 Beautiful Web UI (14 pages)
- **Dashboard** - System overview and health metrics
- **Chat** - Real-time conversational interface with agent selector
- **Skills** - Browse, install, and manage skills with eligibility indicators
- **Memory** - Semantic memory browser and search
- **Agents** - Create and manage AI agents
- **Providers** - Configure AI providers and models
- **Sessions** - Active session monitoring
- **Tasks** - Cron job management
- **Channels** - Multi-channel configuration
- **Metrics** - Token usage and performance analytics
- **Logs** - System and agent activity logs
- **Tools** - Tool registry and documentation
- **Settings** - Platform configuration

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
