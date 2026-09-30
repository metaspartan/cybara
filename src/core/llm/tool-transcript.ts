import { persistCompactedToolOutput } from "../tool-output-recovery";
import { estimateRequestValueChars } from "./context-estimate";

export const TOOL_RESULT_COMPACTION_NOTICE =
  "[compacted: earlier tool output elided to free context]";
export const MESSAGE_CONTENT_COMPACTION_NOTICE =
  "[compacted: earlier message content elided to free context]";
export const TOOL_CALL_ARGUMENTS_COMPACTION_NOTICE =
  "[compacted: earlier tool call arguments elided to free context]";

export const MAX_TOOL_CALL_ARGUMENT_CHARS = 6_000;
export const MAX_TOOL_CALL_PAYLOAD_CHARS_PER_MESSAGE = 20_000;
export const TOOL_CALL_RESULT_COMPACTION_NOTICE =
  "[compacted: earlier tool call result elided to free context]";
export const THINKING_COMPACTION_NOTICE =
  "[compacted: earlier thinking trace elided to free context]";

function elideMessageThinking(message: Record<string, unknown>): boolean {
  const thinking = message.thinking;
  if (typeof thinking !== "string") return false;
  if (!thinking.trim() || thinking === THINKING_COMPACTION_NOTICE) return false;
  message.thinking = THINKING_COMPACTION_NOTICE;
  return true;
}

function isElidedToolCallResult(value: unknown): boolean {
  return typeof value === "string" && value.startsWith(TOOL_CALL_RESULT_COMPACTION_NOTICE);
}

function timelineToolCallResultChars(toolCall: Record<string, unknown>): number {
  if (!("result" in toolCall) || isElidedToolCallResult(toolCall.result)) return 0;
  try {
    return JSON.stringify(toolCall.result ?? null).length;
  } catch {
    return 0;
  }
}

function timelineToolCallArgChars(toolCall: Record<string, unknown>): number {
  const args = toolCall.args;
  if (args === undefined || args === null) return 0;
  if (isElidedToolCallResult(args)) return 0;
  try {
    return JSON.stringify(args).length;
  } catch {
    return 0;
  }
}

function hasInFlightTimelineToolCall(toolCall: Record<string, unknown>): boolean {
  if (!("result" in toolCall)) return true;
  const status = toolCall.status;
  if (status === "pending" || status === "executing") return true;
  return !isElidedToolCallResult(toolCall.result) && timelineToolCallResultChars(toolCall) === 0;
}

function messageHasInFlightToolCalls(message: Record<string, unknown>): boolean {
  const toolCalls = message.tool_calls;
  if (!Array.isArray(toolCalls) || toolCalls.length === 0) return false;
  return toolCalls.some(
    (toolCall) =>
      !!toolCall && typeof toolCall === "object" && hasInFlightTimelineToolCall(toolCall)
  );
}

function collapseTimelineToolCallResults(message: Record<string, unknown>): boolean {
  const toolCalls = message.tool_calls;
  if (!Array.isArray(toolCalls)) return false;
  let changed = false;
  const nextToolCalls = toolCalls.map((toolCall) => {
    if (!toolCall || typeof toolCall !== "object") return toolCall;
    const typed = toolCall as Record<string, unknown>;
    const resultChars = timelineToolCallResultChars(typed);
    const argChars = timelineToolCallArgChars(typed);
    if (resultChars === 0 && argChars === 0) return toolCall;
    changed = true;
    return {
      ...typed,
      result: resultChars > 0 ? TOOL_CALL_RESULT_COMPACTION_NOTICE : typed.result,
      args: argChars > 0 ? TOOL_CALL_RESULT_COMPACTION_NOTICE : typed.args,
    };
  });
  if (!changed) return false;
  message.tool_calls = nextToolCalls;
  return true;
}

function toolCallPayloadChars(message: Record<string, unknown>): number {
  const toolCalls = message.tool_calls;
  if (!Array.isArray(toolCalls)) return 0;
  let total = 0;
  for (const toolCall of toolCalls) {
    if (!toolCall || typeof toolCall !== "object") continue;
    const typed = toolCall as Record<string, unknown>;
    const fn = typed.function;
    if (fn && typeof fn === "object") {
      const args = (fn as Record<string, unknown>).arguments;
      if (typeof args === "string") total += args.length;
      continue;
    }
    total += timelineToolCallResultChars(typed) + timelineToolCallArgChars(typed);
  }
  return total;
}

function collapseToolCallPayload(message: Record<string, unknown>): boolean {
  const toolCalls = message.tool_calls;
  if (!Array.isArray(toolCalls)) return false;
  let changed = false;
  message.tool_calls = toolCalls.map((toolCall) => {
    if (!toolCall || typeof toolCall !== "object") return toolCall;
    const typed = toolCall as Record<string, unknown>;
    const fn = typed.function;
    if (!fn || typeof fn !== "object") return toolCall;
    const fnTyped = fn as Record<string, unknown>;
    const args = fnTyped.arguments;
    if (typeof args !== "string" || args.length <= TOOL_CALL_ARGUMENTS_COMPACTION_NOTICE.length) {
      return toolCall;
    }
    changed = true;
    return { ...typed, function: { ...fnTyped, arguments: TOOL_CALL_ARGUMENTS_COMPACTION_NOTICE } };
  });
  return changed;
}

export function isElidedToolCallArguments(value: unknown): boolean {
  return typeof value === "string" && value.startsWith(TOOL_CALL_ARGUMENTS_COMPACTION_NOTICE);
}

function compactToolCallArgumentsString(value: string, maxChars: number): string {
  if (value.length <= maxChars || isElidedToolCallArguments(value)) return value;
  const budget = Math.max(0, maxChars - TOOL_CALL_ARGUMENTS_COMPACTION_NOTICE.length - 1);
  return `${TOOL_CALL_ARGUMENTS_COMPACTION_NOTICE} ${value.slice(0, budget)}`;
}

function elideOpenAIToolCallArguments(message: Record<string, unknown>, maxChars: number): boolean {
  const toolCalls = message.tool_calls;
  if (!Array.isArray(toolCalls)) return false;
  let changed = false;
  const nextToolCalls = toolCalls.map((toolCall) => {
    if (!toolCall || typeof toolCall !== "object") return toolCall;
    const typed = toolCall as Record<string, unknown>;
    const fn = typed.function;
    if (!fn || typeof fn !== "object") return toolCall;
    const fnTyped = fn as Record<string, unknown>;
    const args = fnTyped.arguments;
    if (typeof args !== "string") return toolCall;
    const compacted = compactToolCallArgumentsString(args, maxChars);
    if (compacted === args) return toolCall;
    changed = true;
    return { ...typed, function: { ...fnTyped, arguments: compacted } };
  });
  if (!changed) return false;
  message.tool_calls = nextToolCalls;
  return true;
}

function isElidedOpenAIToolCallArguments(
  message: Record<string, unknown>,
  maxChars: number
): boolean {
  const toolCalls = message.tool_calls;
  if (!Array.isArray(toolCalls)) return true;
  return !toolCalls.some((toolCall) => {
    if (!toolCall || typeof toolCall !== "object") return false;
    const fn = (toolCall as Record<string, unknown>).function;
    if (!fn || typeof fn !== "object") return false;
    const args = (fn as Record<string, unknown>).arguments;
    return typeof args === "string" && args.length > maxChars;
  });
}

function collapseOversizedToolCallPayloads(
  messages: Array<Record<string, unknown>>,
  maxPayloadChars: number,
  protectRecent: number
): number {
  const protectedFrom = Math.max(0, messages.length - protectRecent);
  let pendingAssistantIndex = -1;
  for (let index = messages.length - 1; index >= protectedFrom; index -= 1) {
    if (messages[index].role !== "assistant") continue;
    if (messageHasInFlightToolCalls(messages[index])) {
      pendingAssistantIndex = index;
      break;
    }
  }
  let collapsed = 0;
  for (let index = 0; index < messages.length; index += 1) {
    if (index === pendingAssistantIndex) continue;
    const message = messages[index];
    if (message.role !== "assistant") continue;
    if (toolCallPayloadChars(message) <= maxPayloadChars) continue;
    if (collapseToolCallPayload(message) || collapseTimelineToolCallResults(message))
      collapsed += 1;
  }
  return collapsed;
}

function compactOpenAIToolCallArguments(
  messages: Array<Record<string, unknown>>,
  budgetChars: number,
  maxArgumentChars: number
): number {
  const estimates = messages.map((message) => estimateOpenAIChatMessageChars(message));
  let running = estimates.reduce((sum, value) => sum + value, 0);
  if (running <= budgetChars) return 0;

  let elided = 0;
  let force = true;
  for (let index = 0; index < messages.length; index += 1) {
    if (!force && running <= budgetChars) break;
    if (index >= messages.length - 2) break;
    const message = messages[index];
    if (message.role !== "assistant") continue;
    if (isElidedOpenAIToolCallArguments(message, maxArgumentChars)) continue;
    const previousEstimate = estimates[index];
    if (!elideOpenAIToolCallArguments(message, maxArgumentChars)) continue;
    const nextEstimate = estimateOpenAIChatMessageChars(message);
    estimates[index] = nextEstimate;
    running = running - previousEstimate + nextEstimate;
    elided += 1;
    force = false;
  }

  return elided;
}

const MIN_RECOVERABLE_TOOL_OUTPUT_CHARS = 400;
const SAVED_OUTPUT_PATH_PATTERN = /Full output saved to: (\S+)/;

export function isCompactedToolResult(content: unknown): boolean {
  return typeof content === "string" && content.startsWith(TOOL_RESULT_COMPACTION_NOTICE);
}

export function compactedToolResult(content: unknown, sessionId?: string): string {
  if (typeof content !== "string" || content.length < MIN_RECOVERABLE_TOOL_OUTPUT_CHARS) {
    return TOOL_RESULT_COMPACTION_NOTICE;
  }
  const path =
    SAVED_OUTPUT_PATH_PATTERN.exec(content)?.[1] ?? persistCompactedToolOutput(content, sessionId);
  return path
    ? `${TOOL_RESULT_COMPACTION_NOTICE}\nFull output saved to: ${path} (read it again only if needed)`
    : TOOL_RESULT_COMPACTION_NOTICE;
}

const CONTEXT_COMPACTION_NOTICES = [
  TOOL_RESULT_COMPACTION_NOTICE,
  MESSAGE_CONTENT_COMPACTION_NOTICE,
] as const;

export function stripContextCompactionNotices(content: string): string {
  let sanitized = content;
  for (const notice of CONTEXT_COMPACTION_NOTICES) {
    sanitized = sanitized.replaceAll(notice, "");
  }
  return sanitized.replace(/\n{3,}/g, "\n\n").trim();
}

export function isContextCompactionOnlyContent(content: string): boolean {
  const trimmed = content.trim();
  if (!trimmed) return false;
  return (
    CONTEXT_COMPACTION_NOTICES.some((notice) => trimmed.includes(notice)) &&
    stripContextCompactionNotices(trimmed).length === 0
  );
}

export interface ToolResultFormat<T> {
  isToolResult: (item: T) => boolean;
  estimateChars: (item: T) => number;
  isElided: (item: T) => boolean;
  elide: (item: T) => void;
  minimize?: (item: T) => boolean;
}

export interface CompactionOptions {
  protectRecent?: number;
  aggressive?: boolean;
  sessionId?: string;
  maxToolCallArgumentChars?: number;
  maxToolCallPayloadChars?: number;
}

export function compactToolTranscriptInPlace<T>(
  items: T[],
  budgetChars: number,
  format: ToolResultFormat<T>,
  options: CompactionOptions = {}
): number {
  const protectRecent = options.aggressive ? 0 : (options.protectRecent ?? 8);
  const estimates = items.map((item) => format.estimateChars(item));
  let running = estimates.reduce((sum, value) => sum + value, 0);
  if (running <= budgetChars && !options.aggressive) return 0;

  let elided = 0;
  let force = Boolean(options.aggressive);
  const lastProtectedIndex = items.length - protectRecent;

  for (let index = 0; index < items.length; index += 1) {
    if (!force && running <= budgetChars) break;
    if (index >= lastProtectedIndex) break;

    const item = items[index];
    if (!format.isToolResult(item) || format.isElided(item)) continue;

    const previousEstimate = estimates[index];
    format.elide(item);
    const nextEstimate = format.estimateChars(item);
    estimates[index] = nextEstimate;
    running = running - previousEstimate + nextEstimate;
    elided += 1;
    force = false;
  }

  if (running > budgetChars && format.minimize) {
    for (let index = 0; index < lastProtectedIndex && running > budgetChars; index += 1) {
      const item = items[index];
      if (!format.isToolResult(item) || !format.isElided(item) || !format.minimize(item)) continue;
      const nextEstimate = format.estimateChars(item);
      running = running - estimates[index] + nextEstimate;
      estimates[index] = nextEstimate;
    }
  }

  return elided;
}

export function minimizeCompactedToolResult(content: unknown): string | undefined {
  return isCompactedToolResult(content) && content !== TOOL_RESULT_COMPACTION_NOTICE
    ? TOOL_RESULT_COMPACTION_NOTICE
    : undefined;
}

function estimateOpenAIChatMessageChars(message: Record<string, unknown>): number {
  let total = 64;
  const role = message.role;
  if (typeof role === "string") total += role.length;

  const content = message.content;
  if (typeof content === "string") {
    total += content.length;
  } else if (Array.isArray(content)) {
    total += estimateRequestValueChars(content);
  }

  if (typeof message.thinking === "string") {
    total += message.thinking.length;
  }

  if (Array.isArray(message.tool_calls)) {
    try {
      total += JSON.stringify(message.tool_calls).length;
    } catch {
      total += 256;
    }
  }

  const toolCallId = message.tool_call_id;
  if (typeof toolCallId === "string") total += toolCallId.length;

  return total;
}

function elideOpenAIMessageContent(message: Record<string, unknown>): boolean {
  const content = message.content;
  if (typeof content === "string") {
    if (!content.trim() || content === MESSAGE_CONTENT_COMPACTION_NOTICE) return false;
    message.content = MESSAGE_CONTENT_COMPACTION_NOTICE;
    return true;
  }

  if (!Array.isArray(content)) return false;

  let changed = false;
  const nextContent = content.map((block) => {
    if (!block || typeof block !== "object") return block;
    const typed = block as Record<string, unknown>;
    if (typed.type !== "text" && typed.type !== "input_text") return block;
    const text = typed.text;
    if (typeof text !== "string" || !text.trim() || text === MESSAGE_CONTENT_COMPACTION_NOTICE) {
      return block;
    }
    changed = true;
    return { ...typed, text: MESSAGE_CONTENT_COMPACTION_NOTICE };
  });

  if (!changed) return false;
  message.content = nextContent;
  return true;
}

export function compactOpenAIChatTranscriptInPlace(
  messages: Array<Record<string, unknown>>,
  budgetChars: number,
  options: CompactionOptions = {}
): number {
  const defaultProtectRecent =
    options.protectRecent ?? Math.min(8, Math.max(2, Math.floor(messages.length / 3)));
  const toolElided = compactToolTranscriptInPlace(
    messages,
    budgetChars,
    {
      isToolResult: (message) => message.role === "tool" && typeof message.content === "string",
      estimateChars: estimateOpenAIChatMessageChars,
      isElided: (message) => isCompactedToolResult(message.content),
      elide: (message) => {
        message.content = compactedToolResult(message.content, options.sessionId);
      },
      minimize: (message) => {
        const minimized = minimizeCompactedToolResult(message.content);
        if (minimized === undefined) return false;
        message.content = minimized;
        return true;
      },
    },
    { ...options, protectRecent: defaultProtectRecent }
  );

  const protectRecent = options.aggressive ? 2 : defaultProtectRecent;
  const payloadCollapsed = collapseOversizedToolCallPayloads(
    messages,
    options.maxToolCallPayloadChars ?? MAX_TOOL_CALL_PAYLOAD_CHARS_PER_MESSAGE,
    protectRecent
  );

  const estimates = messages.map((message) => estimateOpenAIChatMessageChars(message));
  let running = estimates.reduce((sum, value) => sum + value, 0);
  if (running <= budgetChars && !options.aggressive) return toolElided + payloadCollapsed;

  const argumentElided = compactOpenAIToolCallArguments(
    messages,
    budgetChars,
    options.maxToolCallArgumentChars ?? MAX_TOOL_CALL_ARGUMENT_CHARS
  );
  if (argumentElided > 0) {
    const afterArguments = messages.map((message) => estimateOpenAIChatMessageChars(message));
    running = afterArguments.reduce((sum, value) => sum + value, 0);
    if (running <= budgetChars && !options.aggressive) {
      return toolElided + argumentElided + payloadCollapsed;
    }
  }

  const firstUserIndex = messages.findIndex((message) => message.role === "user");
  const lastProtectedIndex = messages.length - protectRecent;
  let messageElided = 0;
  let force = Boolean(options.aggressive);

  for (let index = 0; index < messages.length; index += 1) {
    if (!force && running <= budgetChars) break;
    if (index >= lastProtectedIndex) break;

    const message = messages[index];
    const role = message.role;
    if (role === "system" || role === "tool") continue;
    if (index === firstUserIndex) continue;
    const contentElided = elideOpenAIMessageContent(message);
    const thinkingElided = elideMessageThinking(message);
    if (!contentElided && !thinkingElided) continue;

    const previousEstimate = estimates[index];
    const nextEstimate = estimateOpenAIChatMessageChars(message);
    estimates[index] = nextEstimate;
    running = running - previousEstimate + nextEstimate;
    messageElided += 1;
    force = false;
  }

  if (running > budgetChars) {
    const systemIndexes = messages
      .map((message, index) => (message.role === "system" ? index : -1))
      .filter((index) => index >= 0)
      .sort(
        (a, b) =>
          estimateOpenAIChatMessageChars(messages[b]) - estimateOpenAIChatMessageChars(messages[a])
      );
    for (const index of systemIndexes) {
      if (running <= budgetChars) break;
      const message = messages[index];
      if (typeof message.content !== "string" || message.content.length === 0) continue;
      const currentEstimate = estimates[index];
      const maxChars = Math.max(256, currentEstimate - (running - budgetChars));
      if (message.content.length <= maxChars) continue;
      message.content = truncateSystemMessageText(message.content, maxChars);
      const nextEstimate = estimateOpenAIChatMessageChars(message);
      estimates[index] = nextEstimate;
      running = running - currentEstimate + nextEstimate;
      messageElided += 1;
    }
  }

  return toolElided + messageElided;
}

function truncateSystemMessageText(text: string, maxChars: number): string {
  const notice = "\n[compacted: system prompt truncated to fit context window]\n";
  if (maxChars <= notice.length + 64) {
    return text.slice(0, Math.max(1, maxChars - notice.length)) + notice;
  }
  const headChars = Math.floor(maxChars * 0.65);
  const tailChars = maxChars - headChars - notice.length;
  return text.slice(0, headChars) + notice + text.slice(text.length - tailChars);
}

export function compactOpenAIRequestMessagesForContext(
  requestBody: Record<string, unknown>,
  options: {
    contextWindowTokens?: number;
    defaultContextWindowTokens: number;
    charsPerToken: number;
    estimateRequestInputTokens: (body: Record<string, unknown>) => number;
    aggressive?: boolean;
  }
): boolean {
  if (!Array.isArray(requestBody.messages)) return false;
  const normalizedContextWindow =
    typeof options.contextWindowTokens === "number" &&
    Number.isFinite(options.contextWindowTokens) &&
    options.contextWindowTokens > 0
      ? Math.max(1, Math.floor(options.contextWindowTokens))
      : options.defaultContextWindowTokens;
  const fixedRequestTokens = options.estimateRequestInputTokens({ ...requestBody, messages: [] });
  const reserveTokens = Math.max(512, Math.floor(normalizedContextWindow * 0.06));
  const messageBudgetTokens = Math.max(
    1024,
    Math.floor((normalizedContextWindow - fixedRequestTokens - reserveTokens) * 0.65)
  );
  return (
    compactOpenAIChatTranscriptInPlace(
      requestBody.messages as Record<string, unknown>[],
      messageBudgetTokens * options.charsPerToken,
      { aggressive: options.aggressive }
    ) > 0
  );
}

export function assertResponsesToolPairing(items: Array<Record<string, unknown>>): number {
  const idOf = (item: Record<string, unknown>): string | undefined => {
    const id = item.call_id;
    return typeof id === "string" && id.length > 0 ? id : undefined;
  };
  const seenCalls = new Set<string>();
  const answered = new Set<string>();
  let dropped = 0;

  for (let i = 0; i < items.length; i += 1) {
    const item = items[i];
    if (item.type === "function_call") {
      const id = idOf(item);
      if (id) seenCalls.add(id);
    } else if (item.type === "function_call_output") {
      const id = idOf(item);
      if (!id || !seenCalls.has(id) || answered.has(id)) {
        items.splice(i, 1);
        i -= 1;
        dropped += 1;
        continue;
      }
      answered.add(id);
    }
  }
  return dropped;
}

export function isContextOverflowError(errorText: string): boolean {
  const lower = errorText.toLowerCase();
  return (
    lower.includes("context window") ||
    lower.includes("context length") ||
    lower.includes("request_too_large") ||
    lower.includes("prompt is too long") ||
    lower.includes("maximum prompt length") ||
    lower.includes("prompt length") ||
    lower.includes("maximum context length") ||
    lower.includes("request contains") ||
    lower.includes("token limit") ||
    lower.includes("exceeded model token limit")
  );
}
