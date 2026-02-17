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
  "allowedEthContracts": ["0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D"],
  "allowedSolPrograms": []
}
```

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
