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

function shrink(
  value: unknown,
  depth: number,
  options: Required<ToolResultTransportOptions>
): unknown {
  if (typeof value === "string") return truncateString(value, options.maxStringChars);
  if (value === null || typeof value !== "object") return value;
  if (depth >= options.maxDepth) {
    return truncateString(JSON.stringify(value) ?? "", options.maxStringChars);
  }
  if (Array.isArray(value)) {
    const kept = value
      .slice(0, options.maxArrayItems)
      .map((item) => shrink(item, depth + 1, options));
    return value.length > options.maxArrayItems
      ? [...kept, `${TRUNCATION_MARKER} ${value.length - options.maxArrayItems} more item(s)`]
      : kept;
  }
  if (!isPlainRecord(value)) return value;
  const shrunk: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    shrunk[key] = shrink(entry, depth + 1, options);
  }
  return shrunk;
}

/**
 * Shrink a tool result for transport while preserving its shape. Long string
 * leaves are capped and long arrays are trimmed, but scalars such as exit codes
 * and keys such as stdout/filePath survive, so clients can keep reading fields
 * off the result instead of parsing a flattened blob.
 */
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
  if (result === null || typeof result !== "object") return result;

  // Shrink harder rather than flattening: clients read fields such as exit
  // codes and stdout off the result, so keeping the shape matters more than
  // keeping every character.
  let shrunk = shrink(result, 0, resolved);
  let serialized = JSON.stringify(shrunk);
  for (const stringCap of [200, 80, 24]) {
    if (typeof serialized !== "string" || serialized.length <= resolved.maxTotalChars) break;
    if (stringCap >= resolved.maxStringChars) continue;
    shrunk = shrink(result, 0, { ...resolved, maxStringChars: stringCap });
    serialized = JSON.stringify(shrunk);
  }
  if (typeof serialized === "string" && serialized.length > resolved.maxTotalChars) {
    return truncateString(serialized, resolved.maxTotalChars);
  }
  return shrunk;
}
