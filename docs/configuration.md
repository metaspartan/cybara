# Cybara Configuration

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | 4269 | HTTP server port |
| `CYBARA_HOME` | `~/.cybara` | Data directory |
| `CYBARA_HOST` | `127.0.0.1` | Bind address (localhost only) |
| `CYBARA_API_KEY` | auto-generated | API key for auth |
| `CYBARA_API` | `http://localhost:4269` | API endpoint for CLI |
| `BRAVE_API_KEY` | - | Web search (optional, falls back to DuckDuckGo) |
| `LOG_LEVEL` | info | Logging verbosity |

## Workspace Files

Place in your workspace root for auto-loading:

| File | Purpose |
|------|---------|
| `SOUL.md` | Agent personality and tone |
| `IDENTITY.md` | Agent identity config |
| `USER.md` | User preferences/context |
| `TOOLS.md` | Custom tool guidance |
| `BOOTSTRAP.md` | First-run ritual (auto-deleted) |
| `MEMORY.md` | Persistent memory |

### SOUL.md Example

```markdown
# Soul

You are a friendly coding assistant who:
- Writes clean, well-documented code
- Prefers TypeScript over JavaScript
- Uses functional patterns when appropriate
- Explains reasoning behind decisions

## Tone
Casual but professional. Use "we" language.

## Preferences
- 2-space indentation
- Single quotes
- No semicolons (for TS/JS)
```

## Database (SQLite)

Location: `~/.cybara/cybara.db`

### Tables

- `agents` - Agent configurations
- `sessions` - Conversation sessions  
- `messages` - Message history
- `providers` - AI provider configs
- `skills` - Installed skills
- `config` - Key-value settings
- `cron_jobs` - Scheduled tasks

## Provider Configuration

### Via UI
Settings → Providers → Add Provider

### Via API
```bash
curl -X POST http://localhost:4269/api/providers \
  -H "Content-Type: application/json" \
  -d '{"type": "openai", "apiKey": "sk-..."}'
```

### Supported Providers (20)

| Provider | Config Key |
|----------|------------|
| OpenAI | `OPENAI_API_KEY` |
| Anthropic | `ANTHROPIC_API_KEY` |
| Google | `GOOGLE_API_KEY` |
| Antigravity | OAuth (no key needed) |
| xAI | `XAI_API_KEY` |
| MiniMax | `MINIMAX_API_KEY` |
| Moonshot | `MOONSHOT_API_KEY` |
| Kimi Code | `KIMI_API_KEY` |
| Qwen Portal | OAuth (no key needed) |
| Venice AI | `VENICE_API_KEY` |
| Groq | `GROQ_API_KEY` |
| OpenRouter | `OPENROUTER_API_KEY` |
| Ollama | `OLLAMA_HOST` |
| AWS Bedrock | `AWS_ACCESS_KEY_ID` + `AWS_SECRET_ACCESS_KEY` |
| GitHub Copilot | `GITHUB_TOKEN` |
| Synthetic | `SYNTHETIC_API_KEY` |
| OpenCode Zen | `OPENCODE_ZEN_API_KEY` |
| Chutes | `CHUTES_API_KEY` |
| Xiaomi | `XIAOMI_API_KEY` |
| Qianfan | `QIANFAN_API_KEY` |

## Browser Profiles

Location: `~/.cybara/browser-profiles/`

Each profile is an isolated Chromium user data directory.

```bash
# Create profile
cybara browser profile create "work"

# Use specific profile
{"name": "browser", "args": {"action": "start", "profile": "work"}}
```

## Skill Registries

Configure in settings or `~/.cybara/config.json`:

```json
{
  "skillRegistries": [
    {"name": "clawhub", "url": "https://api.clawhub.com"},
    {"name": "skills.sh", "url": "https://registry.skills.sh"}
  ]
}
```

## Channel Configuration

### Telegram

1. Create bot via @BotFather
2. Copy token
3. Run `cybara channel add telegram`
4. Paste token when prompted

### Discord

1. Create app at discord.com/developers
2. Add bot to server
3. Copy token
4. Run `cybara channel add discord`

### Signal

Requires `signal-cli`:
```bash
# Install signal-cli
brew install signal-cli  # macOS

# Link device
signal-cli link

# Configure
cybara channel add signal
```

## MCP Servers

Add Model Context Protocol servers:

```bash
cybara mcp add memory '{"command": "npx", "args": ["-y", "@modelcontextprotocol/server-memory"]}'
```

## Logging

Logs stored in `~/.cybara/logs/`

```bash
# View logs
tail -f ~/.cybara/logs/cybara.log

# Set log level
LOG_LEVEL=debug cybara start
```

## Reset

```bash
# Clear all data
rm -rf ~/.cybara

# Clear only sessions
rm ~/.cybara/cybara.db-shm ~/.cybara/cybara.db-wal
sqlite3 ~/.cybara/cybara.db "DELETE FROM sessions; DELETE FROM messages;"
```
