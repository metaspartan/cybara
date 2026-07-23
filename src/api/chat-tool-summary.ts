export interface ToolCallResultLike {
  name: string;
  args?: Record<string, unknown>;
  result?: unknown;
  status?: "pending" | "executing" | "completed" | "failed";
}

export interface ProcessActivityLike {
  phase: string;
  toolName?: string;
}

export interface ToolCallOutcome {
  status: "completed" | "failed";
  error?: string;
}

export type AssistantEvidenceIssue =
  | "missing_clarification"
  | "missing_action_evidence"
  | "plan_only"
  | "unfinished_execution"
  | "unsupported_completion"
  | "unsupported_verification";

export interface AssistantEvidenceContext {
  allowPlanOnly?: boolean;
  requireActionEvidence?: boolean;
  userMessage?: string;
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
  if (error) return { status: "failed", error };
  const exitCode =
    typeof record.exitCode === "number"
      ? record.exitCode
      : typeof record.exit_code === "number"
        ? record.exit_code
        : undefined;
  if (exitCode !== undefined && exitCode !== 0) {
    const detail = [record.stderr, record.output, record.message].find(
      (value) => typeof value === "string" && value.trim().length > 0
    );
    return {
      status: "failed",
      error: typeof detail === "string" ? truncate(detail) : `Command exited with code ${exitCode}`,
    };
  }
  const status = typeof record.status === "string" ? record.status.trim().toLowerCase() : "";
  if (
    ["failed", "error", "blocked", "denied", "cancelled", "canceled", "timed_out"].includes(status)
  ) {
    const detail = [record.message, record.stderr, record.output].find(
      (value) => typeof value === "string" && value.trim().length > 0
    );
    return {
      status: "failed",
      error: typeof detail === "string" ? truncate(detail) : `Tool finished with status ${status}`,
    };
  }
  if (record.ok === false || record.success === false) {
    const detail = [record.message, record.stderr, record.output].find(
      (value) => typeof value === "string" && value.trim().length > 0
    );
    return {
      status: "failed",
      error: typeof detail === "string" ? truncate(detail) : "Tool reported failure",
    };
  }
  return { status: "completed" };
}

export function isSuccessfulToolCall(toolCall: ToolCallResultLike): boolean {
  return (
    toolCall.status !== "failed" && classifyToolCallResult(toolCall.result).status === "completed"
  );
}

function hasUsableWebResult(toolCall: ToolCallResultLike): boolean {
  if (toolCall.name !== "web_search" && toolCall.name !== "web_fetch") return false;
  if (!isSuccessfulToolCall(toolCall)) return false;
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

const NON_EVIDENCE_TOOLS = new Set([
  "agents_list",
  "clarify",
  "session_status",
  "sessions_list",
  "todo",
  "tool_describe",
  "tool_search",
]);

const EXECUTION_EVIDENCE_TOOLS = new Set(["exec", "execute_code", "process"]);

const MUTATION_EVIDENCE_TOOLS = new Set([
  "account_connector_write",
  "apply_patch",
  "artifacts",
  "browser",
  "canvas",
  "computer_use",
  "cron",
  "edit",
  "exec",
  "execute_code",
  "git",
  "home_assistant",
  "image_generate",
  "kanban_block",
  "kanban_comment",
  "kanban_complete",
  "kanban_create",
  "kanban_link",
  "kanban_unblock",
  "memory_save",
  "memory_save_durable",
  "message",
  "mobile_simulator",
  "music_generate",
  "pdf",
  "phone",
  "sandbox_run",
  "skill_save",
  "telegram_media",
  "video_generate",
  "voice_call",
  "wallet",
  "write",
]);

const COMPLETION_CLAIM_PATTERNS = [
  /^\s*(?:all\s+)?(?:done|shipped|fixed|implemented|resolved)\b/im,
  /\bI(?:'ve| have)\s+(?:added|changed|completed|created|fixed|implemented|refactored|removed|renamed|resolved|shipped|updated|wired)\b/i,
  /\b(?:changes?|cleanup|fix(?:es)?|implementation|refactor)\s+(?:is|are|was|were)\s+(?:complete|completed|done|finished|implemented|shipped)\b/i,
  /#{1,4}\s+(?:what I (?:changed|fixed|implemented|shipped)|implemented|changes shipped)\b/i,
];

const VERIFICATION_CLAIM_PATTERNS = [
  /\b(?:all\s+)?(?:builds?|checks?|tests?|typechecks?|lint(?:ing)?)\s+(?:(?:is|are|was|were|still)\s+)?(?:clean|green|pass(?:ed|ing)?)\b/i,
  /\b(?:verified|validated|confirmed|tested)\s+(?:end[- ]to[- ]end|successfully|the\s+(?:build|change|fix|result|simulator|implementation))\b/i,
  /\b\d[\d,]*\s*\/\s*\d[\d,]*\s+(?:checks?|tests?|invariants?|cases?)\s+(?:green|pass(?:ed)?)\b/i,
  /\b(?:build|check|test|typecheck|lint)\s*:\s*(?:clean|green|pass(?:ed)?)\b/i,
];

const EXECUTION_VERIFICATION_CLAIM_PATTERNS = [
  /\b(?:all\s+)?(?:builds?|checks?|tests?|typechecks?|lint(?:ing)?)\s+(?:(?:is|are|was|were|still)\s+)?(?:clean|green|pass(?:ed|ing)?)\b/i,
  /\b\d[\d,]*\s*\/\s*\d[\d,]*\s+(?:checks?|tests?|invariants?|cases?)\s+(?:green|pass(?:ed)?)\b/i,
  /\b(?:build|check|test|typecheck|lint)\s*:\s*(?:clean|green|pass(?:ed)?)\b/i,
];

const HIDDEN_CLARIFICATION_PATTERNS = [
  /^\s*(?:I\s+)?asked[.!\s]*$/i,
  /\bI asked\b[^?]*(?:waiting|wait)\s+for\s+(?:your\s+)?(?:answer|response)\b/i,
  /^\s*(?:waiting|wait)\s+for\s+(?:your\s+)?(?:answer|response)\b[^?]*$/i,
];

const UNFINISHED_EXECUTION_PATTERNS = [
  /\bnext\s+(?:concrete\s+)?(?:plan|steps?)\b[\s\S]{0,1600}\b(?:executing|fixing|continuing|working)\s+now\b/i,
  /\bI (?:have not|haven't) yet\b[\s\S]{0,1600}\b(?:executing|fixing|continuing|working)\s+now\b/i,
];

const IMPLEMENTATION_REQUEST_PATTERN =
  /(?:^|[.!?]\s+)(?:please\s+)?(?:continue|implement|build|create|add|fix|update|improve|integrate|deploy|set\s*up|configure|change|refactor|install|push|publish)\b/i;
const EXPLICIT_PLANNING_REQUEST_PATTERN =
  /^\s*(?:please\s+)?(?:create|draft|write|give|provide|propose|outline|design)\s+(?:me\s+)?(?:a|an|the)?\s*(?:implementation\s+|technical\s+)?(?:plan|roadmap|proposal|outline)\b/i;
const PLANNING_FOLLOW_THROUGH_PATTERN =
  /\b(?:and|then)\s+(?:implement|build|execute|apply|make|start|do|continue)\b/i;
const PLAN_ONLY_RESPONSE_PATTERN =
  /\b(?:next\s+(?:phase\s+)?plan|implementation plan|action plan|proposed plan|roadmap|next steps?)\b/i;
const PLANNED_ACTION_PATTERN =
  /\b(?:add|build|configure|create|deploy|generate|implement|integrate|set\s*up|support|update|use)\b/gi;
const REQUEST_CLAUSE_BOUNDARY = String.raw`(?:^|[.!?;,\n]\s*)`;
const REQUEST_COURTESY_PREFIX = String.raw`(?:(?:can|could|would)\s+you\s+)?(?:please\s+)?`;
const ACTION_EXECUTION_REQUEST_PATTERN = new RegExp(
  `${REQUEST_CLAUSE_BOUNDARY}${REQUEST_COURTESY_PREFIX}(?:let'?s\s+)?(?:continue|proceed|go\\s+ahead|do\\s+it|keep\\s+going|finish|implement|build|create|add|fix|update|improve|integrate|deploy|set\\s*up|configure|change|refactor|install|remove|delete|move|copy|import|paste|push|publish)\\b`,
  "i"
);
const EVIDENCE_REQUEST_PATTERN = new RegExp(
  `${REQUEST_CLAUSE_BOUNDARY}${REQUEST_COURTESY_PREFIX}(?:let'?s\s+)?(?:review|audit|inspect|investigate|diagnose|test|verify|run|research|search|look\\s+into|analyze|check|compare)\\b`,
  "i"
);
const EVIDENCE_REQUEST_TARGET_PATTERN =
  /\b(?:app|application|build|chat|cli|code|codebase|file|gateway|implementation|project|provider|repo|repository|session|site|system|test|tool|tui|ui|workspace)\b|https?:\/\//i;

function successfulToolCalls(toolCalls: ToolCallResultLike[]): ToolCallResultLike[] {
  return toolCalls.filter(isSuccessfulToolCall);
}

export function isEvidenceToolCall(toolCall: ToolCallResultLike): boolean {
  return !NON_EVIDENCE_TOOLS.has(toolCall.name);
}

export function requiresToolEvidenceForMessage(message: string): boolean {
  const request = message.trim();
  if (!request || LITERAL_COMPLETION_REQUEST_PATTERN.test(request)) return false;
  if (
    EXPLICIT_PLANNING_REQUEST_PATTERN.test(request) &&
    !PLANNING_FOLLOW_THROUGH_PATTERN.test(request)
  ) {
    return false;
  }
  if (ACTION_EXECUTION_REQUEST_PATTERN.test(request)) return true;
  return EVIDENCE_REQUEST_PATTERN.test(request) && EVIDENCE_REQUEST_TARGET_PATTERN.test(request);
}

function hasPattern(content: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(content));
}

function hasSuccessfulClarification(toolCalls: ToolCallResultLike[]): boolean {
  return successfulToolCalls(toolCalls).some((toolCall) => toolCall.name === "clarify");
}

function hasSuccessfulCompletionEvidence(
  content: string,
  toolCalls: ToolCallResultLike[]
): boolean {
  return successfulToolCalls(toolCalls).some(
    (toolCall) =>
      MUTATION_EVIDENCE_TOOLS.has(toolCall.name) ||
      (toolCall.name === "todo" && /\b(?:plan|task list|todo)\b/i.test(content))
  );
}

function hasSuccessfulVerificationEvidence(
  toolCalls: ToolCallResultLike[],
  requiresExecution: boolean
): boolean {
  return successfulToolCalls(toolCalls).some((toolCall) =>
    requiresExecution
      ? EXECUTION_EVIDENCE_TOOLS.has(toolCall.name)
      : !NON_EVIDENCE_TOOLS.has(toolCall.name)
  );
}

function isPlanOnlyImplementationResponse(
  userMessage: string | undefined,
  assistantContent: string,
  toolCalls: ToolCallResultLike[]
): boolean {
  const request = userMessage?.trim() || "";
  if (!request || !IMPLEMENTATION_REQUEST_PATTERN.test(request)) return false;
  if (
    EXPLICIT_PLANNING_REQUEST_PATTERN.test(request) &&
    !PLANNING_FOLLOW_THROUGH_PATTERN.test(request)
  ) {
    return false;
  }
  if (
    successfulToolCalls(toolCalls).some((toolCall) => MUTATION_EVIDENCE_TOOLS.has(toolCall.name))
  ) {
    return false;
  }
  const actions = assistantContent.match(PLANNED_ACTION_PATTERN)?.length || 0;
  return PLAN_ONLY_RESPONSE_PATTERN.test(assistantContent) && actions >= 2;
}

export function findAssistantEvidenceIssue(
  assistantContent: string,
  toolCalls: ToolCallResultLike[],
  context: AssistantEvidenceContext = {}
): AssistantEvidenceIssue | undefined {
  const visibleContent = assistantContent.trim();
  if (!visibleContent) return undefined;
  if (
    hasPattern(visibleContent, HIDDEN_CLARIFICATION_PATTERNS) &&
    !visibleContent.includes("?") &&
    !hasSuccessfulClarification(toolCalls)
  ) {
    return "missing_clarification";
  }
  if (hasPattern(visibleContent, UNFINISHED_EXECUTION_PATTERNS)) {
    return "unfinished_execution";
  }
  if (
    context.allowPlanOnly !== true &&
    isPlanOnlyImplementationResponse(context.userMessage, visibleContent, toolCalls)
  ) {
    return "plan_only";
  }
  if (
    context.requireActionEvidence === true &&
    !toolCalls.some(isEvidenceToolCall) &&
    !visibleContent.includes("?")
  ) {
    return "missing_action_evidence";
  }
  if (
    hasPattern(visibleContent, COMPLETION_CLAIM_PATTERNS) &&
    !hasSuccessfulCompletionEvidence(visibleContent, toolCalls)
  ) {
    return "unsupported_completion";
  }
  if (
    hasPattern(visibleContent, VERIFICATION_CLAIM_PATTERNS) &&
    !hasSuccessfulVerificationEvidence(
      toolCalls,
      hasPattern(visibleContent, EXECUTION_VERIFICATION_CLAIM_PATTERNS)
    )
  ) {
    return "unsupported_verification";
  }
  return undefined;
}

interface ClarificationOption {
  label?: unknown;
  description?: unknown;
}

export function extractVisibleClarification(toolCalls: ToolCallResultLike[]): string | undefined {
  const clarification = [...toolCalls]
    .reverse()
    .find((toolCall) => toolCall.name === "clarify" && isSuccessfulToolCall(toolCall));
  if (!clarification?.result || typeof clarification.result !== "object") return undefined;
  const result = clarification.result as Record<string, unknown>;
  const question = typeof result.question === "string" ? result.question.trim() : "";
  if (!question) return undefined;
  const header = typeof result.header === "string" ? result.header.trim() : "";
  const options = Array.isArray(result.options)
    ? result.options
        .map((option, index) => {
          if (!option || typeof option !== "object") return undefined;
          const candidate = option as ClarificationOption;
          const label = typeof candidate.label === "string" ? candidate.label.trim() : "";
          const description =
            typeof candidate.description === "string" ? candidate.description.trim() : "";
          if (!label) return undefined;
          return `${index + 1}. **${label}**${description ? ` — ${description}` : ""}`;
        })
        .filter((option): option is string => Boolean(option))
    : [];
  return [header ? `**${header}**` : "", question, options.join("\n")].filter(Boolean).join("\n\n");
}

export function buildUnsupportedAssistantClaimMessage(issue: AssistantEvidenceIssue): string {
  if (issue === "missing_clarification") {
    return "The model said it asked a question, but no question was returned. No action was taken for this turn.";
  }
  if (issue === "unsupported_completion") {
    return "The model claimed the work was completed, but Cybara did not record a successful tool action that supports that claim. Treat this turn as incomplete.";
  }
  if (issue === "missing_action_evidence") {
    return "The model returned an answer for an actionable request, but Cybara did not record a tool attempt that supports the response. Treat this turn as incomplete.";
  }
  if (issue === "plan_only") {
    return "The model returned a plan instead of performing the requested work. No implementation action was completed for this turn.";
  }
  if (issue === "unfinished_execution") {
    return "The model stopped after describing unfinished work instead of completing it. Treat this turn as incomplete.";
  }
  return "The model claimed verification succeeded, but Cybara did not record a successful verification action. Treat this result as unverified.";
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
