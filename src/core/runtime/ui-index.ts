import { readFileSync } from "fs";
import { join } from "path";

export interface ReadUiIndexOptions {
  uiPath: string;
  uiExists: boolean;
  fallbackContent: string;
  readFileSyncFn?: typeof readFileSync;
}

export function readUiIndexContent({
  uiPath,
  uiExists,
  fallbackContent,
  readFileSyncFn = readFileSync,
}: ReadUiIndexOptions): string {
  if (!uiExists) return fallbackContent;

  try {
    return readFileSyncFn(join(uiPath, "index.html"), "utf-8") as string;
  } catch {
    return fallbackContent;
  }
}
