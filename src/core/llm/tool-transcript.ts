export const TOOL_RESULT_COMPACTION_NOTICE =
  "[compacted: earlier tool output elided to free context]";
export const MESSAGE_CONTENT_COMPACTION_NOTICE =
  "[compacted: earlier message content elided to free context]";

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
}

export interface CompactionOptions {
  protectRecent?: number;
  aggressive?: boolean;
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

  return elided;
}

function estimateOpenAIChatMessageChars(message: Record<string, unknown>): number {
  let total = 64;
  const role = message.role;
  if (typeof role === "string") total += role.length;

  const content = message.content;
  if (typeof content === "string") {
    total += content.length;
  } else if (Array.isArray(content)) {
    try {
      total += JSON.stringify(content).length;
    } catch {
      total += 256;
    }
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
      isElided: (message) => message.content === TOOL_RESULT_COMPACTION_NOTICE,
      elide: (message) => {
        message.content = TOOL_RESULT_COMPACTION_NOTICE;
      },
    },
    { ...options, protectRecent: defaultProtectRecent }
  );

  const estimates = messages.map((message) => estimateOpenAIChatMessageChars(message));
  let running = estimates.reduce((sum, value) => sum + value, 0);
  if (running <= budgetChars && !options.aggressive) return toolElided;

  const protectRecent = options.aggressive ? 2 : defaultProtectRecent;
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
    if (!elideOpenAIMessageContent(message)) continue;

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
