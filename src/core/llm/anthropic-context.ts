import {
  compactAnthropicLoopMessagesForContext,
  truncateTextWithHeadAndTail,
} from "../agent-context-guard";
import {
  CONTEXT_CHARS_PER_TOKEN_ESTIMATE,
  DEFAULT_MODEL_CONTEXT_WINDOW_TOKENS,
  DEFAULT_MODEL_MAX_OUTPUT_TOKENS,
} from "../agent-internals";
import type { ToolContext } from "../tools";

const IMAGE_TOKEN_ESTIMATE = 4096;

function estimateValueChars(value: unknown): number {
  if (typeof value === "string") return value.length;
  if (typeof value === "number" || typeof value === "boolean") return String(value).length;
  if (Array.isArray(value)) return value.reduce((sum, item) => sum + estimateValueChars(item), 0);
  if (!value || typeof value !== "object") return 0;

  const record = value as Record<string, unknown>;
  if (record.type === "image") {
    return IMAGE_TOKEN_ESTIMATE * CONTEXT_CHARS_PER_TOKEN_ESTIMATE;
  }
  return Object.entries(record).reduce(
    (sum, [key, item]) => sum + key.length + estimateValueChars(item),
    0
  );
}

export function estimateAnthropicRequestInputTokens(requestBody: Record<string, unknown>): number {
  const chars =
    estimateValueChars(requestBody.system) +
    estimateValueChars(requestBody.messages) +
    estimateValueChars(requestBody.tools) +
    estimateValueChars(requestBody.tool_choice) +
    estimateValueChars(requestBody.model);
  return Math.max(1, Math.ceil(chars / CONTEXT_CHARS_PER_TOKEN_ESTIMATE));
}

export function resolveAnthropicRequestTokenLimit(
  requestBody: Record<string, unknown>,
  maxOutputTokens: number,
  contextWindowTokens?: number
): number {
  const requestedOutputTokens =
    Number.isFinite(maxOutputTokens) && maxOutputTokens > 0
      ? Math.max(1, Math.floor(maxOutputTokens))
      : DEFAULT_MODEL_MAX_OUTPUT_TOKENS;
  const contextTokens =
    typeof contextWindowTokens === "number" &&
    Number.isFinite(contextWindowTokens) &&
    contextWindowTokens > 0
      ? Math.max(1, Math.floor(contextWindowTokens))
      : Math.max(requestedOutputTokens, DEFAULT_MODEL_CONTEXT_WINDOW_TOKENS);
  const reserveTokens = Math.max(128, Math.floor(contextTokens * 0.01));
  return Math.max(
    1,
    Math.min(
      requestedOutputTokens,
      contextTokens - estimateAnthropicRequestInputTokens(requestBody) - reserveTokens
    )
  );
}

function messageStartsIndependentTurn(message: Record<string, unknown>): boolean {
  if (message.role !== "user") return false;
  if (!Array.isArray(message.content)) return true;
  return !message.content.some(
    (block) =>
      !!block &&
      typeof block === "object" &&
      (block as Record<string, unknown>).type === "tool_result"
  );
}

function trimOldAnthropicMessages(
  messages: Record<string, unknown>[],
  attempt: number
): Record<string, unknown>[] {
  if (messages.length <= 2) return messages;
  const targetKeep = attempt === 0 ? Math.max(4, Math.ceil(messages.length * 0.7)) : 4;
  const initialStart = Math.max(0, messages.length - targetKeep);
  let start = initialStart;
  while (start < messages.length - 1 && !messageStartsIndependentTurn(messages[start] || {})) {
    start += 1;
  }
  return start > 0 ? messages.slice(start) : messages;
}

function compactAnthropicSystem(requestBody: Record<string, unknown>, maxChars: number): boolean {
  const system = requestBody.system;
  if (typeof system === "string" && system.length > maxChars) {
    requestBody.system = truncateTextWithHeadAndTail(system, maxChars);
    return true;
  }
  if (!Array.isArray(system)) return false;
  const textBlockCount = system.filter(
    (part) =>
      !!part &&
      typeof part === "object" &&
      typeof (part as Record<string, unknown>).text === "string"
  ).length;
  if (textBlockCount === 0) return false;
  const blockMaxChars = Math.max(1, Math.floor(maxChars / textBlockCount));
  let changed = false;
  requestBody.system = system.map((part) => {
    if (!part || typeof part !== "object") return part;
    const block = part as Record<string, unknown>;
    if (typeof block.text !== "string" || block.text.length <= blockMaxChars) return part;
    changed = true;
    return { ...block, text: truncateTextWithHeadAndTail(block.text, blockMaxChars) };
  });
  return changed;
}

export function isAnthropicContextOverflowError(
  providerConfig: string,
  errorText: string,
  genericContextOverflow: boolean
): boolean {
  if (genericContextOverflow) return true;
  return providerConfig.startsWith("minimax") && /(?:\(|\b)2013(?:\)|\b)/.test(errorText);
}

export function recoverAnthropicRequestForContext(
  requestBody: Record<string, unknown>,
  contextWindowTokens: number,
  attempt: number,
  context?: { model?: string; toolContext?: ToolContext }
): boolean {
  let changed = false;
  const contextBudgetChars = Math.max(
    4096,
    Math.floor(contextWindowTokens * CONTEXT_CHARS_PER_TOKEN_ESTIMATE * 0.75)
  );
  const messages = Array.isArray(requestBody.messages)
    ? (requestBody.messages as Record<string, unknown>[])
    : [];
  if (compactAnthropicLoopMessagesForContext(messages, contextBudgetChars, true, context)) {
    changed = true;
  }
  const trimmedMessages = trimOldAnthropicMessages(messages, attempt);
  if (trimmedMessages !== messages) {
    requestBody.messages = trimmedMessages;
    changed = true;
  }
  if (compactAnthropicSystem(requestBody, Math.floor(contextBudgetChars * 0.35))) {
    changed = true;
  }

  const currentLimit =
    typeof requestBody.max_tokens === "number" && requestBody.max_tokens > 0
      ? Math.floor(requestBody.max_tokens)
      : DEFAULT_MODEL_MAX_OUTPUT_TOKENS;
  const nextLimit = Math.max(1, Math.min(currentLimit - 1, Math.floor(currentLimit * 0.5)));
  if (nextLimit < currentLimit) {
    requestBody.max_tokens = nextLimit;
    changed = true;
  }
  return changed;
}
