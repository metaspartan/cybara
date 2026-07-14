import { Database } from "bun:sqlite";
import { randomBytes } from "crypto";
import {
  chmodSync,
  constants,
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "fs";
import { basename, dirname, join, relative, resolve, sep } from "path";
import { cybaraDir } from "./paths";
import { unwrapStorageKey, wrapStorageKey } from "./secret-storage";

export type SystemBackupKeyProtection = "local" | "password";

export interface SystemBackupManifest {
  version: 1;
  id: string;
  label: string;
  createdAt: string;
  entries: string[];
  includesCredentials: true;
  keyProtection?: SystemBackupKeyProtection;
}

export interface SystemBackupSummary extends SystemBackupManifest {
  bytes: number;
}

export interface SystemRestoreStatus {
  state: "idle" | "pending" | "completed" | "failed";
  backupId?: string;
  updatedAt?: string;
  error?: string;
}

const backupDirectoryName = "backups";
const payloadDirectoryName = "payload";
const manifestFileName = "manifest.json";
const pendingRestoreFileName = "restore-pending.json";
const restoreStatusFileName = "restore-status.json";
const excludedTopLevelNames = new Set([
  backupDirectoryName,
  "browser",
  "cache",
  "lsp",
  "logs",
  "models_dev_cache.json",
  "temp",
  "tool-results",
  "cybara.pid",
  "cybara.log",
  "cybargateway.log",
  pendingRestoreFileName,
  restoreStatusFileName,
  ".DS_Store",
]);
const managedSQLitePaths = new Set(["data/platform.db", "kanban.db", "memory/vectors.db"]);
const secureDirectoryName = "secure";
const storageKeyFileName = "storage.key";
const storageKeyRelativePath = `${secureDirectoryName}/${storageKeyFileName}`;
const protectedStorageKeyFileName = "storage.key.enc";
const protectedStorageKeyRelativePath = `${secureDirectoryName}/${protectedStorageKeyFileName}`;

interface BackupCopyOptions {
  root: string;
  snapshotManagedDatabases: boolean;
}

function backupsDirectory(root: string): string {
  return join(root, backupDirectoryName);
}

function ensurePrivateDirectory(path: string): void {
  mkdirSync(path, { recursive: true, mode: 0o700 });
  try {
    chmodSync(path, 0o700);
  } catch {}
}

function safeTopLevelName(value: string): boolean {
  return (
    value.length > 0 &&
    value === basename(value) &&
    value !== "." &&
    value !== ".." &&
    !value.startsWith(".") &&
    !value.includes("\0") &&
    !excludedTopLevelNames.has(value)
  );
}

function safeBackupId(value: string): boolean {
  return /^backup_[a-z0-9_-]{8,80}$/.test(value);
}

function containedPath(root: string, child: string): string {
  const resolvedRoot = resolve(root);
  const resolvedChild = resolve(child);
  if (resolvedChild !== resolvedRoot && !resolvedChild.startsWith(`${resolvedRoot}${sep}`)) {
    throw new Error("Backup path escaped the configured data directory");
  }
  return resolvedChild;
}

function sqliteSnapshot(source: string, destination: string, root: string): void {
  rmSync(destination, { force: true });
  const database = new Database(source);
  try {
    database.exec("PRAGMA busy_timeout = 5000");
    database.query("PRAGMA wal_checkpoint(TRUNCATE)").get();
    copyFileSync(source, destination, constants.COPYFILE_FICLONE);
    const snapshot = new Database(destination);
    try {
      snapshot.exec("PRAGMA journal_mode = DELETE");
    } finally {
      snapshot.close();
    }
  } catch (error) {
    const detail = error instanceof Error ? error.message : "SQLite snapshot failed";
    throw new Error(`Unable to snapshot ${portableRelativePath(root, source)}: ${detail}`);
  } finally {
    database.close();
  }
  try {
    chmodSync(destination, 0o600);
  } catch {}
}

function portableRelativePath(root: string, path: string): string {
  return relative(root, path).split(sep).join("/");
}

function isManagedSQLiteDatabase(source: string, options: BackupCopyOptions): boolean {
  return managedSQLitePaths.has(portableRelativePath(options.root, source));
}

function skipSQLiteSidecar(source: string, options: BackupCopyOptions): boolean {
  if (source.endsWith(".db-shm") || source.endsWith(".db-journal")) return true;
  if (!source.endsWith(".db-wal")) return false;
  return (
    options.snapshotManagedDatabases &&
    isManagedSQLiteDatabase(source.slice(0, -"-wal".length), options)
  );
}

function excludedNestedPath(source: string, options: BackupCopyOptions): boolean {
  const path = portableRelativePath(options.root, source);
  if (path === protectedStorageKeyRelativePath) return true;
  if (!options.snapshotManagedDatabases) return false;
  if (path === storageKeyRelativePath) return true;
  return path === "memory/transformers" || path.startsWith("memory/transformers/");
}

function copyBackupEntry(source: string, destination: string, options: BackupCopyOptions): void {
  const stats = lstatSync(source);
  if (stats.isSymbolicLink()) return;
  if (stats.isDirectory()) {
    if (excludedNestedPath(source, options)) return;
    ensurePrivateDirectory(destination);
    for (const entry of readdirSync(source, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) continue;
      const entrySource = join(source, entry.name);
      if (skipSQLiteSidecar(entrySource, options) || excludedNestedPath(entrySource, options))
        continue;
      copyBackupEntry(entrySource, join(destination, entry.name), options);
    }
    return;
  }
  if (!stats.isFile()) return;
  ensurePrivateDirectory(dirname(destination));
  if (
    source.endsWith(".db") &&
    options.snapshotManagedDatabases &&
    isManagedSQLiteDatabase(source, options)
  ) {
    sqliteSnapshot(source, destination, options.root);
    return;
  }
  copyFileSync(source, destination);
}

function removeStagedStorageKey(payloadPath: string): void {
  const payloadSecurePath = join(payloadPath, secureDirectoryName);
  if (existsSync(join(payloadSecurePath, protectedStorageKeyFileName))) {
    rmSync(join(payloadSecurePath, storageKeyFileName), { force: true });
  }
}

function removeManagedSQLiteSidecars(root: string): void {
  for (const path of managedSQLitePaths) {
    const databasePath = join(root, ...path.split("/"));
    rmSync(`${databasePath}-wal`, { force: true });
    rmSync(`${databasePath}-shm`, { force: true });
    rmSync(`${databasePath}-journal`, { force: true });
  }
}

function directoryBytes(path: string): number {
  if (!existsSync(path)) return 0;
  const stats = lstatSync(path);
  if (stats.isSymbolicLink()) return 0;
  if (stats.isFile()) return stats.size;
  if (!stats.isDirectory()) return 0;
  return readdirSync(path).reduce((total, entry) => total + directoryBytes(join(path, entry)), 0);
}

function readManifest(backupPath: string): SystemBackupManifest | null {
  try {
    const parsed = JSON.parse(
      readFileSync(join(backupPath, manifestFileName), "utf8")
    ) as Partial<SystemBackupManifest>;
    if (
      parsed.version !== 1 ||
      typeof parsed.id !== "string" ||
      !safeBackupId(parsed.id) ||
      typeof parsed.label !== "string" ||
      typeof parsed.createdAt !== "string" ||
      !Array.isArray(parsed.entries) ||
      !parsed.entries.every((entry) => typeof entry === "string" && safeTopLevelName(entry))
    ) {
      return null;
    }
    return {
      version: 1,
      id: parsed.id,
      label: parsed.label,
      createdAt: parsed.createdAt,
      entries: parsed.entries,
      includesCredentials: true,
      keyProtection:
        parsed.keyProtection === "password" || parsed.keyProtection === "local"
          ? parsed.keyProtection
          : undefined,
    };
  } catch {
    return null;
  }
}

function backupPathForId(root: string, backupId: string): string {
  if (!safeBackupId(backupId)) throw new Error("Invalid backup id");
  return containedPath(backupsDirectory(root), join(backupsDirectory(root), backupId));
}

export interface SystemBackupOptions {
  password?: string;
}

export function createSystemBackup(
  label = "Manual backup",
  root = cybaraDir,
  options?: SystemBackupOptions
): SystemBackupSummary {
  ensurePrivateDirectory(root);
  const backupsRoot = backupsDirectory(root);
  ensurePrivateDirectory(backupsRoot);
  const id = `backup_${Date.now().toString(36)}_${randomBytes(4).toString("hex")}`;
  const temporaryPath = containedPath(backupsRoot, join(backupsRoot, `.tmp-${id}`));
  const finalPath = backupPathForId(root, id);
  const payloadPath = join(temporaryPath, payloadDirectoryName);
  ensurePrivateDirectory(payloadPath);
  const entries: string[] = [];
  const copyOptions: BackupCopyOptions = {
    root,
    snapshotManagedDatabases: true,
  };
  try {
    for (const entry of readdirSync(root, { withFileTypes: true })) {
      if (!safeTopLevelName(entry.name) || entry.isSymbolicLink()) continue;
      const entrySource = join(root, entry.name);
      if (skipSQLiteSidecar(entrySource, copyOptions)) continue;
      copyBackupEntry(entrySource, join(payloadPath, entry.name), copyOptions);
      entries.push(entry.name);
    }
    let keyProtection: SystemBackupKeyProtection = "local";
    const password = options?.password?.trim() ? options.password : undefined;
    const storageKeyPath = join(root, secureDirectoryName, storageKeyFileName);
    if (password && existsSync(storageKeyPath)) {
      const wrapped = wrapStorageKey(readFileSync(storageKeyPath), password);
      const payloadSecurePath = join(payloadPath, secureDirectoryName);
      ensurePrivateDirectory(payloadSecurePath);
      writeFileSync(join(payloadSecurePath, protectedStorageKeyFileName), wrapped, {
        mode: 0o600,
      });
      if (!entries.includes(secureDirectoryName)) entries.push(secureDirectoryName);
      keyProtection = "password";
    }
    const manifest: SystemBackupManifest = {
      version: 1,
      id,
      label: label.trim().slice(0, 120) || "Manual backup",
      createdAt: new Date().toISOString(),
      entries: entries.sort(),
      includesCredentials: true,
      keyProtection,
    };
    writeFileSync(join(temporaryPath, manifestFileName), `${JSON.stringify(manifest, null, 2)}\n`, {
      mode: 0o600,
    });
    renameSync(temporaryPath, finalPath);
    return { ...manifest, bytes: directoryBytes(finalPath) };
  } catch (error) {
    rmSync(temporaryPath, { recursive: true, force: true });
    throw error;
  }
}

export function listSystemBackups(root = cybaraDir): SystemBackupSummary[] {
  const backupsRoot = backupsDirectory(root);
  if (!existsSync(backupsRoot)) return [];
  return readdirSync(backupsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && safeBackupId(entry.name))
    .map((entry) => {
      const path = backupPathForId(root, entry.name);
      const manifest = readManifest(path);
      return manifest ? { ...manifest, bytes: directoryBytes(path) } : null;
    })
    .filter((entry): entry is SystemBackupSummary => entry !== null)
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

export function deleteSystemBackup(backupId: string, root = cybaraDir): boolean {
  const path = backupPathForId(root, backupId);
  if (!existsSync(path)) return false;
  rmSync(path, { recursive: true, force: true });
  return true;
}

export function scheduleSystemRestore(
  backupId: string,
  root = cybaraDir,
  password?: string
): SystemRestoreStatus {
  const backupPath = backupPathForId(root, backupId);
  const manifest = readManifest(backupPath);
  if (!manifest) throw new Error("Backup is missing or invalid");
  const payloadSecurePath = join(backupPath, payloadDirectoryName, secureDirectoryName);
  const protectedKeyPath = join(payloadSecurePath, protectedStorageKeyFileName);
  const trimmedPassword = password?.trim() ? password : undefined;
  if (existsSync(protectedKeyPath)) {
    if (trimmedPassword) {
      const key = unwrapStorageKey(readFileSync(protectedKeyPath, "utf8"), trimmedPassword);
      writeFileSync(join(payloadSecurePath, storageKeyFileName), key, { mode: 0o600 });
    }
  } else if (trimmedPassword) {
    throw new Error("This backup is not password protected");
  }
  const status: SystemRestoreStatus = {
    state: "pending",
    backupId,
    updatedAt: new Date().toISOString(),
  };
  writeFileSync(join(root, pendingRestoreFileName), `${JSON.stringify(status, null, 2)}\n`, {
    mode: 0o600,
  });
  writeFileSync(join(root, restoreStatusFileName), `${JSON.stringify(status, null, 2)}\n`, {
    mode: 0o600,
  });
  return status;
}

export function readSystemRestoreStatus(root = cybaraDir): SystemRestoreStatus {
  try {
    const parsed = JSON.parse(
      readFileSync(join(root, restoreStatusFileName), "utf8")
    ) as Partial<SystemRestoreStatus>;
    if (!parsed.state || !["idle", "pending", "completed", "failed"].includes(parsed.state)) {
      return { state: "idle" };
    }
    return {
      state: parsed.state,
      backupId: typeof parsed.backupId === "string" ? parsed.backupId : undefined,
      updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : undefined,
      error: typeof parsed.error === "string" ? parsed.error : undefined,
    };
  } catch {
    return { state: "idle" };
  }
}

export function applyPendingSystemRestore(root = cybaraDir): SystemRestoreStatus {
  const pendingPath = join(root, pendingRestoreFileName);
  if (!existsSync(pendingPath)) return readSystemRestoreStatus(root);
  let backupId = "";
  const rollbackPath = join(root, `.restore-rollback-${Date.now()}`);
  const installedTargets: string[] = [];
  const stagedTargets: string[] = [];
  const movedTargets: Array<{ target: string; rollback: string }> = [];
  try {
    const pending = JSON.parse(readFileSync(pendingPath, "utf8")) as {
      backupId?: unknown;
    };
    if (typeof pending.backupId !== "string" || !safeBackupId(pending.backupId)) {
      throw new Error("Pending restore has an invalid backup id");
    }
    backupId = pending.backupId;
    const backupPath = backupPathForId(root, backupId);
    const manifest = readManifest(backupPath);
    if (!manifest) throw new Error("Pending restore backup is missing or invalid");
    const payloadPath = join(backupPath, payloadDirectoryName);
    for (const entry of manifest.entries) {
      const source = containedPath(payloadPath, join(payloadPath, entry));
      if (!existsSync(source)) throw new Error(`Backup entry is missing: ${entry}`);
    }
    const liveStorageKeyPath = join(root, secureDirectoryName, storageKeyFileName);
    const preservedStorageKey = existsSync(liveStorageKeyPath)
      ? readFileSync(liveStorageKeyPath)
      : null;
    ensurePrivateDirectory(rollbackPath);
    const copyOptions: BackupCopyOptions = {
      root: payloadPath,
      snapshotManagedDatabases: false,
    };
    for (const entry of manifest.entries) {
      const source = containedPath(payloadPath, join(payloadPath, entry));
      const target = containedPath(root, join(root, entry));
      const staged = containedPath(root, join(root, `.restore-stage-${backupId}-${entry}`));
      const rollback = join(rollbackPath, entry);
      rmSync(staged, { recursive: true, force: true });
      copyBackupEntry(source, staged, copyOptions);
      stagedTargets.push(staged);
      if (existsSync(target)) {
        ensurePrivateDirectory(dirname(rollback));
        renameSync(target, rollback);
        movedTargets.push({ target, rollback });
      }
      renameSync(staged, target);
      stagedTargets.splice(stagedTargets.indexOf(staged), 1);
      installedTargets.push(target);
    }
    if (!existsSync(liveStorageKeyPath) && preservedStorageKey) {
      ensurePrivateDirectory(join(root, secureDirectoryName));
      writeFileSync(liveStorageKeyPath, preservedStorageKey, { mode: 0o600 });
    }
    removeStagedStorageKey(payloadPath);
    removeManagedSQLiteSidecars(root);
    rmSync(rollbackPath, { recursive: true, force: true });
    rmSync(pendingPath, { force: true });
    const status: SystemRestoreStatus = {
      state: "completed",
      backupId,
      updatedAt: new Date().toISOString(),
    };
    writeFileSync(join(root, restoreStatusFileName), `${JSON.stringify(status, null, 2)}\n`, {
      mode: 0o600,
    });
    return status;
  } catch (error) {
    for (const staged of stagedTargets) {
      rmSync(staged, { recursive: true, force: true });
    }
    for (const target of installedTargets.reverse()) {
      rmSync(target, { recursive: true, force: true });
    }
    for (const moved of movedTargets.reverse()) {
      if (existsSync(moved.rollback)) renameSync(moved.rollback, moved.target);
    }
    if (backupId) {
      try {
        removeStagedStorageKey(join(backupPathForId(root, backupId), payloadDirectoryName));
      } catch {}
    }
    rmSync(rollbackPath, { recursive: true, force: true });
    rmSync(pendingPath, { force: true });
    const status: SystemRestoreStatus = {
      state: "failed",
      backupId: backupId || undefined,
      updatedAt: new Date().toISOString(),
      error: error instanceof Error ? error.message : "Restore failed",
    };
    writeFileSync(join(root, restoreStatusFileName), `${JSON.stringify(status, null, 2)}\n`, {
      mode: 0o600,
    });
    return status;
  }
}

export function systemBackupDirectory(root = cybaraDir): string {
  return backupsDirectory(root);
}
