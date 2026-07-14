import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "fs";
import { tmpdir } from "os";
import { basename, dirname, extname, isAbsolute, join, relative, resolve } from "path";
import { Open } from "unzipper";

import { CYBARA_PLUGIN_MANIFEST, installLocalPluginFromPath, validatePluginAtPath } from "./index";
import type { InstalledCybaraPlugin, PluginValidationResult } from "./types";

export const MAX_PLUGIN_BUNDLE_BYTES = 32 * 1024 * 1024;
export const MAX_PLUGIN_BUNDLE_FILES = 2_000;
export const MAX_PLUGIN_EXPANDED_BYTES = 128 * 1024 * 1024;

export type PluginBundleFile = {
  path: string;
  dataBase64: string;
};

export type PluginInstallPayload = {
  path?: string;
  archive?: {
    name: string;
    dataBase64: string;
  };
  files?: PluginBundleFile[];
};

function readRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function normalizeRelativeBundlePath(value: string): string {
  const normalized = value.replaceAll("\\", "/").replace(/^\.\//, "").replace(/\/$/, "");
  if (
    !normalized ||
    normalized.includes("\0") ||
    normalized.startsWith("/") ||
    normalized.startsWith("~") ||
    /^[a-zA-Z]:/.test(normalized)
  ) {
    throw new Error(`Unsafe plugin bundle path: ${value}`);
  }
  const segments = normalized.split("/");
  if (segments.some((segment) => !segment || segment === "." || segment === "..")) {
    throw new Error(`Unsafe plugin bundle path: ${value}`);
  }
  return segments.join("/");
}

export function validatePluginArchiveEntries(entries: string[]): string[] {
  const populatedEntries = entries.filter((entry) => entry.trim());
  if (populatedEntries.length === 0) throw new Error("Plugin ZIP is empty");
  if (populatedEntries.length > MAX_PLUGIN_BUNDLE_FILES) {
    throw new Error(`Plugin ZIP contains more than ${MAX_PLUGIN_BUNDLE_FILES} entries`);
  }
  const normalized = populatedEntries.map((entry) => normalizeRelativeBundlePath(entry.trim()));
  if (new Set(normalized).size !== normalized.length) {
    throw new Error("Plugin ZIP contains duplicate paths");
  }
  return normalized;
}

function findZipEnd(bytes: Buffer): number {
  const minimum = Math.max(0, bytes.length - 65_557);
  for (let offset = bytes.length - 22; offset >= minimum; offset -= 1) {
    if (bytes.readUInt32LE(offset) === 0x06054b50) return offset;
  }
  throw new Error("Plugin ZIP is missing its end record");
}

function inspectZipArchive(archivePath: string): string[] {
  const bytes = readFileSync(archivePath);
  const endOffset = findZipEnd(bytes);
  const disk = bytes.readUInt16LE(endOffset + 4);
  const centralDisk = bytes.readUInt16LE(endOffset + 6);
  const diskEntries = bytes.readUInt16LE(endOffset + 8);
  const totalEntries = bytes.readUInt16LE(endOffset + 10);
  const centralSize = bytes.readUInt32LE(endOffset + 12);
  const centralOffset = bytes.readUInt32LE(endOffset + 16);
  if (disk !== 0 || centralDisk !== 0 || diskEntries !== totalEntries) {
    throw new Error("Multi-volume plugin ZIP files are not supported");
  }
  if (totalEntries === 0 || totalEntries > MAX_PLUGIN_BUNDLE_FILES) {
    throw new Error(`Plugin ZIP must contain between 1 and ${MAX_PLUGIN_BUNDLE_FILES} entries`);
  }
  if (centralOffset + centralSize > endOffset) {
    throw new Error("Plugin ZIP central directory is invalid");
  }

  const names: string[] = [];
  let expandedBytes = 0;
  let cursor = centralOffset;
  for (let index = 0; index < totalEntries; index += 1) {
    if (cursor + 46 > bytes.length || bytes.readUInt32LE(cursor) !== 0x02014b50) {
      throw new Error("Plugin ZIP central directory is malformed");
    }
    const madeByPlatform = bytes.readUInt16LE(cursor + 4) >>> 8;
    const flags = bytes.readUInt16LE(cursor + 8);
    const compressedSize = bytes.readUInt32LE(cursor + 20);
    const expandedSize = bytes.readUInt32LE(cursor + 24);
    const nameLength = bytes.readUInt16LE(cursor + 28);
    const extraLength = bytes.readUInt16LE(cursor + 30);
    const commentLength = bytes.readUInt16LE(cursor + 32);
    const externalAttributes = bytes.readUInt32LE(cursor + 38);
    const localOffset = bytes.readUInt32LE(cursor + 42);
    if (
      compressedSize === 0xffffffff ||
      expandedSize === 0xffffffff ||
      localOffset === 0xffffffff
    ) {
      throw new Error("ZIP64 plugin bundles are not supported");
    }
    if ((flags & 1) !== 0) throw new Error("Encrypted plugin ZIP entries are not supported");
    const nameStart = cursor + 46;
    const nameEnd = nameStart + nameLength;
    const nextCursor = nameEnd + extraLength + commentLength;
    if (nameEnd > bytes.length || nextCursor > bytes.length) {
      throw new Error("Plugin ZIP entry metadata is invalid");
    }
    const name = bytes.subarray(nameStart, nameEnd).toString("utf8");
    if (localOffset + 30 > bytes.length || bytes.readUInt32LE(localOffset) !== 0x04034b50) {
      throw new Error(`Plugin ZIP local header is invalid: ${name}`);
    }
    const localNameLength = bytes.readUInt16LE(localOffset + 26);
    const localNameStart = localOffset + 30;
    const localNameEnd = localNameStart + localNameLength;
    if (
      localNameEnd > bytes.length ||
      bytes.subarray(localNameStart, localNameEnd).toString("utf8") !== name
    ) {
      throw new Error(`Plugin ZIP local path does not match its directory entry: ${name}`);
    }
    if (madeByPlatform === 3) {
      const unixMode = externalAttributes >>> 16;
      if ((unixMode & 0o170000) === 0o120000) {
        throw new Error(`Plugin ZIP cannot contain symbolic links: ${name}`);
      }
    }
    expandedBytes += expandedSize;
    if (expandedBytes > MAX_PLUGIN_EXPANDED_BYTES) {
      throw new Error("Plugin ZIP expands beyond the allowed size");
    }
    names.push(name);
    cursor = nextCursor;
  }
  if (cursor !== centralOffset + centralSize) {
    throw new Error("Plugin ZIP central directory size does not match its entries");
  }
  return validatePluginArchiveEntries(names);
}

function scanExtractedBundle(rootDir: string): void {
  const pending = [rootDir];
  let fileCount = 0;
  let totalBytes = 0;
  while (pending.length > 0) {
    const current = pending.pop();
    if (!current) continue;
    for (const entry of readdirSync(current)) {
      const entryPath = join(current, entry);
      const stats = lstatSync(entryPath);
      if (stats.isSymbolicLink()) {
        throw new Error(`Plugin bundles cannot contain symbolic links: ${entry}`);
      }
      if (stats.isDirectory()) {
        pending.push(entryPath);
        continue;
      }
      if (!stats.isFile()) {
        throw new Error(`Plugin bundles can only contain files and directories: ${entry}`);
      }
      fileCount += 1;
      totalBytes += stats.size;
      if (fileCount > MAX_PLUGIN_BUNDLE_FILES) {
        throw new Error(`Plugin bundle contains more than ${MAX_PLUGIN_BUNDLE_FILES} files`);
      }
      if (totalBytes > MAX_PLUGIN_EXPANDED_BYTES) {
        throw new Error("Plugin bundle expands beyond the allowed size");
      }
    }
  }
}

export function findPluginRoot(rootDir: string): string {
  const pending = [rootDir];
  const manifests: string[] = [];
  while (pending.length > 0) {
    const current = pending.pop();
    if (!current) continue;
    for (const entry of readdirSync(current)) {
      if (entry === "__MACOSX" || entry === ".DS_Store") continue;
      const entryPath = join(current, entry);
      const stats = lstatSync(entryPath);
      if (stats.isSymbolicLink()) throw new Error("Plugin bundles cannot contain symbolic links");
      if (stats.isDirectory()) {
        pending.push(entryPath);
      } else if (stats.isFile() && entry === CYBARA_PLUGIN_MANIFEST) {
        manifests.push(entryPath);
      }
    }
  }
  if (manifests.length === 0) throw new Error(`Plugin bundle is missing ${CYBARA_PLUGIN_MANIFEST}`);
  if (manifests.length > 1) throw new Error("Plugin bundle contains multiple plugin manifests");
  return dirname(manifests[0]);
}

function decodeBase64(value: string): Buffer {
  const compact = value.replace(/\s/g, "");
  if (!compact || compact.length > Math.ceil((MAX_PLUGIN_BUNDLE_BYTES * 4) / 3) + 4) {
    throw new Error("Plugin bundle exceeds the allowed upload size");
  }
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(compact) || compact.length % 4 !== 0) {
    throw new Error("Plugin bundle contains invalid base64 data");
  }
  const bytes = Buffer.from(compact, "base64");
  if (bytes.byteLength > MAX_PLUGIN_BUNDLE_BYTES) {
    throw new Error("Plugin bundle exceeds the allowed upload size");
  }
  return bytes;
}

async function extractInspectedArchive(archivePath: string, extractedRoot: string): Promise<void> {
  const directory = await Open.file(archivePath);
  const names = validatePluginArchiveEntries(directory.files.map((entry) => entry.path));
  mkdirSync(extractedRoot, { recursive: true });
  for (let index = 0; index < directory.files.length; index += 1) {
    const entry = directory.files[index];
    const entryPath = names[index];
    const targetPath = resolve(extractedRoot, entryPath);
    const targetRelativePath = relative(extractedRoot, targetPath);
    if (targetRelativePath.startsWith("..") || isAbsolute(targetRelativePath)) {
      throw new Error(`Unsafe plugin bundle path: ${entry.path}`);
    }
    if (entry.type === "Directory") {
      mkdirSync(targetPath, { recursive: true });
      continue;
    }
    if (entry.type !== "File") {
      throw new Error(`Plugin ZIP contains an unsupported entry: ${entry.path}`);
    }
    const bytes = await entry.buffer();
    if (bytes.byteLength !== entry.uncompressedSize) {
      throw new Error(`Plugin ZIP entry size does not match its metadata: ${entry.path}`);
    }
    mkdirSync(dirname(targetPath), { recursive: true });
    writeFileSync(targetPath, bytes);
  }
}

async function prepareArchive(archivePath: string, tempRoot: string): Promise<string> {
  if (extname(archivePath).toLowerCase() !== ".zip") {
    throw new Error("Plugin archives must use the .zip format");
  }
  if (statSync(archivePath).size > MAX_PLUGIN_BUNDLE_BYTES) {
    throw new Error("Plugin ZIP exceeds the allowed upload size");
  }
  inspectZipArchive(archivePath);
  const extractedRoot = join(tempRoot, "extracted");
  await extractInspectedArchive(archivePath, extractedRoot);
  scanExtractedBundle(extractedRoot);
  return findPluginRoot(extractedRoot);
}

function prepareUploadedFiles(files: PluginBundleFile[], tempRoot: string): string {
  if (files.length === 0) throw new Error("Plugin folder upload is empty");
  if (files.length > MAX_PLUGIN_BUNDLE_FILES) {
    throw new Error(`Plugin folder contains more than ${MAX_PLUGIN_BUNDLE_FILES} files`);
  }
  const uploadRoot = join(tempRoot, "folder");
  mkdirSync(uploadRoot, { recursive: true });
  let totalBytes = 0;
  for (const file of files) {
    const relativePath = normalizeRelativeBundlePath(file.path);
    const bytes = decodeBase64(file.dataBase64);
    totalBytes += bytes.byteLength;
    if (totalBytes > MAX_PLUGIN_BUNDLE_BYTES) {
      throw new Error("Plugin folder exceeds the allowed upload size");
    }
    const targetPath = resolve(uploadRoot, relativePath);
    const targetRelativePath = relative(uploadRoot, targetPath);
    if (targetRelativePath.startsWith("..") || isAbsolute(targetRelativePath)) {
      throw new Error(`Unsafe plugin bundle path: ${file.path}`);
    }
    mkdirSync(dirname(targetPath), { recursive: true });
    writeFileSync(targetPath, bytes);
  }
  scanExtractedBundle(uploadRoot);
  return findPluginRoot(uploadRoot);
}

export function parsePluginInstallPayload(value: unknown): PluginInstallPayload {
  const record = readRecord(value);
  if (!record) throw new Error("Plugin install payload is required");
  const path = typeof record.path === "string" ? record.path.trim() : "";
  const archiveRecord = readRecord(record.archive);
  const archive = archiveRecord
    ? {
        name: typeof archiveRecord.name === "string" ? basename(archiveRecord.name.trim()) : "",
        dataBase64:
          typeof archiveRecord.dataBase64 === "string" ? archiveRecord.dataBase64.trim() : "",
      }
    : undefined;
  const files = Array.isArray(record.files)
    ? record.files.map((entry) => {
        const file = readRecord(entry);
        return {
          path: typeof file?.path === "string" ? file.path : "",
          dataBase64: typeof file?.dataBase64 === "string" ? file.dataBase64 : "",
        };
      })
    : undefined;
  const sources = [Boolean(path), Boolean(archive), Boolean(files)].filter(Boolean).length;
  if (sources !== 1) throw new Error("Choose exactly one plugin folder or ZIP source");
  if (archive && (!archive.name || !archive.dataBase64)) {
    throw new Error("Plugin ZIP name and data are required");
  }
  if (files?.some((file) => !file.path || !file.dataBase64)) {
    throw new Error("Every plugin folder entry requires a path and data");
  }
  return {
    ...(path ? { path } : {}),
    ...(archive ? { archive } : {}),
    ...(files ? { files } : {}),
  };
}

async function withPreparedPluginRoot<T>(
  payload: PluginInstallPayload,
  callback: (rootDir: string) => T | Promise<T>
): Promise<T> {
  const tempRoot = mkdtempSync(join(tmpdir(), "cybara-plugin-bundle-"));
  try {
    if (payload.path) {
      const sourcePath = payload.path.startsWith("~")
        ? join(process.env.HOME || process.env.USERPROFILE || "", payload.path.slice(1))
        : resolve(payload.path);
      if (!existsSync(sourcePath)) throw new Error(`Plugin path not found: ${sourcePath}`);
      if (statSync(sourcePath).isFile() && extname(sourcePath).toLowerCase() === ".zip") {
        return callback(await prepareArchive(sourcePath, tempRoot));
      }
      return callback(sourcePath);
    }
    if (payload.archive) {
      if (extname(payload.archive.name).toLowerCase() !== ".zip") {
        throw new Error("Plugin archives must use the .zip format");
      }
      const archivePath = join(tempRoot, payload.archive.name);
      writeFileSync(archivePath, decodeBase64(payload.archive.dataBase64));
      return callback(await prepareArchive(archivePath, tempRoot));
    }
    if (payload.files) return callback(prepareUploadedFiles(payload.files, tempRoot));
    throw new Error("Plugin folder or ZIP is required");
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
}

export async function validatePluginInstallPayload(
  payload: PluginInstallPayload
): Promise<PluginValidationResult> {
  try {
    return await withPreparedPluginRoot(payload, (rootDir) => validatePluginAtPath(rootDir));
  } catch (error) {
    return {
      valid: false,
      errors: [error instanceof Error ? error.message : String(error)],
      warnings: [],
    };
  }
}

export async function installPluginFromPayload(
  payload: PluginInstallPayload
): Promise<InstalledCybaraPlugin> {
  return withPreparedPluginRoot(payload, (rootDir) => installLocalPluginFromPath(rootDir));
}
