import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdirSync, mkdtempSync, rmSync, statSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

const ROOT_DIR = join(import.meta.dirname, "..", "..");

const PLAINTEXT_API_KEY = "sk-legacy-plaintext-abcdef0123456789abcdef";
const PLAINTEXT_TOKEN = "ya29.legacy-access-token-value-9876543210";
const PLAINTEXT_CHANNEL_TOKEN = "1234567890:AAHlegacyTelegramBotTokenValue012345";
const PLAINTEXT_MCP_TOKEN = "ghp_legacyMcpEnvTokenValue0123456789";

function seedLegacyHome(): string {
  const home = mkdtempSync(join(tmpdir(), "cybara-legacy-"));
  mkdirSync(join(home, "data"), { recursive: true });
  const db = new Database(join(home, "data", "platform.db"), { create: true });
  db.run(`CREATE TABLE providers (
    id TEXT PRIMARY KEY, provider TEXT, name TEXT, base_url TEXT,
    api_key TEXT, access_token TEXT, refresh_token TEXT,
    settings TEXT, expires_at INTEGER, is_default INTEGER DEFAULT 0,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP)`);
  db.run(`CREATE TABLE channels (
    id TEXT PRIMARY KEY, type TEXT, name TEXT, config TEXT, enabled INTEGER DEFAULT 1,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP)`);
  db.run(`CREATE TABLE mcp_servers (
    id TEXT PRIMARY KEY, name TEXT, command TEXT, args TEXT, env TEXT, enabled INTEGER DEFAULT 1,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP)`);
  db.run("INSERT INTO providers (id, provider, name, api_key, access_token) VALUES (?,?,?,?,?)", [
    "legacy-provider",
    "custom",
    "Legacy Provider",
    PLAINTEXT_API_KEY,
    PLAINTEXT_TOKEN,
  ]);
  db.run("INSERT INTO channels (id, type, name, config) VALUES (?,?,?,?)", [
    "legacy-channel",
    "telegram",
    "Legacy Telegram",
    JSON.stringify({ botToken: PLAINTEXT_CHANNEL_TOKEN }),
  ]);
  db.run("INSERT INTO mcp_servers (id, name, command, env) VALUES (?,?,?,?)", [
    "legacy-mcp",
    "Legacy MCP",
    "node",
    JSON.stringify({ GITHUB_TOKEN: PLAINTEXT_MCP_TOKEN }),
  ]);
  db.close();
  return home;
}

function bootDatabase(
  home: string,
  script = 'import("./src/core/database.ts").then(() => process.exit(0));'
) {
  return Bun.spawnSync(["bun", "-e", script], {
    cwd: ROOT_DIR,
    env: { ...process.env, CYBARA_HOME: home },
  });
}

describe("legacy credential migration", () => {
  test("seals pre-encryption credentials and leaves no plaintext in the database file", async () => {
    const home = seedLegacyHome();
    try {
      expect(bootDatabase(home).exitCode).toBe(0);

      const db = new Database(join(home, "data", "platform.db"), { readonly: true });
      const provider = db
        .query("select * from providers where id='legacy-provider'")
        .get() as Record<string, string>;
      const channel = db.query("select * from channels where id='legacy-channel'").get() as Record<
        string,
        string
      >;
      const mcp = db.query("select * from mcp_servers where id='legacy-mcp'").get() as Record<
        string,
        string
      >;
      db.close();

      for (const value of [provider.api_key, provider.access_token, channel.config, mcp.env]) {
        expect(String(value).startsWith("cybara-secret:v1:")).toBe(true);
      }

      const bytes = await Bun.file(join(home, "data", "platform.db")).arrayBuffer();
      const haystack = Buffer.from(bytes).toString("latin1");
      for (const secret of [
        PLAINTEXT_API_KEY,
        PLAINTEXT_TOKEN,
        PLAINTEXT_CHANNEL_TOKEN,
        PLAINTEXT_MCP_TOKEN,
      ]) {
        expect(`${secret.slice(0, 12)}:${haystack.includes(secret)}`).toBe(
          `${secret.slice(0, 12)}:false`
        );
      }
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  test("decrypts migrated credentials back to their original values", () => {
    const home = seedLegacyHome();
    try {
      expect(bootDatabase(home).exitCode).toBe(0);
      const readback = bootDatabase(
        home,
        `import("./src/core/database.ts").then((m) => {
           const p = m.tables.providers.get("legacy-provider");
           const c = m.tables.channels.all().find((x) => x.id === "legacy-channel");
           console.log(JSON.stringify({ apiKey: p?.api_key, token: p?.access_token, config: c?.config }));
           process.exit(0);
         });`
      );
      const line = readback.stdout.toString().trim().split("\n").pop() || "{}";
      const parsed = JSON.parse(line) as { apiKey?: string; token?: string; config?: unknown };

      expect(parsed.apiKey).toBe(PLAINTEXT_API_KEY);
      expect(parsed.token).toBe(PLAINTEXT_TOKEN);
      expect(JSON.stringify(parsed.config ?? "")).toContain(PLAINTEXT_CHANNEL_TOKEN);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  test("does not rewrite the database when nothing needs sealing", () => {
    const home = seedLegacyHome();
    try {
      expect(bootDatabase(home).exitCode).toBe(0);
      const dbPath = join(home, "data", "platform.db");
      const afterMigration = statSync(dbPath).mtimeMs;

      expect(bootDatabase(home).exitCode).toBe(0);

      expect(statSync(dbPath).mtimeMs).toBe(afterMigration);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
});
