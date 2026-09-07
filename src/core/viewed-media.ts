import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "fs";
import { basename, extname, join, resolve, sep } from "path";
import { cybaraDir, dataDir } from "./paths";

const MAX_VIEWED_MEDIA_PATHS = 5000;
const MAX_SNAPSHOT_BYTES = 25 * 1024 * 1024;
const MAX_SNAPSHOT_DIRS = 400;
const SNAPSHOT_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp"]);
const registryFile = join(dataDir, "viewed-media.json");
const snapshotRoot = join(cybaraDir, "media", "viewed");
const snapshotsByFingerprint = new Map<string, string>();

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

function pruneSnapshotDirs(): void {
  let entries: string[];
  try {
    entries = readdirSync(snapshotRoot).sort();
  } catch {
    return;
  }
  while (entries.length > MAX_SNAPSHOT_DIRS) {
    const oldest = entries.shift();
    if (!oldest) break;
    try {
      rmSync(join(snapshotRoot, oldest), { recursive: true, force: true });
    } catch {
      continue;
    }
  }
}

export function isViewedMediaSnapshot(path: string): boolean {
  const normalized = normalizeViewedPath(path);
  return !!normalized && normalized.startsWith(snapshotRoot + sep);
}

export function snapshotViewedMedia(path: string): string | undefined {
  const normalized = normalizeViewedPath(path);
  if (!normalized) return undefined;
  if (isViewedMediaSnapshot(normalized)) return normalized;
  if (!SNAPSHOT_EXTENSIONS.has(extname(normalized).toLowerCase())) return undefined;
  let stats: ReturnType<typeof statSync>;
  try {
    stats = statSync(normalized);
  } catch {
    return undefined;
  }
  if (!stats.isFile() || stats.size <= 0 || stats.size > MAX_SNAPSHOT_BYTES) return undefined;
  const fingerprint = `${normalized}:${Math.floor(stats.mtimeMs)}:${stats.size}`;
  const cached = snapshotsByFingerprint.get(fingerprint);
  if (cached && existsSync(cached)) return cached;
  const dir = join(
    snapshotRoot,
    `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
  );
  const target = join(dir, basename(normalized));
  try {
    mkdirSync(dir, { recursive: true });
    copyFileSync(normalized, target);
  } catch {
    return undefined;
  }
  snapshotsByFingerprint.set(fingerprint, target);
  pruneSnapshotDirs();
  return target;
}
