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
| `FAL_KEY` / `FAL_API_KEY` | - | fal.ai media generation key for images, videos, music, and the bundled `fal.ai` skill |
| `LOG_LEVEL` | info | Logging verbosity |
| `LOG_FORMAT` | pretty | Log output format (`pretty` or `json`) |
| `CYBARA_RESOURCE_DIR` | - | Sidecar resource root used by packaged Tauri/native apps for bundled UI, `node_modules`, `secp256k1.wasm`, and ONNX runtime assets |
| `CYBARA_NATIVE_SIDECAR_PATH` | - | Native macOS shell override for the sidecar executable |
| `CYBARA_NATIVE_PORT` | 4269 | Native macOS shell gateway port |
| `CYBARA_CUA_DRIVER_CMD` | - | Highest-priority override for the `cua-driver` executable used by the `computer_use` tool |

`CYBARA_HOME` is the root for operator state. When set, Cybara resolves config, database, logs, local plugins, and local skills under that directory instead of `~/.cybara`.

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

Location: `$CYBARA_HOME/data/platform.db` (defaults to `~/.cybara/data/platform.db`)

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
- `workspace_indexer`: workspace indexing provider/model/runtime settings
- `memory`: local memory behavior and retrieval settings
- `memory_provider`: external memory provider selection and credentials for `local`, `supermemory`, `mem0`, `honcho`, `openviking`, or `hindsight`
- `llm_timeouts`: provider/model timeout overrides
- `speech`: shared TTS/STT provider settings
- `computer_use`: `{ driverCommand: string }`
- `reasoning_effort`: default model reasoning effort
- `self_improving_skills_enabled`: boolean toggle for `skill_save`
- `provider_plan_monitoring`: coding-plan usage limits and router enforcement

`computer_use.driverCommand` is the persisted Web/Tauri settings override for the Cua Driver
executable. `CYBARA_CUA_DRIVER_CMD` still takes precedence for scripts and operator-managed
deployments. If neither is set, Cybara probes PATH and the known Cua installer locations, including
Windows `%LOCALAPPDATA%\Programs\Cua\cua-driver\bin\cua-driver.exe` and
`%USERPROFILE%\.cua-driver\packages\current`.

## Gateway Auth And Operator Controls

Gateway auth settings are exposed through Settings, the Web/Tauri Auth/System panels, and these
admin API routes:

```http
GET /api/auth/settings
PUT /api/auth/settings
GET /api/auth/key
POST /api/auth/rotate-key
POST /api/system/restart
```

`PUT /api/auth/settings` can update `requireAuthForLocalhost`, `host`, `basePath`, and the
configured port unless those values are forced by environment variables such as `CYBARA_REQUIRE_AUTH`,
`CYBARA_HOST`, `CYBARA_BASE_PATH`, or `PORT`. Host changes can request an immediate controlled
listener rebind with `applyHostNow: true`; port changes still require a gateway restart. API-key
rotation is hot-swapped in memory and does not require a restart. Restart requires the `manage` scope
for paired mobile devices.

## Provider Configuration

### Via UI
Settings → Providers → Add Provider

### Via API
```bash
curl -X POST http://localhost:4269/api/providers \
  -H "Content-Type: application/json" \
  -d '{"type": "openai", "apiKey": "sk-..."}'
```

### Supported Providers (64)

See `/docs/providers.md` for the provider matrix. Runtime model lists are discovered from each
provider when supported, so use the UI, `GET /api/providers/available`, or
`cybara provider models <provider-id>` for the current model catalog.

Quick discovery commands:

```bash
# UI/API provider catalog
curl -s http://localhost:4269/api/providers/available | jq 'length'

# CLI model discovery for a configured provider
cybara provider models <provider-id>
```

### Credential Pools (multi-key rotation)

For any provider, set multiple API keys via environment variables (`<PROVIDER>_API_KEY`,
`<PROVIDER>_API_KEY_2`, `<PROVIDER>_API_KEY_3`, …, or comma-separated lists). Cybara rotates
round-robin and cools a key down on rate-limit/auth errors, so a 429 on one key triggers rotation
instead of failing the request. See `.env.example` and `src/core/credential-pool.ts`.

### Anthropic Prompt Caching

Anthropic requests automatically get `cache_control` breakpoints on the stable system prompt +
recent turns, giving ~75% input-token savings on multi-turn sessions. No configuration required.

## Provider Plan Monitoring

`provider_plan_monitoring` lets the router account for flat coding plans and pay-as-you-go spend:

```json
{
  "enabled": true,
  "routerEnforcement": true,
  "warningThresholdPct": 80,
  "staleAfterMinutes": 120,
  "providers": {
    "openai-codex": {
      "enabled": true,
      "presetId": "openai-codex-plus",
      "sourceMode": "oauth_api",
      "fiveHour": { "enabled": true, "tokenLimit": 2500000 },
      "weekly": { "enabled": true, "tokenLimit": 10000000 },
      "monthly": { "enabled": true, "spendLimit": 20 }
    }
  }
}
```

Supported source modes are `local`, `provider_api`, `oauth_api`, `browser_cookie`, `cli`, and
`manual`. Cybara tracks local token/spend usage immediately; external provider sources are opt-in
and treated as plan context for providers that expose OAuth/API/CLI billing data. When router
enforcement is enabled, exhausted configured plans are marked unavailable in router status.

Routes:

```http
GET /api/provider-plans/config
PUT /api/provider-plans/config
GET /api/provider-plans/status
GET /api/router/status
GET /api/router/config
PUT /api/router/config
```

## Speech Settings

Speech settings are shared by Web/Tauri, React Native mobile, native macOS, and the speech tools:

```json
{
  "speech": {
    "tts": {
      "provider": "auto",
      "providerId": "",
      "model": "",
      "voice": "",
      "outputFormat": "mp3",
      "speed": 1,
      "maxTextLength": 50000,
      "fallbackToSystem": true
    },
    "stt": {
      "provider": "auto",
      "providerId": "",
      "model": "",
      "language": "en-us"
    }
  }
}
```

TTS provider values are `auto`, `system`, `elevenlabs`, and `openai`; STT provider values are
`auto`, `native`, and `openai`. Native STT uses browser/OS speech recognition when available. Server
transcription uses `/api/speech/dictate` with an OpenAI/OpenAI Codex-compatible provider.

Routes:

```http
GET /api/speech/settings
PUT /api/speech/settings
POST /api/speech/dictate
```

## Source Migration

Cybara can import user data from OpenClaw or Hermes from the CLI, Web/Tauri settings, native macOS
settings, or the API. The default `user-data` preset imports persona files, memories, skills, and
workspace instructions while skipping secrets. The `full` preset can also import provider secrets
and speech preferences when `migrateSecrets` is explicitly enabled.

```bash
cybara migrate sources
cybara migrate --from openclaw
cybara migrate --from hermes --apply --preset user-data
cybara migrate --from openclaw --apply --preset full --migrate-secrets --overwrite
```

API routes:

```http
GET /api/migrations/sources
POST /api/migrations/preview
POST /api/migrations/run
```

Migration reports are written under `$CYBARA_HOME/migrations/<source>-<timestamp>/` after an apply
run, so operators can review exactly what was imported or skipped.

## Workspace Indexing And Local Embeddings

Workspace indexing supports lexical search by default and can use local Transformers.js embeddings
when the embedding provider is set to `transformers_js` or selected through `auto`.

Runtime notes:

- `@huggingface/transformers` is pinned in the root package and loaded lazily.
- Desktop sidecar builds copy Transformers.js, ONNX Runtime Node, ONNX Runtime Web/WASM, and the target native ONNX binding when the installed package ships one.
- The loader searches `CYBARA_RESOURCE_DIR`, `process.cwd()`, and `dirname(process.execPath)` for packaged `node_modules` runtime assets.
- Model files are cached under `$HOME/.cybara/memory/transformers` by default.
- If a native ONNX binding is unavailable for the platform/architecture, the bundled ONNX Web/WASM runtime is used as fallback.

## Shell Hooks

User-defined shell scripts can run on agent lifecycle events (tool calls, LLM requests, messages).
Configure them in the runtime config under `hooks.shell`:

```json
{
  "hooks": {
    "shell": [
      {
        "events": ["tool_before"],
        "command": "/path/to/my-hook.sh",
        "timeoutMs": 5000
      }
    ]
  }
}
```

The script receives the event as JSON on stdin. For `tool_before`, returning
`{"block": true, "reason": "..."}` on stdout blocks the tool call. Supported events: `tool_before`,
`tool_after`, `tool_error`, `tool_blocked`, `llm_request`, `llm_response`, `llm_error`,
`message:received`, `message:sent`, or `*` (all). See `src/core/shell-hooks.ts`.

## File-Write Safety

All file-writing tools enforce a hard deny-list before writing (credentials, SSH keys, `.env`,
`.aws/credentials`, OAuth tokens, etc.) — see `docs/tools.md#file-write-safety-policy`. The deny-list
cannot be bypassed by the agent. Optional workspace confinement can be enabled via the execution
context (`confineToWorkspace` + `workspaceDir`).

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

Configure in settings or `$CYBARA_HOME/config.json`:

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

Runtime logs are emitted to stdout/stderr. Daemon mode also writes `$CYBARA_HOME/cybara.log`.

```bash
# Daemon logs (when started with -d)
tail -f ~/.cybara/cybara.log

# Set log level
LOG_LEVEL=debug cybara start
```

## Reset

```bash
# Clear all data
rm -rf "${CYBARA_HOME:-$HOME/.cybara}"

# Clear only sessions
rm "${CYBARA_HOME:-$HOME/.cybara}"/data/platform.db-shm "${CYBARA_HOME:-$HOME/.cybara}"/data/platform.db-wal
sqlite3 "${CYBARA_HOME:-$HOME/.cybara}"/data/platform.db "DELETE FROM sessions; DELETE FROM messages;"
```

## Tool Approval System

Dangerous tools (exec, git, wallet, browser, computer_use, execute_code) can require operator
approval before execution. When `tool_approval_mode` is set to `"ask"` (vs the default
`"always_allow"`), the agent suspends the tool call and emits an approval request. The UI or API
can then resolve it with `approve_once`, `approve_session`, `approve_always`, or `deny`.

```bash
# Set approval mode to "ask"
curl -X PUT http://localhost:4269/api/config -H "Content-Type: application/json" \
  -d '{"tool_approval_mode": "ask"}'

# List pending approval requests
curl http://localhost:4269/api/tools/approvals

# Resolve a request
curl -X POST http://localhost:4269/api/tools/approvals/resolve \
  -H "Content-Type: application/json" \
  -d '{"requestId": "<id>", "decision": "approve_session"}'
```

Per-session and persistent allowlists avoid re-prompting for approved tools.

## Dynamic Model Discovery

Cybara can fetch live model lists from OpenAI-compatible providers and merge new models into
the catalog without code changes:

```bash
# Discover models for a provider
curl -X POST http://localhost:4269/api/providers/<provider-id>/models/discover
```

This queries the provider's `/v1/models` endpoint and adds any new models to the DB-backed
catalog. Use this to stay current as providers release new models.

## Filesystem Checkpoints

Cybara snapshots the workspace before file-mutating turns (via git write-tree). List and manage
checkpoints:

```bash
# List checkpoints for a workspace
curl "http://localhost:4269/api/checkpoints?workspace=/path/to/workspace"

# Delete a checkpoint
curl -X DELETE "http://localhost:4269/api/checkpoints/<id>?workspace=/path/to/workspace"
```

Checkpoints are stored in `<workspace>/.cybara/checkpoints/` and pruned to the 20 most recent.

## Transform Hooks

In addition to shell-script hooks, the agent hook system supports transform hooks that rewrite
output before it's stored/returned. Register via the TS hook API:

- `transform:tool_result` — rewrite a tool's result before the model sees it (PII scrubbing,
  output sanitization).
- `transform:llm_output` — rewrite the assistant's response text.
- `transform:terminal_output` — rewrite exec/process output.
