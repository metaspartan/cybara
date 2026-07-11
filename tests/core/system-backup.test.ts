import { afterEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  applyPendingSystemRestore,
  createSystemBackup,
  deleteSystemBackup,
  listSystemBackups,
  readSystemRestoreStatus,
  scheduleSystemRestore,
} from "../../src/core/system-backup";

const roots: string[] = [];

function createRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "cybara-system-backup-"));
  roots.push(root);
  mkdirSync(join(root, "data"), { recursive: true });
  mkdirSync(join(root, "memory"), { recursive: true });
  mkdirSync(join(root, "logs"), { recursive: true });
  return root;
}

function writeDatabase(path: string, value: string): void {
  const database = new Database(path);
  database.exec("CREATE TABLE IF NOT EXISTS state (value TEXT NOT NULL)");
  database.exec("DELETE FROM state");
  database.query("INSERT INTO state (value) VALUES (?)").run(value);
  database.close();
}

function readDatabase(path: string): string {
  const database = new Database(path, { readonly: true });
  try {
    return (
      database.query("SELECT value FROM state LIMIT 1").get() as {
        value: string;
      }
    ).value;
  } finally {
    database.close();
  }
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("system backups", () => {
  test("creates a consistent private backup without transient files or symlinks", () => {
    const root = createRoot();
    writeDatabase(join(root, "data", "platform.db"), "original");
    writeFileSync(join(root, "memory", "MEMORY.md"), "remember this");
    writeFileSync(join(root, "api_key"), "secret");
    writeFileSync(join(root, "logs", "gateway.log"), "transient");
    symlinkSync(join(root, "api_key"), join(root, "linked-secret"));

    const backup = createSystemBackup("Before upgrade", root);
    const backupRoot = join(root, "backups", backup.id, "payload");

    expect(backup.label).toBe("Before upgrade");
    expect(backup.includesCredentials).toBe(true);
    expect(readDatabase(join(backupRoot, "data", "platform.db"))).toBe("original");
    expect(readFileSync(join(backupRoot, "memory", "MEMORY.md"), "utf8")).toBe("remember this");
    expect(readFileSync(join(backupRoot, "api_key"), "utf8")).toBe("secret");
    expect(existsSync(join(backupRoot, "logs"))).toBe(false);
    expect(existsSync(join(backupRoot, "linked-secret"))).toBe(false);
    expect(listSystemBackups(root).map((entry) => entry.id)).toEqual([backup.id]);
  });

  test("backs up an active gateway while ignoring locked browser databases", () => {
    const root = createRoot();
    const platformPath = join(root, "data", "platform.db");
    const channelDirectory = join(root, "channels", "auth");
    const channelPath = join(channelDirectory, "session.db");
    const browserDirectory = join(root, "browser", "profile");
    const browserPath = join(browserDirectory, "profile.db");
    mkdirSync(channelDirectory, { recursive: true });
    mkdirSync(browserDirectory, { recursive: true });
    mkdirSync(join(root, "lsp", "bin"), { recursive: true });
    mkdirSync(join(root, "memory", "transformers", "models"), {
      recursive: true,
    });
    writeFileSync(join(root, "lsp", "bin", "server"), "downloaded runtime");
    writeFileSync(join(root, "memory", "transformers", "models", "model.onnx"), "model");
    writeFileSync(join(root, "models_dev_cache.json"), "{}");
    writeDatabase(platformPath, "platform");
    writeDatabase(channelPath, "channel");
    writeDatabase(browserPath, "browser");
    const platform = new Database(platformPath);
    const channel = new Database(channelPath);
    const browser = new Database(browserPath);
    platform.exec("PRAGMA journal_mode = WAL");
    channel.exec("BEGIN EXCLUSIVE");
    browser.exec("BEGIN EXCLUSIVE");

    try {
      const backup = createSystemBackup("Live gateway", root);
      const payload = join(root, "backups", backup.id, "payload");
      expect(readDatabase(join(payload, "data", "platform.db"))).toBe("platform");
      expect(existsSync(join(payload, "channels", "auth", "session.db"))).toBe(true);
      expect(existsSync(join(payload, "browser"))).toBe(false);
      expect(existsSync(join(payload, "lsp"))).toBe(false);
      expect(existsSync(join(payload, "memory", "transformers"))).toBe(false);
      expect(existsSync(join(payload, "models_dev_cache.json"))).toBe(false);
      expect(existsSync(join(payload, "kanban.db-shm"))).toBe(false);
    } finally {
      browser.exec("ROLLBACK");
      channel.exec("ROLLBACK");
      browser.close();
      channel.close();
      platform.close();
    }
  });

  test("restores durable state on the next startup while preserving excluded logs", () => {
    const root = createRoot();
    const databasePath = join(root, "data", "platform.db");
    const memoryPath = join(root, "memory", "MEMORY.md");
    const logPath = join(root, "logs", "gateway.log");
    writeDatabase(databasePath, "before");
    writeFileSync(memoryPath, "before");
    writeFileSync(logPath, "old log");
    const backup = createSystemBackup("Restore point", root);
    writeDatabase(databasePath, "after");
    writeFileSync(memoryPath, "after");
    writeFileSync(logPath, "new log");
    writeFileSync(`${databasePath}-wal`, "stale platform wal");
    writeFileSync(join(root, "memory", "vectors.db-wal"), "stale vector wal");
    writeFileSync(join(root, "kanban.db-wal"), "stale kanban wal");

    const pending = scheduleSystemRestore(backup.id, root);
    expect(pending.state).toBe("pending");
    expect(readSystemRestoreStatus(root).state).toBe("pending");

    const restored = applyPendingSystemRestore(root);
    expect(restored.state).toBe("completed");
    expect(readDatabase(databasePath)).toBe("before");
    expect(readFileSync(memoryPath, "utf8")).toBe("before");
    expect(readFileSync(logPath, "utf8")).toBe("new log");
    expect(existsSync(`${databasePath}-wal`)).toBe(false);
    expect(existsSync(join(root, "memory", "vectors.db-wal"))).toBe(false);
    expect(existsSync(join(root, "kanban.db-wal"))).toBe(false);
    expect(readSystemRestoreStatus(root).state).toBe("completed");
  });

  test("rejects invalid identifiers and deletes valid backups", () => {
    const root = createRoot();
    writeDatabase(join(root, "data", "platform.db"), "value");
    const backup = createSystemBackup("Temporary", root);

    expect(() => scheduleSystemRestore("../../escape", root)).toThrow("Invalid backup id");
    expect(deleteSystemBackup(backup.id, root)).toBe(true);
    expect(deleteSystemBackup(backup.id, root)).toBe(false);
  });
});
