import { telegramBot, channelManager } from "../channels";
import { config } from "../config";
import { getSkillExecutors } from "../skills/index";
import { handleCanvas } from "./handlers/canvas";
import { handleClipboard } from "./handlers/clipboard";
import { handleData } from "./handlers/data";
import { handleEnv } from "./handlers/env";
import { handleRead, handleWrite, handleEdit, handleFileSearch, handleGrep } from "./handlers/file";
import { handleWorkspaceIndexSearch } from "./handlers/workspace-index";
import { handleHttp } from "./handlers/http";
import {
  handleLSPDiagnostics,
  handleLSPDefinition,
  handleLSPReferences,
  handleLSPHover,
  handleLSPLanguages,
} from "./handlers/lsp";
import {
  handleMemorySearch,
  handleMemoryGet,
  handleMemorySave,
  handleMemoryList,
} from "./handlers/memory";
import { handleArtifacts } from "./handlers/artifacts";

export interface ToolHandler {
  (args: Record<string, unknown>, context?: ToolContext): Promise<unknown>;
}

export interface ToolContext {
  agentId: string;
  sessionId?: string;
  workspaceDir?: string;
  channel?: string;
  userId?: string;
  permissions?: string[];
  enforcePermissions?: boolean;
  allowDangerousTools?: boolean;
  requireToolUse?: boolean;
  requiredToolName?: string;
  /** Extra path prefixes to deny for write/edit/apply_patch (sensitive dirs). */
  denyWritePrefixes?: string[];
  /** When true, file writes are confined to `workspaceDir`. Default false. */
  confineToWorkspace?: boolean;
}

export interface Tool {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
  handler?: ToolHandler;
  permissions?: string[];
  category:
    | "core"
    | "file"
    | "process"
    | "browser"
    | "memory"
    | "channel"
    | "media"
    | "skill"
    | "lsp"
    | "planning"
    | "discovery"
    | "media"
    | "orchestration";
}

const _toolHandlers = new Map<string, ToolHandler>();
export const toolHandlers = _toolHandlers;

interface RateLimitConfig {
  windowMs: number;
  maxRequests: number;
}

const rateLimits: Record<string, { count: number; resetTime: number }> = {};

const dangerousPermissionPrefixes = ["exec:", "wallet:", "message:", "gateway:", "cron:"];
const dangerousPermissions = new Set([
  "browser:control",
  "env:write",
  "telegram:media",
  "clipboard:access",
]);
const dangerousToolNames = new Set([
  "exec",
  "process",
  "git",
  "browser",
  "wallet",
  "message",
  "gateway",
  "cron",
  "env",
  "http",
  "computer_use",
  "execute_code",
  // camera_snap / screen_record capture the user's camera and screen — gate
  // them behind the dangerous-tool approval flow (privacy-sensitive).
  "nodes",
]);

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

export const toolSchemas: Record<string, Omit<Tool, "handler">> = {
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
      "Execute shell commands. Use workdir parameter for directory context (don't use 'cd' in command). Commands run from workspace root if workdir not specified.",
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

  browser: {
    name: "browser",
    description: [
      "Control browser sessions via status/start/stop/profiles/tabs/open/snapshot/screenshot/actions.",
      "Use snapshot for page text extraction and act/click/type for UI automation.",
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
            "Browser action: 'open'/'navigate' to load URL, 'screenshot' to capture page as IMAGE (returns base64), 'snapshot' for page TEXT, 'click'/'type' to interact",
        },
        sessionId: { type: "string", description: "Session ID for legacy browser session" },
        name: { type: "string", description: "Profile name for create/delete/start/stopProfile" },
        profile: { type: "string", description: "Profile name for profile-related actions" },
        color: { type: "string", description: "Profile color (hex)" },
        executablePath: { type: "string", description: "Chrome executable path for profile" },
        headless: {
          type: "boolean",
          description: "Run in headless mode (default true). Set to false for visible browser.",
        },
        visual: {
          type: "boolean",
          description:
            "Launch visible Chrome window with persistent profile (alternative to headless: false)",
        },
        userDataDir: { type: "string", description: "Custom user data directory for profile" },
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

  web_search: {
    name: "web_search",
    description:
      "Search the web. Returns titles, URLs, and snippets. Use for quick research before browsing. Auto-selects the best configured backend (Tavily/Exa/Brave/SearXNG) and falls back to DuckDuckGo.",
    category: "browser",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search query string" },
        count: { type: "number", description: "Number of results (1-10, default 5)" },
        provider: {
          type: "string",
          enum: ["tavily", "exa", "brave", "searxng", "duckduckgo"],
          description: "Optional: force a specific search backend instead of auto-selecting.",
        },
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
    description: `Spawn a background sub-agent run in an isolated session and announce the result back to the requester chat.
    
The sub-agent runs independently, completing the task and sending back results via sessions_send.
Use for tasks that may take longer or require separate context.`,
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
          description: "Optional agent ID to use for the sub-agent (defaults to current agent)",
        },
        model: {
          type: "string",
          description: "Optional model override for the sub-agent",
        },
        thinking: {
          type: "string",
          description: "Optional thinking level override (off, minimal, low, medium, high, max)",
        },
        runTimeoutSeconds: {
          type: "number",
          description: "Timeout for the run in seconds (0 = no timeout)",
        },
        timeoutSeconds: {
          type: "number",
          description: "Back-compat alias for runTimeoutSeconds",
        },
        cleanup: {
          type: "string",
          enum: ["keep", "delete"],
          description:
            "Cleanup policy after completion (keep = preserve session, delete = remove after 5s)",
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
      "Use the local encrypted multi-chain wallet (ETH, BTC, SOL): native/token balances/history, sends, message signing, ERC-20/SPL transfers, ETH contract calls, Solana program instructions, direct RPC reads, price quotes (Chainlink/Pyth/Jupiter), dynamic swap quote/execute flows (Uniswap v2/v3, Jupiter), generic dapp adapter dispatch, and x402 paid HTTP requests. Requires wallet agent access enabled and an unlocked wallet.",
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
          description: "Wallet action",
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
            "ERC-20 contract address (ETH) or SPL mint address (SOL) for send_token/token_transactions",
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
          description: "Optional Solana skipPreflight flag for sol_program_instruction",
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
          enum: ["uniswap_v2", "uniswap_v3", "jupiter"],
          description: "Swap venue for swap/swap_quote/swap_execute",
        },
        feeTier: {
          type: "number",
          description: "Uniswap v3 fee tier (100, 500, 3000, or 10000)",
        },
        inputMint: {
          type: "string",
          description: "Solana input mint for Jupiter swap actions",
        },
        outputMint: {
          type: "string",
          description: "Solana output mint for Jupiter swap actions",
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

  message: {
    name: "message",
    description:
      "Send messages across channels and run channel actions (discord react/unreact supported)",
    category: "channel",
    input_schema: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["send", "broadcast", "react", "unreact"],
          description: "Message action",
        },
        channel: {
          type: "string",
          description:
            "Optional channel type (telegram|discord|slack|signal|whatsapp|imessage|web).",
        },
        channelId: {
          type: "string",
          description: "Optional internal channel id to target a specific configured channel.",
        },
        target: {
          type: "string",
          description: "Chat/channel target id. Alias: to",
        },
        to: {
          type: "string",
          description: "Alias for target",
        },
        message: { type: "string", description: "Message content. Alias: text/content" },
        text: { type: "string", description: "Alias for message" },
        content: { type: "string", description: "Alias for message" },
        messageId: {
          type: "string",
          description: "Required for react/unreact. Message id to react to.",
        },
        emoji: {
          type: "string",
          description:
            "Required for react/unreact. Discord/Telegram emoji or Slack reaction name (with or without colons).",
        },
        userId: {
          type: "string",
          description: "Optional user id for unreact (defaults to bot user).",
        },
        contentType: { type: "string", description: "Content type" },
        buffer: { type: "string", description: "Base64 attachment" },
      },
      required: ["action"],
    },
    permissions: ["message:send"],
  },

  telegram_media: {
    name: "telegram_media",
    description:
      "Send photos, documents, or videos via Telegram. Use to share screenshots, files, or media with users.",
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
    description:
      "Control canvas for HTML/CSS/JS rendering. Actions: present (show), hide, navigate (load URL), eval (run JS), snapshot (capture image), a2ui_push (push JSONL), a2ui_reset (clear A2UI).",
    category: "browser",
    input_schema: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["present", "hide", "navigate", "eval", "snapshot", "a2ui_push", "a2ui_reset"],
          description:
            "Canvas action: present shows canvas, hide hides it, navigate loads URL, eval runs JS, snapshot captures image, a2ui_push sends JSONL to UI, a2ui_reset clears UI data",
        },
        gatewayUrl: { type: "string", description: "Gateway URL for node communication" },
        gatewayToken: { type: "string", description: "Gateway auth token" },
        timeoutMs: { type: "number", description: "Timeout in milliseconds" },
        node: { type: "string", description: "Target node ID" },
        target: { type: "string", description: "URL or path to present" },
        url: { type: "string", description: "URL or HTML content for present/navigate" },
        x: { type: "number", description: "Window X position" },
        y: { type: "number", description: "Window Y position" },
        width: { type: "number", description: "Window width" },
        height: { type: "number", description: "Window height" },
        javaScript: { type: "string", description: "JavaScript code to evaluate" },
        outputFormat: {
          type: "string",
          enum: ["png", "jpg", "jpeg"],
          description: "Image format for snapshot (default: png)",
        },
        maxWidth: { type: "number", description: "Max width in pixels for snapshot" },
        quality: { type: "number", description: "JPEG quality 0-1 for snapshot" },
        delayMs: { type: "number", description: "Delay before snapshot (ms)" },
        jsonl: { type: "string", description: "JSONL data for A2UI push" },
        jsonlPath: { type: "string", description: "Path to JSONL file for A2UI push" },
      },
      required: ["action"],
    },
    permissions: ["canvas:control"],
  },
  nodes: {
    name: "nodes",
    description:
      "Discover and control device nodes. Today operates on the local host: 'status'/'describe' report it, 'camera_snap'/'screen_record' capture from the local camera/screen (requires ffmpeg + OS Camera/Screen-Recording permission). Remote device nodes (phones/tablets) require a paired companion app, which is not yet available.",
    category: "core",
    input_schema: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["status", "describe", "camera_snap", "screen_record"],
          description: "Node action",
        },
        node: { type: "string", description: "Node ID (default: 'local')" },
        seconds: {
          type: "number",
          description: "screen_record duration in seconds (1-60, default 5)",
        },
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
    description:
      "Convert text to speech using the macOS 'say' synthesizer; returns the path to a generated audio file. macOS only.",
    category: "media",
    input_schema: {
      type: "object",
      properties: {
        text: { type: "string", description: "Text to convert to speech" },
        voice: { type: "string", description: "Optional macOS voice name (e.g. Samantha, Alex)" },
        rate: { type: "number", description: "Optional words-per-minute (80-500)" },
        format: {
          type: "string",
          enum: ["aiff", "m4a", "wav"],
          description: "Output audio format (default aiff)",
        },
      },
      required: ["text"],
    },
    permissions: ["media:tts"],
  },

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
          description: "Cron action to perform",
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

  git: {
    name: "git",
    description:
      "Run git commands (clone/status/pull/etc). Pass subcommand without 'git' prefix (e.g., 'clone url' not 'git clone url'). Use workdir for existing repos.",
    category: "process",
    input_schema: {
      type: "object",
      properties: {
        command: {
          type: "string",
          description: "Git subcommand and arguments (e.g., 'status', 'clone url', 'pull')",
        },
        workdir: {
          type: "string",
          description: "Repository directory (required for most commands except clone)",
        },
      },
      required: ["command"],
    },
    permissions: ["exec:run"],
  },

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

  phone: {
    name: "phone",
    description:
      "Make phone calls on macOS using FaceTime. Opens FaceTime and initiates a call to the specified phone number. Only works on macOS.",
    category: "core",
    input_schema: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["call", "check"],
          description:
            "Action to perform: 'call' to initiate a phone call, 'check' to verify FaceTime availability",
        },
        phone: {
          type: "string",
          description: "Phone number to call (E.164 format recommended, e.g., +15551234567)",
        },
      },
      required: ["action"],
    },
    permissions: ["phone:use"],
  },

  voice_call: {
    name: "voice_call",
    description:
      "Manage a voice call session for agents. On macOS this uses FaceTime for dialing and the system voice for spoken prompts; mock mode is available for tests and dry runs.",
    category: "core",
    input_schema: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: [
            "check_support",
            "initiate_call",
            "continue_call",
            "speak_to_user",
            "end_call",
            "get_status",
          ],
          description: "Voice call action to perform.",
        },
        to: {
          type: "string",
          description: "Destination phone number for initiate_call (E.164 recommended).",
        },
        phone: {
          type: "string",
          description: "Alias for `to`.",
        },
        callId: {
          type: "string",
          description: "Tracked voice call identifier for continue/status/end actions.",
        },
        message: {
          type: "string",
          description: "Prompt to speak or queue for the active call.",
        },
        mode: {
          type: "string",
          enum: ["auto", "macos", "mock"],
          description: "Force a backend. `auto` prefers macOS FaceTime when available.",
        },
        voice: {
          type: "string",
          description: "Optional macOS `say` voice name for spoken prompts.",
        },
        rate: {
          type: "number",
          description: "Optional speaking rate for macOS `say` prompts.",
        },
      },
      required: ["action"],
    },
    permissions: ["phone:use"],
  },

  calc: {
    name: "calc",
    description: "Safely evaluate mathematical expressions",
    category: "skill",
    input_schema: {
      type: "object",
      properties: {
        expression: {
          type: "string",
          description: "Math expression to evaluate (e.g., '2 + 2', 'sqrt(16)', '2^8')",
        },
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
        action: {
          type: "string",
          enum: ["extract_text", "metadata", "page_count"],
          description: "PDF action",
        },
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
  lsp_diagnostics: {
    name: "lsp_diagnostics",
    description:
      "Get code errors and warnings from language servers. Use after editing files to check for issues.",
    category: "lsp",
    input_schema: {
      type: "object",
      properties: {
        file: { type: "string", description: "File path to check for diagnostics" },
        workspace: {
          type: "string",
          description: "Workspace path to check all files (alternative to file)",
        },
      },
    },
    permissions: ["fs:read"],
  },
  lsp_definition: {
    name: "lsp_definition",
    description: "Go to the definition of a symbol at a given position",
    category: "lsp",
    input_schema: {
      type: "object",
      properties: {
        file: { type: "string", description: "File path" },
        line: { type: "number", description: "Line number (1-indexed)" },
        column: { type: "number", description: "Column number (1-indexed)" },
      },
      required: ["file", "line", "column"],
    },
    permissions: ["fs:read"],
  },
  lsp_references: {
    name: "lsp_references",
    description: "Find all references to a symbol at a given position",
    category: "lsp",
    input_schema: {
      type: "object",
      properties: {
        file: { type: "string", description: "File path" },
        line: { type: "number", description: "Line number (1-indexed)" },
        column: { type: "number", description: "Column number (1-indexed)" },
      },
      required: ["file", "line", "column"],
    },
    permissions: ["fs:read"],
  },
  lsp_hover: {
    name: "lsp_hover",
    description: "Get type and documentation info for a symbol at a given position",
    category: "lsp",
    input_schema: {
      type: "object",
      properties: {
        file: { type: "string", description: "File path" },
        line: { type: "number", description: "Line number (1-indexed)" },
        column: { type: "number", description: "Column number (1-indexed)" },
      },
      required: ["file", "line", "column"],
    },
    permissions: ["fs:read"],
  },
  lsp_languages: {
    name: "lsp_languages",
    description: "List supported languages and check if language servers are available",
    category: "lsp",
    input_schema: {
      type: "object",
      properties: {},
    },
    permissions: [],
  },
  todo: {
    name: "todo",
    description:
      "Create and update a task list for the current session. Send the FULL list each call (not a delta). Keep at most ONE item in_progress at a time. Use this for any non-trivial multi-step work to stay organized and avoid drift.",
    category: "planning",
    input_schema: {
      type: "object",
      properties: {
        items: {
          type: "array",
          description: "The complete, current task list.",
          items: {
            type: "object",
            properties: {
              content: { type: "string", description: "Short description of the task" },
              status: {
                type: "string",
                enum: ["pending", "in_progress", "completed"],
                description: "Current state of the task",
              },
              priority: {
                type: "string",
                enum: ["high", "medium", "low"],
                description: "Priority of the task",
              },
            },
            required: ["content", "status", "priority"],
          },
        },
      },
      required: ["items"],
    },
    permissions: [],
  },
  clarify: {
    name: "clarify",
    description:
      "Ask the user a clarifying question when a task is genuinely ambiguous. Provide up to 4 multiple-choice options OR omit options for an open-ended question. Prefer this over guessing and proceeding on a wrong assumption.",
    category: "planning",
    input_schema: {
      type: "object",
      properties: {
        question: { type: "string", description: "The question to ask the user" },
        header: { type: "string", description: "Optional short label for the question" },
        multiSelect: {
          type: "boolean",
          description: "Allow selecting multiple options (only with options). Default false.",
        },
        options: {
          type: "array",
          description: "Up to 4 multiple-choice options. Omit for an open-ended question.",
          items: {
            type: "object",
            properties: {
              label: { type: "string", description: "Short option label" },
              description: { type: "string", description: "Optional detail about the option" },
            },
            required: ["label"],
          },
        },
      },
      required: ["question"],
    },
    permissions: [],
  },
  tool_search: {
    name: "tool_search",
    description:
      "Search the full tool inventory (built-in tools, MCP server tools, and skills) by keyword. Returns matching tool names with short descriptions. Use this to discover available capabilities instead of assuming a tool exists.",
    category: "discovery",
    input_schema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Search query (keywords describing what you want to do)",
        },
        limit: { type: "number", description: "Max results. Default 15, max 50." },
      },
      required: ["query"],
    },
    permissions: [],
  },
  tool_describe: {
    name: "tool_describe",
    description:
      "Fetch the full input schema for a single tool (by name). Call this before tool_call to learn a discovered tool's exact parameters. Built-in tools, MCP tools (named '<server>__<tool>'), and skills ('skill__<name>') are supported.",
    category: "discovery",
    input_schema: {
      type: "object",
      properties: {
        name: { type: "string", description: "The tool name to describe" },
      },
      required: ["name"],
    },
    permissions: [],
  },
  tool_call: {
    name: "tool_call",
    description:
      "Invoke a discovered tool by name with the given arguments. Use tool_describe first to learn the schema. Supports built-in tools and MCP tools named '<server>__<tool>'.",
    category: "discovery",
    input_schema: {
      type: "object",
      properties: {
        name: { type: "string", description: "The tool name to call" },
        arguments: {
          type: "object",
          description: "Arguments object matching the tool's input schema",
          additionalProperties: true,
        },
      },
      required: ["name"],
    },
    permissions: [],
  },
  execute_code: {
    name: "execute_code",
    description:
      "Run JavaScript/TypeScript code that calls other cybara tools programmatically via the `cybara` namespace (e.g. `await cybara.read({path})`). Use this to collapse many tool round-trips into one call for data-processing, loops, and aggregation. The last expression's value is returned.",
    category: "discovery",
    input_schema: {
      type: "object",
      properties: {
        code: { type: "string", description: "The JS/TS code to run" },
        language: {
          type: "string",
          enum: ["javascript", "typescript"],
          description: "Language. Default javascript.",
        },
        timeoutMs: {
          type: "number",
          description: "Execution timeout in ms. Default 15000, max 60000.",
        },
      },
      required: ["code"],
    },
    permissions: [],
  },
  image_generate: {
    name: "image_generate",
    description:
      "Generate images from a text prompt (OpenAI DALL-E / gpt-image or fal.ai). Generated files are saved to the workspace and their paths returned. Set OPENAI_API_KEY or FAL_KEY to enable.",
    category: "media",
    input_schema: {
      type: "object",
      properties: {
        prompt: { type: "string", description: "Text description of the image to generate" },
        provider: {
          type: "string",
          description: "Provider id: 'openai' or 'fal'. Defaults to the configured one.",
        },
        model: {
          type: "string",
          description: "Model id (e.g. gpt-image-1, dall-e-3, fal-ai/flux/schnell).",
        },
        size: { type: "string", description: "Image size (e.g. '1024x1024'). Provider-dependent." },
        quality: {
          type: "string",
          enum: ["standard", "hd"],
          description: "Quality. Default standard.",
        },
        count: { type: "number", description: "Number of images. Default 1." },
        timeoutMs: { type: "number", description: "Timeout in ms." },
      },
      required: ["prompt"],
    },
    permissions: [],
  },
  video_generate: {
    name: "video_generate",
    description:
      "Generate video from a text prompt (fal.ai: minimax, kling, veo3). Async job; the tool waits for completion. Set FAL_KEY to enable. Output saved to the workspace.",
    category: "media",
    input_schema: {
      type: "object",
      properties: {
        prompt: { type: "string", description: "Text description of the video to generate" },
        provider: { type: "string", description: "Provider id. Defaults to 'fal'." },
        model: { type: "string", description: "Model id (e.g. fal-ai/minimax/video-01)." },
        durationSeconds: { type: "number", description: "Target video length in seconds." },
        audio: { type: "boolean", description: "Generate output audio. Default false." },
        timeoutMs: { type: "number", description: "Timeout in ms. Default 120000." },
      },
      required: ["prompt"],
    },
    permissions: [],
  },
  music_generate: {
    name: "music_generate",
    description:
      "Generate music/audio from a text prompt (fal.ai: minimax-music, ace-step, stable-audio). Set FAL_KEY to enable. Output saved to the workspace.",
    category: "media",
    input_schema: {
      type: "object",
      properties: {
        prompt: { type: "string", description: "Style/genre/mood description" },
        provider: { type: "string", description: "Provider id. Defaults to 'fal'." },
        model: { type: "string", description: "Model id (e.g. fal-ai/minimax-music/v2.6)." },
        lyrics: { type: "string", description: "Optional lyrics for vocal tracks." },
        instrumental: {
          type: "boolean",
          description: "Generate instrumental only. Default false.",
        },
        durationSeconds: { type: "number", description: "Duration in seconds." },
        format: {
          type: "string",
          enum: ["mp3", "wav"],
          description: "Output format. Default mp3.",
        },
        timeoutMs: { type: "number", description: "Timeout in ms." },
      },
      required: ["prompt"],
    },
    permissions: [],
  },
  computer_use: {
    name: "computer_use",
    description:
      "Control the user's desktop in the background (capture, click, type, scroll, drag, key, set_value, focus app) via the cua-driver. Does NOT steal the cursor by default. Requires the external cua-driver binary and (on macOS) Accessibility + Screen Recording grants. Prefer 'element' (1-based SOM index) over pixel 'coordinate'; prefer 'set_value' over typing into dropdowns. Dangerous key combos (logout/lock) and shell-injection text are hard-blocked.",
    category: "media",
    input_schema: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: [
            "capture",
            "click",
            "double_click",
            "right_click",
            "middle_click",
            "scroll",
            "drag",
            "type",
            "key",
            "set_value",
            "wait",
            "list_apps",
            "focus_app",
          ],
          description: "The desktop action to perform.",
        },
        mode: {
          type: "string",
          enum: ["som", "vision", "ax"],
          description: "Capture mode. 'som' adds numbered element overlays.",
        },
        app: { type: "string", description: "App name/bundle id, or 'screen'/'desktop'." },
        element: {
          type: "number",
          description: "1-based SOM element index (preferred over coordinate).",
        },
        coordinate: {
          type: "array",
          items: { type: "number" },
          description: "[x,y] pixel coordinate.",
        },
        direction: {
          type: "string",
          enum: ["up", "down", "left", "right"],
          description: "Scroll direction.",
        },
        amount: { type: "number", description: "Scroll amount." },
        text: { type: "string", description: "Text to type (action='type')." },
        keys: { type: "string", description: "Key combo, e.g. 'cmd+s' (action='key')." },
        seconds: { type: "number", description: "Seconds to wait (action='wait')." },
        value: {
          type: "string",
          description: "Value to set (action='set_value' — sets a native AX value without focus steal).",
        },
        raiseWindow: {
          type: "boolean",
          description: "Raise the app window (focus_app). Default false.",
        },
        captureAfter: {
          type: "boolean",
          description: "Re-capture the screen after the action so the model can verify the result.",
        },
      },
      required: ["action"],
    },
    permissions: [],
  },
  kanban_show: {
    name: "kanban_show",
    description:
      "Read one kanban task with its comments. Use to load task context before working it.",
    category: "orchestration",
    input_schema: {
      type: "object",
      properties: { id: { type: "string", description: "Task id" } },
      required: ["id"],
    },
    permissions: [],
  },
  kanban_list: {
    name: "kanban_list",
    description:
      "List/filter kanban tasks (by status or assignee). Default returns the whole board.",
    category: "orchestration",
    input_schema: {
      type: "object",
      properties: {
        status: {
          type: "string",
          description: "Filter by status: triage|todo|ready|running|blocked|done|archived",
        },
        assignee: { type: "string", description: "Filter by assignee" },
        limit: { type: "number", description: "Max results. Default 50, max 200." },
      },
    },
    permissions: [],
  },
  kanban_complete: {
    name: "kanban_complete",
    description:
      "Mark a kanban task done with an optional result summary. Call this when your task's work is finished.",
    category: "orchestration",
    input_schema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Task id" },
        result: { type: "string", description: "Summary of what was accomplished" },
      },
      required: ["id"],
    },
    permissions: [],
  },
  kanban_block: {
    name: "kanban_block",
    description:
      "Mark a task blocked with a reason. Use when you cannot proceed (missing dependency, external blocker).",
    category: "orchestration",
    input_schema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Task id" },
        reason: { type: "string", description: "Why the task is blocked" },
      },
      required: ["id"],
    },
    permissions: [],
  },
  kanban_heartbeat: {
    name: "kanban_heartbeat",
    description:
      "Worker liveness ping. Call periodically while working a long-running task so the dispatcher knows you're alive.",
    category: "orchestration",
    input_schema: {
      type: "object",
      properties: { id: { type: "string", description: "Task id" } },
      required: ["id"],
    },
    permissions: [],
  },
  kanban_comment: {
    name: "kanban_comment",
    description:
      "Append a comment to a task. Used for shared state, findings, and blackboard updates between workers.",
    category: "orchestration",
    input_schema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Task id" },
        body: { type: "string", description: "Comment text" },
        author: { type: "string", description: "Author label. Default 'agent'." },
      },
      required: ["id", "body"],
    },
    permissions: [],
  },
  kanban_create: {
    name: "kanban_create",
    description:
      "Create a new kanban task (optionally as a child of parent tasks). Builds the dependency graph; the dispatcher promotes + spawns children once parents complete.",
    category: "orchestration",
    input_schema: {
      type: "object",
      properties: {
        title: { type: "string", description: "Short task title" },
        body: { type: "string", description: "Detailed task description / acceptance criteria" },
        assignee: { type: "string", description: "Which agent/role should work this task" },
        priority: { type: "number", description: "Priority (higher = more important). Default 5." },
        parents: {
          type: "array",
          items: { type: "string" },
          description: "Parent task ids this depends on",
        },
        status: { type: "string", description: "Initial status. Default 'todo'." },
      },
      required: ["title"],
    },
    permissions: [],
  },
  kanban_unblock: {
    name: "kanban_unblock",
    description: "Return a blocked task to 'todo' so it can be re-promoted to ready.",
    category: "orchestration",
    input_schema: {
      type: "object",
      properties: { id: { type: "string", description: "Task id" } },
      required: ["id"],
    },
    permissions: [],
  },
  kanban_link: {
    name: "kanban_link",
    description:
      "Add a parent→child dependency edge. The child becomes ready only after the parent is done.",
    category: "orchestration",
    input_schema: {
      type: "object",
      properties: {
        parentId: { type: "string", description: "Parent (dependency) task id" },
        childId: { type: "string", description: "Child (dependent) task id" },
      },
      required: ["parentId", "childId"],
    },
    permissions: [],
  },
};

export function isToolEnabledForAgent(toolName: string): boolean {
  if (toolName === "wallet") {
    return config.get<boolean>("wallet_agent_access_enabled") === true;
  }
  return true;
}

export function getToolSchemasForLLM(): Omit<Tool, "handler">[] {
  return Object.values(toolSchemas).filter((tool) => isToolEnabledForAgent(tool.name));
}

export function getToolHandler(name: string): ToolHandler | undefined {
  return _toolHandlers.get(name);
}

export function getToolRequiredPermissions(name: string): string[] {
  const tool = toolSchemas[name];
  if (!tool || !Array.isArray(tool.permissions)) return [];
  return tool.permissions;
}

export function isDangerousTool(name: string): boolean {
  if (dangerousToolNames.has(name)) return true;
  const permissions = getToolRequiredPermissions(name);
  return permissions.some(
    (permission) =>
      dangerousPermissions.has(permission) ||
      dangerousPermissionPrefixes.some((prefix) => permission.startsWith(prefix))
  );
}

export function getDangerousToolNames(): string[] {
  return Object.keys(toolSchemas).filter((name) => isDangerousTool(name));
}

export function checkToolPermissions(
  permissions: string[] = [],
  contextPermissions: string[] = []
): boolean {
  if (permissions.length === 0) return true;
  if (contextPermissions.includes("*")) return true;
  return permissions.some((p) => contextPermissions.includes(p));
}

export type ToolName = keyof typeof toolSchemas;

_toolHandlers.set("read", handleRead);
_toolHandlers.set("write", handleWrite);
_toolHandlers.set("edit", handleEdit);
_toolHandlers.set("file_search", handleFileSearch);
_toolHandlers.set("grep", handleGrep);
_toolHandlers.set("workspace_index_search", handleWorkspaceIndexSearch);

_toolHandlers.set("memory_search", handleMemorySearch);
_toolHandlers.set("memory_get", handleMemoryGet);
_toolHandlers.set("memory_save", handleMemorySave);
_toolHandlers.set("memory_list", handleMemoryList);
_toolHandlers.set("artifacts", handleArtifacts);

_toolHandlers.set("clipboard", handleClipboard);
_toolHandlers.set("http", handleHttp);
_toolHandlers.set("data", handleData);
_toolHandlers.set("env", handleEnv);

_toolHandlers.set("lsp_diagnostics", handleLSPDiagnostics);
_toolHandlers.set("lsp_definition", handleLSPDefinition);
_toolHandlers.set("lsp_references", handleLSPReferences);
_toolHandlers.set("lsp_hover", handleLSPHover);
_toolHandlers.set("lsp_languages", handleLSPLanguages);
_toolHandlers.set("canvas", handleCanvas);
getSkillExecutors()
  .then((executors) => {
    for (const [name, executor] of Object.entries(executors)) {
      _toolHandlers.set(name, async (args) => executor(args));
    }
  })
  .catch((err) => {
    console.error("Failed to initialize skill executors:", err);
  });

export async function handleTelegramMedia(
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

  const channels = channelManager.list();
  const telegramChannel = channels.find((c) => c.type === "telegram" && c.enabled);

  if (!telegramChannel) {
    throw new Error("No active Telegram channel found");
  }

  let targetChatId = chatId;
  if (!targetChatId || targetChatId === "current") {
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
