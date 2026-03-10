# Cybara Tools Reference

Agents have access to built-in tools for file, process, browser, memory, artifacts, data, wallet, calling, and messaging operations.

## Permission Context

Tool schemas include permission tags (for example `fs:read`, `fs:write`, `wallet:use`).
Execution can enforce those tags when a context includes:

```json
{
  "context": {
    "permissions": ["fs:read"],
    "enforcePermissions": true
  }
}
```

This is supported by `POST /api/tools/execute` and by agentic tool loops when an agent config sets
`tool_permissions`/`toolPermissions` (and optional `enforce_tool_permissions`/`enforceToolPermissions`).

## File Operations

### read
Read file contents.
```json
{"name": "read", "args": {"path": "/path/to/file.txt"}}
```
Options: `limit` (max lines), `offset` (start line, 1-indexed)

### write
Create or overwrite files.
```json
{"name": "write", "args": {"path": "/path/to/file.txt", "content": "..."}}
```

### edit
Make precise edits to files using search/replace.
```json
{"name": "edit", "args": {"path": "/path/to/file.txt", "oldText": "old", "newText": "new"}}
```

### file_search
Search for files matching a glob pattern.
```json
{"name": "file_search", "args": {"pattern": "**/*.ts", "cwd": "/project"}}
```

### grep
Search file contents using ripgrep (fast recursive pattern matching).
```json
{"name": "grep", "args": {"pattern": "TODO", "path": "/project"}}
```
Options: `type` (file extension filter), `context` (lines around matches), `maxResults`, `caseSensitive`, `recursive`

### apply_patch
Apply a unified diff patch to multiple files (git diff format).
```json
{"name": "apply_patch", "args": {"patch": "--- a/file.ts\n+++ b/file.ts\n..."}}
```
Options: `dryRun` (validate without applying)

## Process Operations

### exec
Run shell commands.
```json
{"name": "exec", "args": {"command": "git status", "workdir": "/project"}}
```
Options: `timeout` (seconds), `elevated`, `env` (extra environment vars)

### process
Manage background exec sessions.
```json
{"name": "process", "args": {"action": "list"}}
{"name": "process", "args": {"action": "kill", "sessionId": "abc123"}}
```

### git
Git operations (status, diff, log, etc.).
```json
{"name": "git", "args": {"action": "status", "cwd": "/project"}}
```

## Calling

### phone
Start a FaceTime phone call on macOS.
```json
{"name": "phone", "args": {"action": "call", "phone": "+15551234567"}}
{"name": "phone", "args": {"action": "check"}}
```
Actions: `call`, `check`

### voice_call
Manage an agent-tracked call lifecycle. On macOS this uses FaceTime for dialing and the system `say` voice for spoken prompts. For tests and dry runs, use `mode: "mock"`.
```json
{"name": "voice_call", "args": {"action": "check_support", "mode": "mock"}}
{"name": "voice_call", "args": {"action": "initiate_call", "to": "+15551234567", "message": "Hello from Cybara"}}
{"name": "voice_call", "args": {"action": "speak_to_user", "callId": "voice_call_123", "message": "Please confirm your name"}}
{"name": "voice_call", "args": {"action": "end_call", "callId": "voice_call_123"}}
```
Actions: `check_support`, `initiate_call`, `continue_call`, `speak_to_user`, `end_call`, `get_status`  
Common args: `to`/`phone`, `callId`, `message`, `mode`, `voice`, `rate`

## Browser Automation

### browser
Full Chrome control via Playwright.

**Actions:**
- `status` — Browser session status
- `start` — Launch browser
- `stop` / `close` — Close browser
- `open` / `navigate` — Navigate to URL
- `snapshot` — Get page text with element refs
- `screenshot` — Capture image
- `pdf` — Export page as PDF
- `click`, `type`, `press`, `hover`, `scroll`, `drag`, `fill` — Element interactions
- `act` — Cybara-style interaction with `request` object
- `evaluate` — Execute JavaScript
- `wait` — Wait for element/load state
- `profiles`, `createProfile`, `deleteProfile` — Profile management
- `upload`, `dialog`, `resize`, `console`, `select` — Advanced actions

```json
{"name": "browser", "args": {"action": "open", "url": "https://example.com"}}
{"name": "browser", "args": {"action": "snapshot"}}
{"name": "browser", "args": {"action": "act", "request": {"kind": "click", "ref": "e5"}}}
```

### web_search
Search the web (Brave API or DuckDuckGo fallback).
```json
{"name": "web_search", "args": {"query": "bun typescript tutorial"}}
```

### web_fetch
Fetch and extract readable content from a URL.
```json
{"name": "web_fetch", "args": {"url": "https://example.com/article"}}
```

### canvas
Control canvas for HTML/CSS/JS rendering.
```json
{"name": "canvas", "args": {"action": "present", "url": "<div>...</div>"}}
{"name": "canvas", "args": {"action": "snapshot"}}
{"name": "canvas", "args": {"action": "eval", "javaScript": "document.title"}}
```
Actions: `present`, `hide`, `navigate`, `eval`, `snapshot`, `a2ui_push`, `a2ui_reset`

## Memory

### memory_search
Semantic search through memory files.
```json
{"name": "memory_search", "args": {"query": "project architecture"}}
```

### memory_get
Get specific lines from a memory file.
```json
{"name": "memory_get", "args": {"path": "memory/2024-01-15.md", "from": 10, "lines": 20}}
```

### memory_save
Save content to memory (daily logs).
```json
{"name": "memory_save", "args": {"content": "...", "type": "fact", "tags": ["project"]}}
```

### memory_save_durable
Save persistent information to MEMORY.md (preferences, decisions, conventions, goals).
```json
{"name": "memory_save_durable", "args": {"content": "...", "category": "preference"}}
```
Categories: `preference`, `decision`, `convention`, `goal`, `fact`

### memory_context
Get recent memory context (MEMORY.md + recent daily logs) for prompt injection.
```json
{"name": "memory_context", "args": {"maxLines": 50}}
```

## Sessions & Agents

### sessions_spawn
Spawn a sub-agent for background work.
```json
{"name": "sessions_spawn", "args": {"task": "Research topic X", "label": "research-1"}}
```
Options: `agentId`, `model`, `thinking` (off/minimal/low/medium/high/max), `runTimeoutSeconds`, `cleanup` (keep/delete)

### sessions_send
Send a message to another session.
```json
{"name": "sessions_send", "args": {"sessionId": "abc123", "message": "Update ready"}}
```

### sessions_list
List active sessions.
```json
{"name": "sessions_list", "args": {}}
```

### sessions_history
Get history for a session.
```json
{"name": "sessions_history", "args": {"sessionId": "abc123", "limit": 20}}
```

### session_status
Show current session status (tokens, time, message count).
```json
{"name": "session_status", "args": {}}
```

### agents_list
List available agent IDs.
```json
{"name": "agents_list", "args": {}}
```

### artifacts
Create and manage session-scoped `.md.resolved` artifacts.
```json
{"name": "artifacts", "args": {"action": "list"}}
{"name": "artifacts", "args": {"action": "create", "kind": "task", "title": "Release Checklist"}}
{"name": "artifacts", "args": {"action": "append", "name": "implementation", "content": "Step 3 complete"}}
```
Actions: `list`, `read`, `create`, `update`, `append`, `delete`, `check`  
Kinds: `task`, `implementation`, `walkthrough`, `notes`, `custom`

## Wallet

### wallet
Use the encrypted local wallet for ETH/BTC/SOL operations.
```json
{"name": "wallet", "args": {"action": "status"}}
{"name": "wallet", "args": {"action": "balances", "chains": ["eth", "btc", "sol"]}}
{"name": "wallet", "args": {"action": "send", "chain": "eth", "to": "0x...", "amount": "0.01"}}
{"name": "wallet", "args": {"action": "swap", "venue": "uniswap_v3", "tokenOut": "LINK", "amountEth": "0.2"}}
```
Common actions:
- `status`, `accounts`, `balances`, `transactions`, `receive`
- `send`, `send_token`, `sign_message`
- `eth_contract_call`, `sol_program_instruction`, `rpc_call`
- `price`/`price_quote`, `swap`/`swap_quote`/`swap_execute`
- `x402_request`, `dapp`/`dapp_call`, `endpoints`, `dapp_capabilities`

## Messaging

### message
Send messages via messaging channels.
```json
{"name": "message", "args": {"action": "send", "target": "user123", "message": "Hello!"}}
```
Actions: `send`, `broadcast`

### telegram_media
Send photos, documents, or videos via Telegram.
```json
{"name": "telegram_media", "args": {"action": "photo", "file": "/path/to/image.png", "chatId": "current"}}
```

### nodes
List/describe/notify paired nodes.
```json
{"name": "nodes", "args": {"action": "list"}}
```

## Media

### image
Analyze an image with vision models.
```json
{"name": "image", "args": {"path": "/path/to/image.png", "prompt": "Describe this"}}
```

### tts
Text-to-speech generation.
```json
{"name": "tts", "args": {"text": "Hello world", "voice": "nova"}}
```

## Data & Utility

### http
Make HTTP requests (GET, POST, PUT, DELETE).
```json
{"name": "http", "args": {"method": "GET", "url": "https://api.example.com/data"}}
```

### data
Transform, filter, and analyze structured data (JSON, CSV).
```json
{"name": "data", "args": {"action": "parse", "input": "[1,2,3]", "format": "json"}}
```

### env
Read and manage environment variables.
```json
{"name": "env", "args": {"action": "get", "key": "HOME"}}
```

### calc
Evaluate mathematical expressions.
```json
{"name": "calc", "args": {"expression": "sqrt(144) + 3^2"}}
```

### convert
Convert between units and formats.
```json
{"name": "convert", "args": {"value": 100, "from": "celsius", "to": "fahrenheit"}}
```

### clipboard
Read and write the system clipboard.
```json
{"name": "clipboard", "args": {"action": "read"}}
{"name": "clipboard", "args": {"action": "write", "content": "copied text"}}
```

## Document Processing

### summarization
Summarize text content.
```json
{"name": "summarization", "args": {"text": "Long article content...", "maxLength": 200}}
```

### pdf
Extract text from PDF files.
```json
{"name": "pdf", "args": {"path": "/path/to/document.pdf"}}
```

### ocr
Extract text from images using OCR.
```json
{"name": "ocr", "args": {"path": "/path/to/image.png"}}
```

### video_frames
Extract frames from video files for analysis.
```json
{"name": "video_frames", "args": {"path": "/path/to/video.mp4", "count": 5}}
```

## Weather

### weather
Get weather information.
```json
{"name": "weather", "args": {"location": "San Francisco"}}
```

## Scheduling

### cron
Manage cron jobs and wake events.
```json
{"name": "cron", "args": {"action": "list"}}
{"name": "cron", "args": {"action": "add", "schedule": "0 9 * * *", "task": "Check emails"}}
```

### gateway
Restart, apply config, or run updates.
```json
{"name": "gateway", "args": {"action": "restart"}}
```

## LSP (Language Server Protocol)

### lsp_diagnostics
Get code errors/warnings. TypeScript bundled; others need install.
```json
{"name": "lsp_diagnostics", "args": {"path": "/project/src"}}
```

### lsp_definition
Go to symbol definition.
```json
{"name": "lsp_definition", "args": {"path": "/file.ts", "line": 10, "character": 5}}
```

### lsp_references
Find all references to a symbol.
```json
{"name": "lsp_references", "args": {"path": "/file.ts", "line": 10, "character": 5}}
```

### lsp_hover
Get type info and documentation.
```json
{"name": "lsp_hover", "args": {"path": "/file.ts", "line": 10, "character": 5}}
```

### lsp_languages
List available LSP languages and installation status.
```json
{"name": "lsp_languages", "args": {}}
```
