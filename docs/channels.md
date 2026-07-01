# Cybara Channels Guide

Connect agents to multiple messaging platforms.

## Supported Channels

| Channel | Status | Features |
|---------|--------|----------|
| Telegram | ✅ | Full bot, reactions, inline buttons, polls |
| Discord | ✅ | Bot integration, reactions |
| Slack | ✅ | Workspace integration |
| WhatsApp | ✅ | `whatsapp-web.js` multi-device, QR auth, self-message mode |
| Signal | ✅ | via signal-cli |
| iMessage | ✅ | via BlueBubbles |
| Matrix | ✅ | Decentralized/federated messaging |
| Mattermost | ✅ | Self-hosted team chat |
| Microsoft Teams | ✅ | Outgoing webhook (HMAC) + synchronous replies |
| Feishu / Lark | ✅ | Event subscriptions, AES event decryption, tenant-token replies |
| DingTalk | ✅ | Enterprise robot webhook (HMAC), session-webhook replies |
| WeCom (Work Weixin) | ✅ | Self-built app callback (WXBizMsgCrypt AES), message-send replies |
| Zulip | ✅ | Outgoing webhook bot, synchronous replies |
| LINE | ✅ | Messaging API (signature-verified) |
| Google Chat | ✅ | Incoming webhook + app events |
| IRC | ✅ | Classic IRC networks |
| ntfy | ✅ | Push notifications |
| Twitch | ✅ | Chat integration |
| Nextcloud | ✅ | Nextcloud Talk |
| Synology | ✅ | Synology Chat outgoing webhook |
| Zalo | ✅ | Zalo Official Account |
| Home Assistant | ✅ | Automation webhook trigger + notify-service replies |
| Web | ✅ | Built-in chat UI |
| Webhook | ✅ | Inbound signed triggers (HMAC-SHA256) from CI, monitoring, forms |
| SMS | ✅ | Twilio REST — send + receive text messages |
| Email | ✅ | SMTP send + IMAP poll receive |

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

Uses `whatsapp-web.js` (WhatsApp Web multi-device session), not Meta Business API.

1. Add/enable WhatsApp channel in Cybara
2. Open Channels UI and scan the QR code shown for the channel
3. Wait for `Authenticated` + `Ready` state
4. Configure:

```bash
cybara channel add whatsapp
```

Optional config:
- `allow_self_messages: true` to allow replying when you message from the same linked account.

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

## In-Channel Commands

Cybara supports management commands directly from messaging channels:

- `/help` - Show command help
- `/status` - Show system status
- `/new` - Start a fresh session
- `/sessions` - List recent sessions
- `/switch <number|session_id_prefix>` - Switch session
- `/session [target]` - Show current session or switch to target
- `/workspace [path|clear]` - Show or set session workspace
- `/permissions [ask|allow]` - Dangerous tool approval mode
- `/agents` - List agents
- `/agent <id|name|number>` - Set default agent
- `/providers` - List providers
- `/provider <id|name|number>` - Set provider for default agent
- `/models` - List models for the default agent's provider
- `/model <id|number>` - Set model for the default agent
- `/subagents spawn <task>` - Run a one-off subagent task

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

## Webhook (inbound triggers)

Let any external system (CI, monitoring, IFTTT, forms) trigger a cybara agent via a signed HTTP POST. Inbound-only — there is no chat to reply into; the agent's response surfaces in logs / other channels.

1. Create a webhook channel in the UI (or API):
   ```bash
   curl -X POST http://localhost:4269/api/channels \
     -H "Content-Type: application/json" \
     -d '{"type":"webhook","name":"CI Hook","config":{"secret":"shared-hmac-secret"}}'
   ```
2. POST to the channel's inbound endpoint:
   ```bash
   curl -X POST http://localhost:4269/api/channels/<channel-id>/webhook \
     -H "x-cybara-signature: sha256=<hex-hmac>" \
     -H "Content-Type: application/json" \
     -d '{"event":"deploy","message":"Production deploy finished"}'
   ```
3. The HMAC-SHA256 signature (hex of the raw body with the shared secret) is verified when a `secret` is configured. If no secret is set, unsigned webhooks are accepted.

## SMS (Twilio)

Send and receive SMS via Twilio.

1. Create a channel:
   ```bash
   curl -X POST http://localhost:4269/api/channels \
     -H "Content-Type: application/json" \
     -d '{"type":"sms","name":"Twilio","config":{"account_sid":"AC...","auth_token":"...","from_number":"+15551234567"}}'
   ```
2. For inbound SMS, point a Twilio messaging webhook at the channel's inbound URL.
3. Outbound messages go via the Twilio REST API (`POST /2010-04-01/Accounts/{sid}/Messages.json`).

## Email (SMTP/IMAP)

Send email via raw SMTP and receive via IMAP poll.

1. Create a channel:
   ```bash
   curl -X POST http://localhost:4269/api/channels \
     -H "Content-Type: application/json" \
     -d '{"type":"email","name":"Support","config":{"smtp_host":"smtp.gmail.com","imap_host":"imap.gmail.com","username":"bot@example.com","password":"app-password","from_address":"bot@example.com"}}'
   ```
2. Outbound mail is submitted over a raw SMTP socket with AUTH LOGIN (no nodemailer dependency).
3. Inbound mail is polled from the configured IMAP inbox; the `dm_policy` (`allowlist` default) gates which senders are accepted.
