// System Prompt Builder - Cybara compatible structure
import { tables } from "./database";
import { homedir } from "os";
import { getBootstrapContextFiles, isFirstRun } from "./bootstrap-files";
import type { SkillEntry } from "./skills/types";
import { formatSkillsForPrompt } from "./skills/loader";

// Cybara silent reply token
export const SILENT_REPLY_TOKEN = "[SILENT]";

export type PromptMode = "full" | "minimal" | "none";

// Cybara-aligned tool summaries
export const CORE_TOOL_SUMMARIES: Record<string, string> = {
  read: "Read file contents",
  write: "Create or overwrite files",
  edit: "Make precise edits to files",
  apply_patch: "Apply multi-file patches",
  grep: "Search file contents for patterns",
  workspace_index_search: "Search workspace files by path/name via index (with fallback)",
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
  wallet:
    "Read balances/history, send native/token transfers, run contract/program calls, query prices (Chainlink/Pyth/Jupiter), and execute guarded swap flows (Uniswap/Jupiter)",
  gateway: "Restart, apply config, or run updates on the running process",
  agents_list: "List agent ids allowed for sessions_spawn",
  sessions_list: "List other sessions (incl. sub-agents) with filters",
  sessions_history: "Fetch history for another session/sub-agent",
  sessions_send: "Send a message to another session/sub-agent",
  sessions_spawn: "Spawn a sub-agent session for background work",
  session_status: "Show status card (usage + time + Reasoning/Elevated)",
  artifacts:
    "Create and manage session-scoped .md.resolved artifacts for checklists, implementation plans, and walkthroughs",
  image: "Analyze an image with the configured image model",
  memory_search: "Semantic search through memory files",
  memory_get: "Get specific lines from a memory file",
  memory_save: "Save content to memory",
  tts: "Text-to-speech generation",
  // LSP (Language Server Protocol) tools
  lsp_diagnostics:
    "Get code errors/warnings after editing files (TypeScript bundled, others need install)",
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
  // Cybara additions
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
    defaultModel?: string;
    channel?: string;
    capabilities?: string[];
    repoRoot?: string;
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
  /** Sandbox/containerized execution info */
  sandboxInfo?: {
    enabled: boolean;
    workspaceDir?: string;
    workspaceAccess?: "none" | "ro" | "rw";
    agentWorkspaceMount?: string;
    browserBridgeUrl?: string;
    browserNoVncUrl?: string;
    hostBrowserAllowed?: boolean;
    elevated?: {
      allowed: boolean;
      defaultLevel: "on" | "off" | "ask" | "full";
    };
  };
  /** Reaction guidance (for Telegram/Discord minimal/extensive modes) */
  reactionGuidance?: {
    level: "minimal" | "extensive";
    channel: string;
  };
  /** Path to documentation directory */
  docsPath?: string;
  /** Additional workspace notes */
  workspaceNotes?: string[];
  /** Additional hints for message tool usage */
  messageToolHints?: string[];
  /** Whether inline buttons are enabled for current channel */
  inlineButtonsEnabled?: boolean;
  /** User timezone for time display */
  userTimezone?: string;
}

function parseJsonObject(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  if (typeof value !== "string") return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

// Load custom system prompt configuration
function loadSystemPromptConfig(): Record<string, unknown> {
  const config = tables.config.get("systemPrompt");
  if (!config) return {};
  return parseJsonObject(config.value);
}

/**
 * Build a system prompt following Cybara's structure
 */
export function buildSystemPrompt(params: SystemPromptParams): string {
  // Load custom configuration from database
  const systemPromptConfig = loadSystemPromptConfig();

  const { agentData } = params;
  const agentConfig = parseJsonObject(agentData?.config);
  const promptFeatures = systemPromptConfig?.features as { promptMode?: PromptMode } | undefined;

  const promptMode: PromptMode =
    params.promptMode ||
    (agentConfig?.promptMode as PromptMode) ||
    promptFeatures?.promptMode ||
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

  // Tooling section (Cybara style with summaries)
  lines.push(...buildToolingSection(params.tools, isMinimal));

  // Tool Call Style section
  if (!isMinimal) {
    lines.push(...buildToolCallStyleSection());
  }

  // Agentic behavior section (proactive, autonomous agent instructions)
  if (!isMinimal) {
    lines.push(...buildAgenticBehaviorSection());
  }

  // CLI Quick Reference section (Cybara style)
  if (!isMinimal) {
    lines.push(...buildCLIReferenceSection());
  }

  // Skills section
  const features = systemPromptConfig?.features as Record<string, boolean> | undefined;
  if (features?.skillsEnabled !== false && params.tools.includes("read") && !isMinimal) {
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
  lines.push(...buildTimeSection(params.userTimezone, params.tools.includes("session_status")));

  // Reply tags section
  if (features?.replyTagsEnabled !== false && !isMinimal) {
    lines.push(...buildReplyTagsSection());
  }

  // Messaging section (enhanced with Cybara parity)
  if (features?.messagingEnabled !== false && !isMinimal) {
    lines.push(
      ...buildMessagingSection({
        isMinimal,
        tools: params.tools,
        inlineButtonsEnabled: params.inlineButtonsEnabled,
        runtimeChannel: params.runtimeInfo?.channel,
        messageToolHints: params.messageToolHints,
      })
    );
  }

  // TTS/Voice section
  if (params.ttsHint && !isMinimal) {
    lines.push("## Voice (TTS)", params.ttsHint, "");
  }

  // Sandbox section (for containerized execution)
  if (params.sandboxInfo?.enabled) {
    lines.push(...buildSandboxSection(params.sandboxInfo));
  }

  // Documentation section
  if (params.docsPath && !isMinimal) {
    lines.push(...buildDocsSection(params.docsPath));
  }

  // Reactions section (for Telegram/Discord modes)
  if (params.reactionGuidance && !isMinimal) {
    lines.push(...buildReactionsSection(params.reactionGuidance));
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

  // Silent replies section (Cybara)
  if (!isMinimal) {
    lines.push(...buildSilentRepliesSection());
  }

  // Heartbeats section (Cybara)
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
    ]
      .join("\n")
      .trim();
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

// Cybara-style tooling section with tool summaries
function buildToolingSection(tools: string[], isMinimal: boolean): string[] {
  const toolOrder = [
    "read",
    "write",
    "edit",
    "apply_patch",
    "grep",
    "workspace_index_search",
    "find",
    "ls",
    "exec",
    "process",
    "web_search",
    "web_fetch",
    "browser",
    "canvas",
    "nodes",
    "cron",
    "message",
    "wallet",
    "gateway",
    "agents_list",
    "sessions_list",
    "sessions_history",
    "sessions_send",
    "sessions_spawn",
    "session_status",
    "artifacts",
    "image",
    "memory_search",
    "memory_get",
    "memory_save",
    "tts",
    "lsp_diagnostics",
    "lsp_definition",
    "lsp_references",
    "lsp_hover",
    "lsp_languages",
  ];

  const availableTools = new Set(tools.map((t) => t.toLowerCase()));
  const enabledTools = toolOrder.filter((t) => availableTools.has(t));
  const extraTools = tools.filter((t) => !toolOrder.includes(t.toLowerCase()));

  const toolLines = [...enabledTools, ...extraTools].map((tool) => {
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

    // Execution guidance for task completion
    lines.push(
      "### Execution Style",
      "- Complete tasks FULLY in one response - don't stop to ask if it's okay",
      "- Chain tool calls: open → snapshot → extract data → respond with answer",
      "- Only ask questions if the request is genuinely ambiguous",
      ""
    );

    // Browser-specific guidance if browser tool is available
    if (availableTools.has("browser")) {
      lines.push(
        "### Browser Tool (for web data)",
        "Use browser for JavaScript-rendered or dynamic websites (React, Next.js, SPAs).",
        "",
        "**WORKFLOW for extracting data:**",
        "1. browser({action:'open', url:'...'}) - open the page",
        "2. browser({action:'snapshot'}) - get page text, extract data from it",
        "3. browser({action:'scroll'}) - scroll to reveal more content",
        "4. browser({action:'snapshot'}) - get new content, add to your list",
        "5. Repeat steps 3-4 until you have enough items",
        "6. Present ALL accumulated data in organized format",
        "",
        "**KEY PRINCIPLES:**",
        "- Read the snapshot text carefully - it contains the actual page content",
        "- Scroll and snapshot multiple times to get complete lists/feeds",
        "- Accumulate data across snapshots - don't forget earlier items",
        "- Extract and present the data, don't just describe what you did",
        "- **ALWAYS close the browser when done**: browser({action:'close'}) after finishing your browsing task to free resources",
        ""
      );
    }

    if (availableTools.has("wallet")) {
      lines.push(
        "### Wallet Tool (funds and contracts)",
        "- Always begin with read-only steps: wallet status/balances/quotes before any write action.",
        "- For market context, use `price` or `price_quote` (auto/chainlink/pyth/jupiter) before deciding on swaps or transfers.",
        "- Use `endpoints` when you need canonical router/oracle/program IDs before interacting with protocols.",
        "- For swaps, prefer wallet action `swap_eth_uniswap` with `dryRun: true` first, then execute with explicit amount/percent and slippage.",
        "- For dynamic routing, prefer `swap`/`swap_quote` with dry-run first, then execute (`swap_execute` or `swap` with `execute: true`) using explicit venue (uniswap_v2/uniswap_v3/jupiter).",
        "- For broader protocol coverage, use `dapp_capabilities` then `dapp_call` with explicit adapter (`rpc_call`, `eth_contract_call`, `sol_program_instruction`, `swap`, `price`, `x402_http`).",
        "- Prefer `rpc_call` for on-chain read discovery (method/params) before relying on off-chain APIs.",
        "- For ETH contract calls, prefer explicit `methodSignature` for overloaded methods and run `readOnly: true` first before write execution.",
        "- For dynamic contract interactions, verify contract address and method ABI/signature from trusted docs before submission.",
        "- For Solana program instructions, include full account metas and choose a single data encoding (`dataBase64`/`dataHex`/`dataUtf8`).",
        "- For x402 paid HTTP requests, run with `dryRun: true` first, verify requirement amount/network/asset/payTo, then execute with explicit max amount.",
        "- For token sends, verify chain + token address/mint + decimals assumptions before submitting.",
        "- Surface tx hash and explorer URL after successful writes.",
        ""
      );
    }

    if (availableTools.has("artifacts")) {
      lines.push(
        "### Artifacts Tool (.md.resolved project memory)",
        "- Use `artifacts` for multi-step project work (code projects, website design, implementation plans).",
        "- Start with `action=create` + `kind=task` to create a checklist, then track completion with `action=check`.",
        "- Use `kind=implementation` for architecture/plan docs and `kind=walkthrough` for handoff/runbook docs.",
        "- On resumed work, run `action=list` then `action=read` to reload context before making new changes.",
        "- After create/list/read, reuse the returned `artifact.name`/`artifact.fileName` in later calls for deterministic reads/updates.",
        "- `action=read` accepts either `name` or `kind`; prefer exact `name` when available.",
        "- Keep any human-written dates in artifacts aligned with the Current Date & Time section (local timezone), and include UTC only when needed for precision.",
        "- Keep artifacts concise, decision-focused, and tied to concrete verification steps.",
        ""
      );
    }
  }

  return lines;
}

function buildCLIReferenceSection(): string[] {
  return [
    "## Cybara CLI Quick Reference",
    "Cybara is controlled via subcommands. Do not invent commands.",
    "To manage the platform daemon (start/stop/restart):",
    "- cybara start / start -d (daemon mode)",
    "- cybara stop",
    "- cybara restart",
    "- cybara status",
    "",
    "Other commands:",
    "- cybara channel (manage channels)",
    "- cybara mcp (manage MCP servers)",
    "- cybara skill (manage skills)",
    "- cybara agent (manage agents)",
    "If unsure, ask the user to run `cybara --help` and paste the output.",
    "",
  ];
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

function buildAgenticBehaviorSection(): string[] {
  return [
    "## Agentic Behavior",
    "You are an autonomous agent. Act decisively and complete tasks fully without unnecessary interruptions.",
    "",
    "**Core Principles:**",
    "1. **Be proactive**: When asked to do something, do it completely. Don't stop to ask for permission on obvious next steps.",
    "2. **Take initiative**: If you see related issues while working, fix them. If something is broken, fix it.",
    "3. **Complete the task**: Don't give a partial answer and ask if the user wants you to continue. Just continue.",
    "4. **Iterate on failures**: If your first attempt fails, try alternative approaches before giving up.",
    "5. **Use tools liberally**: You have tools—use them. Read files, check directories, run commands, search the codebase.",
    "",
    "**What NOT to do:**",
    '- Don\'t ask "Would you like me to...?" when the answer is obvious from context.',
    "- Don't stop after listing directory contents—analyze what you find.",
    "- Don't give up on the first error—investigate and retry.",
    "- Don't explain what you're about to do in excessive detail before doing it.",
    "- Don't ask for confirmation before routine, non-destructive actions.",
    "",
    "**When to pause and ask:**",
    "- Destructive actions (deleting data, removing files)",
    "- Ambiguous requirements with multiple valid interpretations",
    "- Actions with significant cost or external side-effects (billing, external APIs)",
    "- When the task itself is unclear or underspecified",
    "",
    "**Workspace awareness:**",
    "- Always expand `~` to the user's home directory before using paths.",
    "- When asked to examine a project, use `file_search`, `grep`, and `read` to understand it.",
    "- Provide actionable insights, not just raw tool output.",
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
  const hasSoulFile = contextFiles.some((file) => {
    const name = file.name.toLowerCase();
    return name === "soul.md" || name.endsWith("/soul.md");
  });

  const lines = ["# Project Context", "", "The following project context files have been loaded:"];

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

function resolvePromptTimezone(userTimezone?: string): string {
  const fallback = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  if (!userTimezone) return fallback;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: userTimezone }).format(new Date());
    return userTimezone;
  } catch {
    return fallback;
  }
}

function formatPromptLocalDateTime(now: Date, timeZone: string): string {
  const weekday = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "long",
  }).format(now);
  const date = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
  const time = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(now);
  return `${weekday}, ${date} ${time}`;
}

function buildTimeSection(userTimezone?: string, includeSessionStatusHint?: boolean): string[] {
  const now = new Date();
  const timezone = resolvePromptTimezone(userTimezone);
  const localDateTime = formatPromptLocalDateTime(now, timezone);
  const lines = [
    "## Current Date & Time",
    `Time zone: ${timezone}`,
    `Local (${timezone}): ${localDateTime}`,
    `UTC: ${now.toISOString()}`,
  ];
  if (includeSessionStatusHint) {
    lines.push("For long-running tasks, run `session_status` to refresh the current timestamp.");
  }
  lines.push("");
  return lines;
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
    "When a session-specific workspace folder is provided, use it as the default root for file/process/git tools unless the user asks otherwise.",
    "",
  ];
}

export function buildToolsSection(tools: string[]): string[] {
  const toolList = tools.filter(Boolean).join(", ");
  const lines = [
    "## Tools",
    "Use tools when they help complete the task accurately and efficiently.",
    `Available tools: ${toolList}`,
    "",
    "### Tool Use Defaults",
    "- Prefer doing the work over describing hypothetical steps.",
    "- Do not invent tools or commands that are not available.",
    "- Ask follow-up questions only when the request is genuinely ambiguous or risky.",
    "",
    "### Tool Call Style",
    "- Default: do NOT narrate routine tool calls. Just call the tool silently.",
    "- Narrate briefly only for complex, sensitive, or explicitly requested workflows.",
    "- After getting data, provide the answer, not a play-by-play.",
    "",
    "### Execution Style",
    "- Complete tasks fully whenever possible.",
    "- Chain tool calls deliberately: open -> snapshot -> extract -> respond.",
    "- Only ask questions when needed to avoid wrong or unsafe actions.",
    "- For web data: browser({action:'open'}) -> browser({action:'snapshot'}) -> extract and respond.",
  ];

  // Add browser-specific guidance if browser tools are available
  if (tools.includes("browser")) {
    lines.push("");
    lines.push("### Browser Automation");
    lines.push(
      "Control the browser via status/start/stop/profiles/tabs/open/snapshot/screenshot/actions."
    );
    lines.push(
      "Use snapshot+act for UI automation. Snapshot returns page text with interactive refs [ref=eN]."
    );
    lines.push(
      "When using refs from snapshot, keep the same tab by passing targetId from snapshot into subsequent actions."
    );
    lines.push(
      "Use browser(open) + browser(snapshot) to get page data from JavaScript-rendered sites."
    );
  }

  if (tools.includes("artifacts")) {
    lines.push("");
    lines.push("### Artifacts Workflow");
    lines.push("For complex projects, persist progress in artifacts (.md.resolved).");
    lines.push(
      "Use artifacts create/list/read/update/check to maintain task checklists, implementation plans, and walkthroughs."
    );
  }

  lines.push("");
  return lines;
}

function buildRuntimeSection(
  modelDisplay: string,
  runtimeInfo?: SystemPromptParams["runtimeInfo"]
): string[] {
  // Build Cybara-style runtime line
  const parts: string[] = [];

  if (runtimeInfo?.agentId) {
    parts.push(`agent=${runtimeInfo.agentId}`);
  }
  if (runtimeInfo?.host) {
    parts.push(`host=${runtimeInfo.host}`);
  } else {
    parts.push("host=cybara");
  }

  const os =
    runtimeInfo?.os ||
    (typeof process !== "undefined" && process.platform ? `${process.platform}` : "unknown");
  const arch =
    runtimeInfo?.arch ||
    (typeof process !== "undefined" && process.arch ? process.arch : "unknown");
  parts.push(`os=${os} (${arch})`);

  const nodeVersion =
    runtimeInfo?.node ||
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

  return ["## Runtime", `Runtime: ${parts.join(" | ")}`, ""];
}

function buildMessagingSection(params: {
  isMinimal: boolean;
  tools: string[];
  inlineButtonsEnabled?: boolean;
  runtimeChannel?: string;
  messageToolHints?: string[];
}): string[] {
  if (params.isMinimal) {
    return [];
  }

  const hasMessageTool = params.tools.includes("message");
  const lines = [
    "## Messaging",
    "- Reply in current session → automatically routes to the source channel (Signal, Telegram, etc.)",
    "- Cross-session messaging → use sessions_send(sessionKey, message)",
    "- Never use exec/curl for provider messaging; Cybara handles all routing internally.",
  ];

  if (hasMessageTool) {
    lines.push(
      "",
      "### message tool",
      "- Use `message` for proactive sends + channel actions (polls, reactions, etc.).",
      "- For `action=send`, include `target` (or `to`) and `message` (or `text`).",
      "- For reactions, use `action=react|unreact` with `channel` (`discord`, `slack`, or `telegram`), plus `target`, `messageId`, and `emoji`.",
      `- If you use \`message\` (\`action=send\`) to deliver your user-visible reply, respond with ONLY: ${SILENT_REPLY_TOKEN} (avoid duplicate replies).`
    );

    if (params.inlineButtonsEnabled) {
      lines.push(
        "- Inline buttons supported. Use `action=send` with `buttons=[[{text,callback_data}]]` (callback_data routes back as a user message)."
      );
    } else if (params.runtimeChannel) {
      lines.push(
        `- Inline buttons not enabled for ${params.runtimeChannel}. If you need them, configure channel capabilities.`
      );
    }

    // Add any extra message tool hints
    if (params.messageToolHints && params.messageToolHints.length > 0) {
      lines.push(...params.messageToolHints);
    }
  }

  lines.push("");
  return lines;
}

function buildReplyTagsSection(): string[] {
  return [
    "## Reply Tags",
    "To request a native reply/quote on supported surfaces, include one tag in your reply:",
    "- [[reply_to_current]] replies to the triggering message.",
    "- [[reply_to:<id>]] replies to a specific message id when you have it.",
    "Whitespace inside the tag is allowed (e.g. [[ reply_to_current ]] / [[ reply_to: 123 ]]).",
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

// ============================================
// NEW CYBARA PARITY SECTIONS
// ============================================

function buildSandboxSection(
  sandboxInfo: NonNullable<SystemPromptParams["sandboxInfo"]>
): string[] {
  if (!sandboxInfo.enabled) {
    return [];
  }

  const lines = [
    "## Sandbox",
    "You are running in a sandboxed runtime (tools execute in an isolated host/container sandbox).",
    "Some tools may be unavailable due to sandbox policy.",
    "Sub-agents stay sandboxed (no elevated/host access). Need outside-sandbox read/write? Don't spawn; ask first.",
  ];

  if (sandboxInfo.workspaceDir) {
    lines.push(`Sandbox workspace: ${sandboxInfo.workspaceDir}`);
  }

  if (sandboxInfo.workspaceAccess) {
    let accessLine = `Agent workspace access: ${sandboxInfo.workspaceAccess}`;
    if (sandboxInfo.agentWorkspaceMount) {
      accessLine += ` (mounted at ${sandboxInfo.agentWorkspaceMount})`;
    }
    lines.push(accessLine);
  }

  if (sandboxInfo.browserBridgeUrl) {
    lines.push("Sandbox browser: enabled.");
  }

  if (sandboxInfo.browserNoVncUrl) {
    lines.push(`Sandbox browser observer (noVNC): ${sandboxInfo.browserNoVncUrl}`);
  }

  if (sandboxInfo.hostBrowserAllowed === true) {
    lines.push("Host browser control: allowed.");
  } else if (sandboxInfo.hostBrowserAllowed === false) {
    lines.push("Host browser control: blocked.");
  }

  if (sandboxInfo.elevated?.allowed) {
    lines.push(
      "Elevated exec is available for this session.",
      "User can toggle with /elevated on|off|ask|full.",
      "You may also send /elevated on|off|ask|full when needed.",
      `Current elevated level: ${sandboxInfo.elevated.defaultLevel} (ask runs exec on host with approvals; full auto-approves).`
    );
  }

  lines.push("");
  return lines;
}

function buildReactionsSection(
  reactionGuidance: NonNullable<SystemPromptParams["reactionGuidance"]>
): string[] {
  const { level, channel } = reactionGuidance;

  const guidanceText =
    level === "minimal"
      ? [
          `Reactions are enabled for ${channel} in MINIMAL mode.`,
          "React ONLY when truly relevant:",
          "- Acknowledge important user requests or confirmations",
          "- Express genuine sentiment (humor, appreciation) sparingly",
          "- Avoid reacting to routine messages or your own replies",
          "Guideline: at most 1 reaction per 5-10 exchanges.",
        ].join("\n")
      : [
          `Reactions are enabled for ${channel} in EXTENSIVE mode.`,
          "Feel free to react liberally:",
          "- Acknowledge messages with appropriate emojis",
          "- Express sentiment and personality through reactions",
          "- React to interesting content, humor, or notable events",
          "- Use reactions to confirm understanding or agreement",
          "Guideline: react whenever it feels natural.",
        ].join("\n");

  return ["## Reactions", guidanceText, ""];
}

function buildDocsSection(docsPath?: string): string[] {
  if (!docsPath?.trim()) {
    return [];
  }

  return [
    "## Documentation",
    `Cybara docs: ${docsPath}`,
    "For platform behavior, commands, config, or architecture: consult local docs first.",
    "When diagnosing issues, run `cybara status` yourself when possible; only ask the user if you lack access.",
    "",
  ];
}

/**
 * Agent type presets - similar to Cybara's agent types
 */

// Common tool guidance added to all agent types (Cybara pattern)
const TOOL_GUIDANCE = `

## Tool Use
Use available tools when they improve accuracy or unblock execution.
- Default: do not narrate routine, low-risk tool calls.
- For web data: browser({action:'open', url:'...'}) -> browser({action:'snapshot'}) -> extract and respond.
- Do not invent unavailable tools or commands.`;

export const AGENT_TYPE_PROMPTS: Record<string, string> = {
  main: `You are a helpful, practical AI assistant. Be clear, direct, and useful.

Be concise when possible and detailed when needed.${TOOL_GUIDANCE}`,

  research: `You are a research-focused AI assistant. Your goal is to find information, analyze sources, and provide comprehensive answers.

Distinguish verified facts from speculation and cite sources when useful.${TOOL_GUIDANCE}`,

  coder: `You are a coding-focused AI assistant. Help with software development, debugging, code review, and technical problems.

Write clean, working code and explain tradeoffs when they matter.${TOOL_GUIDANCE}`,

  planner: `You are a planning-focused AI assistant. Help break down complex tasks into actionable steps.

Think systematically, propose practical options, and prioritize by impact.${TOOL_GUIDANCE}`,

  ops: `You are an operations-focused AI assistant. Help with system administration, DevOps, and automation tasks.

Be careful with production systems, verify before changes, and favor safe rollouts.${TOOL_GUIDANCE}`,
};

/**
 * Get default system prompt for an agent type
 */
export function getDefaultSystemPrompt(agentType: string): string {
  return AGENT_TYPE_PROMPTS[agentType] || AGENT_TYPE_PROMPTS.main;
}

/**
 * Model alias resolution - matches Cybara's model aliases
 */
export function resolveModelAlias(modelId: string, provider?: string): string {
  const aliases: Record<string, string> = {
    // MiniMax aliases
    "minimax-m2.5": "MiniMax-M2.5",
    "minimax-m2.5-highspeed": "MiniMax-M2.5-highspeed",
    "minimax-m2.5-lightning": "MiniMax-M2.5-Lightning",
    "minimax-m2": "MiniMax-M2",
    "minimax-m2.1": "MiniMax-M2.1",
    "minimax-m2.1-highspeed": "MiniMax-M2.1-highspeed",
    "minimax-m2.1-lightning": "MiniMax-M2.1-lightning",
    minimax: "MiniMax-M2.5",

    // OpenAI aliases
    "gpt-4o": "gpt-4o",
    "gpt-4": "gpt-4o",
    "gpt-5": "gpt-5.2",
    "gpt-5-codex": "gpt-5.3-codex",
    "gpt-5.2-codex": "gpt-5.3-codex",
    "openai-codex/gpt-5.2-codex": "gpt-5.3-codex",
    o1: "o1",
    o3: "o3",

    // Anthropic aliases
    "claude-opus": "claude-opus-4-6",
    "claude-sonnet": "claude-sonnet-4-6",
    "claude-haiku": "claude-haiku-4-5",
    "claude-opus-4.6": "claude-opus-4-6",
    "claude-sonnet-4.6": "claude-sonnet-4-6",
    "anthropic/claude-opus-4-6": "claude-opus-4-6",
    "anthropic/claude-sonnet-4-6": "claude-sonnet-4-6",
    opus: "claude-opus-4-6",
    sonnet: "claude-sonnet-4-6",
    haiku: "claude-haiku-4-5",

    // Google aliases
    "gemini-2-flash": "gemini-2.0-flash-exp",
    "gemini-3-pro": "gemini-3-pro-preview",
    "gemini-3-flash": "gemini-3-flash-preview",

    // Generic aliases
    default: "MiniMax-M2.5",
    fast: "MiniMax-M2.5-highspeed",
    smart: "claude-opus-4-6",
  };

  const key = `${provider || ""}/${modelId}`.toLowerCase();
  return aliases[key] || aliases[modelId.toLowerCase()] || modelId;
}
