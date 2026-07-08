/**
 * Provider-agnostic tool-transcript compaction.
 *
 * Every tool-calling provider (OpenAI Chat Completions `role:"tool"` messages,
 * the OpenAI Responses `function_call_output` items used by OAuth GPT/"codex"
 * configs, Anthropic `tool_result` blocks) shares the same problem on long
 * multi-tool runs: the transcript grows until it overflows the context window.
 *
 * Following OpenClaw and Hermes, we handle this in ONE shared layer rather than
 * per provider, and we compact by ELIDING old tool-result *content in place*
 * — never removing the structural item. This is pairing-safe by construction:
 * the tool call and its (now-elided) result stay together, so a provider can
 * never reject the request for an orphaned result. Recent turns are protected
 * as an uncompacted tail.
 *
 * A wire format is described by a small `ToolResultFormat` adapter so the same
 * algorithm serves all providers.
 */

export const TOOL_RESULT_COMPACTION_NOTICE =
  "[compacted: earlier tool output elided to free context]";
export const MESSAGE_CONTENT_COMPACTION_NOTICE =
  "[compacted: earlier message content elided to free context]";

export interface ToolResultFormat<T> {
  /** True for an item that carries an elidable tool result. */
  isToolResult: (item: T) => boolean;
  /** Estimated serialized size of an item, in characters. */
  estimateChars: (item: T) => number;
  /** True if this item's result content was already elided. */
  isElided: (item: T) => boolean;
  /** Replace this item's result content with the compaction notice, in place. */
  elide: (item: T) => void;
}

export interface CompactionOptions {
  /** Protect this many trailing items from compaction (recent context). */
  protectRecent?: number;
  /** Compact from the front even if already under budget (used on retry). */
  aggressive?: boolean;
}

/**
 * Elide old tool-result content until the transcript fits `budgetChars`,
 * walking oldest-first and stopping once under budget (unless aggressive).
 * Returns the number of results elided. Mutates `items` in place.
 */
export function compactToolTranscriptInPlace<T>(
  items: T[],
  budgetChars: number,
  format: ToolResultFormat<T>,
  options: CompactionOptions = {}
): number {
  const protectRecent = options.aggressive ? 0 : (options.protectRecent ?? 8);
  const total = () => items.reduce((sum, item) => sum + format.estimateChars(item), 0);

  let running = total();
  if (running <= budgetChars && !options.aggressive) return 0;

  let elided = 0;
  let force = Boolean(options.aggressive);
  const lastProtectedIndex = items.length - protectRecent;

  for (let index = 0; index < items.length; index += 1) {
    if (!force && running <= budgetChars) break;
    if (index >= lastProtectedIndex) break;

    const item = items[index];
    if (!format.isToolResult(item) || format.isElided(item)) continue;

    format.elide(item);
    elided += 1;
    force = false;
    running = total();
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
  const total = () =>
    messages.reduce((sum, message) => sum + estimateOpenAIChatMessageChars(message), 0);
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

  let running = total();
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

    messageElided += 1;
    force = false;
    running = total();
  }

  return toolElided + messageElided;
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

/**
 * Integrity assertion for the OpenAI Responses format: every
 * `function_call_output` must have a preceding `function_call` with the same
 * call_id, or the provider rejects the whole request. With elide-in-place
 * compaction this should never fire, but it is kept as cheap defense-in-depth
 * against orphans arising from persistence/restore or provider quirks. Returns
 * the number of orphaned outputs dropped. Mutates in place.
 */
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

/**
 * Shared context-overflow error matcher. Following OpenClaw, a single list of
 * provider error substrings (OpenAI, Anthropic, Bedrock, Gemini, Ollama,
 * OpenRouter, …) drives reactive compaction across every provider path.
 */
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
