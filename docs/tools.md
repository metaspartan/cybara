# Cybara Tools Reference

Agents have access to 30+ tools for file, process, browser, and messaging operations.

## File Operations

### read
Read file contents.
```json
{"name": "read", "args": {"path": "/path/to/file.txt"}}
```

### write
Create or overwrite files.
```json
{"name": "write", "args": {"path": "/path/to/file.txt", "content": "..."}}
```

### edit
Make precise edits to files using search/replace.
```json
{"name": "edit", "args": {"path": "/path/to/file.txt", "search": "old", "replace": "new"}}
```

### grep
Search file contents for patterns.
```json
{"name": "grep", "args": {"pattern": "TODO", "path": "/project"}}
```

### find
Find files by glob pattern.
```json
{"name": "find", "args": {"pattern": "*.ts", "path": "/project"}}
```

### ls
List directory contents.
```json
{"name": "ls", "args": {"path": "/project"}}
```

## Process Operations

### exec
Run shell commands. Supports PTY for interactive CLIs.
```json
{"name": "exec", "args": {"command": "git status", "cwd": "/project"}}
```

### process
Manage background exec sessions.
```json
{"name": "process", "args": {"action": "list"}}
{"name": "process", "args": {"action": "kill", "pid": 12345}}
```

## Browser Automation

### browser
Full Chrome control via Playwright.

**Actions:**
- `status` - Browser session status
- `start` - Launch browser
- `stop` - Close browser
- `open` - Navigate to URL
- `snapshot` - Get page text with refs
- `screenshot` - Capture image
- `act` - Click, type, scroll, etc.

```json
{"name": "browser", "args": {"action": "open", "url": "https://example.com"}}
{"name": "browser", "args": {"action": "snapshot"}}
{"name": "browser", "args": {"action": "act", "type": "click", "ref": "e5"}}
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

## Canvas

### canvas
Present, evaluate, and snapshot the Canvas.
```json
{"name": "canvas", "args": {"action": "present", "html": "<div>...</div>"}}
{"name": "canvas", "args": {"action": "snapshot"}}
{"name": "canvas", "args": {"action": "eval", "expression": "document.title"}}
```

## Memory

### memory_search
Semantic search through memory files.
```json
{"name": "memory_search", "args": {"query": "project architecture"}}
```

### memory_get
Get specific lines from a memory file.
```json
{"name": "memory_get", "args": {"file": "MEMORY.md", "startLine": 10, "endLine": 20}}
```

### memory_save
Save content to memory.
```json
{"name": "memory_save", "args": {"content": "...", "file": "notes.md"}}
```

## Sessions & Agents

### sessions_spawn
Spawn a sub-agent for background work.
```json
{"name": "sessions_spawn", "args": {"task": "Research topic X", "label": "research-1"}}
```

### sessions_send
Send a message to another session.
```json
{"name": "sessions_send", "args": {"sessionKey": "abc123", "message": "Update ready"}}
```

### sessions_list
List active sessions.
```json
{"name": "sessions_list", "args": {}}
```

### sessions_history
Get history for a session.
```json
{"name": "sessions_history", "args": {"sessionKey": "abc123"}}
```

### session_status
Show current session status (tokens, time, etc.).
```json
{"name": "session_status", "args": {}}
```

### agents_list
List available agent IDs.
```json
{"name": "agents_list", "args": {}}
```

## Messaging

### message
Send messages and channel actions.
```json
{"name": "message", "args": {"action": "send", "to": "user123", "message": "Hello!"}}
```

Inline buttons (Telegram):
```json
{"name": "message", "args": {
  "action": "send",
  "to": "user123",
  "message": "Choose:",
  "buttons": [[{"text": "Option A", "callback_data": "a"}]]
}}
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
List available LSP languages.
```json
{"name": "lsp_languages", "args": {}}
```

## Other

### cron
Manage cron jobs and wake events.
```json
{"name": "cron", "args": {"action": "list"}}
{"name": "cron", "args": {"action": "add", "schedule": "0 9 * * *", "task": "..."}}
```

### gateway
Restart, apply config, or run updates.
```json
{"name": "gateway", "args": {"action": "restart"}}
```

### nodes
List/describe/notify paired nodes.
```json
{"name": "nodes", "args": {"action": "list"}}
```
