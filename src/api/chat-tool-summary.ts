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

const NON_SUBSTANTIVE_COMPLETION_PATTERN =
  /^\s*(?:task\s+)?(?:complete|completed|done|finished|fixed|implemented|resolved)\s*[.!]*\s*$/i;
const LITERAL_COMPLETION_REQUEST_PATTERN =
  /\b(?:answer|output|reply|respond|return|say)\s+(?:with\s+)?(?:(?:only|exactly|just|verbatim)\s+)?["'`]*(?:complete|completed|done|finished)["'`]*[.!]?\s*$/i;

export function isNonSubstantiveAssistantCompletion(content: string): boolean {
  const trimmed = content.trim();
  return trimmed.length === 0 || NON_SUBSTANTIVE_COMPLETION_PATTERN.test(trimmed);
}

export function shouldRecoverNonSubstantiveAssistantCompletion(
  userMessage: string,
  assistantContent: string,
  toolCallCount: number
): boolean {
  if (toolCallCount > 0 || LITERAL_COMPLETION_REQUEST_PATTERN.test(userMessage.trim())) {
    return false;
  }
  return isNonSubstantiveAssistantCompletion(assistantContent);
}

export function buildNoUsableAssistantResponseMessage(): string {
  return "The model returned no usable response for this turn, and no tool actions were executed.";
}

export function requiredDirectToolForMessage(message: string): string | undefined {
  const lower = message.trim().toLowerCase();
  const asksForExplanation =
    /^(?:what|why|how)\s+(?:is|are|does|do|can)\b/.test(lower) ||
    /^(?:explain|describe|define)\b/.test(lower);
  if (asksForExplanation) return undefined;

  const namesComputerUse = /\bcomputer[-_\s]?use\b/.test(lower);
  const namesDesktop = /\b(desktop|screen)\b/.test(lower);
  const requestsDesktopAction =
    /\b(capture|screenshot|move|click|type|scroll|drag|focus|control|open|close|list)\b/.test(
      lower
    );
  if ((namesComputerUse || namesDesktop) && requestsDesktopAction) {
    return "computer_use";
  }

  const requestsChannelAction = /\b(send|post|publish|broadcast|react)\b/.test(lower);
  const namesChannelDestination =
    /\b(discord|slack|telegram|whatsapp|signal|imessage|channel)\b/.test(lower) ||
    /(?:^|\s)#[a-z0-9_-]+\b/.test(lower);
  if (requestsChannelAction && namesChannelDestination) {
    return "message";
  }

  const requestsExecution = /\b(run|execute|use|call|invoke)\b/.test(lower);
  const namesExec = /\b(?:exec|command)(?:\s+tool)?\b/.test(lower);
  const namesShellCommand =
    /\b(?:shell|terminal|powershell|pwsh|bash|zsh)\s+command\b/.test(lower) ||
    /\b(?:run|execute)\s+(?:the\s+)?command\b/.test(lower);
  return requestsExecution && (namesExec || namesShellCommand) ? "exec" : undefined;
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
