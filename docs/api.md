# Cybara API Reference

REST API for programmatic access to Cybara.

Base URL: `http://localhost:4269`

## Authentication

Pass your API key via header:
```bash
curl -H "Authorization: Bearer cybara_abc123..." http://localhost:4269/api/health
```

Development mode keeps a narrow auth bypass for same-origin local browser requests from the Web,
Tauri, or native macOS UI. Bare local API clients, cross-origin browser requests, DNS-rebinding
attempts, and production mode requests still need a valid API key.

### Gateway Auth Settings
```http
GET /api/auth/settings
PUT /api/auth/settings
GET /api/auth/key
POST /api/auth/rotate-key
POST /api/system/restart
```

`PUT /api/auth/settings` accepts `requireAuthForLocalhost`, `host`, `applyHostNow`, `basePath`, and
`port` unless those values are forced by environment variables. Host changes can apply immediately
through a controlled listener rebind; port changes require a gateway restart. `POST
/api/auth/rotate-key` hot-swaps the gateway API key without requiring a restart. `POST
/api/system/restart` requires the `manage` scope for paired mobile devices.

## Chat

### Send Message
```http
POST /api/chat
Content-Type: application/json

{
  "message": "Hello",
  "sessionId": "optional-session-id",
  "agentId": "optional-agent-id",
  "workspaceDir": "/optional/workspace",
  "queueMode": "queue"
}
```
Returns JSON:
```json
{
  "sessionId": "uuid",
  "workspaceDir": "/path/or/null",
  "message": {
    "role": "assistant",
    "content": "...",
    "timestamp": "ISO-8601",
    "thinking": "...",
    "tool_calls": [],
    "process_activities": []
  },
  "agent": {
    "id": "agent-id",
    "name": "Agent Name"
  }
}
```

### List Sessions
```http
GET /api/sessions
```

Query params:

- `limit` (optional, integer): max sessions to return. Server caps at `500`.
- `offset` (optional, integer): pagination offset.

Example:
```http
GET /api/sessions?limit=50&offset=0
```

Returns an array of session summaries:

```json
[
  {
    "id": "session-id",
    "agent_id": "agent-id",
    "title": "Mini: Cybara codebase audit report",
    "created_at": "2026-02-28T05:31:22.102Z",
    "updated_at": "2026-02-28T05:36:03.884Z",
    "workspace_dir": "/home/user/workspace",
    "message_count": 12,
    "last_message": {
      "role": "assistant",
      "content": "I audited the codebase and found..."
    }
  }
]
```

Legacy alias (still supported):
```http
GET /api/chat/sessions
```

### Get Session Messages
```http
GET /api/sessions/:sessionId
```

Legacy message-only alias:
```http
GET /api/chat/sessions/:id/messages
```

### Pending Messages, Queueing, And Steering
```http
GET /api/chat/sessions/:id/pending
POST /api/chat/sessions/:id/pending/reorder
PATCH /api/chat/sessions/:id/pending/:pendingId
DELETE /api/chat/sessions/:id/pending/:pendingId
POST /api/chat/sessions/:id/pending/:pendingId/steer
```

When a session is already running, `POST /api/chat` can accept `queueMode: "queue"` to append a
pending user message or `queueMode: "steer"` to interrupt the current turn and inject the follow-up
as part of the session history. Pending messages can be edited, deleted, reordered, or explicitly
steered from Web/Tauri and mobile clients.

### Delete Session
```http
DELETE /api/sessions/:sessionId
```

Legacy alias:
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
Returns all supported provider types (61 definitions in `src/core/providers.ts`) with configuration requirements.

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

## Router And Provider Plans

### Router Status / Config
```http
GET /api/router/status
GET /api/router/config
PUT /api/router/config
```

Router config controls provider selection strategy, model preferences, fallback behavior, rate
limits, spend caps, and mixture-of-agents settings. Router status includes provider availability and
plan-limit constraints.

### Provider Plan Monitoring
```http
GET /api/provider-plans/config
PUT /api/provider-plans/config
GET /api/provider-plans/status
```

Provider plan monitoring tracks local token/spend usage against configured coding-plan limits.
Supported limit windows are rolling 5-hour, rolling week, and billing month. Source modes are
`local`, `provider_api`, `oauth_api`, `browser_cookie`, `cli`, and `manual`; external sources are
opt-in and provider-specific.

## Speech

### Shared Speech Settings
```http
GET /api/speech/settings
PUT /api/speech/settings
```

The speech config contains `tts` and `stt` settings shared by Web/Tauri, mobile, native macOS, and
the speech tools. TTS supports `auto`, `system`, `elevenlabs`, and `openai`; STT supports `auto`,
`native`, and `openai`.

### Server Transcription
```http
POST /api/speech/dictate
Content-Type: application/json

{
  "audioBase64": "base64-encoded-audio",
  "mimeType": "audio/webm",
  "fileName": "dictation.webm",
  "providerId": "optional-provider-id",
  "model": "optional-model"
}
```

Returns transcribed text using an OpenAI/OpenAI Codex-compatible provider. Native dictation runs in
the client and does not require this endpoint unless a specific server provider is requested.

## Wallet

Encrypted local BIP39 wallet with multi-chain derivations (`eth`, `btc`, `sol`).

### Status / Locking
```http
GET /api/wallet/status
POST /api/wallet/create
POST /api/wallet/import
POST /api/wallet/unlock
POST /api/wallet/lock
DELETE /api/wallet
PUT /api/wallet/agent-access
GET /api/wallet/agent-policy
PUT /api/wallet/agent-policy
```

Create/import/unlock payloads:
```json
{
  "password": "your-password",
  "mnemonic": "24 words (import only)"
}
```

### Derivations / Portfolio
```http
GET /api/wallet/accounts?chains=eth,btc,sol&count=3&startIndex=0
GET /api/wallet/receive?chain=eth&index=0
GET /api/wallet/balances?chains=eth,btc,sol&count=3&startIndex=0
GET /api/wallet/tokens?chain=eth&index=0&includeZero=false
GET /api/wallet/token-transactions?chain=eth&index=0&limit=20
GET /api/wallet/transactions?chain=eth&index=0&limit=10
```

### Send Transaction
```http
POST /api/wallet/send
Content-Type: application/json

{
  "chain": "eth",
  "to": "0x...",
  "amount": "0.01",
  "index": 0,
  "memo": "optional",
  "feeRate": 4
}
```

`feeRate` is used for BTC (sat/vByte).

### Send Token (ERC-20 / SPL)
```http
POST /api/wallet/send-token
Content-Type: application/json

{
  "chain": "eth",
  "tokenAddress": "0xA0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
  "to": "0x...",
  "amount": "10.5",
  "index": 0,
  "decimals": 6
}
```

For Solana, pass the SPL mint in `tokenAddress` (or `mint`) and set `chain` to `sol`.

### Token Transfer History (ERC-20 / SPL)
```http
GET /api/wallet/token-transactions?chain=eth&index=0&limit=20&tokenAddress=0xA0b86991c6218b36c1d19d4a2e9eb0ce3606eb48
```

For Solana, set `chain=sol` and optionally pass `rpcUrl`.

### ETH Smart Contract Call
```http
POST /api/wallet/eth-contract
Content-Type: application/json

{
  "contractAddress": "0x...",
  "method": "balanceOf(address)",
  "methodSignature": "balanceOf(address)",
  "abi": "[\"function balanceOf(address owner) view returns (uint256)\"]",
  "args": ["0x..."],
  "readOnly": true,
  "gasLimit": "210000",
  "maxFeePerGasGwei": "25",
  "maxPriorityFeePerGasGwei": "1.5",
  "nonce": 7
}
```

`abi` is optional when `methodSignature` is provided. Set `readOnly: false` (or omit) to send a signed transaction from the derived wallet index.

### Solana Program Instruction
```http
POST /api/wallet/sol-instruction
Content-Type: application/json

{
  "programId": "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr",
  "accounts": [
    { "pubkey": "11111111111111111111111111111111", "isSigner": false, "isWritable": false }
  ],
  "dataHex": "0x0102",
  "computeUnitLimit": 180000,
  "computeUnitPriceMicroLamports": 2000,
  "skipPreflight": false,
  "index": 0,
  "rpcUrl": "https://api.mainnet-beta.solana.com"
}
```

Use exactly one data field: `dataBase64`, `dataHex`, or `dataUtf8`. `keys` is also accepted as an alias of `accounts`.

### Sign Message (ETH)
```http
POST /api/wallet/sign
Content-Type: application/json

{
  "message": "hello",
  "chain": "eth",
  "index": 0
}
```

### RPC Endpoint Configuration
```http
GET /api/wallet/rpc
GET /api/wallet/rpc/status
PUT /api/wallet/rpc
```

Update payload:
```json
{
  "ethRpc": "https://ethereum-rpc.publicnode.com",
  "solRpc": "https://api.mainnet-beta.solana.com",
  "btcApi": "https://mempool.space/api"
}
```

`GET /api/wallet/rpc/status` returns health/latency/latest-height for ETH, SOL, and BTC endpoints.

### Agent Wallet Policy
```http
GET /api/wallet/agent-policy
PUT /api/wallet/agent-policy
```

Update payload example:
```json
{
  "allowNativeSend": true,
  "allowTokenSend": true,
  "allowEthContractWrite": false,
  "allowSolProgramInstruction": false,
  "allowEthSwaps": true,
  "allowDappInteraction": true,
  "allowX402Payments": false,
  "allowedEthContracts": ["0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D"],
  "allowedSolPrograms": [],
  "allowedDappHosts": ["app.uniswap.org", "jup.ag"],
  "allowedX402Networks": ["eip155:1", "eip155:8453"],
  "x402MaxAmountAtomic": "1000000"
}
```

`allowedDappHosts` entries can be hostnames (e.g. `app.uniswap.org`), parent domains (e.g. `uniswap.org`), or explicit `host:port` values for local/dev gateways.

### Uniswap ETH Swap (V2)
```http
POST /api/wallet/swap-eth-uniswap
Content-Type: application/json

{
  "tokenOut": "LINK",
  "percent": 50,
  "slippageBps": 100,
  "dryRun": true,
  "index": 0
}
```

Set `dryRun: false` (or omit) to broadcast the swap transaction.

### Price Quote (Chainlink / Pyth / Jupiter)
```http
POST /api/wallet/price
Content-Type: application/json

{
  "source": "auto",
  "symbol": "BTC"
}
```

Options:
- `source`: `auto`, `chainlink`, `pyth`, or `jupiter`
- `symbol` or `pair` (e.g., `BTC` or `BTC/USD`)
- `feedAddress` for Chainlink override
- `pythFeedId` (or `feedId`) for Pyth override
- `mint` for Jupiter token pricing

### Wallet Endpoint Directory
```http
GET /api/wallet/endpoints
```

Returns canonical router/oracle/program IDs and service endpoints used by wallet tools.

### Dapp Adapter Directory
```http
GET /api/wallet/dapps
```

Returns discoverable wallet dapp adapters (`adapter`, `chain`, `write`, `description`) and operator notes.

### Raw Chain RPC Call
```http
POST /api/wallet/rpc-call
Content-Type: application/json

{
  "chain": "eth",
  "method": "eth_blockNumber",
  "params": [],
  "id": 7
}
```

Supports `eth` and `sol` with optional `rpcUrl` override.

### Dynamic Dapp Adapter Call
```http
POST /api/wallet/dapp
Content-Type: application/json

{
  "adapter": "uniswap_v3",
  "payload": {
    "action": "quote",
    "tokenOut": "LINK",
    "amountEth": "0.25"
  }
}
```

`payload` can be any JSON object accepted by the target adapter.

### x402 HTTP Payment Flow
```http
POST /api/wallet/x402
Content-Type: application/json

{
  "url": "https://merchant.example/x402/resource",
  "method": "POST",
  "headers": { "content-type": "application/json" },
  "body": { "prompt": "run task" },
  "network": "eip155:1",
  "maxAmountAtomic": "250000",
  "dryRun": true
}
```

When `dryRun: true`, the endpoint returns 402 requirement details without signing/broadcasting a payment.  
When `dryRun: false`, it attempts payment if policy permits.

Compatibility notes:
- Supports x402 v2 (`PAYMENT-REQUIRED` / `PAYMENT-SIGNATURE`) and x402 v1 (`X-PAYMENT` body/header flows).
- EVM exact payments support both `extra.assetTransferMethod = "eip3009"` and `"permit2"`.
- Solana exact payments are supported for `solana:*` (and v1 `solana*` names). Solana requirements must include `extra.feePayer`.
- `network` may be omitted to auto-select the first compatible merchant requirement, or set explicitly (for example `eip155:1`, `base`, `solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp`).

### Dynamic Swap Quote / Execute (Uniswap V2, Uniswap V3, Jupiter)
```http
POST /api/wallet/swap
Content-Type: application/json

{
  "venue": "uniswap_v3",
  "tokenOut": "LINK",
  "amountEth": "0.25",
  "feeTier": 3000,
  "slippageBps": 100,
  "dryRun": true
}
```

Jupiter example:
```http
POST /api/wallet/swap
Content-Type: application/json

{
  "venue": "jupiter",
  "inputMint": "So11111111111111111111111111111111111111112",
  "outputMint": "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  "amount": "1.0",
  "slippageBps": 100,
  "dryRun": true
}
```

Execution controls:
- Quote mode: `dryRun: true` (default when `execute`/`broadcast` are omitted)
- Execute mode: set `execute: true` (or `broadcast: true`) or set `dryRun: false`

Venue aliases are accepted (`uniswap`, `uniswap-v3`, `jup`, etc.) and normalized server-side.

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
POST /api/tasks/:id/run
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
```
Optional JSON body:
```json
{
  "index": 0
}
```
If `index` is provided, that entry is deleted. If no body is sent, the whole file is deleted.

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
  "command": "bunx",
  "args": ["-y", "@modelcontextprotocol/server-filesystem"]
}
```

### List MCP Tools
```http
GET /api/mcp/tools
```

## Metrics

### Summary And Dashboards
```http
GET /api/metrics
GET /api/metrics/overview
GET /api/metrics/storage
GET /api/metrics/tokens
GET /api/metrics/files
GET /api/metrics/tools
GET /api/metrics/providers
GET /api/metrics/time-series
GET /api/metrics/models
GET /api/metrics/insights
GET /api/metrics/token-analysis
POST /api/metrics/track
```

Metrics include overview totals, token/provider/model breakdowns, file and tool activity, storage
usage, time-series data, insights, and token analysis. Dashboard-heavy metric routes are cached with
short stale-while-revalidate windows outside test mode so Web/Tauri, mobile, and native macOS can
load the same large datasets without repeatedly rebuilding them.

## Config

### Get Config
```http
GET /api/config
```

### Set Config
```http
PUT /api/config
Content-Type: application/json

{"key": "value", ...}
```

`GET /api/config` returns redacted runtime settings, including `workspace_indexer`, `memory`,
`memory_provider`, `speech`, `computer_use`, `llm_timeouts`, `reasoning_effort`,
`sandbox_runtime`, and the tool/security policies. `PUT /api/config` accepts partial updates for
those config keys.

## Source Migration

```http
GET /api/migrations/sources
POST /api/migrations/preview
POST /api/migrations/run
```

Migration routes import OpenClaw or Hermes user data. `preview` always runs as a dry run; `run`
applies the selected preset. Request fields include `sourceKind`, `sourcePath`, `preset`,
`migrateSecrets`, `overwrite`, `skillConflict`, and `workspaceTarget`.

## Logs

```http
GET /api/logs/system
GET /api/logs/search?q=query
GET /api/logs/activity?minutes=120
GET /api/logs/sessions/:sessionId/messages
GET /api/logs/agents/:agentId
GET /api/logs/stats?hours=1
```

Log routes back the Web/Tauri, mobile, native macOS, and CLI log viewers. `GET /api/logs/system`
accepts bounded `limit`, `offset`, and `includeTotal=1` query params for paged mobile/native reads.

## System

### Health Check
```http
GET /api/health
```

Returns:
```json
{
  "status": "healthy",
  "uptime": 3600,
  "version": "1.0.818",
  "checks": {
    "database": true
  }
}
```

### Platform Info
```http
GET /api/info
```

### SSE Event Stream
```http
GET /api/sse/status
```
Server-Sent Events stream for real-time status updates (agent state changes, task completions, etc.).

### WebSocket Event Stream
```http
GET /api/ws/status
```
WebSocket status stream with snapshot bootstrap and realtime events (`status`, `task_completed`, `snapshot`).

### Open URL
```http
POST /api/open-url
Content-Type: application/json

{"url": "https://example.com"}
```
Opens a URL in the default browser (used by OAuth flows).
