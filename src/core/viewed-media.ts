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
import {
  imageExtensionOf,
  imageMimeForPath,
  isHeicMimeType,
  isImagePath,
} from "../../shared/image-formats";
import { convertHeicWithEmbeddedDecoder } from "./llm/heic-converter";
import { convertRasterToPng } from "./llm/raster-decoders";
import { cybaraDir } from "./paths";

const MAX_SNAPSHOT_BYTES = 25 * 1024 * 1024;
const DEFAULT_MAX_SNAPSHOT_DIRS = 400;
const DEFAULT_PRUNE_EVERY = 25;
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

export type ViewedMediaHeicConverter = (options: {
  buffer: Uint8Array;
  format: "JPEG";
  quality: number;
}) => Promise<Uint8Array>;

function isRasterConversionPath(path: string): boolean {
  const mime = imageMimeForPath(path);
  return mime === "image/tiff" || mime === "image/bmp";
}

function isHeicPath(path: string): boolean {
  return isHeicMimeType(`image/${imageExtensionOf(path).slice(1)}`);
}

export async function snapshotViewedMedia(
  path: string,
  convertHeic: ViewedMediaHeicConverter = convertHeicWithEmbeddedDecoder
): Promise<string | undefined> {
  const normalized = normalizeViewedPath(path);
  if (!normalized) return undefined;
  if (isViewedMediaSnapshot(normalized)) return normalized;
  if (!isImagePath(normalized)) return undefined;
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
  const heic = isHeicPath(normalized);
  const raster = isRasterConversionPath(normalized);
  const name = basename(normalized);
  const stem = name.slice(0, name.length - extname(name).length);
  const target = join(dir, heic ? `${stem}.jpg` : raster ? `${stem}.png` : name);
  try {
    mkdirSync(dir, { recursive: true });
    if (heic) {
      const converted = await convertHeic({
        buffer: readFileSync(normalized),
        format: "JPEG",
        quality: 0.9,
      });
      if (converted.length === 0) return undefined;
      writeFileSync(target, converted);
    } else if (raster) {
      const png = convertRasterToPng(readFileSync(normalized));
      if (!png) return undefined;
      writeFileSync(target, png);
    } else {
      copyFileSync(normalized, target);
    }
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
