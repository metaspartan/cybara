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

function canTryToon(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value !== "object") return false;
  return Array.isArray(value) || Object.keys(value as Record<string, unknown>).length > 0;
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
  return formatStructuredDataForModel(value, options).content;
}
