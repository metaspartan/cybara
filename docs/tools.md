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

## File-Write Safety Policy

Every file-writing tool (`write`, `edit`, `apply_patch`) enforces a hard **path-safety deny-list**
before writing, implemented in `src/core/tools/path-policy.ts`. Writes are refused to sensitive
locations, including:

- `~/.ssh/*` (private keys, `authorized_keys`, `known_hosts`)
- `.env*` files, `.netrc`, `.pgpass`, `.my.cnf`, `.npmrc`, `.pypirc`, `.htpasswd`, `.git-credentials`
- `~/.aws/credentials`, `~/.config/gcloud/*`, `~/.docker/config.json`, `~/.kube/config`
- OAuth tokens, service-account JSON files
- `~/.gnupg`, macOS `Library/Keychains` and `Library/Cookies`

Optional workspace confinement can be enabled per-tool via the execution context
(`confineToWorkspace: true` + `workspaceDir`). The deny-list cannot be bypassed by the agent; it
exists to protect credentials regardless of an agent's permission tags.

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
Search the web through the best configured backend, with a no-key fallback. Optional filters support domains, recency, location, and research-oriented result categories where the selected backend provides them.
```json
{"name": "web_search", "args": {"query": "bun typescript tutorial"}}
{"name": "web_search", "args": {"query": "agent runtime research", "categories": ["github", "research"], "timeRange": "qdr:m"}}
```

### web_fetch
Fetch and extract readable content from a URL. Direct retrieval is attempted first, with configured extraction providers available for blocked pages, JavaScript-heavy content, and PDFs.
```json
{"name": "web_fetch", "args": {"url": "https://example.com/article"}}
{"name": "web_fetch", "args": {"url": "https://example.com/report.pdf", "objective": "Extract the benchmark methodology and results"}}
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

### sessions_wait
Wait for up to 10 child runs and return their results together for parent-agent synthesis.
```json
{"name": "sessions_wait", "args": {"runIds": ["run-1", "run-2"], "timeoutSeconds": 120}}
```
Waits are scoped to the requesting chat and may return `completed`, `partial`, or `timeout` with pending run IDs.

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
Text-to-speech generation through the configured local, operating-system, or cloud voice.
```json
{"name": "tts", "args": {"text": "Hello world", "provider": "elevenlabs", "voice": "VOICE_ID", "format": "mp3"}}
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

### skill_save
Codify a verified multi-step procedure as a reusable skill (self-improvement). After an agent finishes a complex task whose approach is likely to recur, it saves a concise SKILL.md-style procedure to `~/.cybara/skills/<slug>/`, which the loader picks up for future sessions.
```json
{"name": "skill_save", "args": {"name": "Deploy Cloudflare Worker", "description": "When and how to ship a Worker", "content": "## When to use\n...\n## Steps\n1. ..."}}
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

## Planning

### todo
Create or update the session task list. Send the FULL list each call (not a delta). At most one
item may be `in_progress` at a time — extras are demoted to `pending` automatically. Use this for
any non-trivial multi-step work to stay organized and avoid drift.
```json
{
  "name": "todo",
  "args": {
    "items": [
      { "content": "Read the spec", "status": "completed", "priority": "high" },
      { "content": "Implement the feature", "status": "in_progress", "priority": "high" },
      { "content": "Add tests", "status": "pending", "priority": "medium" }
    ]
  }
}
```
Statuses: `pending` | `in_progress` | `completed`. Priorities: `high` | `medium` | `low`.

### clarify
Ask the user a clarifying question when a task is genuinely ambiguous. Provide up to 4
multiple-choice options OR omit `options` for an open-ended question. Prefer this over guessing
and proceeding on a wrong assumption.
```json
{
  "name": "clarify",
  "args": {
    "question": "Which database should the new feature target?",
    "options": [
      { "label": "PostgreSQL", "description": "Existing infra" },
      { "label": "SQLite", "description": "Zero-config, local" }
    ]
  }
}
```

## Dynamic Tool Discovery

As the tool surface grows (built-in + MCP + skills), these three tools let the model find what it
needs at runtime instead of every schema being registered in the prompt.

### tool_search
Search the full tool inventory (built-in, MCP, and skills) by keyword. Returns matching names with
short descriptions.
```json
{"name": "tool_search", "args": { "query": "write file to disk", "limit": 10 }}
```

### tool_describe
Fetch the full input schema for one tool. MCP tools are named `<server>__<tool>`; skills are
`skill__<name>`. Call this before `tool_call`.
```json
{"name": "tool_describe", "args": { "name": "write" }}
```

### tool_call
Invoke a discovered tool by name with an arguments object. Supports built-in and MCP tools.
```json
{"name": "tool_call", "args": { "name": "github__create_issue", "arguments": { "title": "..." } }}
```

### execute_code
Run trusted JavaScript/TypeScript in a killable host child process that calls enabled tools through the `cybara` namespace.
Use this to collapse many tool round-trips into one call for data processing, loops, and aggregation. It is dangerous host execution with filesystem and network access, not a security sandbox. Use `sandbox_run` for untrusted code. Return a value explicitly when one is needed. The timeout defaults to 15 seconds and is capped at 60 seconds.
```json
{
  "name": "execute_code",
  "args": {
    "code": "const files = await cybara.file_search({ pattern: '*.ts' });\nreturn files.length;"
  }
}
```

## Media Generation

Image, video, and music generation via a swappable provider registry (`src/core/media-generation.ts`).
Set `OPENAI_API_KEY` for OpenAI images or `FAL_KEY`/`FAL_API_KEY` for fal.ai
image/video/music. The bundled `fal.ai` skill becomes eligible when either fal
key is present and routes agents through these same media tools. Generated files
are saved to `<workspace>/.cybara/media/` and their paths returned.

### image_generate
Generate images from a text prompt.
```json
{"name": "image_generate", "args": { "prompt": "a serene mountain lake at dawn", "provider": "openai", "model": "gpt-image-1", "size": "1024x1024" }}
```

### video_generate
Generate video from a text prompt (fal.ai: minimax, kling, veo3). Async job; the tool waits for
completion.
```json
{"name": "video_generate", "args": { "prompt": "a drone shot over a forest", "model": "fal-ai/minimax/video-01", "durationSeconds": 5 }}
```

### music_generate
Generate music/audio from a text prompt (fal.ai: minimax-music, ace-step, stable-audio).
```json
{"name": "music_generate", "args": { "prompt": "upbeat synthwave, 120bpm", "durationSeconds": 30, "format": "mp3" }}
```

## Desktop Control

### mactop
Retrieve Apple Silicon hardware metrics when Cybara is running on macOS and the
`mactop` binary is installed. The bundled `mactop` skill is gated by platform and
binary availability, so it appears for agents by default only when it can run.
Install with `brew install mactop`.

### computer_use
Control the desktop (capture, click, type, scroll, drag, key, set_value, focus app)
through Cybara's bundled, platform-native computer-use runtime. Desktop releases include the
runtime, while standalone gateway and CLI installs provision the same checksum-verified runtime on
first use. `CYBARA_CUA_DRIVER_CMD` and Settings → Computer Use remain optional overrides for custom
builds. Windows desktop control requires the target app to be visible in the active desktop. macOS
requires user-approved Accessibility and Screen Recording grants. Prefer `element` (1-based SOM
index) over pixel `coordinate`; prefer `set_value` over typing into dropdowns.

**Safety hardening:** `computer_use` is gated as a **dangerous tool** (routed through the ask/block
approval flow). Dangerous key combos (logout/lock) and shell-injection typed text (`curl … | bash`,
`rm -rf /`, fork bombs, `mkfs`, `dd if=/dev/`) are hard-blocked and cannot be overridden. Read-only
actions (`capture`, `wait`, `list_apps`) are always allowed; destructive actions require consent
(unless `setComputerUseAutoApprove(true)` or an approval callback permits them).

```json
{"name": "computer_use", "args": { "action": "capture", "mode": "som" }}
{"name": "computer_use", "args": { "action": "click", "element": 3 }}
{"name": "computer_use", "args": { "action": "type", "text": "hello world" }}
{"name": "computer_use", "args": { "action": "key", "keys": "cmd+s" }}
{"name": "computer_use", "args": { "action": "set_value", "element": 5, "value": "Option B" }}
{"name": "computer_use", "args": { "action": "click", "element": 3, "captureAfter": true }}
```
Actions: `capture` | `click` | `double_click` | `right_click` | `middle_click` | `scroll` | `drag` |
`type` | `key` | `set_value` | `wait` | `list_apps` | `focus_app`.

- `captureAfter: true` re-captures after an action so the model can verify the result.
- `set_value` sets a native accessibility value (e.g. selects a dropdown option) without stealing focus.
- `screenshot`, `screen_capture`, `desktop_screenshot`, `capture_screen`, and `take_screenshot`
  are compatibility aliases for full-desktop capture. Bare `capture` keeps the interactive
  cua-driver/SOM path so agents can still capture a window and then click/type by element.
- Results carry a `screenshot` (base64) + `screenshotMime` so vision models receive a real image block; the driver auto-reconnects once on a closed session.


## Kanban (Multi-Agent Orchestration)

A durable SQLite-backed task board with a dependency engine and dispatcher. Tasks flow
`triage → todo → ready → running → (done|blocked)`. The dispatcher promotes tasks to `ready` once
their parent dependencies complete, then claims + spawns a worker for each. Workers self-report
progress via these tools. See `src/core/kanban.ts`.

### kanban_show
Read one task with its comments.
```json
{"name": "kanban_show", "args": { "id": "task_..." }}
```

### kanban_list
List/filter tasks.
```json
{"name": "kanban_list", "args": { "status": "ready" }}
```

### kanban_create
Create a task (optionally as a child of parents).
```json
{"name": "kanban_create", "args": { "title": "Add login flow", "parents": ["task_parent1"], "assignee": "coder" }}
```

### kanban_complete
Mark a task done with a result summary.
```json
{"name": "kanban_complete", "args": { "id": "task_...", "result": "Implemented and tested" }}
```

### kanban_block / kanban_unblock
Mark a task blocked (with a reason) or return it to `todo`.
```json
{"name": "kanban_block", "args": { "id": "task_...", "reason": "waiting on API access" }}
{"name": "kanban_unblock", "args": { "id": "task_..." }}
```

### kanban_heartbeat
Worker liveness ping — call periodically on long-running tasks so the dispatcher doesn't reclaim them.
```json
{"name": "kanban_heartbeat", "args": { "id": "task_..." }}
```

### kanban_comment
Append a comment (shared state / blackboard between workers).
```json
{"name": "kanban_comment", "args": { "id": "task_...", "body": "Found the root cause: ..." }}
```

### kanban_link
Add a parent→child dependency edge. The child becomes `ready` only after the parent is `done`.
```json
{"name": "kanban_link", "args": { "parentId": "task_a", "childId": "task_b" }}
```

## Home Automation

### home_assistant
List entity states, read one entity, or call a service on a Home Assistant instance. Requires `HOME_ASSISTANT_URL` and `HOME_ASSISTANT_TOKEN` (a long-lived access token).
```json
{"name": "home_assistant", "args": { "action": "call_service", "service": "light.turn_on", "entity_id": "light.kitchen", "data": { "brightness_pct": 60 } }}
```

## Multi-Model

### mixture_of_agents
Run a prompt through several configured agents in parallel, then synthesize their candidate responses into one best answer via an aggregator agent.
```json
{"name": "mixture_of_agents", "args": { "prompt": "Design a rate limiter", "max_agents": 3 }}
```
