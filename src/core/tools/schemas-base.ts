import type { Tool } from "./types";

export const baseToolSchemas: Record<string, Omit<Tool, "handler">> = {
  read: {
    name: "read",
    description: "Read file contents from the filesystem",
    category: "file",
    input_schema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Path to the file to read" },
        limit: { type: "number", description: "Maximum number of lines to read" },
        offset: { type: "number", description: "Line number to start reading from (1-indexed)" },
      },
      required: ["path"],
    },
    permissions: ["fs:read"],
  },
  write: {
    name: "write",
    description: "Create or overwrite a file with content",
    category: "file",
    input_schema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Path to write the file to" },
        content: { type: "string", description: "Content to write" },
      },
      required: ["path", "content"],
    },
    permissions: ["fs:write"],
  },
  edit: {
    name: "edit",
    description: "Edit a file by replacing exact text with new content",
    category: "file",
    input_schema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Path to the file" },
        oldText: { type: "string", description: "Exact text to find and replace" },
        newText: { type: "string", description: "Replacement text" },
      },
      required: ["path", "oldText", "newText"],
    },
    permissions: ["fs:write"],
  },
  file_search: {
    name: "file_search",
    description: "Search for files matching a pattern",
    category: "file",
    input_schema: {
      type: "object",
      properties: {
        pattern: { type: "string", description: "Glob pattern (e.g., '**/*.ts')" },
        cwd: { type: "string", description: "Working directory" },
      },
      required: ["pattern"],
    },
    permissions: ["fs:read"],
  },
  grep: {
    name: "grep",
    description: "Search file contents using ripgrep (rg) - fast recursive pattern matching",
    category: "file",
    input_schema: {
      type: "object",
      properties: {
        pattern: { type: "string", description: "Search pattern (regex supported)" },
        path: { type: "string", description: "Directory to search in (default: workspace root)" },
        type: { type: "string", description: "Filter by file type (e.g., 'ts', 'js', 'md', 'py')" },
        context: {
          type: "number",
          description: "Number of lines of context around matches (default: 2)",
        },
        maxResults: { type: "number", description: "Maximum number of results (default: 50)" },
        caseSensitive: { type: "boolean", description: "Case sensitive search (default: false)" },
        recursive: { type: "boolean", description: "Search recursively (default: true)" },
      },
      required: ["pattern"],
    },
    permissions: ["fs:read"],
  },
  workspace_index_search: {
    name: "workspace_index_search",
    description:
      "Search files in the active workspace using the workspace index (hybrid lexical + semantic embeddings when enabled), with filesystem fallback when needed. Best for fast file discovery by name, path, or intent.",
    category: "file",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Path or filename query" },
        path: {
          type: "string",
          description: "Workspace path to search (defaults to current workspace)",
        },
        limit: { type: "number", description: "Max results to return (default 250, max 5000)" },
      },
      required: ["query"],
    },
    permissions: ["fs:read"],
  },
  apply_patch: {
    name: "apply_patch",
    description:
      "Apply a unified diff patch to multiple files. Supports standard git diff format with create, modify, and delete operations.",
    category: "file",
    input_schema: {
      type: "object",
      properties: {
        patch: {
          type: "string",
          description: "Unified diff patch content (git diff format)",
        },
        dryRun: {
          type: "boolean",
          description: "If true, validate the patch without applying it",
        },
      },
      required: ["patch"],
    },
    permissions: ["fs:write"],
  },

  exec: {
    name: "exec",
    description:
      "Execute shell commands. Use workdir for directory context. For servers or long-running commands, set background=true instead of adding shell '&'; use process to list or stop them.",
    category: "process",
    input_schema: {
      type: "object",
      properties: {
        command: { type: "string", description: "Shell command to execute" },
        timeout: { type: "number", description: "Timeout in seconds (default 30)" },
        background: {
          type: "boolean",
          description: "Start a long-running process and return its pid immediately",
        },
        elevated: { type: "boolean", description: "Run with elevated permissions" },
        workdir: { type: "string", description: "Working directory" },
        env: { type: "object", description: "Additional environment variables" },
      },
      required: ["command"],
    },
    permissions: ["exec:run", "env:read", "env:write"],
  },
  process: {
    name: "process",
    description: "Manage background processes",
    category: "process",
    input_schema: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["list", "kill", "status"],
          description: "Action to perform",
        },
        sessionId: { type: "string", description: "Process session ID" },
      },
      required: ["action"],
    },
    permissions: ["exec:manage"],
  },

  ssh: {
    name: "ssh",
    description:
      "Run a command on a remote host over SSH using password authentication. Works headless on any platform (Windows, macOS, Linux) - no sshpass, plink, or paramiko needed. Prefer this over shelling out to `sshpass ssh` / `ssh`. Use scp to transfer files.",
    category: "process",
    input_schema: {
      type: "object",
      properties: {
        host: { type: "string", description: "Remote host address" },
        port: { type: "number", description: "SSH port (default 22)" },
        username: { type: "string", description: "Remote username" },
        password: { type: "string", description: "Remote password" },
        command: { type: "string", description: "Command to run on the remote host" },
        timeout_seconds: { type: "number", description: "Timeout in seconds (default 60)" },
        strict_host_key: {
          type: "boolean",
          description: "Verify the remote host key against known_hosts (default false)",
        },
      },
      required: ["host", "username", "password", "command"],
    },
    permissions: ["exec:run"],
  },
  scp: {
    name: "scp",
    description:
      "Transfer a file to or from a remote host over SSH/SFTP using password authentication. Works headless on any platform (Windows, macOS, Linux) - no sshpass/pscp needed.",
    category: "process",
    input_schema: {
      type: "object",
      properties: {
        host: { type: "string", description: "Remote host address" },
        port: { type: "number", description: "SSH port (default 22)" },
        username: { type: "string", description: "Remote username" },
        password: { type: "string", description: "Remote password" },
        direction: {
          type: "string",
          enum: ["upload", "download"],
          description: "upload: local to remote, download: remote to local",
        },
        local_path: { type: "string", description: "Path on this machine" },
        remote_path: { type: "string", description: "Path on the remote host" },
        timeout_seconds: { type: "number", description: "Timeout in seconds (default 120)" },
        strict_host_key: {
          type: "boolean",
          description: "Verify the remote host key against known_hosts (default false)",
        },
      },
      required: ["host", "username", "password", "direction", "local_path", "remote_path"],
    },
    permissions: ["exec:run"],
  },
  browser: {
    name: "browser",
    description: [
      "Control browser sessions via status/start/stop/profiles/tabs/open/snapshot/screenshot/actions and responsive/mobile/desktop preview modes.",
      "The embedded session browser is the default so users can follow actions in the chat preview panel.",
      "Use open -> snapshot -> act for UI automation and use openVisual only when the user explicitly requests a separate visible browser window.",
      "Keep the embedded browser open after completing the task so the user can inspect the final page; close it only when explicitly requested.",
      "When using refs from snapshot (e.g., e12), keep the same tab by passing targetId from snapshot into follow-up actions.",
      "For stable refs across calls, prefer snapshot with refs='aria'.",
      "Suggested flow: open -> snapshot -> extract data -> respond; for interactions: snapshot -> act.",
    ].join("\\n"),
    category: "browser",
    input_schema: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: [
            "status",
            "start",
            "stop",
            "close",
            "profiles",
            "createProfile",
            "deleteProfile",
            "startProfile",
            "stopProfile",
            "profileTabs",
            "openProfileTab",
            "closeProfileTab",
            "tabs",
            "open",
            "openVisual",
            "focus",
            "navigate",
            "snapshot",
            "screenshot",
            "pdf",
            "console",
            "upload",
            "dialog",
            "click",
            "type",
            "press",
            "select",
            "hover",
            "scroll",
            "drag",
            "fill",
            "resize",
            "evaluate",
            "wait",
            "act",
          ],
          description:
            "Browser action: 'open'/'navigate' to load URL, 'resize' to set a named viewportMode or explicit dimensions, 'screenshot' to capture page as IMAGE (returns base64), 'snapshot' for page TEXT, 'click'/'type' to interact",
        },
        sessionId: { type: "string", description: "Session ID for legacy browser session" },
        name: { type: "string", description: "Profile name for create/delete/start/stopProfile" },
        profile: { type: "string", description: "Profile name for profile-related actions" },
        color: { type: "string", description: "Profile color (hex)" },
        headless: {
          type: "boolean",
          description:
            "Use the embedded chat browser preview (default true). Set false only when the user explicitly requests a separate browser window.",
        },
        visual: {
          type: "boolean",
          description:
            "Launch a separate Chrome window with a persistent profile only when explicitly requested",
        },
        pageId: { type: "string", description: "Page ID for closeProfileTab" },
        url: {
          type: "string",
          description:
            "URL for start/navigate/open actions. ALWAYS pass url with start to open a page.",
        },
        targetId: { type: "string", description: "Target tab ID for focus/close actions" },
        selector: { type: "string", description: "CSS selector for element interactions" },
        ref: { type: "string", description: "Element reference (alternative to selector)" },
        text: { type: "string", description: "Text to type" },
        key: { type: "string", description: "Key to press (e.g., 'Enter', 'ArrowDown')" },
        values: {
          type: "array",
          items: { type: "string" },
          description: "Values to select in dropdown",
        },
        fields: {
          type: "array",
          items: { type: "object" },
          description: "Fields to fill {ref, value}",
        },
        script: { type: "string", description: "JavaScript code to evaluate" },
        request: {
          type: "object",
          description:
            "Cybara-style request for 'act' action. Use {kind:'click', ref:'e5'} or {kind:'type', ref:'e3', text:'hello'}",
          properties: {
            kind: {
              type: "string",
              description: "Action kind: click, type, press, hover, scroll, wait, evaluate",
            },
            ref: { type: "string", description: "Element ref from snapshot (e.g., 'e5', 'e12')" },
            text: { type: "string", description: "Text to type (for kind='type')" },
            key: { type: "string", description: "Key to press (for kind='press')" },
          },
        },
        kind: {
          type: "string",
          description: "Legacy: Sub-action for 'act' (prefer request.kind instead)",
        },
        button: {
          type: "string",
          enum: ["left", "right", "middle"],
          description: "Mouse button for click",
        },
        doubleClick: { type: "boolean", description: "Perform double click" },
        modifiers: {
          type: "array",
          items: { type: "string" },
          description: "Keyboard modifiers (Control, Alt, Shift, Meta)",
        },
        submit: { type: "boolean", description: "Submit form after typing" },
        slowly: { type: "boolean", description: "Type slowly with delay" },
        clear: { type: "boolean", description: "Clear field before typing (default: true)" },
        fullPage: { type: "boolean", description: "Capture full page screenshot" },
        type: { type: "string", enum: ["png", "jpeg"], description: "Screenshot/PDF format type" },
        quality: { type: "number", description: "Image quality (1-100) for JPEG" },
        format: {
          type: "string",
          enum: ["aria", "ai"],
          description: "Snapshot format (ARIA tree or AI text)",
        },
        compact: { type: "boolean", description: "Compact snapshot output" },
        interactive: { type: "boolean", description: "Only include interactive elements" },
        depth: { type: "number", description: "Maximum depth for snapshot tree" },
        maxChars: { type: "number", description: "Maximum characters for snapshot" },
        waitUntil: {
          type: "string",
          enum: ["load", "domcontentloaded", "networkidle"],
          description: "Navigation wait condition",
        },
        loadState: {
          type: "string",
          enum: ["load", "domcontentloaded", "networkidle"],
          description: "Load state to wait for",
        },
        timeout: { type: "number", description: "Wait timeout in milliseconds" },
        timeoutMs: { type: "number", description: "Action timeout in milliseconds" },
        state: {
          type: "string",
          enum: ["visible", "hidden", "attached", "detached"],
          description: "Element state to wait for",
        },
        timeMs: { type: "number", description: "Time to wait in milliseconds" },
        startRef: { type: "string", description: "Starting element for drag action" },
        endRef: { type: "string", description: "Ending element for drag action" },
        width: { type: "number", description: "Viewport width for resize" },
        height: { type: "number", description: "Viewport height for resize" },
        viewportMode: {
          type: "string",
          enum: ["responsive", "mobile", "desktop"],
          description:
            "Named viewport for resize: responsive (960x640), mobile (390x844), or desktop (1440x900)",
        },
        paths: { type: "array", items: { type: "string" }, description: "File paths for upload" },
        inputRef: { type: "string", description: "File input reference for upload" },
        accept: { type: "boolean", description: "Accept or dismiss dialog" },
        promptText: { type: "string", description: "Text to enter in prompt dialog" },
        fn: { type: "string", description: "JavaScript function to evaluate" },
        landscape: { type: "boolean", description: "PDF landscape orientation" },
        printBackground: { type: "boolean", description: "Print background colors in PDF" },
      },
      required: ["action"],
    },
    permissions: ["browser:control"],
  },

  web_fetch: {
    name: "web_fetch",
    description:
      "Fetch and extract readable content from a URL. Uses direct retrieval first, with configured Firecrawl or Parallel extraction fallback for blocked, dynamic, and PDF content.",
    category: "browser",
    input_schema: {
      type: "object",
      properties: {
        url: { type: "string", description: "URL to fetch" },
        extractMode: { type: "string", enum: ["markdown", "text"], description: "Extraction mode" },
        maxChars: { type: "number", description: "Maximum characters to return" },
        provider: {
          type: "string",
          enum: ["direct", "firecrawl", "parallel"],
          description: "Optional preferred extraction backend",
        },
        objective: {
          type: "string",
          description: "Optional extraction goal used by relevance-aware backends",
        },
      },
      required: ["url"],
    },
    permissions: ["net:fetch"],
  },

  web_search: {
    name: "web_search",
    description:
      "Search the web. Returns titles, URLs, and snippets. Auto-selects configured Firecrawl, Parallel, Tavily, Exa, Brave, or SearXNG backends and falls back to DuckDuckGo.",
    category: "browser",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search query string" },
        count: { type: "number", description: "Number of results (1-10, default 5)" },
        provider: {
          type: "string",
          enum: ["firecrawl", "parallel", "tavily", "exa", "brave", "searxng", "duckduckgo"],
          description: "Optional preferred search backend",
        },
        categories: {
          type: "array",
          items: { type: "string", enum: ["github", "research", "pdf"] },
          description: "Optional Firecrawl result categories",
        },
        includeDomains: {
          type: "array",
          items: { type: "string" },
          description: "Optional domains to include",
        },
        excludeDomains: {
          type: "array",
          items: { type: "string" },
          description: "Optional domains to exclude",
        },
        timeRange: {
          type: "string",
          description: "Optional time filter such as qdr:d, qdr:w, qdr:m, or qdr:y",
        },
        location: { type: "string", description: "Optional search location" },
        country: { type: "string", description: "Optional ISO country code" },
      },
      required: ["query"],
    },
    permissions: ["net:fetch"],
  },

  x_search: {
    name: "x_search",
    description:
      "Search X (Twitter) in real time via xAI Grok Live Search. Returns a summary of relevant posts plus citation URLs. Requires XAI_API_KEY. Use for current events, sentiment, or what people are posting now.",
    category: "browser",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "What to search X/Twitter for" },
        count: { type: "number", description: "Max posts to search (1-30, default 15)" },
        fromHandles: {
          type: "array",
          items: { type: "string" },
          description: "Optional: only include posts from these X handles (without @)",
        },
        excludeHandles: {
          type: "array",
          items: { type: "string" },
          description: "Optional: exclude posts from these X handles",
        },
        fromDate: { type: "string", description: "Optional ISO date (YYYY-MM-DD) lower bound" },
        toDate: { type: "string", description: "Optional ISO date (YYYY-MM-DD) upper bound" },
      },
      required: ["query"],
    },
    permissions: ["net:fetch"],
  },

  transcribe: {
    name: "transcribe",
    description:
      "Transcribe an audio file to text (speech-to-text) via the configured OpenAI/OpenAI Codex speech provider, with GROQ_API_KEY or OPENAI_API_KEY fallback.",
    category: "media",
    input_schema: {
      type: "object",
      properties: {
        audioPath: { type: "string", description: "Local path to an audio file (<=25MB)" },
        url: { type: "string", description: "URL of an audio file (alternative to audioPath)" },
        providerId: {
          type: "string",
          description: "Optional configured OpenAI/OpenAI Codex provider id",
        },
        language: { type: "string", description: "Optional ISO-639-1 language hint (e.g. en)" },
        prompt: { type: "string", description: "Optional context prompt to guide transcription" },
        model: { type: "string", description: "Optional model override" },
      },
      required: [],
    },
    permissions: ["net:fetch", "fs:read"],
  },

  memory_search: {
    name: "memory_search",
    description: "Search long-term memory for information",
    category: "memory",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search query" },
        maxResults: { type: "number", description: "Maximum results to return" },
      },
      required: ["query"],
    },
    permissions: ["memory:read"],
  },
  session_search: {
    name: "session_search",
    description:
      "Full-text search across all past chat sessions and messages. Use to recall prior conversations, decisions, or outputs.",
    category: "memory",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search terms" },
        maxResults: { type: "number", description: "Maximum results (default 20, max 100)" },
        offset: { type: "number", description: "Pagination offset" },
        sessionId: { type: "string", description: "Restrict to one session" },
        role: { type: "string", description: "Filter by role: user, assistant, system, tool" },
      },
      required: ["query"],
    },
    permissions: ["memory:read"],
  },
  memory_get: {
    name: "memory_get",
    description: "Read specific memory files",
    category: "memory",
    input_schema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Memory file path (e.g., 'memory/2024-01-15.md')" },
        from: { type: "number", description: "Line number to start from" },
        lines: { type: "number", description: "Number of lines to read" },
      },
      required: ["path"],
    },
    permissions: ["memory:read"],
  },
  memory_save: {
    name: "memory_save",
    description: "Save important context to long-term memory",
    category: "memory",
    input_schema: {
      type: "object",
      properties: {
        content: { type: "string", description: "Content to save" },
        type: {
          type: "string",
          enum: ["fact", "preference", "context", "narrative"],
          description: "Memory type",
        },
        tags: { type: "array", items: { type: "string" }, description: "Tags for categorization" },
      },
      required: ["content"],
    },
    permissions: ["memory:write"],
  },
  memory_save_durable: {
    name: "memory_save_durable",
    description:
      "Save important persistent information to MEMORY.md (preferences, decisions, conventions, goals, critical facts). Unlike daily logs, durable memories persist across sessions.",
    category: "memory",
    input_schema: {
      type: "object",
      properties: {
        content: { type: "string", description: "Content to save durably" },
        category: {
          type: "string",
          enum: ["preference", "decision", "convention", "goal", "fact"],
          description: "Type of durable memory",
        },
        source: { type: "string", description: "Source or context of this memory" },
      },
      required: ["content"],
    },
    permissions: ["memory:write"],
  },
  memory_context: {
    name: "memory_context",
    description:
      "Get recent memory context (MEMORY.md + last 1-2 days of daily logs) for prompt injection",
    category: "memory",
    input_schema: {
      type: "object",
      properties: {
        maxLines: { type: "number", description: "Maximum lines to return (default 50)" },
      },
    },
    permissions: ["memory:read"],
  },
  sessions_spawn: {
    name: "sessions_spawn",
    description: `Spawn a background sub-agent run in an isolated session and return its runId.

The child result is not inserted into the parent transcript automatically. Call sessions_wait with the returned runId, then synthesize the completed result. Each sessions_spawn call creates a new run, so do not call it again to retrieve or retry the same accepted task. For parallel delegation, spawn each distinct worker once, then wait for all returned runIds together.`,
    category: "core",
    input_schema: {
      type: "object",
      properties: {
        task: {
          type: "string",
          description:
            "Task description for the sub-agent. Be specific and include all context needed.",
        },
        label: {
          type: "string",
          description: "Optional short label for the task (used in status/logs)",
        },
        agentId: {
          type: "string",
          description:
            "Optional agent ID or exact unique agent name to use for the sub-agent (defaults to current agent)",
        },
        model: {
          type: "string",
          description: "Optional model override for the sub-agent",
        },
        thinking: {
          type: "string",
          description: "Optional thinking level override (off, minimal, low, medium, high, max)",
        },
        maxToolIterations: {
          type: "number",
          description:
            "Optional maximum tool iterations for this child run (1-100). Use a small bound for focused review or lookup work.",
        },
        runTimeoutSeconds: {
          type: "number",
          description: "Timeout for the run in seconds (0 = no timeout)",
        },
        timeoutSeconds: {
          type: "number",
          description: "Back-compat alias for runTimeoutSeconds",
        },
        maxActiveChildren: {
          type: "number",
          description:
            "Maximum active child sub-agents allowed for this requester (0 = no cap, default 3)",
        },
        cleanup: {
          type: "string",
          enum: ["keep", "delete"],
          description: "Cleanup policy after completion (keep = preserve run, delete = remove run)",
        },
      },
      required: ["task"],
    },
    permissions: ["sessions:create"],
  },

  sessions_transfer: {
    name: "sessions_transfer",
    description:
      "Transfer the active chat to another user-facing agent. The target agent continues the current turn with shared conversation context and becomes the session owner. Use sessions_spawn instead when the current agent should remain in control.",
    category: "core",
    input_schema: {
      type: "object",
      properties: {
        agentId: {
          type: "string",
          description: "Target agent ID or exact name from agents_list",
        },
        reason: {
          type: "string",
          description: "Concise reason the target agent is better suited to continue",
        },
        contextMode: {
          type: "string",
          enum: ["full", "recent", "summary"],
          description: "Context to share with the target agent. Defaults to full.",
        },
        contextSummary: {
          type: "string",
          description: "Optional concise state, constraints, and next action for the target agent",
        },
      },
      required: ["agentId", "reason"],
    },
    permissions: ["sessions:send"],
  },

  sessions_wait: {
    name: "sessions_wait",
    description:
      "Wait for one or more sub-agent runs from the current session and return concise results for synthesis. Use after parallel sessions_spawn calls before answering the user.",
    category: "core",
    input_schema: {
      type: "object",
      properties: {
        runIds: {
          type: "array",
          items: { type: "string" },
          description: "Run IDs returned by sessions_spawn (maximum 10)",
        },
        timeoutSeconds: {
          type: "number",
          description: "Maximum wait in seconds (default 120, maximum 600, 0 checks once)",
        },
      },
      required: ["runIds"],
    },
    permissions: ["sessions:read"],
  },

  sessions_send: {
    name: "sessions_send",
    description: "Send a message to an existing session",
    category: "core",
    input_schema: {
      type: "object",
      properties: {
        sessionId: { type: "string", description: "Session ID" },
        message: { type: "string", description: "Message to send" },
      },
      required: ["sessionId", "message"],
    },
    permissions: ["sessions:send"],
  },
  sessions_history: {
    name: "sessions_history",
    description: "Get conversation history for a session",
    category: "core",
    input_schema: {
      type: "object",
      properties: {
        sessionId: { type: "string", description: "Session ID" },
        limit: { type: "number", description: "Maximum messages to return" },
      },
      required: ["sessionId"],
    },
    permissions: ["sessions:read"],
  },
  sessions_list: {
    name: "sessions_list",
    description: "List all active sessions",
    category: "core",
    input_schema: {
      type: "object",
      properties: {
        agentId: { type: "string", description: "Filter by agent ID" },
      },
    },
    permissions: ["sessions:list"],
  },
  session_status: {
    name: "session_status",
    description:
      "Get detailed status of a session including message count, token estimate, and uptime",
    category: "core",
    input_schema: {
      type: "object",
      properties: {
        sessionId: {
          type: "string",
          description: "Session ID to check. If omitted, returns main session status",
        },
      },
    },
    permissions: ["sessions:read"],
  },

  agents_list: {
    name: "agents_list",
    description: "List all available agents",
    category: "core",
    input_schema: {
      type: "object",
      properties: {},
    },
    permissions: ["agents:read"],
  },
  artifacts: {
    name: "artifacts",
    description:
      "Create and manage session-scoped markdown artifacts (.md.resolved) such as task checklists, implementation plans, and walkthroughs. Artifacts are stored under ~/.cybara/artifacts/<sessionId>/ and can be listed, read, updated, appended, checked, or deleted.",
    category: "core",
    input_schema: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["list", "read", "create", "update", "append", "delete", "check"],
          description: "Artifact action",
        },
        sessionId: {
          type: "string",
          description:
            "Session scope for the artifact. If omitted, the current chat session is used automatically.",
        },
        kind: {
          type: "string",
          enum: ["task", "implementation", "walkthrough", "notes", "custom"],
          description: "Artifact kind for create action",
        },
        name: {
          type: "string",
          description:
            "Artifact name or file stem (for example: task, implementation, walkthrough, release-plan)",
        },
        title: {
          type: "string",
          description: "Optional markdown heading title for create action",
        },
        content: {
          type: "string",
          description: "Artifact content for create/update/append actions",
        },
        items: {
          type: "array",
          items: { type: "string" },
          description: "Checklist items for create action when kind is task",
        },
        overwrite: {
          type: "boolean",
          description:
            "When true, create action overwrites an existing artifact with the same name",
        },
        maxChars: {
          type: "number",
          description: "Maximum characters to return for read action",
        },
        item: {
          type: "number",
          description: "Checklist item number (1-based) for check action",
        },
        checked: {
          type: "boolean",
          description: "Checklist state for check action (default true)",
        },
      },
      required: ["action"],
    },
    permissions: ["fs:read", "fs:write"],
  },
  wallet: {
    name: "wallet",
    description:
      "Use the local encrypted multi-chain wallet (ETH, BTC, SOL). Read-only actions include status, addresses, accounts, native/token balances, transaction history, receive addresses, direct RPC reads, price quotes (Chainlink/Pyth/Jupiter), endpoint discovery, dapp capabilities, and dry-run swap quotes. Fund-moving or signing actions include sends, message signing, ERC-20/SPL transfers, ETH contract writes, Solana program instructions, swap execution (Uniswap v2/v3, Jupiter, Pump), dapp adapter writes, and x402 paid HTTP requests; those require explicit user intent, wallet agent access, policy approval, and an unlocked wallet.",
    category: "core",
    input_schema: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: [
            "status",
            "address",
            "accounts",
            "balances",
            "token_balances",
            "token_transactions",
            "transactions",
            "receive",
            "send",
            "send_token",
            "sign_message",
            "eth_contract_call",
            "sol_program_instruction",
            "swap_eth_uniswap",
            "endpoints",
            "dapp_capabilities",
            "rpc_call",
            "dapp",
            "dapp_call",
            "x402_request",
            "price",
            "price_quote",
            "swap",
            "swap_quote",
            "swap_execute",
          ],
          description:
            "Wallet action. Prefer read-only actions for status, balances, portfolio, history, pricing, and quote requests; use fund-moving/signing actions only with explicit user intent, wallet agent access, and policy allowance.",
        },
        chain: {
          type: "string",
          enum: ["eth", "btc", "sol"],
          description: "Blockchain network",
        },
        chains: {
          type: "array",
          items: { type: "string", enum: ["eth", "btc", "sol"] },
          description: "List of chains to query for accounts/balances",
        },
        count: {
          type: "number",
          description: "Number of derived accounts per chain (default 1, max 20)",
        },
        startIndex: {
          type: "number",
          description: "Derivation index offset for accounts/balances",
        },
        index: {
          type: "number",
          description: "Single derivation index for receive/send/transactions/sign_message",
        },
        limit: {
          type: "number",
          description: "Transaction history limit (default 10, max 50)",
        },
        to: {
          type: "string",
          description: "Destination address for send action",
        },
        amount: {
          type: "string",
          description: "Transfer amount for send action, in native units",
        },
        memo: {
          type: "string",
          description: "Optional memo for SOL/ETH send transactions",
        },
        feeRate: {
          type: "number",
          description: "Optional BTC fee rate in sats/vByte",
        },
        tokenAddress: {
          type: "string",
          description:
            "ERC-20 contract address (ETH) or SPL/Token-2022 mint address or known symbol such as CYB (SOL) for send_token/token_transactions",
        },
        mint: {
          type: "string",
          description: "Alias for tokenAddress on Solana token actions",
        },
        decimals: {
          type: "number",
          description: "Optional token decimals override for send_token",
        },
        includeZero: {
          type: "boolean",
          description: "When true, token_balances includes zero-balance tokens",
        },
        message: {
          type: "string",
          description: "Message to sign when action is sign_message",
        },
        contractAddress: {
          type: "string",
          description: "ETH smart contract address for eth_contract_call",
        },
        abi: {
          type: "string",
          description:
            "Optional contract ABI as JSON string or function fragment (e.g. 'transfer(address,uint256)'). Omit when methodSignature is provided.",
        },
        method: {
          type: "string",
          description:
            "Contract method name for eth_contract_call (or full selector like 'swapExactETHForTokens(uint256,address[],address,uint256)'). Also used as JSON-RPC method for action=rpc_call.",
        },
        methodSignature: {
          type: "string",
          description:
            "Optional method selector for overloaded methods, e.g. 'approve(address,uint256)'. Can be used without abi for dynamic calls.",
        },
        args: {
          type: "array",
          items: {},
          description: "Method arguments for eth_contract_call",
        },
        value: {
          type: "string",
          description: "Optional ETH value in ETH units for payable contract calls",
        },
        gasLimit: {
          type: "string",
          description: "Optional gas limit override for eth_contract_call",
        },
        gasPriceGwei: {
          type: "string",
          description: "Optional legacy gasPrice in gwei for eth_contract_call writes",
        },
        maxFeePerGasGwei: {
          type: "string",
          description: "Optional EIP-1559 maxFeePerGas in gwei",
        },
        maxPriorityFeePerGasGwei: {
          type: "string",
          description: "Optional EIP-1559 maxPriorityFeePerGas in gwei",
        },
        nonce: {
          type: "number",
          description: "Optional transaction nonce override for eth_contract_call writes",
        },
        readOnly: {
          type: "boolean",
          description:
            "When true, execute eth_contract_call as a static read (no broadcast/signature)",
        },
        rpcUrl: {
          type: "string",
          description:
            "Optional RPC override for send_token, token_transactions, eth_contract_call, sol_program_instruction, and swap_eth_uniswap",
        },
        programId: {
          type: "string",
          description: "Solana program ID for sol_program_instruction",
        },
        keys: {
          type: "array",
          items: {
            type: "object",
            properties: {
              pubkey: { type: "string" },
              isSigner: { type: "boolean" },
              isWritable: { type: "boolean" },
            },
            required: ["pubkey"],
          },
          description: "Account metas for sol_program_instruction",
        },
        accounts: {
          type: "array",
          items: {
            type: "object",
            properties: {
              pubkey: { type: "string" },
              address: { type: "string" },
              isSigner: { type: "boolean" },
              signer: { type: "boolean" },
              isWritable: { type: "boolean" },
              writable: { type: "boolean" },
            },
          },
          description: "Alias for keys in sol_program_instruction",
        },
        dataBase64: {
          type: "string",
          description: "Base64-encoded instruction data for sol_program_instruction",
        },
        dataHex: {
          type: "string",
          description:
            "Hex-encoded instruction data for sol_program_instruction (exclusive with dataBase64/dataUtf8)",
        },
        dataUtf8: {
          type: "string",
          description:
            "UTF-8 instruction data for sol_program_instruction (exclusive with dataBase64/dataHex)",
        },
        data: {
          type: "string",
          description: "Alias for dataUtf8 in sol_program_instruction",
        },
        computeUnitLimit: {
          type: "number",
          description: "Optional Solana compute unit limit override",
        },
        computeUnitPriceMicroLamports: {
          type: "number",
          description: "Optional Solana priority fee price in micro-lamports per CU",
        },
        skipPreflight: {
          type: "boolean",
          description: "Optional Solana skipPreflight flag for instructions and swap execution",
        },
        frontRunningProtection: {
          type: "boolean",
          description: "Request protected Pump transaction construction for dry-run quotes",
        },
        tipAmount: {
          type: "number",
          description: "Optional protected Pump route tip in SOL",
        },
        tokenOut: {
          type: "string",
          description:
            "Output token for swap_eth_uniswap/swap_quote/swap_execute; accepts ERC-20 address or symbol (e.g. LINK)",
        },
        amountEth: {
          type: "string",
          description:
            "Exact ETH amount to swap for swap_eth_uniswap/swap_quote/swap_execute (use either amountEth or percent)",
        },
        percent: {
          type: "number",
          description:
            "Percent of current balance to swap for swap_eth_uniswap/swap_quote/swap_execute (0-100, e.g. 50)",
        },
        minAmountOut: {
          type: "string",
          description: "Optional explicit minimum output amount; overrides slippageBps quote",
        },
        slippageBps: {
          type: "number",
          description: "Slippage tolerance in basis points for swap actions (default 100)",
        },
        deadlineSeconds: {
          type: "number",
          description: "Swap expiry window in seconds for ETH swap actions (default 900)",
        },
        recipient: {
          type: "string",
          description: "Optional recipient address for ETH swap output tokens",
        },
        dryRun: {
          type: "boolean",
          description:
            "When true, swap actions return quote/minOut without broadcasting a transaction. For action=swap, default is true unless execute=true.",
        },
        execute: {
          type: "boolean",
          description:
            "For action=swap only: when true, broadcasts the swap transaction (sets dryRun=false unless explicitly overridden)",
        },
        broadcast: {
          type: "boolean",
          description: "Alias for execute in action=swap",
        },
        source: {
          type: "string",
          enum: ["auto", "chainlink", "pyth", "jupiter"],
          description: "Price source for action=price or action=price_quote",
        },
        symbol: {
          type: "string",
          description: "Asset symbol (e.g., BTC, ETH, SOL) for action=price/action=price_quote",
        },
        pair: {
          type: "string",
          description: "Asset pair (e.g., BTC/USD) for action=price/action=price_quote",
        },
        feedAddress: {
          type: "string",
          description:
            "Chainlink feed contract address override for action=price/action=price_quote",
        },
        feedId: {
          type: "string",
          description: "Alias for pythFeedId in action=price/action=price_quote",
        },
        pythFeedId: {
          type: "string",
          description: "Explicit Pyth feed id for action=price/action=price_quote",
        },
        quoteCurrency: {
          type: "string",
          description: "Quote currency for action=price/action=price_quote (default USD)",
        },
        venue: {
          type: "string",
          enum: ["uniswap_v2", "uniswap_v3", "jupiter", "pump_swap"],
          description: "Swap venue for swap/swap_quote/swap_execute",
        },
        feeTier: {
          type: "number",
          description: "Uniswap v3 fee tier (100, 500, 3000, or 10000)",
        },
        inputMint: {
          type: "string",
          description: "Solana input mint or symbol for Jupiter and Pump swap actions",
        },
        outputMint: {
          type: "string",
          description: "Solana output mint or symbol for Jupiter and Pump swap actions",
        },
        amountRaw: {
          type: "string",
          description: "Exact swap input amount in raw base units (string integer)",
        },
        wrapUnwrapSol: {
          type: "boolean",
          description: "For Jupiter swaps, wrap/unwrap native SOL automatically (default true)",
        },
        adapter: {
          type: "string",
          enum: [
            "rpc_call",
            "eth_contract_call",
            "sol_program_instruction",
            "swap",
            "price",
            "x402_http",
          ],
          description:
            "Generic dapp adapter used by action=dapp/dapp_call (rpc_call, eth_contract_call, sol_program_instruction, swap, price, x402_http)",
        },
        payload: {
          type: "object",
          description: "JSON payload object for action=dapp/dapp_call",
        },
        input: {
          type: "object",
          description: "Alias for payload in action=dapp/dapp_call",
        },
        id: {
          type: "string",
          description: "Optional JSON-RPC id for action=rpc_call",
        },
        params: {
          type: "array",
          items: {},
          description: "JSON-RPC params array for action=rpc_call",
        },
        url: {
          type: "string",
          description: "Target URL for action=x402_request",
        },
        headers: {
          type: "object",
          description: "HTTP headers object for action=x402_request",
        },
        body: {
          description: "Request body for action=x402_request",
        },
        network: {
          type: "string",
          description: "Optional x402 network selector (e.g., eip155:8453)",
        },
        maxAmountAtomic: {
          type: "string",
          description: "Maximum x402 payment amount in atomic units for action=x402_request",
        },
        timeoutMs: {
          type: "number",
          description: "HTTP timeout override for action=x402_request",
        },
        parseJsonResponse: {
          type: "boolean",
          description: "Parse action=x402_request response as JSON when content-type is JSON",
        },
      },
      required: ["action"],
    },
    permissions: ["wallet:use"],
  },
};
