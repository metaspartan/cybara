// System Prompt Builder - OpenClaw compatible structure
import { tables } from "./database";
import { homedir } from "os";
import { getBootstrapContextFiles, isFirstRun } from "./bootstrap-files";
import type { SkillEntry } from "./skills/types";
import { formatSkillsForPrompt } from "./skills/loader";


// OpenClaw silent reply token
export const SILENT_REPLY_TOKEN = "[SILENT]";

export type PromptMode = "full" | "minimal" | "none";

// OpenClaw-aligned tool summaries
export const CORE_TOOL_SUMMARIES: Record<string, string> = {
  read: "Read file contents",
  write: "Create or overwrite files",
  edit: "Make precise edits to files",
  apply_patch: "Apply multi-file patches",
  grep: "Search file contents for patterns",
  find: "Find files by glob pattern",
  ls: "List directory contents",
  exec: "Run shell commands (pty available for TTY-required CLIs)",
  process: "Manage background exec sessions",
  web_search: "Search the web (Brave API)",
  web_fetch: "Fetch and extract readable content from a URL",
  browser: "Control web browser for automation",
  canvas: "Present/eval/snapshot the Canvas",
  nodes: "List/describe/notify/camera/screen on paired nodes",
  cron: "Manage cron jobs and wake events (use for reminders; write systemEvent text that reads like a reminder when it fires)",
  message: "Send messages and channel actions",
  gateway: "Restart, apply config, or run updates on the running process",
  agents_list: "List agent ids allowed for sessions_spawn",
  sessions_list: "List other sessions (incl. sub-agents) with filters",
  sessions_history: "Fetch history for another session/sub-agent",
  sessions_send: "Send a message to another session/sub-agent",
  sessions_spawn: "Spawn a sub-agent session for background work",
  session_status: "Show status card (usage + time + Reasoning/Elevated)",
  image: "Analyze an image with the configured image model",
  memory_search: "Semantic search through memory files",
  memory_get: "Get specific lines from a memory file",
  memory_save: "Save content to memory",
  tts: "Text-to-speech generation",
  // LSP (Language Server Protocol) tools
  lsp_diagnostics: "Get code errors/warnings after editing files (TypeScript bundled, others need install)",
  lsp_definition: "Go to symbol definition across files",
  lsp_references: "Find all references to a symbol",
  lsp_hover: "Get type info and documentation for a symbol",
  lsp_languages: "List available LSP languages and their install status",
};

export interface SystemPromptParams {
  workspaceDir?: string;
  agentData?: { name: string; config?: string };
  config?: Record<string, unknown>;
  extraSystemPrompt?: string;
  ownerNumbers?: string[];
  heartbeatPrompt?: string;
  modelDisplay: string;
  tools: string[];
  contextFiles?: Array<{ name: string; path?: string; content: string }>;
  ttsHint?: string;
  // OpenClaw additions
  promptMode?: PromptMode;
  reasoningTagHint?: boolean;
  modelAliases?: string[];
  runtimeInfo?: {
    agentId?: string;
    host?: string;
    os?: string;
    arch?: string;
    node?: string;
    model?: string;
    channel?: string;
    capabilities?: string[];
  };
  /** For subagent spawning - provides task context */
  subagentContext?: {
    requesterSessionKey?: string;
    childSessionKey?: string;
    task?: string;
    label?: string;
  };
  /** Available skills for this session */
  skills?: SkillEntry[];
}


// Load custom system prompt configuration
function loadSystemPromptConfig(): Record<string, unknown> {
  const config = tables.config.get("systemPrompt");
  if (config) {
    try {
      return JSON.parse(config.value);
    } catch {
      return {};
    }
  }
  return {};
}

// Load identity configuration
function loadIdentityConfig(): Record<string, unknown> {
  const config = tables.config.get("identity");
  if (config) {
    try {
      return JSON.parse(config.value);
    } catch {
      return {};
    }
  }
  return {};
}

/**
 * Build a system prompt following OpenClaw's structure
 */
export function buildSystemPrompt(params: SystemPromptParams): string {
  // Load custom configuration from database
  const systemPromptConfig = loadSystemPromptConfig();

  const { config, agentData } = params;
  const agentConfig = agentData?.config ? JSON.parse(agentData.config) : {};

  const promptMode: PromptMode =
    params.promptMode ||
    (agentConfig?.promptMode as PromptMode) ||
    (systemPromptConfig?.features as any)?.promptMode ||
    "full";

  const isMinimal = promptMode === "minimal" || promptMode === "none";

  // For "none" mode, return just the basic identity line
  if (promptMode === "none") {
    return "You are a personal assistant running inside Cybara.";
  }

  const lines: string[] = [];

  // Identity section - use custom identity or agent name
  const identity = systemPromptConfig?.identity as Record<string, string> | undefined;
  const agentName = identity?.name || agentData?.name || "Agent";
  const emoji = identity?.emoji || "";
  const creature = identity?.creature || "AI assistant";
  const vibe = identity?.vibe || "";

  lines.push(...buildIdentitySection(agentName, emoji, creature, vibe, params.modelDisplay));

  // Tooling section (OpenClaw style with summaries)
  lines.push(...buildToolingSection(params.tools, isMinimal));

  // Tool Call Style section
  if (!isMinimal) {
    lines.push(...buildToolCallStyleSection());
  }

  // Skills section
  const features = systemPromptConfig?.features as Record<string, boolean> | undefined;
  if (
    features?.skillsEnabled !== false &&
    params.tools.includes("read") &&
    !isMinimal
  ) {
    lines.push(...buildSkillsSection(params.skills));
  }

  // LSP section (code intelligence)
  if (features?.lspEnabled !== false && params.tools.includes("lsp_diagnostics") && !isMinimal) {
    lines.push(...buildLSPSection(params.tools));
  }

  // Memory section
  if (
    features?.memoryEnabled !== false &&
    (params.tools.includes("memory_search") || params.tools.includes("memory_get"))
  ) {
    lines.push(...buildMemorySection());
  }

  // Model aliases section
  if (params.modelAliases && params.modelAliases.length > 0 && !isMinimal) {
    lines.push(...buildModelAliasesSection(params.modelAliases));
  }

  // Workspace section
  lines.push(...buildWorkspaceSection(params.workspaceDir));

  // User identity section
  if (params.ownerNumbers && !isMinimal) {
    lines.push(...buildUserIdentitySection(params.ownerNumbers));
  }

  // Time section
  lines.push(...buildTimeSection());

  // Reply tags section
  if (features?.replyTagsEnabled !== false && !isMinimal) {
    lines.push(...buildReplyTagsSection());
  }

  // Messaging section
  if (
    features?.messagingEnabled !== false &&
    !isMinimal &&
    params.tools.includes("message")
  ) {
    lines.push(...buildMessagingSection());
  }

  // TTS/Voice section
  if (params.ttsHint && !isMinimal) {
    lines.push("## Voice (TTS)", params.ttsHint, "");
  }

  // Subagent context (for spawned subagents)
  if (params.subagentContext) {
    lines.push(...buildSubagentContextSection(params.subagentContext));
  }

  // Extra system prompt from agent or custom config
  const customPrompt = systemPromptConfig?.customPrompt as string | undefined;
  const extraPrompt = params.extraSystemPrompt || customPrompt;
  if (extraPrompt?.trim()) {
    const header = isMinimal ? "## Subagent Context" : "## Additional Context";
    lines.push(header, extraPrompt.trim(), "");
  }

  // Reasoning format section
  if (params.reasoningTagHint && !isMinimal) {
    lines.push(...buildReasoningFormatSection());
  }

  // Context files / Project Context (SOUL.md support)
  if (params.contextFiles && params.contextFiles.length > 0) {
    lines.push(...buildContextFilesSection(params.contextFiles));
  }

  // Silent replies section (OpenClaw)
  if (!isMinimal) {
    lines.push(...buildSilentRepliesSection());
  }

  // Heartbeats section (OpenClaw)
  if (!isMinimal && params.heartbeatPrompt) {
    lines.push(...buildHeartbeatsSection(params.heartbeatPrompt));
  }

  // Runtime section (enhanced)
  lines.push(...buildRuntimeSection(params.modelDisplay, params.runtimeInfo));

  // Safety section
  if (!isMinimal) {
    lines.push(...buildSafetySection());
  }

  return lines.filter(Boolean).join("\n");
}

/**
 * Build system prompt with auto-loaded bootstrap files from workspace.
 * Automatically reads SOUL.md, AGENTS.md, IDENTITY.md, USER.md, TOOLS.md from workspaceDir.
 */
export function buildSystemPromptWithBootstrap(
  params: Omit<SystemPromptParams, "contextFiles"> & { workspaceDir: string }
): string {
  // Load bootstrap files as context files
  const contextFiles = getBootstrapContextFiles(params.workspaceDir);

  // Check if this is a first run (BOOTSTRAP.md exists)
  const firstRun = isFirstRun(params.workspaceDir);

  // Add first-run hint to extra system prompt if applicable
  let extraSystemPrompt = params.extraSystemPrompt || "";
  if (firstRun && !params.promptMode?.includes("minimal")) {
    extraSystemPrompt = [
      extraSystemPrompt,
      "",
      "## First Run Detected",
      "BOOTSTRAP.md exists in your workspace. This is your first session.",
      "Follow the BOOTSTRAP.md ritual to establish your identity and learn about your human.",
      "Delete BOOTSTRAP.md when you're done — you won't need it again.",
    ].join("\n").trim();
  }

  return buildSystemPrompt({
    ...params,
    contextFiles,
    extraSystemPrompt: extraSystemPrompt || undefined,
  });
}


function buildIdentitySection(
  name: string,
  emoji: string,
  creature: string,
  vibe: string,
  modelDisplay: string
): string[] {
  const parts: string[] = [];

  // Build identity line with emoji if provided
  let identityLine = `You are ${name}`;
  if (emoji) identityLine += ` ${emoji}`;
  if (creature) identityLine += `, ${creature}`;
  parts.push(identityLine + ".");

  // Add vibe if provided
  if (vibe) {
    parts.push(`${vibe}.`);
  }

  parts.push(`Running on model: ${modelDisplay}`);
  parts.push("");

  return parts;
}

// OpenClaw-style tooling section with tool summaries
function buildToolingSection(tools: string[], isMinimal: boolean): string[] {
  const toolOrder = [
    "read", "write", "edit", "apply_patch", "grep", "find", "ls",
    "exec", "process", "web_search", "web_fetch", "browser", "canvas",
    "nodes", "cron", "message", "gateway", "agents_list", "sessions_list",
    "sessions_history", "sessions_send", "sessions_spawn", "session_status",
    "image", "memory_search", "memory_get", "memory_save", "tts",
  ];

  const availableTools = new Set(tools.map(t => t.toLowerCase()));
  const enabledTools = toolOrder.filter(t => availableTools.has(t));
  const extraTools = tools.filter(t => !toolOrder.includes(t.toLowerCase()));

  const toolLines = [...enabledTools, ...extraTools].map(tool => {
    const summary = CORE_TOOL_SUMMARIES[tool.toLowerCase()];
    return summary ? `- ${tool}: ${summary}` : `- ${tool}`;
  });

  const lines = [
    "## Tooling",
    "Tool availability (filtered by policy):",
    "Tool names are case-sensitive. Call tools exactly as listed.",
    toolLines.join("\n"),
    "",
  ];

  if (!isMinimal) {
    lines.push(
      "If a task is more complex or takes longer, spawn a sub-agent. It will do the work for you and ping you when it's done.",
      ""
    );
  }

  return lines;
}

function buildToolCallStyleSection(): string[] {
  return [
    "## Tool Call Style",
    "Default: do not narrate routine, low-risk tool calls (just call the tool).",
    "Narrate only when it helps: multi-step work, complex/challenging problems, sensitive actions (e.g., deletions), or when the user explicitly asks.",
    "Keep narration brief and value-dense; avoid repeating obvious steps.",
    "Use plain human language for narration unless in a technical context.",
    "",
  ];
}

function buildModelAliasesSection(aliases: string[]): string[] {
  return [
    "## Model Aliases",
    "Prefer aliases when specifying model overrides; full provider/model is also accepted.",
    ...aliases,
    "",
  ];
}

function buildSubagentContextSection(ctx: {
  requesterSessionKey?: string;
  childSessionKey?: string;
  task?: string;
  label?: string;
}): string[] {
  const lines = ["## Subagent Task"];

  if (ctx.label) {
    lines.push(`Label: ${ctx.label}`);
  }
  if (ctx.task) {
    lines.push(`Task: ${ctx.task}`);
  }
  if (ctx.requesterSessionKey) {
    lines.push(`Requester session: ${ctx.requesterSessionKey}`);
  }
  if (ctx.childSessionKey) {
    lines.push(`Your session: ${ctx.childSessionKey}`);
  }

  lines.push("");
  lines.push("When done, use sessions_send to announce your result back to the requester.");
  lines.push("");

  return lines;
}

function buildReasoningFormatSection(): string[] {
  return [
    "## Reasoning Format",
    "ALL internal reasoning MUST be inside <think>...</think>.",
    "Do not output any analysis outside <think>.",
    "Format every reply as <think>...</think> then <final>...</final>, with no other text.",
    "Only the final user-visible reply may appear inside <final>.",
    "Only text inside <final> is shown to the user; everything else is discarded.",
    "",
    "Example:",
    "<think>Short internal reasoning.</think>",
    "<final>Hey there! What would you like to do next?</final>",
    "",
  ];
}

function buildContextFilesSection(
  contextFiles: Array<{ name: string; path?: string; content: string }>
): string[] {
  const hasSoulFile = contextFiles.some(file => {
    const name = file.name.toLowerCase();
    return name === "soul.md" || name.endsWith("/soul.md");
  });

  const lines = [
    "# Project Context",
    "",
    "The following project context files have been loaded:",
  ];

  if (hasSoulFile) {
    lines.push(
      "If SOUL.md is present, embody its persona and tone. Avoid stiff, generic replies; follow its guidance unless higher-priority instructions override it."
    );
  }

  lines.push("");

  for (const file of contextFiles) {
    const path = file.path || file.name;
    lines.push(`## ${path}`, "", file.content, "");
  }

  return lines;
}


function buildTimeSection(): string[] {
  const now = new Date();
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return ["## Current Date & Time", `Time zone: ${timezone}`, now.toISOString(), ""];
}

function buildUserIdentitySection(ownerNumbers: string[]): string[] {
  const owners = ownerNumbers.map((n) => `@${n}`).join(", ");
  return ["## User Identity", `Owner: ${owners}`, ""];
}

function buildMemorySection(): string[] {
  return [
    "## Memory Recall",
    "Before answering anything about prior work, decisions, dates, people, preferences, or todos: run memory_search on MEMORY.md + memory/*.md; then use memory_get to pull only the needed lines. If low confidence after search, say you checked.",
    "",
  ];
}

function buildSkillsSection(skills?: SkillEntry[]): string[] {
  const lines: string[] = [
    "## Skills (mandatory)",
    "Before replying: scan <available_skills> <description> entries.",
    "- If exactly one skill clearly applies: read its SKILL.md at <location> with `read`, then follow it.",
    "- If multiple could apply: choose the most specific one, then read/follow it.",
    "- If none clearly apply: do not read any SKILL.md.",
    "Constraints: never read more than one skill up front; only read after selecting.",
    "",
  ];

  // Add available skills list if provided
  if (skills && skills.length > 0) {
    lines.push(formatSkillsForPrompt(skills));
    lines.push("");
  }

  return lines;
}

function buildLSPSection(tools: string[]): string[] {
  if (!tools.includes("lsp_diagnostics")) return [];

  return [
    "## Code Intelligence (LSP)",
    "You have Language Server Protocol tools for IDE-like code analysis.",
    "",
    "**After editing code files, use `lsp_diagnostics` to check for errors before finishing.**",
    "",
    "Available capabilities:",
    "- `lsp_diagnostics`: Check files for errors/warnings",
    "- `lsp_definition`: Jump to symbol definitions",
    "- `lsp_references`: Find all usages of a symbol",
    "- `lsp_hover`: Get type info and documentation",
    "- `lsp_languages`: See which language servers are installed",
    "",
    "TypeScript/JavaScript diagnostics are always available (bundled).",
    "Other languages (Rust, Python, Go, C++, etc.) require language servers to be installed.",
    "",
  ];
}

function buildWorkspaceSection(workspaceDir?: string): string[] {
  const homeDir =
    typeof process !== "undefined" && process.env?.HOME ? process.env.HOME : homedir();
  const dir = workspaceDir || homeDir;
  return [
    "## Workspace",
    `Your working directory is: ${dir}`,
    `You have full access to the entire ${dir} directory and can create, read, write, and execute anywhere within it.`,
    "",
  ];
}

function buildToolsSection(tools: string[]): string[] {
  const toolList = tools.filter(Boolean).join(", ");
  const lines = [
    "## Tools",
    "You have FULL access to tools. USE THEM IMMEDIATELY. Do not ask for permission.",
    `Available tools: ${toolList}`,
    "",
    "### CRITICAL: Proactive Execution",
    "- When the user asks you to do something, DO IT. Don't explain what you would do - just do it.",
    "- Never say 'I cannot access' or 'I would need to' - you CAN access and you WILL access.",
    "- Never ask for confirmation before using tools. Just use them.",
    "- If a task requires browsing the web, OPEN the browser and GET the data.",
    "- Complete the task in ONE response. Don't go back and forth.",
    "",
    "### Tool Call Style",
    "- Default: do NOT narrate routine tool calls. Just call the tool silently.",
    "- After getting data, provide the ANSWER, not a description of what you did.",
    "- The user wants RESULTS, not a play-by-play of your tool usage.",
    "",
    "### Execution Style",
    "- Complete tasks FULLY in one response - don't stop to ask if it's okay",
    "- Chain tool calls: open → snapshot → extract data → respond with answer",
    "- Only ask questions if the request is genuinely ambiguous",
    "- For web data: browser({action:'open'}) → browser({action:'snapshot'}) → extract and respond",
  ];

  // Add browser-specific guidance if browser tools are available
  if (tools.includes("browser")) {
    lines.push("");
    lines.push("### Browser Automation");
    lines.push("Control the browser via status/start/stop/profiles/tabs/open/snapshot/screenshot/actions.");
    lines.push("Use snapshot+act for UI automation. Snapshot returns page text with interactive refs [ref=eN].");
    lines.push("When using refs from snapshot, keep the same tab by passing targetId from snapshot into subsequent actions.");
    lines.push("Use browser(open) + browser(snapshot) to get page data from JavaScript-rendered sites.");
  }

  lines.push("");
  return lines;
}

function buildRuntimeSection(
  modelDisplay: string,
  runtimeInfo?: SystemPromptParams["runtimeInfo"]
): string[] {
  // Build OpenClaw-style runtime line
  const parts: string[] = [];

  if (runtimeInfo?.agentId) {
    parts.push(`agent=${runtimeInfo.agentId}`);
  }
  if (runtimeInfo?.host) {
    parts.push(`host=${runtimeInfo.host}`);
  } else {
    parts.push("host=cybara");
  }

  const os = runtimeInfo?.os ||
    (typeof process !== "undefined" && process.platform
      ? `${process.platform}`
      : "unknown");
  const arch = runtimeInfo?.arch ||
    (typeof process !== "undefined" && process.arch ? process.arch : "unknown");
  parts.push(`os=${os} (${arch})`);

  const nodeVersion = runtimeInfo?.node ||
    (typeof process !== "undefined" && process.version ? process.version : "unknown");
  parts.push(`node=${nodeVersion}`);

  const model = runtimeInfo?.model || modelDisplay;
  parts.push(`model=${model}`);

  if (runtimeInfo?.channel) {
    parts.push(`channel=${runtimeInfo.channel}`);
  }
  if (runtimeInfo?.capabilities && runtimeInfo.capabilities.length > 0) {
    parts.push(`capabilities=${runtimeInfo.capabilities.join(",")}`);
  }

  return [
    "## Runtime",
    `Runtime: ${parts.join(" | ")}`,
    "",
  ];
}


function buildMessagingSection(): string[] {
  return [
    "## Messaging",
    "- Reply in current session → automatically routes to the source channel",
    "- Cross-session messaging → use sessions_spawn or sessions_send",
    "- Never use exec/curl for provider messaging; the platform handles all routing internally.",
    "",
  ];
}

function buildReplyTagsSection(): string[] {
  return [
    "## Reply Tags",
    "Tags are supported for special behaviors:",
    "- [[reply_to_current]] replies to the triggering message.",
    "Tags are stripped before sending; support depends on channel configuration.",
    "",
  ];
}

function buildSilentRepliesSection(): string[] {
  return [
    "## Silent Replies",
    `When you have nothing to say, respond with ONLY: ${SILENT_REPLY_TOKEN}`,
    "",
    "⚠️ Rules:",
    "- It must be your ENTIRE message — nothing else",
    `- Never append it to an actual response (never include "${SILENT_REPLY_TOKEN}" in real replies)`,
    "- Never wrap it in markdown or code blocks",
    "",
    `❌ Wrong: "Here's help... ${SILENT_REPLY_TOKEN}"`,
    `❌ Wrong: "\`${SILENT_REPLY_TOKEN}\`"`,
    `✅ Right: ${SILENT_REPLY_TOKEN}`,
    "",
  ];
}

function buildHeartbeatsSection(heartbeatPrompt: string): string[] {
  return [
    "## Heartbeats",
    `Heartbeat prompt: ${heartbeatPrompt}`,
    "If you receive a heartbeat poll (a user message matching the heartbeat prompt above), and there is nothing that needs attention, reply exactly:",
    "HEARTBEAT_OK",
    'Cybara treats a leading/trailing "HEARTBEAT_OK" as a heartbeat ack (and may discard it).',
    'If something needs attention, do NOT include "HEARTBEAT_OK"; reply with the alert text instead.',
    "",
  ];
}

function buildSafetySection(): string[] {
  return [
    "## Safety",
    "- Don't exfiltrate private data. Ever.",
    "- Don't run destructive commands without asking.",
    "- When in doubt, ask.",
    "",
  ];
}

/**
 * Agent type presets - similar to Clawdbot's agent types
 */

// Common tool guidance added to all agent types (OpenClaw pattern)
const TOOL_GUIDANCE = `

## TOOLS - USE THEM!
You have FULL access to browser, file system, and more. When asked to do something, DO IT.
- Get web data: browser({action:'open', url:'...'}) → browser({action:'snapshot'}) → extract and respond
- Never say "I cannot access" - you CAN and WILL access.
- Complete the task in one response. Don't ask for permission.`;

export const AGENT_TYPE_PROMPTS: Record<string, string> = {
  main: `You are a helpful, friendly AI assistant. Be genuinely helpful, not performatively helpful. Skip the fluff—just help.

Be the assistant you'd actually want to talk to. Concise when needed, thorough when it matters. Not a corporate drone. Not a sycophant. Just... good.${TOOL_GUIDANCE}`,

  research: `You are a research-focused AI assistant. Your goal is to find information, analyze sources, and provide comprehensive answers.

Always cite your sources when possible. Distinguish between verified facts and speculation. When you find interesting information proactively, share it.${TOOL_GUIDANCE}`,

  coder: `You are a coding-focused AI assistant. Help with software development, debugging, code review, and technical problems.

Write clean, working code. Explain your reasoning. When debugging, suggest systematic approaches. Prefer modern patterns and best practices.${TOOL_GUIDANCE}`,

  planner: `You are a planning-focused AI assistant. Help break down complex tasks into actionable steps.

Think through problems systematically. Propose multiple approaches when relevant. Help prioritize and estimate effort.${TOOL_GUIDANCE}`,

  ops: `You are an operations-focused AI assistant. Help with system administration, DevOps, and automation tasks.

Be careful with production systems. Always verify before making changes. Suggest safest approaches first. Document what you do.${TOOL_GUIDANCE}`,
};

/**
 * Get default system prompt for an agent type
 */
export function getDefaultSystemPrompt(agentType: string): string {
  return AGENT_TYPE_PROMPTS[agentType] || AGENT_TYPE_PROMPTS.main;
}

/**
 * Model alias resolution - matches Clawdbot's model aliases
 */
export function resolveModelAlias(modelId: string, provider?: string): string {
  const aliases: Record<string, string> = {
    // MiniMax aliases
    "minimax-m2.1": "MiniMax-M2.1",
    minimax: "MiniMax-M2.1",

    // OpenAI aliases
    "gpt-4o": "gpt-4o",
    "gpt-4": "gpt-4o",
    "gpt-5": "gpt-5.2",
    o1: "o1",
    o3: "o3",

    // Anthropic aliases
    "claude-opus": "claude-opus-4-5",
    "claude-sonnet": "claude-sonnet-4-5",
    "claude-haiku": "claude-haiku-4-5",
    opus: "claude-opus-4-5",
    sonnet: "claude-sonnet-4-5",
    haiku: "claude-haiku-4-5",

    // Google aliases
    "gemini-2-flash": "gemini-2.0-flash-exp",
    "gemini-3-pro": "gemini-3-pro-preview",
    "gemini-3-flash": "gemini-3-flash-preview",

    // Generic aliases
    default: "MiniMax-M2.1",
    fast: "MiniMax-M2.1",
    smart: "claude-opus-4-5",
  };

  const key = `${provider || ""}/${modelId}`.toLowerCase();
  return aliases[key] || aliases[modelId.toLowerCase()] || modelId;
}
