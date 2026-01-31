

// ============================================
// TOOL DEFINITIONS
// All Clawdbot tools + extras
// ============================================

export interface ToolHandler {
  (args: Record<string, unknown>, context?: ToolContext): Promise<unknown>;
}

export interface ToolContext {
  agentId: string;
  sessionId?: string;
  channel?: string;
  userId?: string;
}

export interface Tool {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
  handler?: ToolHandler;
  permissions?: string[];
  category: "core" | "file" | "process" | "browser" | "memory" | "channel" | "media" | "skill";
}

// ============================================
// TOOL HANDLERS REGISTRY
// ============================================

const _toolHandlers = new Map<string, ToolHandler>();
export const toolHandlers = _toolHandlers;

// ============================================
// RATE LIMITING
// ============================================

interface RateLimitConfig {
  windowMs: number;
  maxRequests: number;
}

const rateLimits: Record<string, { count: number; resetTime: number }> = {};

export function checkRateLimit(
  key: string,
  config: RateLimitConfig
): { allowed: boolean; remaining: number; resetTime: number } {
  const now = Date.now();
  const record = rateLimits[key];

  if (!record || now > record.resetTime) {
    rateLimits[key] = { count: 1, resetTime: now + config.windowMs };
    return { allowed: true, remaining: config.maxRequests - 1, resetTime: now + config.windowMs };
  }

  if (record.count >= config.maxRequests) {
    return { allowed: false, remaining: 0, resetTime: record.resetTime };
  }

  record.count++;
  return {
    allowed: true,
    remaining: config.maxRequests - record.count,
    resetTime: record.resetTime,
  };
}

export function getRateLimitStatus(key: string): { remaining: number; resetTime: number } {
  const record = rateLimits[key];
  if (!record || Date.now() > record.resetTime) {
    return { remaining: 100, resetTime: Date.now() + 60000 };
  }
  return { remaining: 100 - record.count, resetTime: record.resetTime };
}

// ============================================
// CIRCUIT BREAKER
// ============================================

interface CircuitBreakerConfig {
  failureThreshold: number;
  recoveryTimeMs: number;
}

interface CircuitState {
  state: "closed" | "open" | "half-open";
  failureCount: number;
  lastFailureTime: number;
  successesSinceHalfOpen: number;
}

const circuitBreakers: Map<string, CircuitState> = new Map();
const defaultBreakerConfig: CircuitBreakerConfig = {
  failureThreshold: 5,
  recoveryTimeMs: 30000,
};

export function getCircuitState(service: string): CircuitState | undefined {
  return circuitBreakers.get(service);
}

export function checkCircuit(
  service: string,
  config: CircuitBreakerConfig = defaultBreakerConfig
): { allowed: boolean; state: string } {
  const state = circuitBreakers.get(service);

  if (!state) {
    return { allowed: true, state: "closed" };
  }

  const now = Date.now();

  if (state.state === "open") {
    if (now - state.lastFailureTime >= config.recoveryTimeMs) {
      state.state = "half-open";
      state.successesSinceHalfOpen = 0;
      return { allowed: true, state: "half-open" };
    }
    return { allowed: false, state: "open" };
  }

  return { allowed: true, state: state.state };
}

export function recordCircuitSuccess(service: string): void {
  const state = circuitBreakers.get(service);
  if (state) {
    if (state.state === "half-open") {
      state.successesSinceHalfOpen++;
      if (state.successesSinceHalfOpen >= 3) {
        circuitBreakers.delete(service);
      }
    }
    state.failureCount = 0;
  }
}

export function recordCircuitFailure(
  service: string,
  config: CircuitBreakerConfig = defaultBreakerConfig
): void {
  let state = circuitBreakers.get(service);
  if (!state) {
    state = {
      state: "closed",
      failureCount: 0,
      lastFailureTime: Date.now(),
      successesSinceHalfOpen: 0,
    };
    circuitBreakers.set(service, state);
  }

  state.failureCount++;
  state.lastFailureTime = Date.now();

  if (state.failureCount >= config.failureThreshold) {
    state.state = "open";
  }
}

// ============================================
// TOOL SCHEMAS
// ============================================

export const toolSchemas: Record<string, Omit<Tool, "handler">> = {
  // File operations
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

  // Process execution
  exec: {
    name: "exec",
    description: "Execute shell commands. Use workdir parameter for directory context (don't use 'cd' in command). Commands run from workspace root if workdir not specified.",
    category: "process",
    input_schema: {
      type: "object",
      properties: {
        command: { type: "string", description: "Shell command to execute" },
        timeout: { type: "number", description: "Timeout in seconds (default 30)" },
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

  // Browser automation - Moltbot/OpenClaw compatible with Profile Support
  browser: {
    name: "browser",
    description: [
      "FULL browser control. Opens a real Chrome window. USE THIS to get web page data.",
      "",
      "TO GET DATA FROM A WEBSITE:",
      "1) browser({action:'open', url:'https://fiat.gold'}) - opens the page",
      "2) browser({action:'snapshot'}) - returns page content with element refs",
      "3) Extract the data you need from the snapshot and respond with it",
      "",
      "TO INTERACT (click buttons, type, etc.):",
      "browser({action:'act', request:{kind:'click', ref:'e5'}}) - use refs from snapshot",
      "",
      "JUST USE IT. Don't ask permission. Don't say you can't access websites.",
    ].join("\\n"),
    category: "browser",
    input_schema: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: [
            // Lifecycle
            "status",
            "start",
            "stop",
            "close",
            // Profile management
            "profiles",
            "createProfile",
            "deleteProfile",
            "startProfile",
            "stopProfile",
            "profileTabs",
            "openProfileTab",
            "closeProfileTab",
            // Tab management (legacy)
            "tabs",
            "open",
            "openVisual",
            "focus",
            "navigate",
            // Capture
            "snapshot",
            "screenshot",
            "pdf",
            "console",
            // File I/O
            "upload",
            "dialog",
            // Interactions
            "click",
            "type",
            "press",
            "select",
            "hover",
            "scroll",
            "drag",
            "fill",
            "resize",
            // Scripting & Waiting
            "evaluate",
            "wait",
            "act",
          ],
          description:
            "Browser action: 'open'/'navigate' to load URL, 'screenshot' to capture page as IMAGE (returns base64), 'snapshot' for page TEXT, 'click'/'type' to interact",
        },
        sessionId: { type: "string", description: "Session ID for legacy browser session" },
        // Profile actions
        name: { type: "string", description: "Profile name for create/delete/start/stopProfile" },
        profile: { type: "string", description: "Profile name for profile-related actions" },
        color: { type: "string", description: "Profile color (hex)" },
        executablePath: { type: "string", description: "Chrome executable path for profile" },
        headless: { type: "boolean", description: "Run in headless mode (default true). Set to false for visible browser." },
        visual: { type: "boolean", description: "Launch visible Chrome window with persistent profile (alternative to headless: false)" },
        userDataDir: { type: "string", description: "Custom user data directory for profile" },
        pageId: { type: "string", description: "Page ID for closeProfileTab" },
        // Navigation
        url: { type: "string", description: "URL for start/navigate/open actions. ALWAYS pass url with start to open a page." },
        targetId: { type: "string", description: "Target tab ID for focus/close actions" },
        // Element interactions
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
          description: "OpenClaw-style request for 'act' action. Use {kind:'click', ref:'e5'} or {kind:'type', ref:'e3', text:'hello'}",
          properties: {
            kind: { type: "string", description: "Action kind: click, type, press, hover, scroll, wait, evaluate" },
            ref: { type: "string", description: "Element ref from snapshot (e.g., 'e5', 'e12')" },
            text: { type: "string", description: "Text to type (for kind='type')" },
            key: { type: "string", description: "Key to press (for kind='press')" },
          },
        },
        kind: {
          type: "string",
          description:
            "Legacy: Sub-action for 'act' (prefer request.kind instead)",
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
        // Capture options
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

  // NOTE: Use browser({ action: 'open', url }) instead - OpenClaw pattern
  web_fetch: {
    name: "web_fetch",
    description: "Fetch and extract readable content from a URL",
    category: "browser",
    input_schema: {
      type: "object",
      properties: {
        url: { type: "string", description: "URL to fetch" },
        extractMode: { type: "string", enum: ["markdown", "text"], description: "Extraction mode" },
        maxChars: { type: "number", description: "Maximum characters to return" },
      },
      required: ["url"],
    },
    permissions: ["net:fetch"],
  },

  // Web search (OpenClaw pattern: supports Brave API or DuckDuckGo fallback)
  web_search: {
    name: "web_search",
    description: "Search the web. Returns titles, URLs, and snippets. Use for quick research before browsing. Set BRAVE_API_KEY for better results.",
    category: "browser",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search query string" },
        count: { type: "number", description: "Number of results (1-10, default 5)" },
      },
      required: ["query"],
    },
    permissions: ["net:fetch"],
  },

  // Memory system
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

  // Session management
  sessions_spawn: {
    name: "sessions_spawn",
    description: `Spawn a background sub-agent run in an isolated session and announce the result back to the requester chat.
    
The sub-agent runs independently, completing the task and sending back results via sessions_send.
Use for tasks that may take longer or require separate context.`,
    category: "core",
    input_schema: {
      type: "object",
      properties: {
        task: {
          type: "string",
          description: "Task description for the sub-agent. Be specific and include all context needed."
        },
        label: {
          type: "string",
          description: "Optional short label for the task (used in status/logs)"
        },
        agentId: {
          type: "string",
          description: "Optional agent ID to use for the sub-agent (defaults to current agent)"
        },
        model: {
          type: "string",
          description: "Optional model override for the sub-agent"
        },
        thinking: {
          type: "string",
          description: "Optional thinking level override (off, minimal, low, medium, high, max)",
        },
        runTimeoutSeconds: {
          type: "number",
          description: "Timeout for the run in seconds (0 = no timeout)"
        },
        timeoutSeconds: {
          type: "number",
          description: "Back-compat alias for runTimeoutSeconds",
        },
        cleanup: {
          type: "string",
          enum: ["keep", "delete"],
          description: "Cleanup policy after completion (keep = preserve session, delete = remove after 5s)",
        },
      },
      required: ["task"],
    },
    permissions: ["sessions:create"],
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
    description: "Get detailed status of a session including message count, token estimate, and uptime",
    category: "core",
    input_schema: {
      type: "object",
      properties: {
        sessionId: {
          type: "string",
          description: "Session ID to check. If omitted, returns main session status"
        },
      },
    },
    permissions: ["sessions:read"],
  },

  // Agent management
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

  // Channel/messaging
  message: {
    name: "message",
    description: "Send messages via messaging channels",
    category: "channel",
    input_schema: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["send", "broadcast"], description: "Message action" },
        target: { type: "string", description: "Recipient/channel target" },
        message: { type: "string", description: "Message content" },
        contentType: { type: "string", description: "Content type" },
        buffer: { type: "string", description: "Base64 attachment" },
      },
      required: ["action", "target"],
    },
    permissions: ["message:send"],
  },

  // Telegram media sending
  telegram_media: {
    name: "telegram_media",
    description: "Send photos, documents, or videos via Telegram. Use to share screenshots, files, or media with users.",
    category: "channel",
    input_schema: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["photo", "document", "video"],
          description: "Type of media to send",
        },
        chatId: {
          type: "string",
          description: "Telegram chat ID to send to. Use 'current' for the active chat.",
        },
        file: {
          type: "string",
          description: "File path, URL, or Telegram file_id",
        },
        caption: {
          type: "string",
          description: "Optional caption for the media",
        },
      },
      required: ["action", "file"],
    },
    permissions: ["telegram:media"],
  },
  canvas: {
    name: "canvas",
    description: "Control node canvases for UI rendering",
    category: "media",
    input_schema: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["present", "hide", "snapshot"],
          description: "Canvas action",
        },
        node: { type: "string", description: "Node ID" },
        javaScript: { type: "string", description: "JavaScript to execute" },
      },
      required: ["action"],
    },
    permissions: ["canvas:control"],
  },
  nodes: {
    name: "nodes",
    description: "Discover and control paired nodes",
    category: "core",
    input_schema: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["status", "describe", "camera_snap", "screen_record"],
          description: "Node action",
        },
        node: { type: "string", description: "Node ID" },
      },
      required: ["action"],
    },
    permissions: ["nodes:control"],
  },
  image: {
    name: "image",
    description: "Analyze images with vision models",
    category: "media",
    input_schema: {
      type: "object",
      properties: {
        image: { type: "string", description: "Image path or URL" },
        prompt: { type: "string", description: "Analysis prompt" },
        model: { type: "string", description: "Vision model to use" },
      },
      required: ["image", "prompt"],
    },
    permissions: ["image:analyze"],
  },
  tts: {
    name: "tts",
    description: "Convert text to speech",
    category: "media",
    input_schema: {
      type: "object",
      properties: {
        text: { type: "string", description: "Text to convert to speech" },
        channel: { type: "string", description: "Output channel" },
      },
      required: ["text"],
    },
    permissions: ["media:tts"],
  },

  // Scheduling
  cron: {
    name: "cron",
    description: `Manage cron jobs (status/list/add/update/remove/run/runs) and send wake events.

ACTIONS:
- status: Check cron scheduler status
- list: List jobs (use includeDisabled:true to include disabled)
- add: Create job (requires job object with schedule, payload, sessionTarget)
- update: Modify job (requires jobId + patch object)
- remove: Delete job (requires jobId)
- run: Trigger job immediately (requires jobId)
- runs: Get job run history (requires jobId)
- wake: Send wake event (requires text, optional mode)

SCHEDULE TYPES (schedule.kind):
- "at": One-shot at absolute time { kind: "at", atMs: <unix-ms> }
- "every": Recurring interval { kind: "every", everyMs: <interval-ms> }
- "cron": Cron expression { kind: "cron", expr: "<cron-expr>" }

PAYLOAD TYPES (payload.kind):
- "systemEvent": Injects text { kind: "systemEvent", text: "<message>" }
- "agentTurn": Runs agent { kind: "agentTurn", message: "<prompt>" }`,
    category: "core",
    input_schema: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["status", "list", "add", "update", "remove", "run", "runs", "wake"],
          description: "Cron action to perform"
        },
        includeDisabled: { type: "boolean", description: "Include disabled jobs in list" },
        job: { type: "object", description: "Job definition for add action" },
        jobId: { type: "string", description: "Job ID for update/remove/run/runs" },
        id: { type: "string", description: "Alias for jobId" },
        patch: { type: "object", description: "Patch object for update action" },
        text: { type: "string", description: "Text for wake action" },
        mode: { type: "string", enum: ["now", "next-heartbeat"], description: "Wake mode" },
      },
      required: ["action"],
    },
    permissions: ["cron:manage"],
  },

  // Gateway
  gateway: {
    name: "gateway",
    description: `Control the gateway daemon service, get status, and manage configuration.

ACTIONS:
- status: Get gateway status including uptime, agent count, cron status, memory usage
- restart: Schedule a gateway restart (optional: reason, delayMs)
- config.get: Get current configuration (sanitized)
- config.patch: Apply a configuration patch (requires raw YAML/JSON string)`,
    category: "core",
    input_schema: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["status", "restart", "config.get", "config.patch"],
          description: "Gateway action",
        },
        reason: { type: "string", description: "Reason for restart" },
        delayMs: { type: "number", description: "Delay before restart in milliseconds" },
        raw: { type: "string", description: "Raw config for config.patch" },
      },
      required: ["action"],
    },
    permissions: ["gateway:control"],
  },

  // Git operations (extra)
  git: {
    name: "git",
    description: "Run git commands (clone/status/pull/etc). Pass subcommand without 'git' prefix (e.g., 'clone url' not 'git clone url'). Use workdir for existing repos.",
    category: "process",
    input_schema: {
      type: "object",
      properties: {
        command: { type: "string", description: "Git subcommand and arguments (e.g., 'status', 'clone url', 'pull')" },
        workdir: { type: "string", description: "Repository directory (required for most commands except clone)" },
      },
      required: ["command"],
    },
    permissions: ["exec:run"],
  },

  // Skills (extra)
  summarization: {
    name: "summarization",
    description: "Summarize text content using AI",
    category: "skill",
    input_schema: {
      type: "object",
      properties: {
        text: { type: "string", description: "Text to summarize" },
        maxLength: { type: "number", description: "Maximum summary length" },
        style: {
          type: "string",
          enum: ["brief", "detailed", "bullet"],
          description: "Summary style",
        },
      },
      required: ["text"],
    },
    permissions: [],
  },
  weather: {
    name: "weather",
    description: "Get current weather and forecasts",
    category: "skill",
    input_schema: {
      type: "object",
      properties: {
        location: { type: "string", description: "Location to get weather for" },
        format: {
          type: "string",
          enum: ["short", "detailed", "forecast"],
          description: "Output format",
        },
      },
    },
    permissions: [],
  },
  video_frames: {
    name: "video_frames",
    description: "Extract frames from video files",
    category: "skill",
    input_schema: {
      type: "object",
      properties: {
        video: { type: "string", description: "Video file path" },
        interval: { type: "number", description: "Extract frame every N seconds" },
        count: { type: "number", description: "Maximum frames to extract" },
        output: { type: "string", description: "Output directory" },
      },
      required: ["video"],
    },
    permissions: ["fs:read", "fs:write"],
  },

  // Utility tools
  clipboard: {
    name: "clipboard",
    description: "Read and write system clipboard (macOS)",
    category: "core",
    input_schema: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["read", "write", "clear"],
          description: "Clipboard action",
        },
        content: { type: "string", description: "Content to write (for write action)" },
      },
      required: ["action"],
    },
    permissions: ["clipboard:access"],
  },
  http: {
    name: "http",
    description: "Make HTTP requests to APIs",
    category: "core",
    input_schema: {
      type: "object",
      properties: {
        url: { type: "string", description: "Target URL" },
        method: {
          type: "string",
          enum: ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"],
          description: "HTTP method (default: GET)",
        },
        headers: { type: "object", description: "Request headers" },
        body: { type: "string", description: "Request body" },
        timeout: { type: "number", description: "Timeout in ms (default: 30000)" },
      },
      required: ["url"],
    },
    permissions: ["net:fetch"],
  },
  data: {
    name: "data",
    description: "Transform and manipulate data (JSON, CSV, Base64, etc.)",
    category: "core",
    input_schema: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: [
            "parse_json",
            "stringify_json",
            "base64_encode",
            "base64_decode",
            "url_encode",
            "url_decode",
            "csv_to_json",
            "json_to_csv",
            "diff",
            "hash",
            "uuid",
            "timestamp",
          ],
          description: "Transformation action",
        },
        data: { type: "string", description: "Input data string" },
        input: { type: "object", description: "Input object (for stringify/csv)" },
        text1: { type: "string", description: "First text for diff" },
        text2: { type: "string", description: "Second text for diff" },
        algorithm: { type: "string", description: "Hash algorithm (sha256, sha512, md5)" },
        pretty: { type: "boolean", description: "Pretty print JSON (default: true)" },
      },
      required: ["action"],
    },
    permissions: [],
  },
  env: {
    name: "env",
    description: "Read environment variables and system info",
    category: "core",
    input_schema: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["get", "list", "set", "unset", "has", "info"],
          description: "Environment action",
        },
        key: { type: "string", description: "Environment variable name" },
        value: { type: "string", description: "Value to set" },
        filter: { type: "string", description: "Filter for list action" },
      },
      required: ["action"],
    },
    permissions: ["env:read"],
  },

  // Skill tools
  calc: {
    name: "calc",
    description: "Safely evaluate mathematical expressions",
    category: "skill",
    input_schema: {
      type: "object",
      properties: {
        expression: { type: "string", description: "Math expression to evaluate (e.g., '2 + 2', 'sqrt(16)', '2^8')" },
      },
      required: ["expression"],
    },
    permissions: [],
  },
  convert: {
    name: "convert",
    description: "Convert units (length, weight, temperature)",
    category: "skill",
    input_schema: {
      type: "object",
      properties: {
        value: { type: "number", description: "The value to convert" },
        from: { type: "string", description: "Source unit (m, km, ft, kg, g, lb, c, f, k)" },
        to: { type: "string", description: "Target unit" },
      },
      required: ["value", "from", "to"],
    },
    permissions: [],
  },
  pdf: {
    name: "pdf",
    description: "Extract text, metadata, and page count from PDF files",
    category: "skill",
    input_schema: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["extract_text", "metadata", "page_count"], description: "PDF action" },
        path: { type: "string", description: "Path to the PDF file" },
      },
      required: ["action", "path"],
    },
    permissions: ["fs:read"],
  },
  ocr: {
    name: "ocr",
    description: "Extract text from images using OCR",
    category: "skill",
    input_schema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Path to the image file" },
        language: { type: "string", description: "Language code (default: eng)" },
      },
      required: ["path"],
    },
    permissions: ["fs:read"],
  },
  // MCP Tools - dynamically populated
};

// ============================================
// TOOL HANDLER FUNCTIONS
// ============================================

// Get tool schemas for LLM tool calling
export function getToolSchemasForLLM(): Omit<Tool, "handler">[] {
  return Object.values(toolSchemas);
}

// Get tool handler by name
export function getToolHandler(name: string): ToolHandler | undefined {
  return _toolHandlers.get(name);
}

// Check tool permissions
export function checkToolPermissions(
  permissions: string[] = [],
  contextPermissions: string[] = []
): boolean {
  if (permissions.length === 0) return true;
  return permissions.some((p) => contextPermissions.includes(p));
}

export type ToolName = keyof typeof toolSchemas;

// ============================================
// INITIALIZE TOOL HANDLERS
// ============================================

// Import file handlers
import { handleRead, handleWrite, handleEdit, handleFileSearch, handleGrep } from "./handlers/file";

// Register file handlers
_toolHandlers.set("read", handleRead);
_toolHandlers.set("write", handleWrite);
_toolHandlers.set("edit", handleEdit);
_toolHandlers.set("file_search", handleFileSearch);
_toolHandlers.set("grep", handleGrep);

// Import memory handlers
import {
  handleMemorySearch,
  handleMemoryGet,
  handleMemorySave,
  handleMemoryList,
} from "./handlers/memory";

// Register memory handlers
_toolHandlers.set("memory_search", handleMemorySearch);
_toolHandlers.set("memory_get", handleMemoryGet);
_toolHandlers.set("memory_save", handleMemorySave);
_toolHandlers.set("memory_list", handleMemoryList);

// Import utility handlers
import { handleClipboard } from "./handlers/clipboard";
import { handleHttp } from "./handlers/http";
import { handleData } from "./handlers/data";
import { handleEnv } from "./handlers/env";

// Register utility handlers
_toolHandlers.set("clipboard", handleClipboard);
_toolHandlers.set("http", handleHttp);
_toolHandlers.set("data", handleData);
_toolHandlers.set("env", handleEnv);

// Register skill executors as tools
import { getSkillExecutors } from "../skills/index";
getSkillExecutors()
  .then((executors) => {
    for (const [name, executor] of Object.entries(executors)) {
      _toolHandlers.set(name, async (args) => executor(args));
    }
  })
  .catch((err) => {
    console.error("Failed to initialize skill executors:", err);
  });

// Telegram media handler
async function handleTelegramMedia(
  args: Record<string, unknown>,
  context?: ToolContext
): Promise<{ success: boolean; message: string }> {
  const action = args.action as "photo" | "document" | "video";
  const file = args.file as string;
  const chatId = args.chatId as string | undefined;
  const caption = args.caption as string | undefined;

  if (!file) {
    throw new Error("file is required");
  }

  // Import telegram bot manager
  const { telegramBot, channelManager } = await import("../channels");

  // Find active Telegram channel
  const channels = channelManager.list();
  const telegramChannel = channels.find((c) => c.type === "telegram" && c.enabled);

  if (!telegramChannel) {
    throw new Error("No active Telegram channel found");
  }

  // Get chat ID from context or argument
  let targetChatId = chatId;
  if (!targetChatId || targetChatId === "current") {
    // Try to get from context
    if (context?.channel) {
      targetChatId = context.channel;
    } else {
      throw new Error("chatId required when no active Telegram chat context");
    }
  }

  let success = false;
  switch (action) {
    case "photo":
      success = await telegramBot.sendPhoto(telegramChannel.id, targetChatId, file, caption);
      break;
    case "document":
      success = await telegramBot.sendDocument(telegramChannel.id, targetChatId, file, caption);
      break;
    case "video":
      success = await telegramBot.sendVideo(telegramChannel.id, targetChatId, file, caption);
      break;
    default:
      throw new Error(`Unknown action: ${action}`);
  }

  return {
    success,
    message: success ? `${action} sent successfully` : `Failed to send ${action}`,
  };
}

_toolHandlers.set("telegram_media", handleTelegramMedia);
