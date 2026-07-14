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

  test("never copies the credential encryption key into a backup payload", () => {
    const root = createRoot();
    mkdirSync(join(root, "secure"), { recursive: true });
    const keyBytes = Buffer.alloc(32, 7);
    writeFileSync(join(root, "secure", "storage.key"), keyBytes);
    writeFileSync(join(root, "secure", "mobile-devices.json"), "{}");
    writeDatabase(join(root, "data", "platform.db"), "sealed-data");

    const backup = createSystemBackup("Key exclusion", root);
    const payload = join(root, "backups", backup.id, "payload");

    expect(backup.keyProtection).toBe("local");
    expect(existsSync(join(payload, "secure", "storage.key"))).toBe(false);
    expect(existsSync(join(payload, "secure", "storage.key.enc"))).toBe(false);
    expect(existsSync(join(payload, "secure", "mobile-devices.json"))).toBe(true);
    expect(existsSync(join(payload, "data", "platform.db"))).toBe(true);
  });

  test("preserves the machine-local encryption key across a restore", () => {
    const root = createRoot();
    mkdirSync(join(root, "secure"), { recursive: true });
    const keyBytes = Buffer.alloc(32, 7);
    writeFileSync(join(root, "secure", "storage.key"), keyBytes);
    writeFileSync(join(root, "secure", "mobile-devices.json"), "before");
    writeDatabase(join(root, "data", "platform.db"), "before");

    const backup = createSystemBackup("Restore point", root);
    writeFileSync(join(root, "secure", "mobile-devices.json"), "after");
    writeDatabase(join(root, "data", "platform.db"), "after");

    scheduleSystemRestore(backup.id, root);
    const restored = applyPendingSystemRestore(root);

    expect(restored.state).toBe("completed");
    expect(readDatabase(join(root, "data", "platform.db"))).toBe("before");
    expect(readFileSync(join(root, "secure", "mobile-devices.json"), "utf8")).toBe("before");
    expect(readFileSync(join(root, "secure", "storage.key"))).toEqual(keyBytes);
  });

  test("wraps the encryption key under a password and restores it with that password", () => {
    const root = createRoot();
    mkdirSync(join(root, "secure"), { recursive: true });
    const keyBytes = Buffer.alloc(32, 9);
    writeFileSync(join(root, "secure", "storage.key"), keyBytes);
    writeDatabase(join(root, "data", "platform.db"), "portable");

    const backup = createSystemBackup("Portable", root, { password: "correct horse" });
    const payload = join(root, "backups", backup.id, "payload");

    expect(backup.keyProtection).toBe("password");
    expect(existsSync(join(payload, "secure", "storage.key"))).toBe(false);
    const wrapped = readFileSync(join(payload, "secure", "storage.key.enc"), "utf8");
    expect(wrapped).toStartWith("cybara-keybackup:v1:");
    expect(wrapped).not.toContain(keyBytes.toString("base64url"));

    expect(() => scheduleSystemRestore(backup.id, root, "wrong password")).toThrow();

    rmSync(join(root, "secure", "storage.key"));
    scheduleSystemRestore(backup.id, root, "correct horse");
    const restored = applyPendingSystemRestore(root);

    expect(restored.state).toBe("completed");
    expect(readFileSync(join(root, "secure", "storage.key"))).toEqual(keyBytes);
    expect(existsSync(join(payload, "secure", "storage.key"))).toBe(false);
  });

  test("rejects a restore password for a backup that is not password protected", () => {
    const root = createRoot();
    writeDatabase(join(root, "data", "platform.db"), "value");
    const backup = createSystemBackup("Plain", root);

    expect(() => scheduleSystemRestore(backup.id, root, "some password")).toThrow(
      "This backup is not password protected"
    );
  });

  test("restores a legacy backup that still bundles the raw encryption key", () => {
    const root = createRoot();
    mkdirSync(join(root, "secure"), { recursive: true });
    const legacyKey = Buffer.alloc(32, 3);
    writeFileSync(join(root, "secure", "storage.key"), legacyKey);
    writeDatabase(join(root, "data", "platform.db"), "legacy-sealed-data");

    const seed = createSystemBackup("seed", root);
    const legacyId = "backup_legacyfmt_00000001";
    const legacyDir = join(root, "backups", legacyId);
    const legacyPayload = join(legacyDir, "payload");
    mkdirSync(join(legacyPayload, "secure"), { recursive: true });
    mkdirSync(join(legacyPayload, "data"), { recursive: true });
    writeFileSync(join(legacyPayload, "secure", "storage.key"), legacyKey);
    writeFileSync(
      join(legacyPayload, "data", "platform.db"),
      readFileSync(join(root, "backups", seed.id, "payload", "data", "platform.db"))
    );
    writeFileSync(
      join(legacyDir, "manifest.json"),
      `${JSON.stringify({
        version: 1,
        id: legacyId,
        label: "legacy",
        createdAt: new Date(0).toISOString(),
        entries: ["data", "secure"],
        includesCredentials: true,
      })}\n`
    );

    const listed = listSystemBackups(root).find((entry) => entry.id === legacyId);
    expect(listed).toBeDefined();
    expect(listed?.keyProtection).toBeUndefined();

    writeFileSync(join(root, "secure", "storage.key"), Buffer.alloc(32, 255));
    writeDatabase(join(root, "data", "platform.db"), "clobbered");

    scheduleSystemRestore(legacyId, root);
    const restored = applyPendingSystemRestore(root);

    expect(restored.state).toBe("completed");
    expect(readFileSync(join(root, "secure", "storage.key"))).toEqual(legacyKey);
    expect(readDatabase(join(root, "data", "platform.db"))).toBe("legacy-sealed-data");
  });

  test("does not leak the wrapped key into the live dir or later backups", () => {
    const root = createRoot();
    mkdirSync(join(root, "secure"), { recursive: true });
    const keyBytes = Buffer.alloc(32, 11);
    writeFileSync(join(root, "secure", "storage.key"), keyBytes);
    writeFileSync(join(root, "secure", "mobile-devices.json"), "{}");
    writeDatabase(join(root, "data", "platform.db"), "sealed");

    const backup = createSystemBackup("Portable", root, { password: "pw-abcdef" });
    rmSync(join(root, "secure", "storage.key"));
    scheduleSystemRestore(backup.id, root, "pw-abcdef");
    const restored = applyPendingSystemRestore(root);

    expect(restored.state).toBe("completed");
    const liveSecure = readFileSync(join(root, "secure", "storage.key"));
    expect(liveSecure).toEqual(keyBytes);
    expect(existsSync(join(root, "secure", "storage.key.enc"))).toBe(false);

    const next = createSystemBackup("After restore", root);
    const nextSecure = join(root, "backups", next.id, "payload", "secure");
    expect(existsSync(join(nextSecure, "storage.key"))).toBe(false);
    expect(existsSync(join(nextSecure, "storage.key.enc"))).toBe(false);
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
