import { encode as encodeToon } from "@toon-format/toon";

export type ModelVisibleStructuredFormat = "json" | "toon";

export interface ModelVisibleStructuredResult {
  content: string;
  format: ModelVisibleStructuredFormat;
  jsonChars: number;
  toonChars?: number;
}

export interface ModelVisibleStructuredOptions {
  toonEnabled?: boolean;
  minSavingsRatio?: number;
}

function safeJsonStringify(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function compactBinaryFields(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const record = value as Record<string, unknown>;
  if (typeof record.screenshot !== "string" || record.screenshot.length < 4096) return value;
  return {
    ...record,
    screenshot: record.filePath
      ? `[binary image omitted; read ${String(record.filePath)} if visual analysis is needed]`
      : "[binary image omitted from model context]",
  };
}

function canTryToon(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value !== "object") return false;
  return hasUniformRecordArray(value);
}

function isPrimitive(value: unknown): boolean {
  return value === null || ["string", "number", "boolean"].includes(typeof value);
}

function primitiveRecordKeys(value: unknown): string[] | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length === 0) return null;
  if (!entries.every(([, entryValue]) => isPrimitive(entryValue))) return null;
  return entries.map(([key]) => key).sort();
}

function sameKeys(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((key, index) => key === b[index]);
}

function hasUniformRecordArray(value: unknown): boolean {
  if (Array.isArray(value)) {
    if (value.length < 2) return false;
    const keys = primitiveRecordKeys(value[0]);
    return Boolean(
      keys &&
        value.every((entry) => {
          const entryKeys = primitiveRecordKeys(entry);
          return entryKeys ? sameKeys(keys, entryKeys) : false;
        })
    );
  }

  if (!value || typeof value !== "object") return false;
  return Object.values(value as Record<string, unknown>).some((entry) =>
    hasUniformRecordArray(entry)
  );
}

export function formatStructuredDataForModel(
  value: unknown,
  options: ModelVisibleStructuredOptions = {}
): ModelVisibleStructuredResult {
  const json = safeJsonStringify(value);
  if (!options.toonEnabled || !canTryToon(value)) {
    return { content: json, format: "json", jsonChars: json.length };
  }

  try {
    const toon = encodeToon(value, { keyFolding: "safe" });
    const minSavingsRatio = options.minSavingsRatio ?? 0.92;
    if (toon.length > 0 && toon.length < json.length * minSavingsRatio) {
      return {
        content: toon,
        format: "toon",
        jsonChars: json.length,
        toonChars: toon.length,
      };
    }
  } catch {}

  return { content: json, format: "json", jsonChars: json.length };
}

export function formatToolResultForModel(
  value: unknown,
  options: ModelVisibleStructuredOptions = {}
): string {
  if (typeof value === "string") return value;
  return formatStructuredDataForModel(compactBinaryFields(value), options).content;
}
