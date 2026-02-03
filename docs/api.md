# Cybara API Reference

REST API for programmatic access to Cybara.

Base URL: `http://localhost:4269`

## Chat

### Send Message
```http
POST /api/chat
Content-Type: application/json

{
  "message": "Hello",
  "sessionId": "optional-session-id",
  "agentId": "optional-agent-id"
}
```

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

## Skills

### List Installed Skills
```http
GET /api/skills
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
  "source": "clawhub:git-commit"
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

### Add Provider
```http
POST /api/providers
Content-Type: application/json

{
  "type": "openai",
  "apiKey": "sk-..."
}
```

### Remove Provider
```http
DELETE /api/providers/:id
```

### Test Provider
```http
POST /api/providers/:id/test
```

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

### Add Channel
```http
POST /api/channels
Content-Type: application/json

{
  "type": "telegram",
  "config": {"token": "123:ABC..."}
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

## Memory

### Search
```http
GET /api/memory/search?q=project+architecture
```

### Get Lines
```http
GET /api/memory/:file?start=10&end=20
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

## Cron

### List Jobs
```http
GET /api/cron
```

### Create Job
```http
POST /api/cron
Content-Type: application/json

{
  "schedule": "0 9 * * *",
  "task": "Check emails"
}
```

### Delete Job
```http
DELETE /api/cron/:id
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

## Health

### Status Check
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
