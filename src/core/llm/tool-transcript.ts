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
    lower.includes("maximum context length") ||
    lower.includes("token limit") ||
    lower.includes("exceeded model token limit")
  );
}
