# Cybara Channels Guide

Connect agents to multiple messaging platforms.

## Supported Channels

| Channel | Status | Features |
|---------|--------|----------|
| Telegram | ✅ | Full bot, reactions, inline buttons, polls |
| Discord | ✅ | Bot integration, reactions |
| Slack | ✅ | Workspace integration |
| WhatsApp | ✅ | Meta Business API |
| Signal | ✅ | via signal-cli |
| iMessage | ✅ | via BlueBubbles |
| Web | ✅ | Built-in chat UI |

## Quick Setup

### Telegram

1. Message @BotFather on Telegram
2. Create bot: `/newbot`
3. Copy the bot token
4. Configure:

```bash
cybara channel add telegram
# Paste token when prompted
```

Or via API:
```bash
curl -X POST http://localhost:4269/api/channels \
  -H "Content-Type: application/json" \
  -d '{"type":"telegram","name":"Telegram Bot","config":{"bot_token":"123456:ABC..."}}'
```

#### Telegram Features

- **Reactions**: Enable in config, modes: minimal/extensive
- **Inline Buttons**: Enable per-chat or globally
- **Media**: Photos, documents, voice, video
- **Polls**: Create via message tool

### Discord

1. Create app: discord.com/developers/applications
2. Add bot to your server
3. Copy bot token
4. Configure:

```bash
cybara channel add discord
# Paste token when prompted
```

Discord requirements:
- Enable `Message Content Intent` in the Discord Developer Portal for your bot.
- In servers, message the bot with a mention (or DM the bot directly) to trigger responses.

### Slack

1. Create Slack app at api.slack.com
2. Add bot scopes: `chat:write`, `channels:history`, `app_mentions:read`
3. Install to workspace
4. Copy bot token and signing secret
5. Configure:

```bash
cybara channel add slack
```

### WhatsApp

Requires Meta Business API access:

1. Set up Meta Business account
2. Create WhatsApp Business app
3. Get phone number ID and access token
4. Configure:

```bash
cybara channel add whatsapp
```

### Signal

Requires signal-cli:

```bash
# Install
brew install signal-cli  # macOS
# or download from GitHub releases

# Register/Link
signal-cli link -n "Cybara"

# Configure
cybara channel add signal
```

### iMessage

Requires BlueBubbles server:

1. Install BlueBubbles on Mac
2. Get server URL and password
3. Configure:

```bash
cybara channel add imessage
```

## Channel Configuration

### Via Settings UI

Settings → Channels → Add/Edit

### Via Config File

`~/.cybara/config.json`:
```json
{
  "channels": [
    {
      "id": "tg-1",
      "type": "telegram",
      "enabled": true,
      "config": {
        "bot_token": "123456:ABC...",
        "allowedChats": ["@username", "-100123456"],
        "reactions": {
          "enabled": true,
          "mode": "minimal"
        },
        "inlineButtons": {
          "enabled": true,
          "scope": "dm"
        }
      }
    }
  ]
}
```

## Channel Capabilities

Configure per channel:

```json
{
  "capabilities": {
    "reactions": true,
    "inlineButtons": "dm",    // dm | group | all | allowlist
    "media": true,
    "voice": true,
    "replyQuotes": true
  }
}
```

## Multi-Channel Routing

When multiple channels are configured, the agent automatically routes to the source channel. For proactive sends:

```json
{"name": "message", "args": {
  "action": "send",
  "channel": "telegram",
  "to": "@username",
  "message": "Hello!"
}}
```

## Reply Tags

Quote/reply to specific messages:

```markdown
[[reply_to_current]]     # Reply to triggering message
[[reply_to:12345]]       # Reply to specific message ID
```
