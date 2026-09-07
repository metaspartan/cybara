import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from "fs";
import { basename, extname, join, resolve, sep } from "path";
import { cybaraDir } from "./paths";

const MAX_SNAPSHOT_BYTES = 25 * 1024 * 1024;
const MAX_SNAPSHOT_DIRS = 400;
const SNAPSHOT_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp"]);
const snapshotRoot = join(cybaraDir, "media", "viewed");
const snapshotsByFingerprint = new Map<string, string>();

function normalizeViewedPath(path: string): string | undefined {
  const trimmed = path.trim();
  if (!trimmed || trimmed.startsWith("data:") || /^https?:\/\//i.test(trimmed)) return undefined;
  return resolve(trimmed);
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
