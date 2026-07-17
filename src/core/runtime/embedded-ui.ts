import { readFileSync } from "fs";

export interface EmbeddedUiBundle {
  indexPath: string;
  assets: Record<string, string>;
}

interface EmbeddedUiGlobal {
  __CYBARA_EMBEDDED_UI__?: unknown;
}

function isStringRecord(value: unknown): value is Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  return Object.values(value).every((entry) => typeof entry === "string");
}

export function getEmbeddedUiBundle(): EmbeddedUiBundle | undefined {
  const candidate = (globalThis as typeof globalThis & EmbeddedUiGlobal).__CYBARA_EMBEDDED_UI__;
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return undefined;
  const record = candidate as Record<string, unknown>;
  if (typeof record.indexPath !== "string" || !isStringRecord(record.assets)) return undefined;
  return { indexPath: record.indexPath, assets: record.assets };
}

export function readEmbeddedUiIndex(
  bundle: EmbeddedUiBundle,
  readFileSyncFn: typeof readFileSync = readFileSync
): string | undefined {
  try {
    return readFileSyncFn(bundle.indexPath, "utf8") as string;
  } catch {
    return undefined;
  }
}
