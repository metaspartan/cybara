const IMAGE_FILE_PATTERN = /\.(png|jpe?g|gif|webp)$/i;

function objectRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function parsedResult(value: unknown): Record<string, unknown> | undefined {
  const direct = objectRecord(value);
  if (direct) return direct;
  if (typeof value !== "string" || !value.trim().startsWith("{")) return undefined;
  try {
    return objectRecord(JSON.parse(value));
  } catch {
    return undefined;
  }
}

function stringField(record: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value;
  }
  return undefined;
}

function boundedText(value: unknown, limit: number): string | undefined {
  if (typeof value !== "string" || !value.trim()) return undefined;
  return value.length > limit ? `${value.slice(0, limit)}...` : value;
}

function viewportValue(value: unknown): { width: number; height: number } | undefined {
  const viewport = objectRecord(value);
  const width = viewport?.width;
  const height = viewport?.height;
  if (
    typeof width !== "number" ||
    !Number.isFinite(width) ||
    width <= 0 ||
    typeof height !== "number" ||
    !Number.isFinite(height) ||
    height <= 0
  ) {
    return undefined;
  }
  return { width: Math.round(width), height: Math.round(height) };
}

function screenshotPathFromRawJson(value: string): Record<string, unknown> | undefined {
  const pathMatch = value.match(
    /"(?:filePath|file_path|path)"\s*:\s*"([^"]*screenshots[^"]*\.(?:png|jpe?g|gif|webp))"/i
  );
  if (!pathMatch) return undefined;
  const payload: Record<string, unknown> = { filePath: pathMatch[1] };
  const actionMatch = value.match(/"action"\s*:\s*"([^"]+)"/i);
  if (actionMatch) payload.action = actionMatch[1];
  const mimeMatch = value.match(
    /"(?:screenshotMime|mimeType|mime_type|contentType|content_type)"\s*:\s*"([^"]+)"/i
  );
  if (mimeMatch) payload.contentType = mimeMatch[1];
  return payload;
}

export function sanitizeToolMediaResult(result: unknown): Record<string, unknown> | undefined {
  if (typeof result === "string" && result.length > 20_000) {
    return screenshotPathFromRawJson(result);
  }
  const record = parsedResult(result);
  if (!record) return undefined;
  const filePath = stringField(record, ["filePath", "file_path", "path"]);
  const contentType = stringField(record, [
    "contentType",
    "content_type",
    "screenshotMime",
    "mimeType",
    "mime_type",
  ]);
  if (!filePath || (!IMAGE_FILE_PATTERN.test(filePath) && !contentType?.startsWith("image/"))) {
    return undefined;
  }

  const payload: Record<string, unknown> = { filePath };
  const action = stringField(record, ["action"]);
  const text = boundedText(record.text, 1_000);
  const error = boundedText(record.error, 500);
  const viewport = viewportValue(record.viewport);
  if (action) payload.action = action;
  if (typeof record.ok === "boolean") payload.ok = record.ok;
  if (text) payload.text = text;
  if (error) payload.error = error;
  if (contentType) {
    payload.contentType = contentType;
    payload.screenshotMime = contentType;
  }
  if (typeof record.capturedAfter === "boolean") payload.capturedAfter = record.capturedAfter;
  if (viewport) payload.viewport = viewport;
  return payload;
}

export function extractScreenshotPathFromText(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const match = value.match(
    /((?:[A-Za-z]:[\\/]|\/)[^\s`"'<>]*[\\/]screenshots[\\/][^\s`"'<>]+\.(?:png|jpe?g|gif|webp))/i
  );
  return match?.[1];
}
