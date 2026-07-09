import type { ToolDefinition } from "./database";

const baseTools = ["todo", "clarify"];
const codeReadTools = [
  "read",
  "file_search",
  "grep",
  "workspace_index_search",
  "exec",
  "process",
  "git",
  "lsp_diagnostics",
  "lsp_definition",
  "lsp_references",
  "lsp_hover",
  "lsp_languages",
];
const codeWriteTools = ["write", "edit", "apply_patch", "artifacts"];
const browserTools = ["browser", "web_fetch", "web_search", "x_search", "http", "data"];
const memoryTools = ["memory_search", "memory_get", "memory_save", "memory_context"];
const sessionTools = [
  "sessions_spawn",
  "sessions_send",
  "sessions_history",
  "sessions_list",
  "session_status",
  "agents_list",
  "mixture_of_agents",
];
const walletTools = ["wallet"];
const mediaTools = [
  "image",
  "image_generate",
  "video_generate",
  "video_frames",
  "music_generate",
  "pdf",
  "ocr",
  "transcribe",
  "tts",
  "voice_call",
];
const channelTools = ["message", "telegram_media"];
const automationTools = ["cron", "kanban_show", "kanban_list", "kanban_create", "kanban_complete"];
const computerTools = [
  "computer_use",
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
  "screenshot",
  "screen_capture",
  "desktop_screenshot",
  "capture_screen",
  "take_screenshot",
];
const utilityTools = ["calc", "convert", "weather", "clipboard", "env"];
const platformTools = ["gateway", "tool_search", "tool_describe", "tool_call"];
const codeExecutionTools = ["execute_code"];

function includesAny(text: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(text));
}

function isWalletIntent(text: string): boolean {
  return includesAny(text, [
    /\b(wallet|balance|send|swap|trade|price|quote|address|transaction|sign|portfolio|chain|solana|ethereum|crypto|btc|bitcoin|eth|erc20|spl|jupiter|uniswap|pyth|chainlink)\b/,
    /\b(token|tokens)\b.*\b(send|swap|trade|price|quote|balance|address|transaction|wallet|solana|ethereum|crypto|jupiter|uniswap)\b/,
    /\b(send|swap|trade|price|quote|balance)\b.*\b(token|tokens)\b/,
  ]);
}

function latestUserText(messages: Array<{ role?: string; content?: string }> = []): string {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role === "user" && typeof message.content === "string") {
      return message.content;
    }
  }
  return "";
}

function addTools(target: Set<string>, names: string[]): void {
  for (const name of names) target.add(name);
}

export function selectBuiltinToolNamesForIntent(
  messages: Array<{ role?: string; content?: string }> = []
): Set<string> {
  const latest = latestUserText(messages);
  const recent = messages
    .filter((message) => message?.role === "user")
    .slice(-6)
    .map((message) => (typeof message.content === "string" ? message.content : ""))
    .join("\n")
    .toLowerCase();
  const text = `${latest}\n${recent}`.toLowerCase();
  const selected = new Set<string>();

  if (
    includesAny(text, [
      /\b(code|repo|repository|file|files|folder|directory|source|bug|fix|implement|refactor|test|tests|ci|build|lint|typecheck|tsc|biome|knip|git|branch|commit|diff|pr|pull request|workspace|terminal|shell|command|exec|logs?)\b/,
      /\b(read|write|edit|patch|grep|search)\b.*\b(file|code|repo|workspace)\b/,
      /\/users\/|src\/|apps\/|tests\/|package\.json|cargo\.toml|\.ts\b|\.tsx\b|\.swift\b|\.rs\b/,
    ])
  ) {
    addTools(selected, [...baseTools, ...codeReadTools]);
    if (
      includesAny(text, [
        /\b(fix|implement|refactor|write|edit|patch|apply patch|change|update|modify|create|delete|remove|add|repair)\b/,
        /\bcommit|pr|pull request\b/,
      ])
    ) {
      addTools(selected, codeWriteTools);
    }
  }

  if (
    includesAny(text, [
      /\b(web|website|browser|page|url|http|https|search|google|fetch|scrape|crawl|open)\b/,
      /\bcurrent|latest|today|news|docs?|documentation|github\.com\b/,
    ])
  ) {
    addTools(selected, [...baseTools, ...browserTools]);
  }

  if (includesAny(text, [/\b(memory|remember|recall|knowledge|notes?)\b/])) {
    addTools(selected, [...baseTools, ...memoryTools]);
  }

  if (includesAny(text, [/\b(subagent|agent|session|background|parallel|delegate|spawn)\b/])) {
    addTools(selected, [...baseTools, ...sessionTools, ...codeReadTools]);
    if (includesAny(text, [/\b(fix|implement|write|edit|patch|change|update|modify)\b/])) {
      addTools(selected, codeWriteTools);
    }
  }

  if (isWalletIntent(text)) {
    addTools(selected, [...baseTools, ...walletTools]);
  }

  if (
    includesAny(text, [
      /\b(image|photo|screenshot|screen|ocr|pdf|video|audio|voice|tts|stt|transcribe|generate.*image|generate.*video|music)\b/,
    ])
  ) {
    addTools(selected, [...baseTools, ...mediaTools]);
  }

  if (
    includesAny(text, [
      /\b(discord|telegram|slack|whatsapp|sms|email|channel|message|send a message)\b/,
    ])
  ) {
    addTools(selected, [...baseTools, ...channelTools]);
  }

  if (includesAny(text, [/\b(remind|schedule|cron|task|todo|kanban|plan)\b/])) {
    addTools(selected, [...baseTools, ...automationTools]);
  }

  if (
    includesAny(text, [
      /\b(computer|desktop|window|click|keyboard|mouse|app|focus|capture|screenshot)\b/,
    ])
  ) {
    addTools(selected, [...baseTools, ...computerTools]);
  }

  if (includesAny(text, [/\b(calculate|convert|weather|clipboard|environment|env)\b/])) {
    addTools(selected, [...baseTools, ...utilityTools]);
  }

  if (includesAny(text, [/\b(gateway|provider|mcp|tool search|tool describe|call tool)\b/])) {
    addTools(selected, [...baseTools, ...platformTools]);
  }

  if (includesAny(text, [/\b(execute code|run code|evaluate code|eval|javascript|typescript)\b/])) {
    addTools(selected, [...baseTools, ...codeExecutionTools]);
  }

  return selected;
}

export function selectBuiltinToolsForIntent(
  tools: ToolDefinition[],
  messages: Array<{ role?: string; content?: string }> = []
): ToolDefinition[] {
  const selected = selectBuiltinToolNamesForIntent(messages);
  if (selected.size === 0) return [];
  return tools.filter((tool) => selected.has(tool.name));
}
