import { isCodeMutationRequest } from "../core/message-action";

export interface ToolCallResultLike {
  name: string;
  result?: unknown;
}

export interface ProcessActivityLike {
  phase: string;
  toolName?: string;
}

export interface ToolCallOutcome {
  status: "completed" | "failed";
  error?: string;
}

const TOOL_RESULT_PREVIEW_LIMIT = 220;

function truncate(value: string, limit = TOOL_RESULT_PREVIEW_LIMIT): string {
  const compact = value.replace(/\s+/g, " ").trim();
  if (compact.length <= limit) return compact;
  return `${compact.slice(0, Math.max(0, limit - 3))}...`;
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export function classifyToolCallResult(result: unknown): ToolCallOutcome {
  if (!result || typeof result !== "object" || Array.isArray(result)) {
    return { status: "completed" };
  }
  const record = result as Record<string, unknown>;
  const error = typeof record.error === "string" ? record.error.trim() : "";
  if (!error) return { status: "completed" };
  return { status: "failed", error };
}

function hasUsableWebResult(toolCall: ToolCallResultLike): boolean {
  if (toolCall.name !== "web_search" && toolCall.name !== "web_fetch") return false;
  if (classifyToolCallResult(toolCall.result).status === "failed") return false;
  if (typeof toolCall.result === "string") return toolCall.result.trim().length > 0;
  if (!toolCall.result || typeof toolCall.result !== "object" || Array.isArray(toolCall.result)) {
    return false;
  }
  const result = toolCall.result as Record<string, unknown>;
  if (toolCall.name === "web_search") {
    return (
      (Array.isArray(result.results) && result.results.length > 0) ||
      (typeof result.count === "number" && result.count > 0)
    );
  }
  return [result.content, result.text, result.markdown, result.output].some(
    (value) => typeof value === "string" && value.trim().length > 0
  );
}

export function suppressRecoveredWebFailureActivities<T extends ProcessActivityLike>(
  activities: T[] | undefined,
  toolCalls: ToolCallResultLike[]
): T[] | undefined {
  if (!activities?.length || !toolCalls.some(hasUsableWebResult)) return activities;
  return activities.filter(
    (activity) =>
      activity.phase !== "error" ||
      (activity.toolName !== "web_search" && activity.toolName !== "web_fetch")
  );
}

function summarizeUnknownResult(value: unknown): string {
  if (value === null || value === undefined) return "No output";
  if (typeof value === "string") return truncate(value);
  if (typeof value === "number" || typeof value === "boolean") return String(value);

  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    if (typeof obj.error === "string" && obj.error.trim()) {
      return `Error: ${truncate(obj.error)}`;
    }
    if (typeof obj.message === "string" && obj.message.trim()) {
      return truncate(obj.message);
    }
    if (typeof obj.path === "string" && typeof obj.content === "string") {
      const lineCount = obj.content.split(/\r?\n/).length;
      return `Read ${obj.path} (${lineCount} lines)`;
    }
    if (typeof obj.filePath === "string") {
      return `Wrote ${obj.filePath}`;
    }
    if (typeof obj.output === "string" && obj.output.trim()) {
      return truncate(obj.output);
    }
    if (typeof obj.status === "string" && typeof obj.txid === "string") {
      return `${obj.status}: ${obj.txid}`;
    }
  }

  return truncate(safeStringify(value));
}

export function buildToolExecutionFallbackMessage(toolCalls: ToolCallResultLike[]): string {
  if (!toolCalls.length) {
    return "No tool actions were executed.";
  }

  const heading = `Completed ${toolCalls.length} tool call${toolCalls.length === 1 ? "" : "s"}:`;
  const bulletLines = toolCalls.slice(0, 8).map((toolCall) => {
    const preview = summarizeUnknownResult(toolCall.result);
    return `- \`${toolCall.name}\`: ${preview || "completed"}`;
  });
  const extraCount = toolCalls.length - bulletLines.length;
  if (extraCount > 0) {
    bulletLines.push(`- ...and ${extraCount} more tool call${extraCount === 1 ? "" : "s"}.`);
  }
  return `${heading}\n${bulletLines.join("\n")}`;
}

const ACTION_VERBS = new Set([
  "add",
  "analyze",
  "audit",
  "build",
  "check",
  "continue",
  "create",
  "debug",
  "edit",
  "execute",
  "explore",
  "fix",
  "implement",
  "inspect",
  "install",
  "patch",
  "refactor",
  "research",
  "review",
  "run",
  "scan",
  "search",
  "test",
  "update",
  "write",
]);

const WORK_CONTEXT_TERMS = new Set([
  "agent",
  "api",
  "bug",
  "channel",
  "chat",
  "code",
  "config",
  "detector",
  "discord",
  "docs",
  "file",
  "folder",
  "lint",
  "model",
  "provider",
  "repo",
  "session",
  "skill",
  "test",
  "ui",
  "wallet",
]);

const NON_ACTIONABLE_PATTERNS = [
  /^\s*(hi|hello|hey|yo)\b/i,
  /^\s*(thanks|thank you)\b/i,
  /^\s*(what can you do|who are you)\b/i,
];

export function shouldEnforceToolUseForMessage(message: string): boolean {
  const trimmed = message.trim();
  if (trimmed.length < 8) return false;
  if (NON_ACTIONABLE_PATTERNS.some((pattern) => pattern.test(trimmed))) {
    return false;
  }
  if (isCodeMutationRequest(trimmed)) return true;

  const lower = trimmed.toLowerCase();
  const tokens = lower.split(/[^a-z0-9_.:/-]+/).filter(Boolean);
  const hasActionVerb = tokens.some((token) => ACTION_VERBS.has(token));
  const hasWorkContext =
    tokens.some((token) => WORK_CONTEXT_TERMS.has(token)) ||
    /[./][a-z0-9_-]/i.test(trimmed) ||
    /\bhttps?:\/\//i.test(trimmed);

  return hasActionVerb && hasWorkContext;
}

export function requiredDirectToolForMessage(message: string): string | undefined {
  const lower = message.trim().toLowerCase();
  const namesComputerUse = /\bcomputer[-_\s]?use\b/.test(lower);
  const namesDesktop = /\b(desktop|screen)\b/.test(lower);
  const requestsDesktopAction =
    /\b(capture|screenshot|move|click|type|scroll|drag|focus|control|open|close|list)\b/.test(
      lower
    );
  return (namesComputerUse || namesDesktop) && requestsDesktopAction ? "computer_use" : undefined;
}

const ARTIFACT_INTENT_PATTERNS = [
  /\bartifact(?:s)?\b/i,
  /\.md\.resolved\b/i,
  /\bimplementation\.md\b/i,
  /\bwalkthrough\.md\b/i,
  /\btask\s+checklist\b/i,
  /\bartifact\s+report\b/i,
];

export function shouldPreferArtifactsForMessage(message: string): boolean {
  const trimmed = message.trim();
  if (trimmed.length < 6) return false;
  return ARTIFACT_INTENT_PATTERNS.some((pattern) => pattern.test(trimmed));
}
