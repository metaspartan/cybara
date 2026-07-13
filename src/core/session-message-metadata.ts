import { sanitizeToolMediaResult } from "./tool-media-result";

const SESSION_MESSAGE_METADATA_MAX_CHARS = 262_144;
const SESSION_MESSAGE_RESULT_PREVIEW_CHARS = 4_000;
const FILE_CHANGE_TOOL_NAMES = new Set(["apply_patch", "edit", "write"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function compactToolResult(value: unknown): unknown {
  if (value === undefined) return undefined;
  const mediaResult = sanitizeToolMediaResult(value);
  if (mediaResult) return mediaResult;
  const encoded = typeof value === "string" ? value : JSON.stringify(value);
  const serialized = typeof encoded === "string" ? encoded : String(value);
  if (serialized.length <= SESSION_MESSAGE_RESULT_PREVIEW_CHARS) return value;
  return `${serialized.slice(0, SESSION_MESSAGE_RESULT_PREVIEW_CHARS)}... [persisted preview]`;
}

function compactToolCall(value: unknown, truncateLargeResult: boolean): unknown {
  if (!isRecord(value)) return value;
  const name = typeof value.name === "string" ? value.name.toLowerCase() : "";
  if (FILE_CHANGE_TOOL_NAMES.has(name)) return value;
  const mediaResult = sanitizeToolMediaResult(value.result);
  if (mediaResult) return { ...value, result: mediaResult };
  if (!truncateLargeResult) return value;
  return {
    ...value,
    result: compactToolResult(value.result),
  };
}

function compactProcessActivities(value: unknown): unknown {
  if (!Array.isArray(value)) return value;
  return value.slice(-500).map((entry) => {
    if (!isRecord(entry) || typeof entry.text !== "string" || entry.text.length <= 2_000) {
      return entry;
    }
    return { ...entry, text: `${entry.text.slice(0, 2_000)}...` };
  });
}

export function capSessionMessageMetadata(metadataJson?: string): string | undefined {
  if (!metadataJson) return metadataJson;
  const truncateLargeResult = metadataJson.length > SESSION_MESSAGE_METADATA_MAX_CHARS;
  if (!truncateLargeResult && !metadataJson.includes("screenshot")) return metadataJson;
  try {
    const parsed = JSON.parse(metadataJson) as unknown;
    if (!isRecord(parsed)) return metadataJson;
    return JSON.stringify({
      ...parsed,
      tool_calls: Array.isArray(parsed.tool_calls)
        ? parsed.tool_calls.map((toolCall) => compactToolCall(toolCall, truncateLargeResult))
        : parsed.tool_calls,
      process_activities: truncateLargeResult
        ? compactProcessActivities(parsed.process_activities)
        : parsed.process_activities,
    });
  } catch {
    return metadataJson;
  }
}
