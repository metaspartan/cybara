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
| `LOG_FORMAT` | pretty | Log output format (`pretty` or `json`) |

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

Location: `~/.cybara/data/platform.db`

### Tables

- `agents` - Agent configurations
- `sessions` - Conversation sessions  
- `messages` - Message history
- `providers` - AI provider configs
- `skills` - Installed skills
- `config` - Key-value settings
- `cron_jobs` - Scheduled tasks

## Runtime Config Keys

Key-value settings are stored in the `config` table and exposed via `GET/PUT /api/config`.

- `tool_approval_mode`: `always_allow` or `ask`
- `dangerous_tool_policy`: `{ enabled: boolean, mode: "audit" | "block" }`
- `web_tool_url_policy`: `{ enabled: boolean, fetch_allowlist: string[], search_result_allowlist: string[] }`
- `sandbox_runtime`: `{ enabled: boolean, provider: "auto" | "apple_sandbox" | "podman" | "docker", network: "allow" | "deny" }`

## Provider Configuration

### Via UI
Settings → Providers → Add Provider

### Via API
```bash
curl -X POST http://localhost:4269/api/providers \
  -H "Content-Type: application/json" \
  -d '{"type": "openai", "apiKey": "sk-..."}'
```

### Supported Providers (33)

See `/docs/providers.md` for the complete up-to-date provider matrix.

Quick discovery commands:

```bash
# UI/API provider catalog
curl -s http://localhost:4269/api/providers/available | jq 'length'

# CLI model discovery for a configured provider
cybara provider models <provider-id>
```

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
cybara mcp add memory '{"command": "bunx", "args": ["@modelcontextprotocol/server-memory"]}'
```

## Logging

Runtime logs are emitted to stdout/stderr. Daemon mode also writes `~/.cybara/cybara.log`.

```bash
# Daemon logs (when started with -d)
tail -f ~/.cybara/cybara.log

# Set log level
LOG_LEVEL=debug cybara start
```

## Reset

```bash
# Clear all data
rm -rf ~/.cybara

# Clear only sessions
rm ~/.cybara/data/platform.db-shm ~/.cybara/data/platform.db-wal
sqlite3 ~/.cybara/data/platform.db "DELETE FROM sessions; DELETE FROM messages;"
```
