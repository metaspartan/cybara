import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join, resolve } from "path";
import { dataDir } from "./paths";

const MAX_VIEWED_MEDIA_PATHS = 5000;
const registryFile = join(dataDir, "viewed-media.json");

let viewedPaths: Set<string> | undefined;

function normalizeViewedPath(path: string): string | undefined {
  const trimmed = path.trim();
  if (!trimmed || trimmed.startsWith("data:") || /^https?:\/\//i.test(trimmed)) return undefined;
  return resolve(trimmed);
}

function loadViewedPaths(): Set<string> {
  if (viewedPaths) return viewedPaths;
  viewedPaths = new Set();
  try {
    if (existsSync(registryFile)) {
      const parsed = JSON.parse(readFileSync(registryFile, "utf8")) as unknown;
      if (Array.isArray(parsed)) {
        for (const entry of parsed) {
          if (typeof entry === "string" && entry) viewedPaths.add(entry);
        }
      }
    }
  } catch {
    viewedPaths = new Set();
  }
  return viewedPaths;
}

function persistViewedPaths(paths: Set<string>): void {
  try {
    mkdirSync(dataDir, { recursive: true });
    writeFileSync(registryFile, JSON.stringify([...paths]));
  } catch {
    return;
  }
}

export function registerViewedMediaPath(path: string): void {
  const normalized = normalizeViewedPath(path);
  if (!normalized) return;
  const paths = loadViewedPaths();
  if (paths.has(normalized)) return;
  paths.add(normalized);
  while (paths.size > MAX_VIEWED_MEDIA_PATHS) {
    const oldest = paths.values().next().value;
    if (oldest === undefined) break;
    paths.delete(oldest);
  }
  persistViewedPaths(paths);
}

export function isViewedMediaPath(path: string): boolean {
  const normalized = normalizeViewedPath(path);
  return normalized ? loadViewedPaths().has(normalized) : false;
}

export function resetViewedMediaPathsForTests(): void {
  viewedPaths = undefined;
}
