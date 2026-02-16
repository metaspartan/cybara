# Cybara API Reference

REST API for programmatic access to Cybara.

Base URL: `http://localhost:4269`

## Authentication

Pass your API key via header:
```bash
curl -H "Authorization: Bearer cybara_abc123..." http://localhost:4269/api/health
```

Localhost connections skip auth in development mode.

## Chat

### Send Message (SSE Streaming)
```http
POST /api/chat
Content-Type: application/json

{
  "message": "Hello",
  "sessionId": "optional-session-id",
  "agentId": "optional-agent-id"
}
```
Returns a Server-Sent Events stream with assistant response, tool calls, and status updates.

### List Sessions
```http
GET /api/chat/sessions
```

### Get Session Messages
```http
GET /api/chat/sessions/:id/messages
```

### Delete Session
```http
DELETE /api/chat/sessions/:id
```

## Agents

### List Agents
```http
GET /api/agents
```

### Create Agent
```http
POST /api/agents
Content-Type: application/json

{
  "name": "Research Agent",
  "type": "research",
  "provider": "anthropic",
  "model": "claude-sonnet-4-5"
}
```

### Get Agent
```http
GET /api/agents/:id
```

### Update Agent
```http
PUT /api/agents/:id
```

### Delete Agent
```http
DELETE /api/agents/:id
```

### Start/Stop Agent
```http
POST /api/agents/:id/start
POST /api/agents/:id/stop
```

### Get Agent State
```http
GET /api/agents/:id/state
```

## Skills

### List Installed Skills
```http
GET /api/skills
```

### Create Local Skill
```http
POST /api/skills
Content-Type: application/json

{
  "name": "my-skill",
  "description": "What this skill does",
  "content": "# my-skill\n\nSkill instructions..."
}
```

### Get Skill Status
```http
GET /api/skills/status
```
Returns eligibility info and missing requirements.

### Search Registry
```http
GET /api/skills/registry/search?q=git&registry=all
```

### Install Skill
```http
POST /api/skills/install
Content-Type: application/json

{
  "slug": "git-commit",
  "registry": "clawhub"
}
```

### Remove Skill
```http
DELETE /api/skills/:name
```

### Update Skills
```http
POST /api/skills/update
```

## Providers

### List Providers
```http
GET /api/providers
```

### Get Available Types
```http
GET /api/providers/available
```
Returns all 20 supported provider types with their configuration requirements.

### Provider Health
```http
GET /api/providers/health
```

### Add Provider
```http
POST /api/providers
Content-Type: application/json

{
  "provider": "openai",
  "name": "OpenAI",
  "api_key": "sk-..."
}
```

### Update Provider
```http
PUT /api/providers/:id
```

### Remove Provider
```http
DELETE /api/providers/:id
```

### Test Provider
```http
POST /api/providers/:id/test
```

### List Provider Models
```http
GET /api/providers/:id/models
```

### Start OAuth Flow
```http
POST /api/providers/oauth/start
Content-Type: application/json

{
  "providerType": "antigravity"
}
```
Opens a browser window for OAuth authentication. Uses PKCE for security.

### Check OAuth Callback Status
```http
POST /api/providers/oauth/callback-status
```
Poll this endpoint to check if the OAuth flow completed.

## Browser

### Get Status
```http
GET /api/browser/status
```

### List Profiles
```http
GET /api/browser/profiles
```

### Create Profile
```http
POST /api/browser/profiles
Content-Type: application/json

{"name": "work"}
```

### Delete Profile
```http
DELETE /api/browser/profiles/:name
```

## Channels

### List Channels
```http
GET /api/channels
```

### Get Available Channel Types
```http
GET /api/channels/available
```

### Add Channel
```http
POST /api/channels
Content-Type: application/json

{
  "type": "telegram",
  "name": "Telegram Bot",
  "config": {"bot_token": "123:ABC..."}
}
```

### Auto-Setup Telegram
```http
POST /api/channels/telegram/setup
Content-Type: application/json

{
  "botToken": "123:ABC...",
  "webhookUrl": "https://example.com/api/webhooks/telegram"
}
```

### Remove Channel
```http
DELETE /api/channels/:id
```

### Test Channel
```http
POST /api/channels/:id/test
```

## Tasks (Cron)

### List Tasks
```http
GET /api/tasks
```

### Create Task
```http
POST /api/tasks
Content-Type: application/json

{
  "name": "Daily Report",
  "action": "Check emails",
  "schedule": "0 9 * * *",
  "agent_id": "optional-agent-id"
}
```

### Start/Stop/Trigger Task
```http
POST /api/tasks/:id/start
POST /api/tasks/:id/stop
POST /api/tasks/:id/trigger
```

### Delete Task
```http
DELETE /api/tasks/:id
```

### Get Task Run History
```http
GET /api/tasks/:id/runs
```

## Terminal

> Requires `--enable-terminal` flag (enabled by default in `tauri:dev`).

### WebSocket Connection
```
WS /api/terminal/ws?sessionId=my-session
```
Connect via WebSocket for interactive terminal access. Send text to write to stdin, receive stdout/stderr output.

### List Terminal Sessions
```http
GET /api/terminal/sessions
```

## Subagents

### Spawn Subagent
```http
POST /api/subagents/spawn
Content-Type: application/json

{
  "task": "Research best practices for...",
  "agentId": "optional-agent-id"
}
```

### List Subagents
```http
GET /api/subagents
```

### Get Subagent Details
```http
GET /api/subagents/:id
```

### Kill Subagent
```http
POST /api/subagents/:id/kill
```

## Memory

### List Memory Files
```http
GET /api/memory
```

### Search
```http
GET /api/memory/search?query=project+architecture
```

### Save
```http
POST /api/memory
Content-Type: application/json

{
  "file": "notes.md",
  "content": "..."
}
```

### Edit Memory Entry
```http
PUT /api/memory/:file
Content-Type: application/json

{
  "index": 0,
  "content": "updated text"
}
```

### Delete Memory Entry or File
```http
DELETE /api/memory/:file
Content-Type: application/json

{
  "index": 0
}
```

## LSP

### Get Language Server Status
```http
GET /api/lsp/status
```

### Install Language Server
```http
POST /api/lsp/install/:language
```

### Uninstall Language Server
```http
POST /api/lsp/uninstall/:language
```

## MCP

### List MCP Servers
```http
GET /api/mcp/servers
```

### Add MCP Server
```http
POST /api/mcp/servers
Content-Type: application/json

{
  "name": "filesystem",
  "command": "npx",
  "args": ["-y", "@modelcontextprotocol/server-filesystem"]
}
```

### List MCP Tools
```http
GET /api/mcp/tools
```

## Metrics

### Token Usage
```http
GET /api/metrics/tokens
```

### Session Stats
```http
GET /api/metrics/sessions
```

## Config

### Get Config
```http
GET /api/config/:key
```

### Set Config
```http
POST /api/config
Content-Type: application/json

{"key": "value", ...}
```

## System

### Health Check
```http
GET /api/health
```

Returns:
```json
{
  "status": "ok",
  "uptime": 3600,
  "version": "1.0.0",
  "database": "connected"
}
```

### Platform Info
```http
GET /api/info
```

### SSE Event Stream
```http
GET /api/status/sse
```
Server-Sent Events stream for real-time status updates (agent state changes, task completions, etc.).

### Open URL
```http
POST /api/open-url
Content-Type: application/json

{"url": "https://example.com"}
```
Opens a URL in the default browser (used by OAuth flows).
