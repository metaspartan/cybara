import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from "fs";
import { basename, extname, join, resolve, sep } from "path";
import { cybaraDir } from "./paths";

const MAX_SNAPSHOT_BYTES = 25 * 1024 * 1024;
const DEFAULT_MAX_SNAPSHOT_DIRS = 400;
const DEFAULT_PRUNE_EVERY = 25;
const SNAPSHOT_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp"]);
const DEFAULT_SNAPSHOT_ROOT = join(cybaraDir, "media", "viewed");
const snapshotsByFingerprint = new Map<string, string>();

let snapshotRoot = DEFAULT_SNAPSHOT_ROOT;
let maxSnapshotDirs = DEFAULT_MAX_SNAPSHOT_DIRS;
let pruneEvery = DEFAULT_PRUNE_EVERY;
let copiesSincePrune = Number.POSITIVE_INFINITY;
let snapshotSequence = 0;

function nextSnapshotDirName(): string {
  snapshotSequence += 1;
  const stamp = Date.now().toString(36).padStart(9, "0");
  const order = snapshotSequence.toString(36).padStart(6, "0");
  return `${stamp}-${order}-${Math.random().toString(36).slice(2, 6)}`;
}

function normalizeViewedPath(path: string): string | undefined {
  const trimmed = path.trim();
  if (!trimmed || trimmed.startsWith("data:") || /^https?:\/\//i.test(trimmed)) return undefined;
  return resolve(trimmed);
}

function forgetSnapshotsUnder(dir: string): void {
  const prefix = dir + sep;
  for (const [fingerprint, target] of snapshotsByFingerprint) {
    if (target.startsWith(prefix)) snapshotsByFingerprint.delete(fingerprint);
  }
}

function pruneSnapshotDirs(): void {
  copiesSincePrune = 0;
  let entries: string[];
  try {
    entries = readdirSync(snapshotRoot).sort();
  } catch {
    return;
  }
  while (entries.length > maxSnapshotDirs) {
    const oldest = entries.shift();
    if (!oldest) break;
    const dir = join(snapshotRoot, oldest);
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      continue;
    }
    forgetSnapshotsUnder(dir);
  }
}

function rememberSnapshot(fingerprint: string, target: string): void {
  snapshotsByFingerprint.delete(fingerprint);
  snapshotsByFingerprint.set(fingerprint, target);
  while (snapshotsByFingerprint.size > maxSnapshotDirs) {
    const oldest = snapshotsByFingerprint.keys().next().value;
    if (oldest === undefined) break;
    snapshotsByFingerprint.delete(oldest);
  }
  copiesSincePrune += 1;
  if (copiesSincePrune >= pruneEvery) pruneSnapshotDirs();
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
  if (cached) snapshotsByFingerprint.delete(fingerprint);
  const dir = join(snapshotRoot, nextSnapshotDirName());
  const target = join(dir, basename(normalized));
  try {
    mkdirSync(dir, { recursive: true });
    copyFileSync(normalized, target);
  } catch {
    return undefined;
  }
  rememberSnapshot(fingerprint, target);
  return target;
}

export function configureViewedMediaSnapshotsForTests(options?: {
  maxDirs?: number;
  pruneEvery?: number;
  root?: string;
}): void {
  snapshotRoot = options?.root ? resolve(options.root) : DEFAULT_SNAPSHOT_ROOT;
  maxSnapshotDirs = options?.maxDirs ?? DEFAULT_MAX_SNAPSHOT_DIRS;
  pruneEvery = options?.pruneEvery ?? DEFAULT_PRUNE_EVERY;
  snapshotsByFingerprint.clear();
  copiesSincePrune = Number.POSITIVE_INFINITY;
}

export function viewedMediaSnapshotCacheSizeForTests(): number {
  return snapshotsByFingerprint.size;
}
