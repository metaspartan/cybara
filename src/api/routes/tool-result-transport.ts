export interface ToolResultTransportOptions {
  maxStringChars?: number;
  maxArrayItems?: number;
  maxTotalChars?: number;
  maxDepth?: number;
}

const DEFAULT_MAX_STRING_CHARS = 500;
const DEFAULT_MAX_ARRAY_ITEMS = 20;
const DEFAULT_MAX_TOTAL_CHARS = 8_000;
const DEFAULT_MAX_DEPTH = 6;
const TRUNCATION_MARKER = "... [truncated]";

function truncateString(value: string, maxChars: number): string {
  return value.length > maxChars ? value.slice(0, maxChars) + TRUNCATION_MARKER : value;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function safeJsonStringify(value: unknown): string | undefined {
  try {
    return JSON.stringify(value) ?? undefined;
  } catch {
    return undefined;
  }
}

function jsonSafeScalar(value: unknown): unknown {
  if (typeof value === "bigint" || typeof value === "symbol") return String(value);
  if (typeof value === "function") return `[Function ${value.name || "anonymous"}]`;
  return value;
}

interface ShrinkState {
  used: number;
  aborted: boolean;
}

function shrinkBounded(
  value: unknown,
  depth: number,
  options: Required<ToolResultTransportOptions>,
  state: ShrinkState
): unknown {
  if (state.aborted) return TRUNCATION_MARKER;
  if (typeof value === "string") {
    const kept = truncateString(value, options.maxStringChars);
    state.used += kept.length;
    if (state.used > options.maxTotalChars) state.aborted = true;
    return kept;
  }
  if (value === null || typeof value !== "object") return jsonSafeScalar(value);
  if (depth >= options.maxDepth) {
    const kept = truncateString(safeJsonStringify(value) ?? "", options.maxStringChars);
    state.used += kept.length;
    if (state.used > options.maxTotalChars) state.aborted = true;
    return kept;
  }
  if (Array.isArray(value)) {
    const kept = value
      .slice(0, options.maxArrayItems)
      .map((item) => shrinkBounded(item, depth + 1, options, state));
    return value.length > options.maxArrayItems
      ? [...kept, `${TRUNCATION_MARKER} ${value.length - options.maxArrayItems} more item(s)`]
      : kept;
  }
  if (!isPlainRecord(value)) return value;
  const shrunk: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (state.aborted) {
      shrunk[key] = TRUNCATION_MARKER;
      break;
    }
    state.used += key.length;
    shrunk[key] = shrinkBounded(entry, depth + 1, options, state);
  }
  return shrunk;
}

const transportTruncateCache = new WeakMap<object, { key: string; result: unknown }>();

export function truncateToolResultForTransport(
  result: unknown,
  options: ToolResultTransportOptions = {}
): unknown {
  const resolved: Required<ToolResultTransportOptions> = {
    maxStringChars: options.maxStringChars ?? DEFAULT_MAX_STRING_CHARS,
    maxArrayItems: options.maxArrayItems ?? DEFAULT_MAX_ARRAY_ITEMS,
    maxTotalChars: options.maxTotalChars ?? DEFAULT_MAX_TOTAL_CHARS,
    maxDepth: options.maxDepth ?? DEFAULT_MAX_DEPTH,
  };
  if (result === undefined) return result;
  if (typeof result === "string") return truncateString(result, resolved.maxStringChars);
  if (result === null || typeof result !== "object") return jsonSafeScalar(result);

  const cacheKey = `${resolved.maxStringChars}:${resolved.maxArrayItems}:${resolved.maxTotalChars}:${resolved.maxDepth}`;
  const cached = transportTruncateCache.get(result as object);
  if (cached?.key === cacheKey) return cached.result;
  let shrunk = shrinkBounded(result, 0, resolved, { used: 0, aborted: false });
  let serialized = safeJsonStringify(shrunk) ?? "";
  for (const stringCap of [200, 80, 24]) {
    if (serialized.length <= resolved.maxTotalChars) break;
    if (stringCap >= resolved.maxStringChars) continue;
    shrunk = shrinkBounded(
      result,
      0,
      { ...resolved, maxStringChars: stringCap },
      { used: 0, aborted: false }
    );
    serialized = safeJsonStringify(shrunk) ?? "";
  }
  if (serialized.length > resolved.maxTotalChars) {
    return truncateString(serialized, resolved.maxTotalChars);
  }
  transportTruncateCache.set(result as object, { key: cacheKey, result: shrunk });
  return shrunk;
}
