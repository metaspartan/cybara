import { Database } from "bun:sqlite";
import { afterAll, beforeAll } from "bun:test";
import { createDecipheriv } from "crypto";
import { mkdtempSync, readFileSync, rmSync } from "fs";
import { createServer } from "net";
import { tmpdir } from "os";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

function buildRoutesFixture() {
  const ROOT_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
  const PACKAGE_VERSION = (
    JSON.parse(readFileSync(join(ROOT_DIR, "package.json"), "utf8")) as {
      version: string;
    }
  ).version;
  let BASE_URL = "";
  let serverProc: ReturnType<typeof Bun.spawn> | null = null;
  let testHome = "";

  function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async function getFreePort(): Promise<number> {
    return await new Promise((resolve, reject) => {
      const server = createServer();
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => {
        const addr = server.address();
        if (!addr || typeof addr === "string") {
          server.close();
          reject(new Error("Failed to allocate free port"));
          return;
        }

        const port = addr.port;
        server.close((err) => {
          if (err) reject(err);
          else resolve(port);
        });
      });
    });
  }

  async function waitForServerReady(baseUrl: string, timeoutMs = 30000): Promise<void> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      try {
        const res = await fetch(`${baseUrl}/api/health`);
        if (res.ok) return;
      } catch {}
      await sleep(250);
    }
    throw new Error(`Timed out waiting for API server at ${baseUrl}`);
  }

  async function api(method: string, path: string, body?: unknown) {
    // Simulate the same-origin web UI (browsers send Sec-Fetch-Site) so localhost
    // auth bypass applies; non-browser header-less requests now require the key.
    const headers: Record<string, string> = { "sec-fetch-site": "same-origin" };

    if (body) {
      headers["Content-Type"] = "application/json";
    }

    const response = await fetch(`${BASE_URL}${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
    return {
      status: response.status,
      data: await response.json().catch(() => null),
    };
  }

  async function apiWithBearer(method: string, path: string, token: string, body?: unknown) {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
    };

    if (body) {
      headers["Content-Type"] = "application/json";
    }

    const response = await fetch(`${BASE_URL}${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
    return {
      status: response.status,
      data: await response.json().catch(() => null),
    };
  }

  function git(args: string[], cwd: string): void {
    const result = Bun.spawnSync(["git", ...args], { cwd });
    if (result.exitCode !== 0) {
      throw new Error(`git ${args.join(" ")} failed: ${result.stderr.toString()}`);
    }
  }

  function insertRawMetric(type: string, key: string, value: number, metadata?: string): void {
    const dbPath = join(testHome, ".cybara", "data", "platform.db");
    const db = new Database(dbPath);
    try {
      db.query("INSERT INTO metrics (id, type, key, value, metadata) VALUES (?, ?, ?, ?, ?)").run(
        crypto.randomUUID(),
        type,
        key,
        value,
        metadata ?? null
      );
      db.query(
        `INSERT INTO metrics_totals (type, key, total, count, metadata) VALUES (?, ?, ?, 1, ?)
         ON CONFLICT(type, key) DO UPDATE SET
           total = total + excluded.total,
           count = count + 1,
           metadata = COALESCE(excluded.metadata, metadata),
           updated_at = CURRENT_TIMESTAMP`
      ).run(type, key, value, metadata ?? null);
    } finally {
      db.close();
    }
  }

  function insertRawSystemLog(id: string, message: string, createdAt: string): void {
    const dbPath = join(testHome, ".cybara", "data", "platform.db");
    const db = new Database(dbPath);
    try {
      db.query(
        "INSERT INTO system_logs (id, level, source, message, metadata, created_at) VALUES (?, ?, ?, ?, ?, ?)"
      ).run(id, "info", "system", message, null, createdAt);
    } finally {
      db.close();
    }
  }

  function countMetrics(type: string, key?: string): number {
    const dbPath = join(testHome, ".cybara", "data", "platform.db");
    const db = new Database(dbPath);
    try {
      const row = key
        ? (db
            .query("SELECT COUNT(*) as count FROM metrics WHERE type = ? AND key = ?")
            .get(type, key) as { count?: number } | null)
        : (db.query("SELECT COUNT(*) as count FROM metrics WHERE type = ?").get(type) as {
            count?: number;
          } | null);
      return Number(row?.count || 0);
    } finally {
      db.close();
    }
  }

  function insertRawChannel(
    id: string,
    type: string,
    name: string,
    config: string,
    enabled: boolean
  ): void {
    const dbPath = join(testHome, ".cybara", "data", "platform.db");
    const db = new Database(dbPath);
    try {
      db.query("INSERT INTO channels (id, type, name, config, enabled) VALUES (?, ?, ?, ?, ?)").run(
        id,
        type,
        name,
        config,
        enabled ? 1 : 0
      );
    } finally {
      db.close();
    }
  }

  function insertRawTask(id: string, name: string, config: string, status: string): void {
    const dbPath = join(testHome, ".cybara", "data", "platform.db");
    const db = new Database(dbPath);
    try {
      db.query("INSERT INTO tasks (id, name, config, status) VALUES (?, ?, ?, ?)").run(
        id,
        name,
        config,
        status
      );
    } finally {
      db.close();
    }
  }

  function insertRawAgent(
    id: string,
    name: string,
    config: string,
    options: { model?: string; providerId?: string } = {}
  ): void {
    const dbPath = join(testHome, ".cybara", "data", "platform.db");
    const db = new Database(dbPath);
    try {
      db.query(
        "INSERT INTO agents (id, name, model, provider_id, config) VALUES (?, ?, ?, ?, ?)"
      ).run(id, name, options.model ?? null, options.providerId ?? null, config);
    } finally {
      db.close();
    }
  }

  function insertRawProvider(id: string, provider: string, name: string): void {
    const dbPath = join(testHome, ".cybara", "data", "platform.db");
    const db = new Database(dbPath);
    try {
      db.query("INSERT INTO providers (id, provider, name) VALUES (?, ?, ?)").run(
        id,
        provider,
        name
      );
    } finally {
      db.close();
    }
  }

  function deleteRawAgent(id: string): void {
    const dbPath = join(testHome, ".cybara", "data", "platform.db");
    const db = new Database(dbPath);
    try {
      db.query("DELETE FROM agents WHERE id = ?").run(id);
    } finally {
      db.close();
    }
  }

  function deleteRawProvider(id: string): void {
    const dbPath = join(testHome, ".cybara", "data", "platform.db");
    const db = new Database(dbPath);
    try {
      db.query("DELETE FROM providers WHERE id = ?").run(id);
    } finally {
      db.close();
    }
  }

  function deleteRawSession(sessionId: string): void {
    const dbPath = join(testHome, ".cybara", "data", "platform.db");
    const db = new Database(dbPath);
    try {
      db.query("DELETE FROM session_messages WHERE session_id = ?").run(sessionId);
      db.query("DELETE FROM chat_sessions WHERE id = ?").run(sessionId);
    } finally {
      db.close();
    }
  }

  function upsertRawConfig(key: string, value: string): void {
    const dbPath = join(testHome, ".cybara", "data", "platform.db");
    const db = new Database(dbPath);
    try {
      db.query("INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)").run(key, value);
    } finally {
      db.close();
    }
  }

  function readRawConfig(key: string): string | undefined {
    const dbPath = join(testHome, ".cybara", "data", "platform.db");
    const db = new Database(dbPath, { readonly: true });
    try {
      const row = db.query("SELECT value FROM config WHERE key = ?").get(key) as {
        value: string;
      } | null;
      return row?.value;
    } finally {
      db.close();
    }
  }

  function readRawChannelConfig(id: string): string | undefined {
    const dbPath = join(testHome, ".cybara", "data", "platform.db");
    const db = new Database(dbPath, { readonly: true });
    try {
      const row = db.query("SELECT config FROM channels WHERE id = ?").get(id) as {
        config: string;
      } | null;
      return row?.config;
    } finally {
      db.close();
    }
  }

  function openSealedValue(context: string, value: string): string {
    const prefix = "cybara-secret:v1:";
    if (!value.startsWith(prefix)) return value;
    const key = readFileSync(join(testHome, ".cybara", "secure", "storage.key"));
    const payload = Buffer.from(value.slice(prefix.length), "base64url");
    const decipher = createDecipheriv("aes-256-gcm", key, payload.subarray(0, 12));
    decipher.setAAD(Buffer.from(context, "utf8"));
    decipher.setAuthTag(payload.subarray(12, 28));
    return Buffer.concat([decipher.update(payload.subarray(28)), decipher.final()]).toString(
      "utf8"
    );
  }

  function insertRawSession(
    sessionId: string,
    agentId: string,
    messages: Array<{
      role: string;
      content: string;
      metadata?: string | Record<string, unknown>;
    }>
  ): void {
    const dbPath = join(testHome, ".cybara", "data", "platform.db");
    const db = new Database(dbPath);
    try {
      db.query(
        "INSERT OR REPLACE INTO chat_sessions (id, agent_id, messages, created_at, updated_at) VALUES (?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)"
      ).run(sessionId, agentId, "[]");

      for (const message of messages) {
        const metadata =
          typeof message.metadata === "string"
            ? message.metadata
            : message.metadata
              ? JSON.stringify(message.metadata)
              : null;
        db.query(
          "INSERT INTO session_messages (id, session_id, agent_id, role, content, metadata) VALUES (?, ?, ?, ?, ?, ?)"
        ).run(crypto.randomUUID(), sessionId, agentId, message.role, message.content, metadata);
      }
    } finally {
      db.close();
    }
  }

  function getRawProviderRecord(id: string): {
    id: string;
    provider: string;
    name: string;
    api_key: string | null;
    access_token: string | null;
    base_url: string | null;
    is_default: number;
  } | null {
    const dbPath = join(testHome, ".cybara", "data", "platform.db");
    const db = new Database(dbPath);
    try {
      return db
        .query(
          "SELECT id, provider, name, api_key, access_token, base_url, is_default FROM providers WHERE id = ?"
        )
        .get(id) as {
        id: string;
        provider: string;
        name: string;
        api_key: string | null;
        access_token: string | null;
        base_url: string | null;
        is_default: number;
      } | null;
    } finally {
      db.close();
    }
  }

  function openRawProviderApiKey(id: string, value: string): string {
    const prefix = "cybara-secret:v1:";
    if (!value.startsWith(prefix)) return value;
    const key = readFileSync(join(testHome, ".cybara", "secure", "storage.key"));
    const payload = Buffer.from(value.slice(prefix.length), "base64url");
    const decipher = createDecipheriv("aes-256-gcm", key, payload.subarray(0, 12));
    decipher.setAAD(Buffer.from(`provider:${id}:api_key`, "utf8"));
    decipher.setAuthTag(payload.subarray(12, 28));
    return Buffer.concat([decipher.update(payload.subarray(28)), decipher.final()]).toString(
      "utf8"
    );
  }

  beforeAll(async () => {
    testHome = mkdtempSync(join(tmpdir(), "cybara-routes-test-home-"));
    const port = await getFreePort();
    BASE_URL = `http://127.0.0.1:${port}`;

    serverProc = Bun.spawn([process.execPath, "run", "src/index.ts"], {
      cwd: ROOT_DIR,
      env: {
        ...process.env,
        HOME: testHome,
        USERPROFILE: testHome,
        CYBARA_HOME: "",
        CYBARA_MCP_REGISTRY_OFFLINE: "true",
        PORT: String(port),
      },
      stdout: "ignore",
      stderr: "ignore",
    });

    await waitForServerReady(BASE_URL);
  });

  afterAll(async () => {
    if (serverProc) {
      try {
        serverProc.kill("SIGTERM");
      } catch {}
      await Promise.race([serverProc.exited, sleep(5000)]);
    }

    if (testHome) {
      rmSync(testHome, { recursive: true, force: true });
    }
  });

  return {
    get PACKAGE_VERSION() {
      return PACKAGE_VERSION;
    },
    get BASE_URL() {
      return BASE_URL;
    },
    get testHome() {
      return testHome;
    },
    get ROOT_DIR() {
      return ROOT_DIR;
    },
    apiWithBearer,
    api,
    git,
    insertRawMetric,
    insertRawSystemLog,
    countMetrics,
    insertRawChannel,
    insertRawTask,
    insertRawAgent,
    insertRawProvider,
    deleteRawAgent,
    deleteRawProvider,
    deleteRawSession,
    upsertRawConfig,
    readRawConfig,
    readRawChannelConfig,
    openSealedValue,
    insertRawSession,
    getRawProviderRecord,
    openRawProviderApiKey,
  };
}

export function createRoutesFixture(): ReturnType<typeof buildRoutesFixture> {
  return buildRoutesFixture();
}
