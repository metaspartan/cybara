import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "fs";
import { createServer } from "net";
import { tmpdir } from "os";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const ROOT_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const PACKAGE_VERSION = (
  JSON.parse(readFileSync(join(ROOT_DIR, "package.json"), "utf8")) as { version: string }
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
    db.query("INSERT INTO providers (id, provider, name) VALUES (?, ?, ?)").run(id, provider, name);
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

function insertRawSession(
  sessionId: string,
  agentId: string,
  messages: Array<{ role: string; content: string; metadata?: string | Record<string, unknown> }>
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

describe("API Health & Status", () => {
  test("GET /api/health should return healthy status", async () => {
    const { status, data } = await api("GET", "/api/health");
    expect(status).toBe(200);
    expect(data.status).toBe("healthy");
    expect(data.timestamp).toBeDefined();
    expect(data.uptime).toBeDefined();
    expect(data.version).toBe(PACKAGE_VERSION);
  });

  test("GET /api/health should include system checks", async () => {
    const { data } = await api("GET", "/api/health");
    expect(data.checks.database).toBeDefined();
    expect(data.checks.agents).toBeDefined();
    expect(data.checks.providers).toBeDefined();
    expect(data.checks.memory).toBeDefined();
  });

  test("GET /api/health/ready and /api/health/live should return readiness/liveness", async () => {
    const ready = await api("GET", "/api/health/ready");
    expect(ready.status).toBe(200);
    expect(ready.data.ready).toBe(true);

    const live = await api("GET", "/api/health/live");
    expect(live.status).toBe(200);
    expect(live.data.live).toBe(true);
  });
});

describe("Setup & Info API", () => {
  test("GET /api/info should return platform summary", async () => {
    const { status, data } = await api("GET", "/api/info");
    expect(status).toBe(200);
    expect(data.name).toBe("Cybara");
    expect(typeof data.version).toBe("string");
    expect(typeof data.homeDir).toBe("string");
    expect(typeof data.cybaraDataDir).toBe("string");
    expect(typeof data.configuredCybaraDataDir).toBe("string");
    expect(typeof data.cybaraDataDirSource).toBe("string");
    expect(typeof data.cybaraDataDirForced).toBe("boolean");
    expect(typeof data.cybaraDataDirRestartRequired).toBe("boolean");
    expect(typeof data.defaultCybaraDataDir).toBe("string");
    expect(typeof data.defaultWorkspaceDir).toBe("string");
    expect(data.stats).toBeDefined();
  });

  test("default workspace setting is normalized and reflected in info", async () => {
    const workspaceDir = join(testHome, "workspaces", "primary");
    const update = await api("PUT", "/api/config", { default_workspace_dir: workspaceDir });
    expect(update.status).toBe(200);
    expect(update.data.success).toBe(true);

    const configRes = await api("GET", "/api/config");
    expect(configRes.status).toBe(200);
    expect(configRes.data.default_workspace_dir).toBe(workspaceDir);

    const info = await api("GET", "/api/info");
    expect(info.status).toBe(200);
    expect(info.data.defaultWorkspaceDir).toBe(workspaceDir);

    await api("PUT", "/api/config", { default_workspace_dir: testHome });
  });

  test("cybara data directory setting records configured path until restart", async () => {
    const activeDir = join(testHome, ".cybara");
    const nextDir = join(testHome, "cybara-data-alt");
    const update = await api("PUT", "/api/config", { cybara_data_dir: nextDir });
    expect(update.status).toBe(200);
    expect(update.data.success).toBe(true);
    expect(update.data.restartRequired).toBe(true);
    expect(update.data.cybara_data_dir).toBe(activeDir);
    expect(update.data.configured_cybara_data_dir).toBe(nextDir);
    expect(update.data.cybara_data_dir_restart_required).toBe(true);

    const configRes = await api("GET", "/api/config");
    expect(configRes.status).toBe(200);
    expect(configRes.data.cybara_data_dir).toBe(activeDir);
    expect(configRes.data.configured_cybara_data_dir).toBe(nextDir);
    expect(configRes.data.cybara_data_dir_source).toBe("override");
    expect(configRes.data.cybara_data_dir_restart_required).toBe(true);

    const info = await api("GET", "/api/info");
    expect(info.status).toBe(200);
    expect(info.data.cybaraDataDir).toBe(activeDir);
    expect(info.data.configuredCybaraDataDir).toBe(nextDir);
    expect(info.data.cybaraDataDirRestartRequired).toBe(true);

    const reset = await api("PUT", "/api/config", { cybara_data_dir: activeDir });
    expect(reset.status).toBe(200);
    expect(reset.data.success).toBe(true);
    expect(reset.data.configured_cybara_data_dir).toBe(activeDir);
    expect(reset.data.cybara_data_dir_restart_required).toBe(false);
  });

  test("setup status and complete flow should return success", async () => {
    const beforeStatus = await api("GET", "/api/setup/status");
    expect(beforeStatus.status).toBe(200);
    expect(typeof beforeStatus.data.complete).toBe("boolean");

    const beforeAgents = await api("GET", "/api/agents");
    expect(beforeAgents.status).toBe(200);
    const beforeCount = Array.isArray(beforeAgents.data) ? beforeAgents.data.length : 0;

    const completeRes = await api("POST", "/api/setup/complete");
    expect(completeRes.status).toBe(200);
    expect(completeRes.data.success).toBe(true);

    const afterStatus = await api("GET", "/api/setup/status");
    expect(afterStatus.status).toBe(200);
    expect(afterStatus.data.complete).toBe(true);

    const afterFirstCompleteAgents = await api("GET", "/api/agents");
    expect(afterFirstCompleteAgents.status).toBe(200);
    const afterFirstCount = Array.isArray(afterFirstCompleteAgents.data)
      ? afterFirstCompleteAgents.data.length
      : 0;
    expect(afterFirstCount).toBeGreaterThanOrEqual(beforeCount);
    expect(afterFirstCount - beforeCount).toBeLessThanOrEqual(1);

    const secondCompleteRes = await api("POST", "/api/setup/complete");
    expect(secondCompleteRes.status).toBe(200);
    expect(secondCompleteRes.data.success).toBe(true);

    const afterSecondCompleteAgents = await api("GET", "/api/agents");
    expect(afterSecondCompleteAgents.status).toBe(200);
    const afterSecondCount = Array.isArray(afterSecondCompleteAgents.data)
      ? afterSecondCompleteAgents.data.length
      : 0;
    expect(afterSecondCount).toBe(afterFirstCount);
  });
});

describe("Mobile API", () => {
  test("reports mobile connection URLs and localhost pairing warnings", async () => {
    const info = await api("GET", "/api/mobile/connect-info");

    expect(info.status).toBe(200);
    expect(info.data.baseUrl).toBe(BASE_URL);
    expect(info.data.currentBaseUrl).toBe(BASE_URL);
    expect(info.data.candidates).toContain(BASE_URL);
    expect(info.data.isCurrentLoopback).toBe(true);
    expect(info.data.lanAccessEnabled).toBe(false);
    expect(String(info.data.warnings.join(" "))).toContain("127.0.0.1");
    expect(String(info.data.warnings.join(" "))).toContain("LAN address");
    expect(String(info.data.troubleshooting.join(" "))).toContain("/api/health");
    expect(String(info.data.exposeCommand)).toContain("cybara start");
  });

  test("blocks mobile pairing codes until the gateway listens on the local network", async () => {
    const blocked = await api("POST", "/api/mobile/devices/pair-code", {
      baseUrl: "http://192.168.1.20:4269",
      role: "standard",
      deviceName: "Routes Phone",
    });

    expect(blocked.status).toBe(400);
    expect(String(blocked.data.error)).toContain("Listen on local network");
  });

  test("allows mobile pairing through a ready password-protected remote URL", async () => {
    const pending = await api("PUT", "/api/auth/settings", {
      remoteAccess: {
        enabled: true,
        mode: "public_tunnel",
        provider: "cloudflare",
        baseUrl: "https://cybara.example.com",
      },
    });
    expect(pending.status).toBe(200);
    expect(pending.data.remoteAccess.ready).toBe(false);
    expect(pending.data.remoteAccess.status).toBe("needs_password");

    const blocked = await api("POST", "/api/mobile/devices/pair-code", {
      baseUrl: "https://cybara.example.com",
      role: "standard",
      deviceName: "Routes Phone",
    });
    expect(blocked.status).toBe(400);
    expect(String(blocked.data.error)).toContain("ready remote access");

    const password = await api("PUT", "/api/auth/settings", {
      gatewayPassword: "correct horse battery staple",
    });
    expect(password.status).toBe(200);
    expect(password.data.remoteAccess.ready).toBe(true);

    const created = await api("POST", "/api/mobile/devices/pair-code", {
      baseUrl: "https://cybara.example.com",
      role: "standard",
      deviceName: "Routes Phone",
    });
    expect(created.status).toBe(200);
    expect(created.data.payload.baseUrl).toBe("https://cybara.example.com");

    await api("PUT", "/api/auth/settings", {
      remoteAccess: {
        enabled: false,
        mode: "private_overlay",
        provider: "tailscale",
        baseUrl: "",
      },
    });
  });

  test("auth settings persist a restart-bound gateway host", async () => {
    const before = await api("GET", "/api/auth/settings");
    expect(before.status).toBe(200);
    expect(before.data.host).toBe("127.0.0.1");
    expect(before.data.configuredHost).toBe("127.0.0.1");
    expect(before.data.hostForced).toBe(false);

    const updated = await api("PUT", "/api/auth/settings", { host: "0.0.0.0" });
    expect(updated.status).toBe(200);
    expect(updated.data.success).toBe(true);
    expect(updated.data.host).toBe("127.0.0.1");
    expect(updated.data.configuredHost).toBe("0.0.0.0");

    const reset = await api("PUT", "/api/auth/settings", { host: "127.0.0.1" });
    expect(reset.status).toBe(200);
    expect(reset.data.configuredHost).toBe("127.0.0.1");
  });

  test("creates revocable mobile device tokens without exposing the root key", async () => {
    const created = await api("POST", "/api/mobile/devices", {
      baseUrl: BASE_URL,
      gatewayName: "Routes Gateway",
      deviceName: "Routes Phone",
    });

    expect(created.status).toBe(200);
    expect(created.data.success).toBe(true);
    expect(created.data.device.id).toMatch(/^mobile_/);
    expect(created.data.device.name).toBe("Routes Phone");
    expect(created.data.payload.protocol).toBe("cybara-mobile-connect-v1");
    expect(created.data.payload.deviceId).toBe(created.data.device.id);
    expect(created.data.payload.name).toBe("Routes Gateway");
    expect(created.data.payload.baseUrl).toBe(BASE_URL);
    expect(created.data.payload.apiKey).toMatch(/^cybara_mobile_/);
    expect(String(created.data.qrDataUrl).startsWith("data:image/png;base64,")).toBe(true);

    const rootApiKey = readFileSync(join(testHome, ".cybara", "api_key"), "utf8").trim();
    expect(created.data.payload.apiKey).not.toBe(rootApiKey);

    const encoded = JSON.parse(created.data.encoded) as { apiKey?: string; deviceId?: string };
    expect(encoded.apiKey).toBe(created.data.payload.apiKey);
    expect(encoded.deviceId).toBe(created.data.device.id);

    const list = await api("GET", "/api/mobile/devices");
    expect(list.status).toBe(200);
    expect(
      list.data.devices.some((device: { id: string }) => device.id === created.data.device.id)
    ).toBe(true);

    const mobileInfo = await apiWithBearer("GET", "/api/info", created.data.payload.apiKey);
    expect(mobileInfo.status).toBe(200);
    expect(mobileInfo.data.name).toBe("Cybara");

    const forbiddenManage = await apiWithBearer(
      "GET",
      "/api/mobile/devices",
      created.data.payload.apiKey
    );
    expect(forbiddenManage.status).toBe(403);
    expect(forbiddenManage.data.error).toContain("Root API key required");

    const revoked = await api("POST", `/api/mobile/devices/${created.data.device.id}/revoke`);
    expect(revoked.status).toBe(200);
    expect(revoked.data.device.status).toBe("revoked");

    const afterRevoke = await apiWithBearer("GET", "/api/info", created.data.payload.apiKey);
    expect(afterRevoke.status).toBe(401);

    const removed = await api("DELETE", `/api/mobile/devices/${created.data.device.id}`);
    expect(removed.status).toBe(200);
    expect(removed.data.success).toBe(true);
  });
});

describe("Logs API", () => {
  test("GET /api/logs/system honors bounded mobile and CLI reads", async () => {
    const stamp = Date.now();
    insertRawSystemLog(`bounded-log-old-${stamp}`, "older bounded log", "2026-06-30T08:00:00.000Z");
    insertRawSystemLog(`bounded-log-new-${stamp}`, "newer bounded log", "2026-06-30T09:00:00.000Z");

    const limited = await api("GET", "/api/logs/system?limit=1");

    expect(limited.status).toBe(200);
    expect(Array.isArray(limited.data)).toBe(true);
    expect(limited.data).toHaveLength(1);

    const paged = await api("GET", "/api/logs/system?limit=1&offset=0&includeTotal=1");

    expect(paged.status).toBe(200);
    expect(Array.isArray(paged.data.logs)).toBe(true);
    expect(paged.data.logs).toHaveLength(1);
    expect(paged.data.total).toBeGreaterThanOrEqual(2);
    expect(paged.data.limit).toBe(1);
    expect(paged.data.offset).toBe(0);
    expect(paged.data.hasMore).toBe(true);
  });
});

describe("Wallet API", () => {
  test("wallet create/unlock/derive/sign/delete flow works", async () => {
    const statusBefore = await api("GET", "/api/wallet/status");
    expect(statusBefore.status).toBe(200);
    expect(statusBefore.data.exists).toBe(false);

    const create = await api("POST", "/api/wallet/create", { password: "integration-pass-123" });
    expect(create.status).toBe(200);
    expect(create.data.success).toBe(true);
    expect(typeof create.data.mnemonic).toBe("string");
    expect(create.data.mnemonic.split(" ").length).toBe(24);
    expect(typeof create.data.address).toBe("string");
    expect(typeof create.data.primaryAddresses.eth).toBe("string");
    expect(typeof create.data.primaryAddresses.btc).toBe("string");
    expect(typeof create.data.primaryAddresses.sol).toBe("string");

    const statusAfterCreate = await api("GET", "/api/wallet/status");
    expect(statusAfterCreate.status).toBe(200);
    expect(statusAfterCreate.data.exists).toBe(true);
    expect(statusAfterCreate.data.unlocked).toBe(true);
    expect(statusAfterCreate.data.primaryAddresses.eth).toBe(create.data.primaryAddresses.eth);

    const accounts = await api(
      "GET",
      "/api/wallet/accounts?chains=eth,btc,sol&count=1&startIndex=0"
    );
    expect(accounts.status).toBe(200);
    expect(Array.isArray(accounts.data)).toBe(true);
    expect(accounts.data).toHaveLength(3);
    expect(accounts.data[0].index).toBe(0);
    expect(typeof accounts.data[0].address).toBe("string");

    const receive = await api("GET", "/api/wallet/receive?chain=eth&index=0");
    expect(receive.status).toBe(200);
    expect(receive.data.chain).toBe("eth");
    expect(receive.data.index).toBe(0);
    expect(typeof receive.data.address).toBe("string");

    const invalidTokenChain = await api("GET", "/api/wallet/tokens?chain=btc&index=0");
    expect(invalidTokenChain.status).toBe(400);
    expect(invalidTokenChain.data.code).toBe("VALIDATION_ERROR");

    const invalidTokenTxChain = await api(
      "GET",
      "/api/wallet/token-transactions?chain=btc&index=0"
    );
    expect(invalidTokenTxChain.status).toBe(400);
    expect(invalidTokenTxChain.data.code).toBe("VALIDATION_ERROR");

    const sign = await api("POST", "/api/wallet/sign", {
      message: "integration-wallet-sign",
      chain: "eth",
      index: 0,
    });
    expect(sign.status).toBe(200);
    expect(typeof sign.data.signature).toBe("string");
    expect(sign.data.signature.startsWith("0x")).toBe(true);

    const lock = await api("POST", "/api/wallet/lock");
    expect(lock.status).toBe(200);
    expect(lock.data.success).toBe(true);

    const lockedStatus = await api("GET", "/api/wallet/status");
    expect(lockedStatus.status).toBe(200);
    expect(lockedStatus.data.unlocked).toBe(false);

    const unlock = await api("POST", "/api/wallet/unlock", { password: "integration-pass-123" });
    expect(unlock.status).toBe(200);
    expect(unlock.data.success).toBe(true);
    expect(unlock.data.address).toBe(create.data.address);

    const deleteRes = await api("DELETE", "/api/wallet", { password: "integration-pass-123" });
    expect(deleteRes.status).toBe(200);
    expect(deleteRes.data.success).toBe(true);

    const statusAfterDelete = await api("GET", "/api/wallet/status");
    expect(statusAfterDelete.status).toBe(200);
    expect(statusAfterDelete.data.exists).toBe(false);
  });
});

describe("Agents API", () => {
  test("GET /api/agents should return array", async () => {
    const { status, data } = await api("GET", "/api/agents");
    expect(status).toBe(200);
    expect(Array.isArray(data)).toBe(true);
  });

  test("POST /api/agents should create a new agent", async () => {
    const newAgent = {
      name: `test-agent-${Date.now()}`,
      type: "basic",
      provider: "anthropic",
      model: "claude-sonnet-4-20250514",
    };
    const { status, data } = await api("POST", "/api/agents", newAgent);
    expect(status).toBe(200);
    expect(data.name).toBe(newAgent.name);
    expect(data.id).toBeDefined();
  });

  test("agent create/update resolve legacy provider field and auto-heal missing provider_id", async () => {
    const providerRes = await api("POST", "/api/providers", {
      provider: "openai",
      name: `agent-provider-${Date.now()}`,
      api_key: `sk-test-${Date.now()}`,
      is_default: true,
    });
    expect(providerRes.status).toBe(200);
    const providerId = providerRes.data.id as string;

    const created = await api("POST", "/api/agents", {
      name: `legacy-provider-agent-${Date.now()}`,
      type: "main",
      model: "gpt-5-mini",
      provider: providerId,
    });
    expect(created.status).toBe(200);
    expect(created.data.provider_id).toBe(providerId);

    const fetched = await api("GET", `/api/agents/${created.data.id}`);
    expect(fetched.status).toBe(200);
    expect(fetched.data.provider).toBe(providerId);

    const missingProviderAgent = await api("POST", "/api/agents", {
      name: `missing-provider-agent-${Date.now()}`,
      type: "main",
      model: "gpt-5-mini",
    });
    expect(missingProviderAgent.status).toBe(200);
    expect(missingProviderAgent.data.provider_id).toBeUndefined();

    const chatRes = await api("POST", "/api/chat", {
      message: "provider auto-heal check",
      agentId: missingProviderAgent.data.id,
    });
    expect(chatRes.status).toBe(200);
    expect(String(chatRes.data.message?.content || "")).not.toContain("No AI provider configured");

    const healed = await api("GET", `/api/agents/${missingProviderAgent.data.id}`);
    expect(healed.status).toBe(200);
    expect(typeof healed.data.provider).toBe("string");
    expect(healed.data.provider.length).toBeGreaterThan(0);

    await api("DELETE", `/api/agents/${created.data.id}`);
    await api("DELETE", `/api/agents/${missingProviderAgent.data.id}`);
    await api("DELETE", `/api/providers/${providerId}`);
  });

  test("PUT /api/agents/:id tolerates malformed persisted config JSON", async () => {
    const agentId = `bad-agent-config-${Date.now()}`;
    insertRawAgent(agentId, `bad-agent-${Date.now()}`, "{bad-json");

    const updateRes = await api("PUT", `/api/agents/${agentId}`, {
      name: `recovered-agent-${Date.now()}`,
    });
    expect(updateRes.status).toBe(200);
    expect(updateRes.data.id).toBe(agentId);
    expect(typeof updateRes.data.name).toBe("string");
    expect(updateRes.data.name).toContain("recovered-agent-");

    const getRes = await api("GET", `/api/agents/${agentId}`);
    expect(getRes.status).toBe(200);
    expect(getRes.data.id).toBe(agentId);
    expect(getRes.data.name).toBe(updateRes.data.name);

    await api("DELETE", `/api/agents/${agentId}`);
  });

  test("POST /api/agents/:id/start tolerates malformed persisted config JSON", async () => {
    const agentId = `bad-agent-start-config-${Date.now()}`;
    insertRawAgent(agentId, `bad-agent-start-${Date.now()}`, "{bad-json");

    const startRes = await api("POST", `/api/agents/${agentId}/start`);
    expect(startRes.status).toBe(200);
    expect(startRes.data.success).toBe(true);

    const stateRes = await api("GET", `/api/agents/${agentId}/state`);
    expect(stateRes.status).toBe(200);
    expect(stateRes.data.running).toBe(true);

    const stopRes = await api("POST", `/api/agents/${agentId}/stop`);
    expect(stopRes.status).toBe(200);
    expect(stopRes.data.success).toBe(true);

    await api("DELETE", `/api/agents/${agentId}`);
  });

  test("POST /api/agents/:id/message auto-starts a stopped agent", async () => {
    const created = await api("POST", "/api/agents", {
      name: `auto-start-message-agent-${Date.now()}`,
      type: "main",
      model: "gpt-5-mini",
    });
    expect(created.status).toBe(200);

    const agentId = created.data.id as string;
    const beforeState = await api("GET", `/api/agents/${agentId}/state`);
    expect(beforeState.status).toBe(200);
    expect(beforeState.data.running).toBe(false);

    const messageRes = await api("POST", `/api/agents/${agentId}/message`, {
      message: "hello",
    });
    expect(messageRes.status).toBe(200);
    expect(typeof messageRes.data.response).toBe("string");
    expect(messageRes.data.response.length).toBeGreaterThan(0);

    const afterState = await api("GET", `/api/agents/${agentId}/state`);
    expect(afterState.status).toBe(200);
    expect(afterState.data.running).toBe(true);

    await api("POST", `/api/agents/${agentId}/stop`);
    await api("DELETE", `/api/agents/${agentId}`);
  });

  test("agent loop endpoints start/list/get/cancel runs", async () => {
    const created = await api("POST", "/api/agents", {
      name: `loop-agent-${Date.now()}`,
      type: "main",
      model: "gpt-5-mini",
    });
    expect(created.status).toBe(200);
    const agentId = created.data.id as string;

    const start = await api("POST", `/api/agents/${agentId}/loops`, {
      objective: "Draft a concise status summary",
      maxIterations: 2,
      maxDurationSeconds: 30,
      useTools: false,
    });
    expect(start.status).toBe(200);
    expect(start.data.success).toBe(true);
    expect(typeof start.data.runId).toBe("string");
    const runId = start.data.runId as string;

    const byAgent = await api("GET", `/api/agents/${agentId}/loops`);
    expect(byAgent.status).toBe(200);
    expect(Array.isArray(byAgent.data.runs)).toBe(true);
    expect(byAgent.data.runs.some((run: { id: string }) => run.id === runId)).toBe(true);

    const listAll = await api("GET", "/api/loops");
    expect(listAll.status).toBe(200);
    expect(Array.isArray(listAll.data.runs)).toBe(true);
    expect(listAll.data.runs.some((run: { id: string }) => run.id === runId)).toBe(true);

    const getRun = await api("GET", `/api/loops/${runId}`);
    expect(getRun.status).toBe(200);
    expect(getRun.data.success).toBe(true);
    expect(getRun.data.run.id).toBe(runId);

    const cancel = await api("POST", `/api/loops/${runId}/cancel`);
    expect(cancel.status).toBe(200);
    expect(cancel.data.success).toBe(true);

    const getAfterCancel = await api("GET", `/api/loops/${runId}`);
    expect(getAfterCancel.status).toBe(200);
    expect(getAfterCancel.data.success).toBe(true);
    expect(typeof getAfterCancel.data.run.status).toBe("string");

    await api("DELETE", `/api/agents/${agentId}`);
  });
});

describe("Providers API", () => {
  test("GET /api/providers should return array", async () => {
    const { status, data } = await api("GET", "/api/providers");
    expect(status).toBe(200);
    expect(Array.isArray(data)).toBe(true);
  });

  test("POST /api/providers rejects invalid OpenAI key shapes", async () => {
    const bad = await api("POST", "/api/providers", {
      provider: "openai",
      name: `bad-openai-key-${Date.now()}`,
      api_key: "bc1qnotanopenaikey",
    });

    expect(bad.status).toBe(400);
    expect(bad.data.code).toBe("VALIDATION_ERROR");
    expect(String(bad.data.error)).toContain("OpenAI API key must start with 'sk-'");
  });

  test("POST /api/providers rejects invalid Google key shapes", async () => {
    const badUrl = await api("POST", "/api/providers", {
      provider: "google",
      name: `bad-google-key-url-${Date.now()}`,
      api_key: "https://aistudio.google.com/apikey",
    });

    expect(badUrl.status).toBe(400);
    expect(badUrl.data.code).toBe("VALIDATION_ERROR");
    expect(String(badUrl.data.error)).toContain("Google API key looks like a URL");

    const badFormat = await api("POST", "/api/providers", {
      provider: "google",
      name: `bad-google-key-format-${Date.now()}`,
      api_key: "not-a-google-key",
    });

    expect(badFormat.status).toBe(400);
    expect(badFormat.data.code).toBe("VALIDATION_ERROR");
    expect(String(badFormat.data.error)).toContain("Google API key format is invalid");
  });

  test("POST /api/providers accepts aliased provider ids", async () => {
    const created = await api("POST", "/api/providers", {
      provider: "opencode",
      name: `alias-opencode-${Date.now()}`,
      api_key: `sk-alias-${Date.now()}`,
    });
    expect(created.status).toBe(200);
    const providerId = created.data.id as string;

    const row = getRawProviderRecord(providerId);
    expect(row?.provider).toBe("opencode_zen");

    await api("DELETE", `/api/providers/${providerId}`);
  });

  test("POST /api/providers persists validated base URLs", async () => {
    const created = await api("POST", "/api/providers", {
      provider: "ollama",
      name: `create-base-url-${Date.now()}`,
      base_url: "http://127.0.0.1:11434/v1",
    });
    expect(created.status).toBe(200);
    const providerId = created.data.id as string;

    const row = getRawProviderRecord(providerId);
    expect(row?.base_url).toBe("http://127.0.0.1:11434/v1");

    await api("DELETE", `/api/providers/${providerId}`);
  });

  test("PUT /api/providers/:id preserves existing credentials when api_key is blank", async () => {
    const provider = await api("POST", "/api/providers", {
      provider: "openai",
      name: `preserve-openai-key-${Date.now()}`,
      api_key: `sk-preserve-${Date.now()}`,
    });
    expect(provider.status).toBe(200);
    const providerId = provider.data.id as string;

    const before = getRawProviderRecord(providerId);
    expect(before).not.toBeNull();
    expect(before?.api_key).toContain("sk-preserve-");

    const update = await api("PUT", `/api/providers/${providerId}`, {
      name: `preserve-openai-key-updated-${Date.now()}`,
      api_key: "",
    });
    expect(update.status).toBe(200);
    expect(update.data.success).toBe(true);

    const after = getRawProviderRecord(providerId);
    expect(after).not.toBeNull();
    expect(after?.name).toContain("preserve-openai-key-updated-");
    expect(after?.api_key).toBe(before?.api_key);

    await api("DELETE", `/api/providers/${providerId}`);
  });

  test("PUT /api/providers/:id rejects embedded-credential base URLs", async () => {
    const provider = await api("POST", "/api/providers", {
      provider: "openai",
      name: `bad-base-url-${Date.now()}`,
      api_key: `sk-base-url-${Date.now()}`,
    });
    expect(provider.status).toBe(200);
    const providerId = provider.data.id as string;

    const update = await api("PUT", `/api/providers/${providerId}`, {
      base_url: "https://user:pass@example.com/v1",
    });
    expect(update.status).toBe(400);
    expect(update.data.code).toBe("VALIDATION_ERROR");
    expect(String(update.data.error)).toContain("cannot include embedded credentials");

    const after = getRawProviderRecord(providerId);
    expect(after?.base_url).not.toBe("https://user:pass@example.com/v1");

    await api("DELETE", `/api/providers/${providerId}`);
  });

  test("PUT /api/providers/:id accepts localhost base URLs for local model providers", async () => {
    const provider = await api("POST", "/api/providers", {
      provider: "ollama",
      name: `local-base-url-${Date.now()}`,
    });
    expect(provider.status).toBe(200);
    const providerId = provider.data.id as string;

    const update = await api("PUT", `/api/providers/${providerId}`, {
      base_url: "http://127.0.0.1:11434/v1",
    });
    expect(update.status).toBe(200);
    expect(update.data.success).toBe(true);

    const after = getRawProviderRecord(providerId);
    expect(after?.base_url).toBe("http://127.0.0.1:11434/v1");

    await api("DELETE", `/api/providers/${providerId}`);
  });

  test("GET /api/providers/available should return provider catalog metadata", async () => {
    const { status, data } = await api("GET", "/api/providers/available");
    expect(status).toBe(200);
    expect(Array.isArray(data)).toBe(true);
    expect(data.length).toBeGreaterThan(0);
    expect(typeof data[0].id).toBe("string");
    expect(typeof data[0].name).toBe("string");
    expect(Array.isArray(data[0].models)).toBe(true);

    const geminiCli = (
      data as Array<{
        id: string;
        authType: string;
        oauthFlow: string | null;
        hasOAuthConfig: boolean;
      }>
    ).find((provider) => provider.id === "google-gemini-cli");
    const openaiCodex = (
      data as Array<{
        id: string;
        authType: string;
        oauthFlow: string | null;
        hasOAuthConfig: boolean;
      }>
    ).find((provider) => provider.id === "openai-codex");
    expect(geminiCli).toBeDefined();
    expect(geminiCli?.authType).toBe("oauth");
    expect(geminiCli?.oauthFlow).toBe("redirect");
    expect(geminiCli?.hasOAuthConfig).toBe(true);
    expect(openaiCodex).toBeDefined();
    expect(openaiCodex?.authType).toBe("oauth");
    expect(openaiCodex?.oauthFlow).toBe("redirect");
    expect(openaiCodex?.hasOAuthConfig).toBe(true);
  });

  test("GET /api/providers/health should return provider health", async () => {
    const { status, data } = await api("GET", "/api/providers/health");
    expect(status).toBe(200);
    expect(data.status).toBe("healthy");
    expect(data.summary).toBeDefined();
    expect(Array.isArray(data.providers)).toBe(true);
  });

  test("POST /api/providers/:id/test should return not found for unknown provider", async () => {
    const { status, data } = await api("POST", `/api/providers/nonexistent-${Date.now()}/test`);
    expect(status).toBe(404);
    expect(data.code).toBe("NOT_FOUND");
  });
});

describe("Providers OAuth API", () => {
  test("OAuth endpoints should reject unknown provider types as validation errors", async () => {
    const suffix = `missing-provider-${Date.now()}`;

    const deviceCode = await api("POST", "/api/providers/oauth/device-code", {
      providerType: suffix,
    });
    expect(deviceCode.status).toBe(400);
    expect(deviceCode.data.code).toBe("VALIDATION_ERROR");

    const poll = await api("POST", "/api/providers/oauth/poll", {
      providerType: suffix,
      deviceCode: "device-code",
    });
    expect(poll.status).toBe(400);
    expect(poll.data.code).toBe("VALIDATION_ERROR");

    const start = await api("POST", "/api/providers/oauth/start", {
      providerType: suffix,
    });
    expect(start.status).toBe(400);
    expect(start.data.code).toBe("VALIDATION_ERROR");
  });

  test("callback status should return not_found for unknown state", async () => {
    const { status, data } = await api("POST", "/api/providers/oauth/callback-status", {
      state: `missing-state-${Date.now()}`,
    });
    expect(status).toBe(200);
    expect(data.status).toBe("not_found");
  });
});

describe("Speech API", () => {
  test("GET /api/providers/available should include ElevenLabs speech provider", async () => {
    const { status, data } = await api("GET", "/api/providers/available");
    expect(status).toBe(200);
    expect(Array.isArray(data)).toBe(true);
    const elevenlabs = data.find((provider: { id?: string }) => provider.id === "elevenlabs");
    expect(elevenlabs).toBeDefined();
    expect(elevenlabs.authType).toBe("api_key");
    expect(elevenlabs.models.map((model: { id: string }) => model.id)).toContain(
      "eleven_multilingual_v2"
    );
  });

  test("GET and PUT /api/speech/settings should normalize shared speech config", async () => {
    const put = await api("PUT", "/api/speech/settings", {
      tts: {
        provider: "Eleven Labs",
        providerId: "  provider-1  ",
        model: " eleven_flash_v2_5 ",
        voice: " voice-abc ",
        outputFormat: "wav",
        speed: 9,
        maxTextLength: 100000,
        fallbackToSystem: false,
      },
      stt: {
        provider: "openai-codex",
        providerId: " provider-2 ",
        model: " whisper-1 ",
        language: " EN ",
      },
    });
    expect(put.status).toBe(200);
    expect(put.data.success).toBe(true);
    expect(put.data.speech.tts.provider).toBe("elevenlabs");
    expect(put.data.speech.tts.providerId).toBe("provider-1");
    expect(put.data.speech.tts.outputFormat).toBe("wav");
    expect(put.data.speech.tts.speed).toBe(2);
    expect(put.data.speech.tts.maxTextLength).toBe(50000);
    expect(put.data.speech.stt.provider).toBe("openai");
    expect(put.data.speech.stt.language).toBe("en");

    const get = await api("GET", "/api/speech/settings");
    expect(get.status).toBe(200);
    expect(get.data.tts.provider).toBe("elevenlabs");
    expect(get.data.tts.providerId).toBe("provider-1");
    expect(get.data.stt.providerId).toBe("provider-2");

    const configResponse = await api("GET", "/api/config");
    expect(configResponse.status).toBe(200);
    expect(configResponse.data.speech.tts.model).toBe("eleven_flash_v2_5");
  });

  test("native speech-to-text mode is normalized and blocks server transcription by default", async () => {
    const put = await api("PUT", "/api/speech/settings", {
      tts: { provider: "auto" },
      stt: { provider: "native", language: "en-US" },
    });
    expect(put.status).toBe(200);
    expect(put.data.speech.stt.provider).toBe("native");

    const blocked = await api("POST", "/api/speech/dictate", {
      audioBase64: "Zm9v",
      mimeType: "audio/webm",
      fileName: "dictation.webm",
    });
    expect(blocked.status).toBe(400);
    expect(String(blocked.data.error)).toContain("native dictation");

    await api("PUT", "/api/speech/settings", {
      tts: { provider: "auto" },
      stt: { provider: "auto" },
    });
  });

  test("POST /api/speech/dictate should reject missing audio payload", async () => {
    const { status, data } = await api("POST", "/api/speech/dictate", {});
    expect(status).toBe(400);
    expect(data.code).toBe("VALIDATION_ERROR");
    expect(String(data.error)).toContain("audioBase64 is required");
  });

  test("POST /api/speech/dictate should reject unknown requested provider", async () => {
    const { status, data } = await api("POST", "/api/speech/dictate", {
      providerId: `missing-provider-${Date.now()}`,
      audioBase64: "Zm9v",
      mimeType: "audio/webm",
      fileName: "dictation.webm",
    });
    expect(status).toBe(400);
    expect(data.code).toBe("VALIDATION_ERROR");
    expect(String(data.error)).toContain("Requested dictation provider ID is invalid");
  });
});

describe("Channels API", () => {
  test("GET /api/channels should return array", async () => {
    const { status, data } = await api("GET", "/api/channels");
    expect(status).toBe(200);
    expect(Array.isArray(data)).toBe(true);
  });

  test("GET /api/channels/available should return channel type metadata", async () => {
    const { status, data } = await api("GET", "/api/channels/available");
    expect(status).toBe(200);
    expect(Array.isArray(data)).toBe(true);
    expect(data.length).toBeGreaterThan(0);
    expect(typeof data[0].id).toBe("string");
    expect(Array.isArray(data[0].fields)).toBe(true);
  });

  test("POST /api/channels should reject missing required config", async () => {
    const { status, data } = await api("POST", "/api/channels", {
      name: `invalid-discord-${Date.now()}`,
      type: "discord",
      config: {},
    });
    expect(status).toBe(400);
    expect(typeof data.error).toBe("string");
  });

  test("POST /api/channels/telegram/setup should validate bot token", async () => {
    const { status, data } = await api("POST", "/api/channels/telegram/setup", {});
    expect(status).toBe(400);
    expect(data.code).toBe("VALIDATION_ERROR");
  });

  test("GET /api/channels/:id and POST /api/channels/:id/test should work for web channel", async () => {
    const channelName = `web-test-${Date.now()}`;
    const created = await api("POST", "/api/channels", {
      name: channelName,
      type: "web",
      config: {},
    });

    expect(created.status).toBe(200);
    const channelId = created.data.id as string;
    expect(channelId).toBeDefined();

    const fetched = await api("GET", `/api/channels/${channelId}`);
    expect(fetched.status).toBe(200);
    expect(fetched.data.id).toBe(channelId);
    expect(fetched.data.type).toBe("web");

    const tested = await api("POST", `/api/channels/${channelId}/test`);
    expect(tested.status).toBe(200);
    expect(tested.data.success).toBe(true);
    expect(tested.data.running).toBe(true);

    await api("DELETE", `/api/channels/${channelId}`);
  });

  test("channel routes tolerate malformed persisted config JSON", async () => {
    const suffix = Date.now().toString();
    const channelId = `discord-bad-config-${suffix}`;
    insertRawChannel(channelId, "discord", `discord-bad-${suffix}`, "{bad-json", false);

    const listRes = await api("GET", "/api/channels");
    expect(listRes.status).toBe(200);
    const listed = (listRes.data as Array<{ id: string; config: Record<string, unknown> }>).find(
      (entry) => entry.id === channelId
    );
    expect(listed).toBeDefined();
    expect(listed?.config).toEqual({});

    const malformedTestRes = await api("POST", `/api/channels/${channelId}/test`);
    expect(malformedTestRes.status).toBe(200);
    expect(malformedTestRes.data.success).toBe(false);
    expect(typeof malformedTestRes.data.error).toBe("string");
    expect(malformedTestRes.data.error).toContain("Missing required config fields");
    expect(malformedTestRes.data.error).toContain("bot_token");

    const updateRes = await api("PUT", `/api/channels/${channelId}`, {
      config: { bot_token: "recovered-token" },
    });
    expect(updateRes.status).toBe(200);
    expect(updateRes.data.success).toBe(true);

    const recoveredRes = await api("POST", `/api/channels/${channelId}/test`);
    expect(recoveredRes.status).toBe(200);
    expect(recoveredRes.data.success).toBe(false);
    expect(recoveredRes.data.error).toBeUndefined();

    const getRes = await api("GET", `/api/channels/${channelId}`);
    expect(getRes.status).toBe(200);
    expect(getRes.data.config.bot_token).toBe("••••••••");

    await api("DELETE", `/api/channels/${channelId}`);
  });
});

describe("Webhooks API", () => {
  test("POST /api/webhooks/telegram/:channelId should return ok=false for unknown channel", async () => {
    const { status, data } = await api("POST", `/api/webhooks/telegram/missing-${Date.now()}`, {});
    expect(status).toBe(200);
    expect(data.ok).toBe(false);
  });
});

describe("Skills API", () => {
  test("GET /api/skills should return skills array", async () => {
    const { status, data } = await api("GET", "/api/skills");
    expect(status).toBe(200);
    expect(Array.isArray(data)).toBe(true);
  });

  test("skills category/status/registry endpoints should return shaped responses", async () => {
    const categories = await api("GET", "/api/skills/categories");
    expect(categories.status).toBe(200);
    expect(Array.isArray(categories.data)).toBe(true);

    const statusRes = await api("GET", "/api/skills/status");
    expect(statusRes.status).toBe(200);
    expect(Array.isArray(statusRes.data.skills)).toBe(true);
    expect(typeof statusRes.data.summary.total).toBe("number");

    const registrySearch = await api("GET", "/api/skills/registry/search");
    expect(registrySearch.status).toBe(200);
    expect(Array.isArray(registrySearch.data.skills)).toBe(true);
    expect(Array.isArray(registrySearch.data.registries)).toBe(true);
  });

  test("POST /api/skills should create local skill", async () => {
    const skillSlug = `audit-skill-${Date.now()}`;
    const { status, data } = await api("POST", "/api/skills", {
      name: skillSlug,
      slug: skillSlug,
      description: "Audit test skill",
      content: `# ${skillSlug}\n\nA test skill created by integration tests.`,
    });

    expect(status).toBe(200);
    expect(data.name).toBeDefined();

    await api("DELETE", `/api/skills/${skillSlug}`);
  });

  test("POST /api/skills/:name/execute should run builtin calc skill", async () => {
    const { status, data } = await api("POST", "/api/skills/calc/execute", { expression: "2+2*5" });
    expect(status).toBe(200);
    expect(data.expression).toBe("2+2*5");
    expect(data.result).toBe(12);
    expect(data.formatted).toBe("12");
  });
});

describe("MCP Servers API", () => {
  test("GET /api/mcp/servers should return array", async () => {
    const { status, data } = await api("GET", "/api/mcp/servers");
    expect(status).toBe(200);
    expect(Array.isArray(data)).toBe(true);
  });

  test("GET /api/mcp/tools should return array", async () => {
    const { status, data } = await api("GET", "/api/mcp/tools");
    expect(status).toBe(200);
    expect(Array.isArray(data)).toBe(true);
  });

  test("MCP create/get/update/start/stop/delete lifecycle should be wired", async () => {
    const createRes = await api("POST", "/api/mcp", {
      name: `routes-mcp-${Date.now()}`,
      command: "echo",
      args: "hello",
      enabled: true,
    });
    expect(createRes.status).toBe(200);
    expect(typeof createRes.data.id).toBe("string");
    const mcpId = createRes.data.id as string;

    const getRes = await api("GET", `/api/mcp/${mcpId}`);
    expect(getRes.status).toBe(200);
    expect(getRes.data.id).toBe(mcpId);
    expect(typeof getRes.data.status).toBe("string");

    const updateRes = await api("PUT", `/api/mcp/${mcpId}`, {
      name: `routes-mcp-updated-${Date.now()}`,
    });
    expect(updateRes.status).toBe(200);
    expect(updateRes.data.success).toBe(true);

    const startRes = await api("POST", `/api/mcp/${mcpId}/start`);
    expect(startRes.status).toBe(200);
    expect(startRes.data.success).toBe(false);
    expect(typeof startRes.data.error).toBe("string");

    const stopRes = await api("POST", `/api/mcp/${mcpId}/stop`);
    expect(stopRes.status).toBe(200);
    expect(stopRes.data.success).toBe(true);

    const deleteRes = await api("DELETE", `/api/mcp/${mcpId}`);
    expect(deleteRes.status).toBe(200);
    expect(deleteRes.data.success).toBe(true);
  });
});

describe("MCP Registry API", () => {
  test("registry list/search/category/detail/install endpoints should be wired", async () => {
    const registriesRes = await api("GET", "/api/mcp/registry/registries");
    expect(registriesRes.status).toBe(200);
    expect(Array.isArray(registriesRes.data)).toBe(true);
    expect(registriesRes.data.length).toBeGreaterThan(0);

    const popularRes = await api("GET", "/api/mcp/registry/popular");
    expect(popularRes.status).toBe(200);
    expect(Array.isArray(popularRes.data)).toBe(true);
    expect(popularRes.data.length).toBeGreaterThan(0);

    const categoriesRes = await api("GET", "/api/mcp/registry/categories");
    expect(categoriesRes.status).toBe(200);
    expect(Array.isArray(categoriesRes.data)).toBe(true);
    expect(categoriesRes.data.length).toBeGreaterThan(0);

    const categoryRes = await api("GET", "/api/mcp/registry/category/core");
    expect(categoryRes.status).toBe(200);
    expect(Array.isArray(categoryRes.data)).toBe(true);
    expect(categoryRes.data.length).toBeGreaterThan(0);

    const searchRes = await api("GET", "/api/mcp/registry/search?q=filesystem&registry=official");
    expect(searchRes.status).toBe(200);
    expect(Array.isArray(searchRes.data)).toBe(true);

    const detailRes = await api("GET", "/api/mcp/registry/servers/mcp-filesystem");
    expect(detailRes.status).toBe(200);
    expect(detailRes.data.id).toBe("mcp-filesystem");

    const installRes = await api("POST", "/api/mcp/registry/install", {
      id: "mcp-filesystem",
      trustedAction: true,
    });
    expect(installRes.status).toBe(200);
    expect(installRes.data.success).toBe(true);
    expect(typeof installRes.data.id).toBe("string");
    const installedId = installRes.data.id as string;

    const cleanupRes = await api("DELETE", `/api/mcp/${installedId}`);
    expect(cleanupRes.status).toBe(200);
    expect(cleanupRes.data.success).toBe(true);
  });

  test("install endpoint should validate missing id/package", async () => {
    const untrusted = await api("POST", "/api/mcp/registry/install", { id: "mcp-filesystem" });
    expect(untrusted.status).toBe(200);
    expect(untrusted.data.success).toBe(false);
    expect(String(untrusted.data.error)).toContain("trustedAction=true");

    const res = await api("POST", "/api/mcp/registry/install", { trustedAction: true });
    expect(res.status).toBe(200);
    expect(res.data.success).toBe(false);
    expect(typeof res.data.error).toBe("string");
  });
});

describe("Tools API", () => {
  test("GET /api/tools/builtin should return builtin tool definitions", async () => {
    const { status, data } = await api("GET", "/api/tools/builtin");
    expect(status).toBe(200);
    expect(Array.isArray(data)).toBe(true);
    expect(data.length).toBeGreaterThan(0);
    expect(typeof data[0].name).toBe("string");
  });

  test("GET /api/tools should return tools", async () => {
    const { status, data } = await api("GET", "/api/tools");
    expect(status).toBe(200);
    expect(typeof data).toBe("object");
  });

  test("GET /api/tools/dangerous returns policy and dangerous tool list", async () => {
    const { status, data } = await api("GET", "/api/tools/dangerous");
    expect(status).toBe(200);
    expect(Array.isArray(data.tools)).toBe(true);
    expect(data.tools).toContain("exec");
    expect(typeof data.policy).toBe("object");
    expect(typeof data.policy.enabled).toBe("boolean");
    expect(["audit", "block"]).toContain(data.policy.mode);
  });

  test("POST /api/tools/execute should validate missing/unknown tool names", async () => {
    const missingName = await api("POST", "/api/tools/execute", {});
    expect(missingName.status).toBe(400);
    expect(missingName.data.code).toBe("VALIDATION_ERROR");

    const unknownTool = await api("POST", "/api/tools/execute", {
      name: `missing-tool-${Date.now()}`,
      args: {},
    });
    expect(unknownTool.status).toBe(400);
    expect(unknownTool.data.code).toBe("VALIDATION_ERROR");
  });

  test("POST /api/tools/execute supports optional context permission enforcement", async () => {
    const toolFile = join(testHome, `tool-permission-${Date.now()}.txt`);
    writeFileSync(toolFile, "permission-test", "utf8");

    const denied = await api("POST", "/api/tools/execute", {
      name: "read",
      args: { path: toolFile },
      context: {
        agentId: "api-tools-test",
        sessionId: "api-tools-session",
        permissions: ["net:fetch"],
        enforcePermissions: true,
      },
    });
    expect(denied.status).toBe(400);
    expect(denied.data.code).toBe("VALIDATION_ERROR");
    expect(String(denied.data.error || "")).toContain("Permission denied");

    const allowed = await api("POST", "/api/tools/execute", {
      name: "read",
      args: { path: toolFile },
      context: {
        agentId: "api-tools-test",
        sessionId: "api-tools-session",
        permissions: ["fs:read"],
        enforcePermissions: true,
      },
    });
    expect(allowed.status).toBe(200);
    expect(allowed.data.content).toBe("permission-test");
  });

  test("POST /api/tools/execute confines file writes to the supplied workspace by default", async () => {
    const workspaceDir = mkdtempSync(join(testHome, "tool-workspace-"));
    const outsideDir = mkdtempSync(join(testHome, "tool-outside-"));
    try {
      const inside = join(workspaceDir, "notes.txt");
      const outside = join(outsideDir, "escape.txt");

      const insideWrite = await api("POST", "/api/tools/execute", {
        name: "write",
        args: { path: inside, content: "inside" },
        context: { agentId: "api-tools-workspace", workspaceDir },
      });
      expect(insideWrite.status).toBe(200);
      expect(insideWrite.data.success).toBe(true);

      const outsideWrite = await api("POST", "/api/tools/execute", {
        name: "write",
        args: { path: outside, content: "outside" },
        context: { agentId: "api-tools-workspace", workspaceDir },
      });
      expect(outsideWrite.status).toBe(400);
      expect(String(outsideWrite.data.error || "")).toContain("outside the configured workspace");
    } finally {
      rmSync(workspaceDir, { recursive: true, force: true });
      rmSync(outsideDir, { recursive: true, force: true });
    }
  });

  test("POST /api/tools/execute rejects symlink escapes from the supplied workspace", async () => {
    const workspaceDir = mkdtempSync(join(testHome, "tool-symlink-workspace-"));
    const outsideDir = mkdtempSync(join(testHome, "tool-symlink-outside-"));
    try {
      const outsideFile = join(outsideDir, "target.txt");
      const outsideFileLink = join(workspaceDir, "linked-target.txt");
      const outsideSubdir = join(outsideDir, "subdir");
      const outsideDirLink = join(workspaceDir, "linked-dir");
      writeFileSync(outsideFile, "outside", "utf8");
      mkdirSync(outsideSubdir, { recursive: true });
      symlinkSync(outsideFile, outsideFileLink);
      symlinkSync(outsideSubdir, outsideDirLink, "dir");

      const fileLinkWrite = await api("POST", "/api/tools/execute", {
        name: "write",
        args: { path: outsideFileLink, content: "overwrite through link" },
        context: { agentId: "api-tools-symlink", workspaceDir },
      });
      expect(fileLinkWrite.status).toBe(400);
      expect(String(fileLinkWrite.data.error || "")).toContain("outside the configured workspace");

      const parentLinkWrite = await api("POST", "/api/tools/execute", {
        name: "write",
        args: { path: join(outsideDirLink, "new-file.txt"), content: "escape through parent" },
        context: { agentId: "api-tools-symlink", workspaceDir },
      });
      expect(parentLinkWrite.status).toBe(400);
      expect(String(parentLinkWrite.data.error || "")).toContain(
        "outside the configured workspace"
      );
    } finally {
      rmSync(workspaceDir, { recursive: true, force: true });
      rmSync(outsideDir, { recursive: true, force: true });
    }
  });

  test("POST /api/tools/execute blocks dangerous tools when policy is enabled", async () => {
    const applyPolicy = await api("PUT", "/api/config", {
      dangerous_tool_policy: { enabled: true, mode: "block" },
    });
    expect(applyPolicy.status).toBe(200);

    const blocked = await api("POST", "/api/tools/execute", {
      name: "exec",
      args: { command: "echo policy-blocked" },
      context: { agentId: "dangerous-policy-test" },
    });
    expect(blocked.status).toBe(400);
    expect(blocked.data.code).toBe("VALIDATION_ERROR");
    expect(String(blocked.data.error || "")).toContain("Dangerous tool 'exec' blocked by policy");

    // SECURITY: a client-supplied allowDangerousTools must NOT bypass the
    // policy — the server ignores it, so the dangerous tool stays blocked.
    const overrideIgnored = await api("POST", "/api/tools/execute", {
      name: "exec",
      args: { command: "echo policy-allowed" },
      context: { agentId: "dangerous-policy-test", allowDangerousTools: true },
    });
    expect(overrideIgnored.status).toBe(400);
    expect(String(overrideIgnored.data.error || "")).toContain(
      "Dangerous tool 'exec' blocked by policy"
    );

    const resetPolicy = await api("PUT", "/api/config", {
      dangerous_tool_policy: { enabled: false, mode: "audit" },
    });
    expect(resetPolicy.status).toBe(200);
  });

  test("POST /api/tools/execute requires approval for dangerous tools when tool approval mode is ask", async () => {
    const setAskMode = await api("PUT", "/api/config", {
      tool_approval_mode: "ask",
    });
    expect(setAskMode.status).toBe(200);

    const blocked = await api("POST", "/api/tools/execute", {
      name: "exec",
      args: { command: "echo approval-required" },
      context: { agentId: "dangerous-approval-test" },
    });
    expect(blocked.status).toBe(400);
    expect(blocked.data.code).toBe("VALIDATION_ERROR");
    expect(String(blocked.data.error || "")).toContain("requires approval");

    // SECURITY: a client-supplied allowDangerousTools must NOT bypass the
    // approval gate — the server ignores it, so approval is still required.
    const overrideIgnored = await api("POST", "/api/tools/execute", {
      name: "exec",
      args: { command: "echo approval-override" },
      context: { agentId: "dangerous-approval-test", allowDangerousTools: true },
    });
    expect(overrideIgnored.status).toBe(400);
    expect(String(overrideIgnored.data.error || "")).toContain("requires approval");

    const resetMode = await api("PUT", "/api/config", {
      tool_approval_mode: "always_allow",
    });
    expect(resetMode.status).toBe(200);
  });
});

describe("LSP API", () => {
  test("LSP status/languages/diagnostics/install-status endpoints should return shaped payloads", async () => {
    const lspMetricsBefore = countMetrics("lsp_operation");

    const statusRes = await api("GET", "/api/lsp/status");
    expect(statusRes.status).toBe(200);
    expect(typeof statusRes.data.status).toBe("string");
    expect(typeof statusRes.data.workspace).toBe("string");
    expect(Array.isArray(statusRes.data.supported)).toBe(true);
    expect(typeof statusRes.data.diagnosticsCount).toBe("number");

    const languagesRes = await api("GET", "/api/lsp/languages");
    expect(languagesRes.status).toBe(200);
    expect(Array.isArray(languagesRes.data.languages)).toBe(true);

    const diagnosticsRes = await api("GET", "/api/lsp/diagnostics");
    expect(diagnosticsRes.status).toBe(200);
    expect(Array.isArray(diagnosticsRes.data.files)).toBe(true);
    expect(typeof diagnosticsRes.data.total).toBe("number");

    const installStatusRes = await api("GET", "/api/lsp/install-status");
    expect(installStatusRes.status).toBe(200);
    expect(Array.isArray(installStatusRes.data.status)).toBe(true);
    expect(installStatusRes.data.status.length).toBeGreaterThan(0);

    const lspMetricsAfter = countMetrics("lsp_operation");
    expect(lspMetricsAfter).toBeGreaterThan(lspMetricsBefore);
  });

  test("LSP diagnostics file endpoint should validate missing path and support explicit file path", async () => {
    const missingRes = await api("GET", "/api/lsp/diagnostics/file");
    expect(missingRes.status).toBe(200);
    expect(missingRes.data.success).toBe(false);
    expect(typeof missingRes.data.error).toBe("string");

    const tsPath = join(testHome, `lsp-test-${Date.now()}.ts`);
    writeFileSync(tsPath, "const n: number = 1;\n", "utf8");

    const fileRes = await api(
      "GET",
      `/api/lsp/diagnostics/file?path=${encodeURIComponent(tsPath)}`
    );
    expect(fileRes.status).toBe(200);
    expect(fileRes.data.success).toBe(true);
    expect(fileRes.data.path).toBe(tsPath);
    expect(Array.isArray(fileRes.data.diagnostics)).toBe(true);
  });

  test("LSP install/uninstall endpoints should validate and reject unknown languages safely", async () => {
    const missingInstall = await api("POST", "/api/lsp/install", {});
    expect(missingInstall.status).toBe(200);
    expect(missingInstall.data.success).toBe(false);
    expect(typeof missingInstall.data.error).toBe("string");

    const unknownInstall = await api("POST", "/api/lsp/install", { language: "unknown_lang_123" });
    expect(unknownInstall.status).toBe(200);
    expect(unknownInstall.data.success).toBe(false);
    expect(typeof unknownInstall.data.error).toBe("string");

    const missingUninstall = await api("POST", "/api/lsp/uninstall", {});
    expect(missingUninstall.status).toBe(200);
    expect(missingUninstall.data.success).toBe(false);
    expect(typeof missingUninstall.data.error).toBe("string");

    const unknownUninstall = await api("POST", "/api/lsp/uninstall", {
      language: "unknown_lang_123",
    });
    expect(unknownUninstall.status).toBe(200);
    expect(unknownUninstall.data.success).toBe(false);
    expect(typeof unknownUninstall.data.error).toBe("string");
  });
});

describe("Session API", () => {
  test("GET /api/sessions should return array", async () => {
    const { status, data } = await api("GET", "/api/sessions");
    expect(status).toBe(200);
    expect(Array.isArray(data)).toBe(true);
  });

  test("session list and detail include provider/model metadata for the chat agent", async () => {
    const suffix = Date.now();
    const providerId = `session-provider-${suffix}`;
    const agentId = `session-agent-${suffix}`;
    const sessionId = `session-metadata-${suffix}`;
    try {
      insertRawProvider(providerId, "openai", "OpenAI Test");
      insertRawAgent(agentId, "Session Metadata Agent", "{}", {
        model: "gpt-5-mini",
        providerId,
      });
      insertRawSession(sessionId, agentId, [{ role: "assistant", content: "hello" }]);

      const list = await api("GET", "/api/sessions");
      expect(list.status).toBe(200);
      const found = (
        list.data as Array<{
          id: string;
          provider?: string;
          provider_id?: string;
          provider_name?: string;
          model?: string;
        }>
      ).find((entry) => entry.id === sessionId);
      expect(found).toMatchObject({
        provider: "openai",
        provider_id: providerId,
        provider_name: "OpenAI Test",
        model: "gpt-5-mini",
      });

      const detail = await api("GET", `/api/sessions/${sessionId}`);
      expect(detail.status).toBe(200);
      expect(detail.data).toMatchObject({
        provider: "openai",
        provider_id: providerId,
        provider_name: "OpenAI Test",
        model: "gpt-5-mini",
      });
    } finally {
      deleteRawSession(sessionId);
      deleteRawAgent(agentId);
      deleteRawProvider(providerId);
    }
  });

  test("session list and detail fall back to stored assistant model metadata", async () => {
    const suffix = Date.now();
    const sessionId = `session-stored-model-${suffix}`;
    const missingAgentId = `deleted-session-agent-${suffix}`;
    try {
      insertRawSession(sessionId, missingAgentId, [
        {
          role: "assistant",
          content: "hello from a previous model",
          metadata: {
            provider: "openai",
            provider_id: `deleted-provider-${suffix}`,
            provider_name: "OpenAI Snapshot",
            model: "gpt-4.1",
            agent_name: "Deleted Agent",
          },
        },
      ]);

      const list = await api("GET", "/api/sessions");
      expect(list.status).toBe(200);
      const found = (
        list.data as Array<{
          id: string;
          provider?: string;
          provider_id?: string;
          provider_name?: string;
          model?: string;
          agent_name?: string;
        }>
      ).find((entry) => entry.id === sessionId);
      expect(found).toMatchObject({
        provider: "openai",
        provider_id: `deleted-provider-${suffix}`,
        provider_name: "OpenAI Snapshot",
        model: "gpt-4.1",
        agent_name: "Deleted Agent",
      });

      const detail = await api("GET", `/api/sessions/${sessionId}`);
      expect(detail.status).toBe(200);
      expect(detail.data).toMatchObject({
        provider: "openai",
        provider_id: `deleted-provider-${suffix}`,
        provider_name: "OpenAI Snapshot",
        model: "gpt-4.1",
        agent_name: "Deleted Agent",
      });
    } finally {
      deleteRawSession(sessionId);
    }
  });

  test("session workspace can be set and loaded via session routes", async () => {
    const initialWorkspace = process.cwd();
    const agentId = `workspace-session-agent-${Date.now()}`;
    insertRawAgent(agentId, "Workspace Session Agent", "{}");
    const create = await api("POST", "/api/chat", {
      message: `workspace-session-${Date.now()}`,
      agentId,
      workspaceDir: initialWorkspace,
    });
    try {
      expect(create.status).toBe(200);
      const sessionId = create.data.sessionId as string;
      expect(typeof sessionId).toBe("string");

      const detailBefore = await api("GET", `/api/sessions/${sessionId}`);
      expect(detailBefore.status).toBe(200);
      expect(detailBefore.data.workspace_dir).toBe(initialWorkspace);

      const nextWorkspace = process.env.HOME || initialWorkspace;
      const update = await api("PUT", `/api/sessions/${sessionId}/workspace`, {
        workspaceDir: nextWorkspace,
      });
      expect(update.status).toBe(200);
      expect(update.data.success).toBe(true);
      expect(update.data.sessionId).toBe(sessionId);
      expect(update.data.workspaceDir).toBe(nextWorkspace);

      const detailAfter = await api("GET", `/api/sessions/${sessionId}`);
      expect(detailAfter.status).toBe(200);
      expect(detailAfter.data.workspace_dir).toBe(nextWorkspace);

      const sessions = await api("GET", "/api/sessions");
      expect(sessions.status).toBe(200);
      const found = (sessions.data as Array<{ id: string; workspace_dir?: string | null }>).find(
        (entry) => entry.id === sessionId
      );
      expect(found).toBeDefined();
      expect(found?.workspace_dir).toBe(nextWorkspace);
    } finally {
      if (typeof create.data?.sessionId === "string") {
        deleteRawSession(create.data.sessionId);
      }
      deleteRawAgent(agentId);
    }
  });

  test("GET /api/sessions/:sessionId keeps artifact tool calls visible when tool list exceeds preview limit", async () => {
    const sessionId = `session-artifact-trunc-${Date.now()}`;
    const agentId = `agent-artifact-trunc-${Date.now()}`;
    const toolCalls = Array.from({ length: 55 }, (_, index) => ({
      id: `call-${index}`,
      name: "exec",
      args: { command: `echo ${index}` },
      status: "completed",
      result: { output: `exec-${index}` },
    }));
    toolCalls[54] = {
      id: "call-artifact",
      name: "artifacts",
      args: { action: "create", name: "task" },
      status: "completed",
      result: {
        action: "create",
        sessionId,
        artifact: {
          sessionId,
          name: "task",
          fileName: "task.md.resolved",
          path: `/Users/test/.cybara/artifacts/${sessionId}/task.md.resolved`,
          kind: "task",
          title: "Task",
          size: 42,
          createdAt: "2026-02-21T00:00:00.000Z",
          updatedAt: "2026-02-21T00:00:00.000Z",
        },
      },
    };

    insertRawSession(sessionId, agentId, [
      {
        role: "user",
        content: "Create an artifact",
        metadata: { source: "chat_api" },
      },
      {
        role: "assistant",
        content: "Done. Artifact created.",
        metadata: {
          source: "chat_api",
          tool_calls: toolCalls,
        },
      },
    ]);

    const loaded = await api("GET", `/api/sessions/${sessionId}`);
    expect(loaded.status).toBe(200);
    expect(Array.isArray(loaded.data.messagesList)).toBe(true);

    const assistant = (loaded.data.messagesList as Array<Record<string, unknown>>).find(
      (entry) => entry.role === "assistant"
    ) as { tool_calls?: Array<Record<string, unknown>>; _truncated?: string } | undefined;
    expect(assistant).toBeDefined();
    expect(Array.isArray(assistant?.tool_calls)).toBe(true);
    expect(assistant?.tool_calls?.length).toBeLessThanOrEqual(50);
    expect(typeof assistant?._truncated).toBe("string");
    const previewTimelineIndexes = (assistant?.tool_calls || []).map((toolCall) => {
      const value = (toolCall as { timeline_index?: unknown }).timeline_index;
      return typeof value === "number" ? value : null;
    });
    expect(previewTimelineIndexes.every((value) => typeof value === "number")).toBe(true);
    for (let i = 1; i < previewTimelineIndexes.length; i += 1) {
      expect((previewTimelineIndexes[i] || 0) >= (previewTimelineIndexes[i - 1] || 0)).toBe(true);
    }

    const artifactCall = assistant?.tool_calls?.find((toolCall) => toolCall.name === "artifacts");
    expect(artifactCall).toBeDefined();
    expect((artifactCall?.result as Record<string, unknown>)?.artifact).toBeDefined();
    expect(
      ((artifactCall?.result as Record<string, unknown>)?.artifact as Record<string, unknown>)
        ?.fileName
    ).toBe("task.md.resolved");

    const loadedFull = await api("GET", `/api/sessions/${sessionId}?includeFullToolCalls=1`);
    expect(loadedFull.status).toBe(200);
    const assistantFull = (loadedFull.data.messagesList as Array<Record<string, unknown>>).find(
      (entry) => entry.role === "assistant"
    ) as { tool_calls?: Array<Record<string, unknown>>; _truncated?: string } | undefined;
    expect(assistantFull).toBeDefined();
    expect(assistantFull?._truncated).toBeUndefined();
    expect(Array.isArray(assistantFull?.tool_calls)).toBe(true);
    expect(assistantFull?.tool_calls?.length).toBe(55);
    const fullToolCalls = assistantFull?.tool_calls || [];
    const fullFirstTimelineIndex = (fullToolCalls[0] as { timeline_index?: unknown })
      ?.timeline_index;
    const fullLastTimelineIndex = (
      fullToolCalls[fullToolCalls.length - 1] as { timeline_index?: unknown }
    )?.timeline_index;
    expect(fullFirstTimelineIndex).toBe(0);
    expect(fullLastTimelineIndex).toBe(54);
  });

  test("GET /api/sessions/:sessionId includeFullToolCalls preserves full content, process activities, and tool payloads", async () => {
    const sessionId = `session-full-history-${Date.now()}`;
    const agentId = `agent-full-history-${Date.now()}`;
    const longAssistantContent = `Audit output\n${"A".repeat(12050)}`;
    const longToolResult = `tool-result-${"R".repeat(1400)}`;
    const longToolError = `tool-error-${"E".repeat(420)}`;
    const processActivities = Array.from({ length: 320 }, (_, index) => ({
      id: `activity-${index}`,
      phase: index % 7 === 0 ? "start" : "result",
      text: `activity-${index}-${"x".repeat(620)}`,
      timestamp: 1_770_000_000_000 + index,
      toolName: index % 11 === 0 ? "__thought" : "read",
    }));

    insertRawSession(sessionId, agentId, [
      {
        role: "user",
        content: "Run full audit",
        metadata: { source: "chat_api" },
      },
      {
        role: "assistant",
        content: longAssistantContent,
        metadata: {
          source: "chat_api",
          tool_calls: [
            {
              id: "call-full-0",
              name: "read",
              args: { path: "src/index.ts" },
              status: "failed",
              result: longToolResult,
              error: longToolError,
            },
          ],
          process_activities: processActivities,
        },
      },
    ]);

    const compact = await api("GET", `/api/sessions/${sessionId}`);
    expect(compact.status).toBe(200);
    const compactAssistant = (compact.data.messagesList as Array<Record<string, unknown>>).find(
      (entry) => entry.role === "assistant"
    ) as Record<string, unknown> | undefined;
    expect(compactAssistant).toBeDefined();
    expect(String(compactAssistant?.content || "")).toContain("[content truncated");
    expect(
      ((compactAssistant?.process_activities as Array<Record<string, unknown>> | undefined) || [])
        .length
    ).toBeLessThanOrEqual(240);
    const compactTool = (
      compactAssistant?.tool_calls as Array<Record<string, unknown>> | undefined
    )?.[0];
    expect(typeof compactTool?.result).toBe("string");
    expect(String(compactTool?.result || "")).toContain("[truncated]");
    expect(String(compactTool?.error || "")).toContain("...");

    const full = await api("GET", `/api/sessions/${sessionId}?includeFullToolCalls=1`);
    expect(full.status).toBe(200);
    const fullAssistant = (full.data.messagesList as Array<Record<string, unknown>>).find(
      (entry) => entry.role === "assistant"
    ) as Record<string, unknown> | undefined;
    expect(fullAssistant).toBeDefined();
    expect(String(fullAssistant?.content || "")).toBe(longAssistantContent);
    expect(String(fullAssistant?.content || "")).not.toContain("[content truncated");
    expect(
      ((fullAssistant?.process_activities as Array<Record<string, unknown>> | undefined) || [])
        .length
    ).toBe(processActivities.length);

    const fullTool = (fullAssistant?.tool_calls as Array<Record<string, unknown>> | undefined)?.[0];
    expect(fullTool?.result).toBe(longToolResult);
    expect(fullTool?.error).toBe(longToolError);
    expect((fullAssistant as { _truncated?: string })._truncated).toBeUndefined();
  });

  test("POST /api/sessions/:sessionId/revert truncates later conversation history", async () => {
    const agentId = `revert-session-agent-${Date.now()}`;
    insertRawAgent(agentId, "Revert Session Agent", "{}");
    const first = await api("POST", "/api/chat", {
      agentId,
      message: `revert-first-${Date.now()}`,
    });
    try {
      expect(first.status).toBe(200);
      const sessionId = first.data.sessionId as string;
      expect(typeof sessionId).toBe("string");

      const second = await api("POST", "/api/chat", {
        sessionId,
        message: `revert-second-${Date.now()}`,
      });
      expect(second.status).toBe(200);

      const third = await api("POST", "/api/chat", {
        sessionId,
        message: `revert-third-${Date.now()}`,
      });
      expect(third.status).toBe(200);

      const before = await api("GET", `/api/sessions/${sessionId}`);
      expect(before.status).toBe(200);
      expect(before.data.messagesList.length).toBeGreaterThanOrEqual(4);
      const userIndexes = (before.data.messagesList as Array<{ role?: string }>).reduce<number[]>(
        (indexes, message, index) => {
          if (message.role === "user") indexes.push(index);
          return indexes;
        },
        []
      );
      expect(userIndexes.length).toBeGreaterThanOrEqual(2);
      const revertIndex = userIndexes[1] ?? userIndexes[0] ?? 0;
      const expectedKeptCount = revertIndex;
      const expectedRemovedCount = before.data.messagesList.length - expectedKeptCount;
      const revertMessage = before.data.messagesList[revertIndex];
      const shiftedIndex =
        revertIndex + 1 < before.data.messagesList.length ? revertIndex + 1 : revertIndex;

      const reverted = await api("POST", `/api/sessions/${sessionId}/revert`, {
        messageIndex: shiftedIndex,
        messageRole: "user",
        messageContent: revertMessage.content,
        messageTimestamp: revertMessage.timestamp,
      });
      expect(reverted.status).toBe(200);
      expect(reverted.data.success).toBe(true);
      expect(reverted.data.sessionId).toBe(sessionId);
      expect(reverted.data.keptCount).toBe(expectedKeptCount);
      expect(reverted.data.removedCount).toBe(expectedRemovedCount);
      expect(reverted.data.removedFromIndex).toBe(revertIndex);
      expect(reverted.data.messagesList).toHaveLength(expectedKeptCount);
      if (expectedKeptCount > 0) {
        expect(reverted.data.messagesList[expectedKeptCount - 1].role).not.toBeUndefined();
      }

      const after = await api("GET", `/api/sessions/${sessionId}`);
      expect(after.status).toBe(200);
      expect(after.data.messagesList).toHaveLength(expectedKeptCount);
      if (expectedKeptCount > 0) {
        expect(after.data.messagesList[expectedKeptCount - 1].role).not.toBeUndefined();
      }
    } finally {
      if (typeof first.data?.sessionId === "string") {
        deleteRawSession(first.data.sessionId);
      }
      deleteRawAgent(agentId);
    }
  });

  test("session artifact routes and artifacts tool manage session-scoped .md.resolved files", async () => {
    const sessionId = `artifact-session-${Date.now()}`;

    const create = await api("POST", "/api/tools/execute", {
      name: "artifacts",
      args: {
        action: "create",
        kind: "task",
        name: "task",
        title: "Task Checklist",
        items: ["Design API", "Implement backend", "Wire UI preview"],
      },
      context: {
        sessionId,
      },
    });
    expect(create.status).toBe(200);
    expect(create.data.action).toBe("create");
    expect(create.data.artifact.fileName).toBe("task.md.resolved");

    const readViaKind = await api("POST", "/api/tools/execute", {
      name: "artifacts",
      args: {
        action: "read",
        kind: "task",
      },
      context: {
        sessionId,
      },
    });
    expect(readViaKind.status).toBe(200);
    expect(readViaKind.data.action).toBe("read");
    expect(readViaKind.data.artifact.fileName).toBe("task.md.resolved");
    expect(typeof readViaKind.data.content).toBe("string");

    const readWithFallback = await api("POST", "/api/tools/execute", {
      name: "artifacts",
      args: {
        action: "read",
        name: "does-not-exist",
        kind: "task",
      },
      context: {
        sessionId,
      },
    });
    expect(readWithFallback.status).toBe(200);
    expect(readWithFallback.data.action).toBe("read");
    expect(readWithFallback.data.fallback).toBe(true);
    expect(readWithFallback.data.resolvedFrom).toBe("does-not-exist");
    expect(readWithFallback.data.artifact.fileName).toBe("task.md.resolved");
    expect(typeof readWithFallback.data.content).toBe("string");

    const list = await api("GET", `/api/sessions/${sessionId}/artifacts`);
    expect(list.status).toBe(200);
    expect(Array.isArray(list.data.artifacts)).toBe(true);
    expect(list.data.artifacts.length).toBeGreaterThan(0);
    expect(list.data.artifacts[0].fileName).toBe("task.md.resolved");

    const readBeforeCheck = await api(
      "GET",
      `/api/sessions/${sessionId}/artifacts/${encodeURIComponent("task.md.resolved")}`
    );
    expect(readBeforeCheck.status).toBe(200);
    expect(typeof readBeforeCheck.data.content).toBe("string");
    expect(readBeforeCheck.data.content).toContain("- [ ] Design API");

    const check = await api("POST", "/api/tools/execute", {
      name: "artifacts",
      args: {
        action: "check",
        name: "task",
        item: 1,
        checked: true,
      },
      context: {
        sessionId,
      },
    });
    expect(check.status).toBe(200);
    expect(check.data.action).toBe("check");
    expect(check.data.checked).toBe(true);

    const readAfterCheck = await api(
      "GET",
      `/api/sessions/${sessionId}/artifacts/${encodeURIComponent("task.md.resolved")}`
    );
    expect(readAfterCheck.status).toBe(200);
    expect(readAfterCheck.data.content).toContain("- [x] Design API");

    const deleted = await api(
      "DELETE",
      `/api/sessions/${sessionId}/artifacts/${encodeURIComponent("task.md.resolved")}`
    );
    expect(deleted.status).toBe(200);
    expect(deleted.data.success).toBe(true);

    const listAfterDelete = await api("GET", `/api/sessions/${sessionId}/artifacts`);
    expect(listAfterDelete.status).toBe(200);
    expect(Array.isArray(listAfterDelete.data.artifacts)).toBe(true);
    expect(listAfterDelete.data.artifacts).toHaveLength(0);
  });

  test("artifacts are isolated per session id", async () => {
    const sessionA = `artifact-session-a-${Date.now()}`;
    const sessionB = `artifact-session-b-${Date.now()}`;

    const createA = await api("POST", "/api/tools/execute", {
      name: "artifacts",
      args: { action: "create", kind: "notes", name: "notes", content: "# A\n" },
      context: { sessionId: sessionA },
    });
    expect(createA.status).toBe(200);

    const createB = await api("POST", "/api/tools/execute", {
      name: "artifacts",
      args: { action: "create", kind: "notes", name: "notes", content: "# B\n" },
      context: { sessionId: sessionB },
    });
    expect(createB.status).toBe(200);

    const listA = await api("GET", `/api/sessions/${sessionA}/artifacts`);
    const listB = await api("GET", `/api/sessions/${sessionB}/artifacts`);
    expect(listA.status).toBe(200);
    expect(listB.status).toBe(200);
    expect(listA.data.artifacts).toHaveLength(1);
    expect(listB.data.artifacts).toHaveLength(1);

    const readA = await api(
      "GET",
      `/api/sessions/${sessionA}/artifacts/${encodeURIComponent("notes.md.resolved")}`
    );
    const readB = await api(
      "GET",
      `/api/sessions/${sessionB}/artifacts/${encodeURIComponent("notes.md.resolved")}`
    );
    expect(readA.status).toBe(200);
    expect(readB.status).toBe(200);
    expect(readA.data.content).toContain("# A");
    expect(readB.data.content).toContain("# B");
  });

  test("artifacts read returns missing payload instead of throwing when no artifact exists", async () => {
    const sessionId = `artifact-missing-${Date.now()}`;
    const readMissing = await api("POST", "/api/tools/execute", {
      name: "artifacts",
      args: {
        action: "read",
        name: "task",
      },
      context: {
        sessionId,
      },
    });

    expect(readMissing.status).toBe(200);
    expect(readMissing.data.action).toBe("read");
    expect(readMissing.data.missing).toBe(true);
    expect(readMissing.data.count).toBe(0);
    expect(Array.isArray(readMissing.data.artifacts)).toBe(true);
  });

  test("GET /api/status/sessions returns active-session snapshot shape", async () => {
    const all = await api("GET", "/api/status/sessions");
    expect(all.status).toBe(200);
    expect(Array.isArray(all.data.activeSessions)).toBe(true);
    expect(Array.isArray(all.data.activeSessionIds)).toBe(true);
    expect(typeof all.data.count).toBe("number");

    const sessionId = `missing-session-${Date.now()}`;
    const scoped = await api(
      "GET",
      `/api/status/sessions?sessionId=${encodeURIComponent(sessionId)}`
    );
    expect(scoped.status).toBe(200);
    expect(scoped.data.sessionId).toBe(sessionId);
    expect(typeof scoped.data.active).toBe("boolean");
    expect(Array.isArray(scoped.data.activeSessionIds)).toBe(true);
  });

  test("GET /api/artifacts lists artifacts across sessions", async () => {
    const sessionA = `artifact-global-a-${Date.now()}`;
    const sessionB = `artifact-global-b-${Date.now()}`;

    const createdA = await api("POST", "/api/tools/execute", {
      name: "artifacts",
      args: {
        action: "create",
        kind: "notes",
        name: "global-a",
        content: "# Global A\n",
      },
      context: { sessionId: sessionA },
    });
    expect(createdA.status).toBe(200);

    const createdB = await api("POST", "/api/tools/execute", {
      name: "artifacts",
      args: {
        action: "create",
        kind: "notes",
        name: "global-b",
        content: "# Global B\n",
      },
      context: { sessionId: sessionB },
    });
    expect(createdB.status).toBe(200);

    const allArtifacts = await api("GET", "/api/artifacts");
    expect(allArtifacts.status).toBe(200);
    expect(Array.isArray(allArtifacts.data.artifacts)).toBe(true);
    const summaries = allArtifacts.data.artifacts as Array<{ sessionId: string; fileName: string }>;
    expect(
      summaries.some(
        (summary) => summary.sessionId === sessionA && summary.fileName === "global-a.md.resolved"
      )
    ).toBe(true);
    expect(
      summaries.some(
        (summary) => summary.sessionId === sessionB && summary.fileName === "global-b.md.resolved"
      )
    ).toBe(true);
  });
});

describe("Tasks API", () => {
  test("POST /api/tasks/:id/run should resolve alias route", async () => {
    const runRes = await api("POST", `/api/tasks/nonexistent-${Date.now()}/run`);
    expect(runRes.status).toBe(200);
    expect(runRes.data.success).toBe(false);
  });

  test("GET /api/tasks and /api/tasks/:id tolerate malformed task config JSON", async () => {
    const taskId = `bad-task-config-${Date.now()}`;
    insertRawTask(taskId, `bad-task-${Date.now()}`, "{bad-json", "pending");

    const listRes = await api("GET", "/api/tasks");
    expect(listRes.status).toBe(200);
    const listed = (listRes.data as Array<{ id: string; config: Record<string, unknown> }>).find(
      (entry) => entry.id === taskId
    );
    expect(listed).toBeDefined();
    expect(listed?.config).toEqual({});

    const getRes = await api("GET", `/api/tasks/${taskId}`);
    expect(getRes.status).toBe(200);
    expect(getRes.data.id).toBe(taskId);
    expect(getRes.data.config).toEqual({});

    await api("DELETE", `/api/tasks/${taskId}`);
  });

  test("task lifecycle routes create/get/start/stop/trigger/runs/delete", async () => {
    const agentId = `task-lifecycle-agent-${Date.now()}`;
    insertRawAgent(agentId, "Task Lifecycle Agent", "{}");
    const createRes = await api("POST", "/api/tasks", {
      name: `routes-task-${Date.now()}`,
      description: "integration task lifecycle",
      action: "Say hello from tasks integration test",
      agent_id: agentId,
      schedule: "0 * * * *",
      enabled: false,
    });
    let taskId = "";
    try {
      expect(createRes.status).toBe(200);
      expect(typeof createRes.data.id).toBe("string");
      taskId = createRes.data.id as string;

      const getRes = await api("GET", `/api/tasks/${taskId}`);
      expect(getRes.status).toBe(200);
      expect(getRes.data.id).toBe(taskId);

      const startRes = await api("POST", `/api/tasks/${taskId}/start`);
      expect(startRes.status).toBe(200);
      expect(startRes.data.success).toBe(true);

      const stopRes = await api("POST", `/api/tasks/${taskId}/stop`);
      expect(stopRes.status).toBe(200);
      expect(stopRes.data.success).toBe(true);

      const triggerRes = await api("POST", `/api/tasks/${taskId}/trigger`);
      expect(triggerRes.status).toBe(200);
      expect(triggerRes.data.success).toBe(true);

      const runsRes = await api("GET", `/api/tasks/${taskId}/runs`);
      expect(runsRes.status).toBe(200);
      expect(Array.isArray(runsRes.data)).toBe(true);
      expect(runsRes.data.length).toBeGreaterThan(0);

      const deleteRes = await api("DELETE", `/api/tasks/${taskId}`);
      expect(deleteRes.status).toBe(200);
      expect(deleteRes.data.success).toBe(true);
      taskId = "";
    } finally {
      if (taskId) {
        await api("DELETE", `/api/tasks/${taskId}`);
      }
      deleteRawAgent(agentId);
    }
  });
});

describe("Subagents API", () => {
  test("list/get/spawn/kill routes should be wired and validate required fields", async () => {
    const listRes = await api("GET", "/api/subagents");
    expect(listRes.status).toBe(200);
    expect(Array.isArray(listRes.data)).toBe(true);

    const getMissingRes = await api("GET", `/api/subagents/missing-${Date.now()}`);
    expect(getMissingRes.status).toBe(200);
    expect(getMissingRes.data.error).toBe("Subagent not found");

    const spawnMissingTaskRes = await api("POST", "/api/subagents/spawn", {});
    expect(spawnMissingTaskRes.status).toBe(200);
    expect(spawnMissingTaskRes.data.success).toBe(false);
    expect(typeof spawnMissingTaskRes.data.error).toBe("string");

    const killMissingRes = await api("POST", `/api/subagents/missing-${Date.now()}/kill`);
    expect(killMissingRes.status).toBe(200);
    expect(killMissingRes.data.success).toBe(false);
  });

  test("spawn route forwards optional agent/model metadata and returns session/run identifiers", async () => {
    const requestedAgentId = `requested-agent-${Date.now()}`;
    const spawnRes = await api("POST", "/api/subagents/spawn", {
      task: "api spawn metadata wiring",
      agentId: requestedAgentId,
      model: "gpt-test-model",
      timeout: 5,
      label: "metadata test",
    });

    expect(spawnRes.status).toBe(200);
    expect(spawnRes.data.success).toBe(true);
    expect(spawnRes.data.status).toBe("accepted");
    expect(typeof spawnRes.data.subagentId).toBe("string");
    expect(typeof spawnRes.data.sessionKey).toBe("string");
    expect(
      (spawnRes.data.sessionKey as string).startsWith(`agent:${requestedAgentId}:subagent:`)
    ).toBe(true);

    const getRes = await api("GET", `/api/subagents/${spawnRes.data.subagentId}`);
    expect(getRes.status).toBe(200);
    expect(getRes.data.id).toBe(spawnRes.data.subagentId);
  });
});

describe("Metrics API", () => {
  test("GET /api/metrics should return metrics", async () => {
    const { status, data } = await api("GET", "/api/metrics");
    expect(status).toBe(200);
    expect(typeof data).toBe("object");
    expect(data).toHaveProperty("memory");
    expect(data).toHaveProperty("uptime");
  });

  test("GET /api/metrics/storage returns storage usage details", async () => {
    const storage = await api("GET", "/api/metrics/storage");
    expect(storage.status).toBe(200);
    expect(typeof storage.data.totalBytes).toBe("number");
    expect(storage.data.totalBytes).toBeGreaterThanOrEqual(0);
    expect(typeof storage.data.accountedBytes).toBe("number");
    expect(typeof storage.data.uncategorizedBytes).toBe("number");
    expect(typeof storage.data.directories).toBe("object");
    expect(typeof storage.data.components).toBe("object");
    expect(typeof storage.data.components.database.bytes).toBe("number");
    expect(storage.data.components.database.path).toContain("platform.db");
    expect(typeof storage.data.components.artifacts.bytes).toBe("number");
    expect(typeof storage.data.components.logs.bytes).toBe("number");
    expect(typeof storage.data.components.memory.bytes).toBe("number");
    expect(typeof storage.data.components.data.bytes).toBe("number");
    expect(typeof storage.data.components.sessions.bytes).toBe("number");
    expect(typeof storage.data.components.media.bytes).toBe("number");
    expect(typeof storage.data.components.channels.bytes).toBe("number");
    expect(typeof storage.data.components.other.bytes).toBe("number");
    expect(Array.isArray(storage.data.topLevel)).toBe(true);
    const accountedPlusOther =
      Number(storage.data.accountedBytes || 0) + Number(storage.data.uncategorizedBytes || 0);
    expect(accountedPlusOther).toBeLessThanOrEqual(storage.data.totalBytes + 1);
  });

  test("metrics detail endpoints tolerate malformed metadata rows", async () => {
    const suffix = Date.now().toString();
    const malformedProvider = `prov_bad_${suffix}`;
    const providerWithUrl = `prov_url_${suffix}`;
    const uniqueTokenValue = 987_654_321;
    const uniqueFileOp = `file_op_${suffix}`;
    const uniqueTool = `tool_${suffix}`;

    insertRawMetric("token_usage_by_provider", malformedProvider, 11, "{bad-json");
    insertRawMetric("api_call", malformedProvider, 5, "{still-bad");
    insertRawMetric("token_usage_by_provider", providerWithUrl, 22, "{bad-json");
    insertRawMetric(
      "api_call",
      providerWithUrl,
      2,
      JSON.stringify({ url: `https://metrics.${suffix}.example/v1` })
    );

    insertRawMetric("token_usage", `token_${suffix}`, uniqueTokenValue, "{bad-json");
    insertRawMetric("file_operation", uniqueFileOp, 13, "{bad-json");
    insertRawMetric("tool_call", uniqueTool, 17, "{bad-json");

    const providersRes = await api("GET", "/api/metrics/providers");
    expect(providersRes.status).toBe(200);
    const providers = (providersRes.data.providers || []) as Array<{
      provider: string;
      hits: number;
      tokens: number;
      url: string;
    }>;
    const providerMap = new Map(providers.map((p) => [p.provider, p]));
    expect(providerMap.get(malformedProvider)).toEqual({
      provider: malformedProvider,
      hits: 5,
      tokens: 11,
      url: "unknown",
    });
    expect(providerMap.get(providerWithUrl)).toEqual({
      provider: providerWithUrl,
      hits: 2,
      tokens: 22,
      url: `https://metrics.${suffix}.example/v1`,
    });

    const tokensRes = await api("GET", "/api/metrics/tokens");
    expect(tokensRes.status).toBe(200);
    const tokenRow = (tokensRes.data.recentUsage || []).find(
      (row: { tokens: number; metadata: unknown }) => row.tokens === uniqueTokenValue
    ) as { tokens: number; metadata: unknown } | undefined;
    expect(tokenRow).toBeDefined();
    expect(tokenRow?.metadata).toBeNull();

    const filesRes = await api("GET", "/api/metrics/files");
    expect(filesRes.status).toBe(200);
    const fileRow = (filesRes.data.recentOperations || []).find(
      (row: { type: string; metadata: unknown }) => row.type === uniqueFileOp
    ) as { type: string; metadata: unknown } | undefined;
    expect(fileRow).toBeDefined();
    expect(fileRow?.metadata).toBeNull();

    const toolsRes = await api("GET", "/api/metrics/tools");
    expect(toolsRes.status).toBe(200);
    const toolRow = (toolsRes.data.recentCalls || []).find(
      (row: { tool: string; metadata: unknown }) => row.tool === uniqueTool
    ) as { tool: string; metadata: unknown } | undefined;
    expect(toolRow).toBeDefined();
    expect(toolRow?.metadata).toBeNull();
  });

  test("metrics insights endpoint returns efficiency and trend summaries", async () => {
    const suffix = Date.now().toString();
    const provider = `insight_provider_${suffix}`;
    const model = `insight_model_${suffix}`;
    const tool = `insight_tool_${suffix}`;
    const tokenTotal = 9_000_000;

    insertRawMetric("token_usage", "all", tokenTotal);
    insertRawMetric("token_usage", "input", 3_000_000);
    insertRawMetric("token_usage", "output", 6_000_000);
    insertRawMetric("token_usage_by_model", model, tokenTotal);
    insertRawMetric(
      "token_usage_by_provider",
      provider,
      tokenTotal,
      JSON.stringify({ url: `https://${provider}.example/v1` })
    );
    insertRawMetric(
      "api_call",
      provider,
      3,
      JSON.stringify({ url: `https://${provider}.example/v1` })
    );
    insertRawMetric("tool_call", tool, 5);
    insertRawMetric("tool_error", tool, 1);

    const insightsRes = await api("GET", "/api/metrics/insights");
    expect(insightsRes.status).toBe(200);
    expect(insightsRes.data.tokenBreakdown.total).toBeGreaterThan(0);
    expect(typeof insightsRes.data.tokenTrend24h.changePct).toBe("number");
    expect(["up", "down", "flat"]).toContain(insightsRes.data.tokenTrend24h.direction);

    const providerRow = (insightsRes.data.providerEfficiency || []).find(
      (row: { provider: string }) => row.provider === provider
    ) as { provider: string; tokens: number; calls: number; tokensPerCall: number } | undefined;
    expect(providerRow).toBeDefined();
    expect(providerRow?.tokens).toBeGreaterThanOrEqual(tokenTotal);
    expect(providerRow?.calls).toBeGreaterThan(0);
    expect(typeof providerRow?.tokensPerCall).toBe("number");

    const toolRow = (insightsRes.data.toolUsage24h || []).find(
      (row: { tool: string }) => row.tool === tool
    ) as { tool: string; calls: number } | undefined;
    expect(toolRow).toBeDefined();
    expect(toolRow?.calls).toBeGreaterThanOrEqual(5);

    expect(typeof insightsRes.data.toolReliability.successRatePct).toBe("number");
    expect(
      insightsRes.data.modelInsights.some((entry: { model: string }) => entry.model === model)
    ).toBe(true);
  });
});

describe("Config API", () => {
  test("GET /api/config should return config object", async () => {
    const { status, data } = await api("GET", "/api/config");
    expect(status).toBe(200);
    expect(typeof data).toBe("object");
    expect(data).not.toBeNull();
    expect(typeof data.dangerous_tool_policy).toBe("object");
    expect(typeof data.dangerous_tool_policy.enabled).toBe("boolean");
    expect(["audit", "block"]).toContain(data.dangerous_tool_policy.mode);
    expect(["always_allow", "ask"]).toContain(data.tool_approval_mode);
  });

  test("GET /api/config tolerates malformed stored JSON values", async () => {
    const key = `routes_bad_config_${Date.now()}`;
    const rawValue = "{bad-json";
    upsertRawConfig(key, rawValue);

    const getRes = await api("GET", "/api/config");
    expect(getRes.status).toBe(200);
    expect(getRes.data[key]).toBe(rawValue);
  });

  test("PUT /api/config should update a temporary key", async () => {
    const key = `routes_test_key_${Date.now()}`;
    const value = `value-${Date.now()}`;

    const putRes = await api("PUT", "/api/config", { [key]: value });
    expect(putRes.status).toBe(200);
    expect(putRes.data.success).toBe(true);

    const getRes = await api("GET", "/api/config");
    expect(getRes.status).toBe(200);
    expect(getRes.data[key]).toBe(value);
  });

  test("PUT /api/config normalizes dangerous tool policy payloads", async () => {
    const putRes = await api("PUT", "/api/config", {
      dangerous_tool_policy: { enabled: true, mode: "invalid-mode" },
    });
    expect(putRes.status).toBe(200);
    expect(putRes.data.success).toBe(true);

    const getRes = await api("GET", "/api/config");
    expect(getRes.status).toBe(200);
    expect(getRes.data.dangerous_tool_policy).toEqual({
      enabled: true,
      mode: "audit",
    });

    const resetRes = await api("PUT", "/api/config", {
      dangerous_tool_policy: { enabled: false, mode: "audit" },
    });
    expect(resetRes.status).toBe(200);
  });

  test("PUT /api/config normalizes tool approval mode payloads", async () => {
    const putAsk = await api("PUT", "/api/config", {
      tool_approval_mode: "ask",
    });
    expect(putAsk.status).toBe(200);
    expect(putAsk.data.success).toBe(true);

    const getAsk = await api("GET", "/api/config");
    expect(getAsk.status).toBe(200);
    expect(getAsk.data.tool_approval_mode).toBe("ask");

    const putInvalid = await api("PUT", "/api/config", {
      tool_approval_mode: "not-a-mode",
    });
    expect(putInvalid.status).toBe(200);
    expect(putInvalid.data.success).toBe(true);

    const getInvalid = await api("GET", "/api/config");
    expect(getInvalid.status).toBe(200);
    expect(getInvalid.data.tool_approval_mode).toBe("ask");
  });

  test("PUT /api/config normalizes web tool url policy payloads", async () => {
    const putRes = await api("PUT", "/api/config", {
      web_tool_url_policy: {
        enabled: true,
        fetch_allowlist: ["EXAMPLE.com", "  *.Allowed.io  ", "", 123],
        search_result_allowlist: ["NEWS.EXAMPLE.com", null, "*.ALLOWED.io"],
      },
    });
    expect(putRes.status).toBe(200);
    expect(putRes.data.success).toBe(true);

    const getRes = await api("GET", "/api/config");
    expect(getRes.status).toBe(200);
    expect(getRes.data.web_tool_url_policy).toEqual({
      enabled: true,
      fetch_allowlist: ["example.com", "*.allowed.io"],
      search_result_allowlist: ["news.example.com", "*.allowed.io"],
    });

    const resetRes = await api("PUT", "/api/config", {
      web_tool_url_policy: {
        enabled: false,
        fetch_allowlist: [],
        search_result_allowlist: [],
      },
    });
    expect(resetRes.status).toBe(200);
  });

  test("PUT /api/config normalizes computer-use driver command override", async () => {
    const putRes = await api("PUT", "/api/config", {
      computer_use: {
        driverCommand:
          '"C:\\Users\\carsen\\AppData\\Local\\Programs\\Cua\\cua-driver\\bin\\cua-driver.exe"',
      },
    });
    expect(putRes.status).toBe(200);
    expect(putRes.data.success).toBe(true);

    const getRes = await api("GET", "/api/config");
    expect(getRes.status).toBe(200);
    expect(getRes.data.computer_use).toEqual({
      driverCommand:
        "C:\\Users\\carsen\\AppData\\Local\\Programs\\Cua\\cua-driver\\bin\\cua-driver.exe",
    });

    const resetRes = await api("PUT", "/api/config", {
      computer_use: { driverCommand: "" },
    });
    expect(resetRes.status).toBe(200);
  });

  test("PUT /api/config normalizes memory behavior settings", async () => {
    const putRes = await api("PUT", "/api/config", {
      memory: {
        backgroundReviewEnabled: false,
        backgroundReviewMinIntervalMs: 2500,
        backgroundReviewTimeoutSeconds: 9999,
        memoryFlushEnabled: true,
        memoryFlushSoftThresholdTokens: 10,
        memoryFlushPrompt: "  capture durable facts only  ",
        memoryFlushSystemPrompt: "  memory system  ",
      },
    });
    expect(putRes.status).toBe(200);
    expect(putRes.data.success).toBe(true);

    const getRes = await api("GET", "/api/config");
    expect(getRes.status).toBe(200);
    expect(getRes.data.memory).toMatchObject({
      backgroundReviewEnabled: false,
      backgroundReviewMinIntervalMs: 10000,
      backgroundReviewTimeoutSeconds: 600,
      memoryFlushEnabled: true,
      memoryFlushSoftThresholdTokens: 500,
      memoryFlushPrompt: "capture durable facts only",
      memoryFlushSystemPrompt: "memory system",
    });

    const resetRes = await api("PUT", "/api/config", {
      memory: {
        backgroundReviewEnabled: true,
        backgroundReviewMinIntervalMs: 300000,
        backgroundReviewTimeoutSeconds: 90,
        memoryFlushEnabled: true,
        memoryFlushSoftThresholdTokens: 4000,
      },
    });
    expect(resetRes.status).toBe(200);
  });
});

describe("Browser API", () => {
  test("GET /api/browser/status should return browser state", async () => {
    const { status, data } = await api("GET", "/api/browser/status");
    expect(status).toBe(200);
    expect(typeof data.running).toBe("boolean");
  });

  test("GET /api/browser/tabs should return tabs array", async () => {
    const { status, data } = await api("GET", "/api/browser/tabs");
    expect(status).toBe(200);
    expect(Array.isArray(data.tabs)).toBe(true);
  });

  test("POST /api/browser/tabs/:id/navigate should validate missing url", async () => {
    const { status, data } = await api("POST", "/api/browser/tabs/nonexistent/navigate", {});
    expect(status).toBe(200);
    expect(data.error).toBe("URL is required");
  });

  test("POST /api/browser/tabs/:id/click should validate selector", async () => {
    const { status, data } = await api("POST", "/api/browser/tabs/nonexistent/click", {});
    expect(status).toBe(200);
    expect(data.error).toBe("Selector is required");
  });

  test("POST /api/browser/tabs/:id/type should validate selector and text", async () => {
    const { status, data } = await api("POST", "/api/browser/tabs/nonexistent/type", {
      selector: "",
      text: "",
    });
    expect(status).toBe(200);
    expect(data.error).toBe("Selector and text are required");
  });

  test("DELETE /api/browser/tabs/:id should return not found for unknown page", async () => {
    const { status, data } = await api("DELETE", "/api/browser/tabs/nonexistent");
    expect(status).toBe(200);
    expect(data.error).toBe("Page not found");
  });

  test("POST /api/browser/close should return success", async () => {
    const { status, data } = await api("POST", "/api/browser/close");
    expect(status).toBe(200);
    expect(data.success).toBe(true);
  });
});

describe("Open URL API", () => {
  test("POST /api/open-url should reject invalid URLs as validation errors", async () => {
    const { status, data } = await api("POST", "/api/open-url", { url: "not-a-valid-url" });
    expect(status).toBe(400);
    expect(data.code).toBe("VALIDATION_ERROR");
  });

  test("POST /api/open-url should reject missing url", async () => {
    const { status, data } = await api("POST", "/api/open-url", {});
    expect(status).toBe(400);
    expect(data.code).toBe("VALIDATION_ERROR");
  });

  test("POST /api/open-url should reject non-http protocols", async () => {
    const { status, data } = await api("POST", "/api/open-url", { url: "javascript:alert(1)" });
    expect(status).toBe(400);
    expect(data.code).toBe("VALIDATION_ERROR");
  });

  test("POST /api/open-url should reject localhost/private targets", async () => {
    const { status, data } = await api("POST", "/api/open-url", { url: "http://localhost:3000" });
    expect(status).toBe(400);
    expect(data.code).toBe("VALIDATION_ERROR");
  });
});

describe("System Prompt & Identity API", () => {
  test("system prompt and identity endpoints tolerate malformed persisted JSON", async () => {
    upsertRawConfig("systemPrompt", "{bad-json");
    upsertRawConfig("identity", "{bad-json");

    const systemPromptRes = await api("GET", "/api/system-prompt");
    expect(systemPromptRes.status).toBe(200);
    expect(typeof systemPromptRes.data.template).toBe("string");
    expect(systemPromptRes.data.template).toBe("default");
    expect(systemPromptRes.data.identity.name).toBe("Cybara");

    const identityRes = await api("GET", "/api/identity");
    expect(identityRes.status).toBe(200);
    expect(identityRes.data.name).toBe("Cybara");
    expect(identityRes.data.avatar).toBe("");

    const previewRes = await api("GET", "/api/system-prompt/preview");
    expect(previewRes.status).toBe(200);
    expect(typeof previewRes.data.preview).toBe("string");
    expect(previewRes.data.preview.length).toBeGreaterThan(50);
  });

  test("system prompt config can be updated and preview generated", async () => {
    const getRes = await api("GET", "/api/system-prompt");
    expect(getRes.status).toBe(200);
    expect(typeof getRes.data.template).toBe("string");
    expect(getRes.data.identity).toBeDefined();

    const updated = {
      template: "custom",
      customPrompt: "You are a test prompt profile.",
      defaultBasePrompt: "Base prompt text",
      identity: {
        name: "Cybara Test",
        emoji: "🧪",
        creature: "assistant",
        vibe: "focused",
        theme: "light",
      },
      features: {
        memoryEnabled: true,
        skillsEnabled: true,
        messagingEnabled: false,
        replyTagsEnabled: true,
      },
    };

    const putRes = await api("PUT", "/api/system-prompt", updated);
    expect(putRes.status).toBe(200);
    expect(putRes.data.success).toBe(true);

    const verifyRes = await api("GET", "/api/system-prompt");
    expect(verifyRes.status).toBe(200);
    expect(verifyRes.data.template).toBe("custom");
    expect(verifyRes.data.identity.name).toBe("Cybara Test");
    expect(verifyRes.data.features.messagingEnabled).toBe(false);

    const previewRes = await api("GET", "/api/system-prompt/preview");
    expect(previewRes.status).toBe(200);
    expect(typeof previewRes.data.preview).toBe("string");
    expect(previewRes.data.preview.length).toBeGreaterThan(50);
  });

  test("identity config can be updated and re-read", async () => {
    const getRes = await api("GET", "/api/identity");
    expect(getRes.status).toBe(200);
    expect(typeof getRes.data.name).toBe("string");

    const updated = {
      name: "Cybara Identity Test",
      emoji: "🤖",
      creature: "bot",
      vibe: "calm",
      theme: "dark",
      avatar: "https://example.com/avatar.png",
    };

    const putRes = await api("PUT", "/api/identity", updated);
    expect(putRes.status).toBe(200);
    expect(putRes.data.success).toBe(true);

    const verifyRes = await api("GET", "/api/identity");
    expect(verifyRes.status).toBe(200);
    expect(verifyRes.data.name).toBe(updated.name);
    expect(verifyRes.data.emoji).toBe(updated.emoji);
    expect(verifyRes.data.avatar).toBe(updated.avatar);
  });
});

describe("System Status API", () => {
  test("GET /api/system/status should return lightweight status payload", async () => {
    const { status, data } = await api("GET", "/api/system/status");
    expect(status).toBe(200);
    expect(typeof data.status).toBe("string");
    expect(typeof data.timestamp).toBe("number");
    expect(typeof data.agentCount).toBe("number");
  });
});

describe("Memory API", () => {
  test("POST /api/memory should create file and DELETE should remove it", async () => {
    const file = `routes-memory-${Date.now()}.md`;
    const createRes = await api("POST", "/api/memory", {
      file,
      content: "memory integration test",
    });

    expect(createRes.status).toBe(200);
    expect(createRes.data.success).toBe(true);
    expect(createRes.data.file).toBe(file);

    const listRes = await api("GET", "/api/memory");
    expect(listRes.status).toBe(200);
    expect(Array.isArray(listRes.data.files)).toBe(true);
    expect(listRes.data.files).toContain(file);

    const deleteRes = await api("DELETE", `/api/memory/${file}`);
    expect(deleteRes.status).toBe(200);
    expect(deleteRes.data.success).toBe(true);
  });

  test("GET /api/memory/search should return search results array", async () => {
    const file = `routes-memory-search-${Date.now()}.md`;
    const needle = `needle-${Date.now()}`;

    const createRes = await api("POST", "/api/memory", {
      file,
      content: `memory search ${needle}`,
    });
    expect(createRes.status).toBe(200);

    const searchRes = await api("GET", `/api/memory/search?query=${encodeURIComponent(needle)}`);
    expect(searchRes.status).toBe(200);
    expect(Array.isArray(searchRes.data.results)).toBe(true);
    expect(searchRes.data.results.length).toBeGreaterThan(0);

    await api("DELETE", `/api/memory/${file}`);
  });

  test("POST /api/memory appends entries to existing files and supports edit/delete", async () => {
    const file = `routes-memory-append-${Date.now()}.md`;

    try {
      const firstCreate = await api("POST", "/api/memory", {
        file,
        content: "first memory entry",
      });
      expect(firstCreate.status).toBe(200);
      expect(firstCreate.data.success).toBe(true);
      expect(firstCreate.data.appended).toBe(false);

      const appendCreate = await api("POST", "/api/memory", {
        file,
        content: "second memory entry",
      });
      expect(appendCreate.status).toBe(200);
      expect(appendCreate.data.success).toBe(true);
      expect(appendCreate.data.appended).toBe(true);

      const listAfterAppend = await api("GET", "/api/memory");
      const memoryFile = listAfterAppend.data.memories.find(
        (item: { file: string }) => item.file === file
      );
      expect(memoryFile.entries).toHaveLength(2);
      expect(memoryFile.entries[1].content).toContain("second memory entry");

      const searchRes = await api("GET", "/api/memory/search?query=second%20memory");
      const searchHit = searchRes.data.results.find((item: { file: string }) => item.file === file);
      expect(searchHit.file).toBe(file);
      expect(searchHit.entry.index).toBe(1);

      const editRes = await api("PUT", `/api/memory/${file}`, {
        index: 1,
        content: "edited second memory entry",
      });
      expect(editRes.status).toBe(200);
      expect(editRes.data.success).toBe(true);

      const deleteEntryRes = await api("DELETE", `/api/memory/${file}`, { index: 0 });
      expect(deleteEntryRes.status).toBe(200);
      expect(deleteEntryRes.data.success).toBe(true);

      const listAfterDelete = await api("GET", "/api/memory");
      const updatedMemoryFile = listAfterDelete.data.memories.find(
        (item: { file: string }) => item.file === file
      );
      expect(updatedMemoryFile.entries).toHaveLength(1);
      expect(updatedMemoryFile.entries[0].content).toContain("edited second memory entry");
    } finally {
      await api("DELETE", `/api/memory/${file}`);
    }
  });

  test("memory edit and delete decode encoded route filenames before sanitizing", async () => {
    const rawFile = `routes memory encoded ${Date.now()}.md`;
    const expectedFile = rawFile.replace(/[^\w.-]/g, "-");
    const encodedFile = encodeURIComponent(rawFile);

    try {
      const createRes = await api("POST", "/api/memory", {
        file: rawFile,
        content: "encoded memory entry",
      });
      expect(createRes.status).toBe(200);
      expect(createRes.data.file).toBe(expectedFile);

      const editRes = await api("PUT", `/api/memory/${encodedFile}`, {
        index: 0,
        content: "encoded memory entry updated",
      });
      expect(editRes.status).toBe(200);
      expect(editRes.data.success).toBe(true);

      const searchRes = await api(
        "GET",
        "/api/memory/search?query=encoded%20memory%20entry%20updated"
      );
      expect(searchRes.status).toBe(200);
      const hit = searchRes.data.results.find(
        (item: { file: string }) => item.file === expectedFile
      );
      expect(hit.entry.content).toContain("encoded memory entry updated");

      const deleteRes = await api("DELETE", `/api/memory/${encodedFile}`);
      expect(deleteRes.status).toBe(200);
      expect(deleteRes.data.success).toBe(true);

      const listRes = await api("GET", "/api/memory");
      expect(listRes.data.files).not.toContain(expectedFile);
    } finally {
      await api("DELETE", `/api/memory/${encodeURIComponent(expectedFile)}`);
    }
  });
});

describe("IDE & Git API", () => {
  test("IDE browse/read/write/create routes should work inside HOME sandbox", async () => {
    const ideMetricsBefore = countMetrics("ide_operation");
    const fileMetricsBefore = countMetrics("file_operation");

    const fileName = `ide-test-${Date.now()}.txt`;
    const filePath = join(testHome, fileName);
    writeFileSync(filePath, "initial-content", "utf8");

    const browseRes = await api("GET", `/api/ide/browse?path=${encodeURIComponent(testHome)}`);
    expect(browseRes.status).toBe(200);
    expect(browseRes.data.success).toBe(true);
    expect(Array.isArray(browseRes.data.entries)).toBe(true);
    expect(
      browseRes.data.entries.some(
        (entry: { name: string; type: string }) => entry.name === fileName
      )
    ).toBe(true);

    const readRes = await api("GET", `/api/ide/read?path=${encodeURIComponent(filePath)}`);
    expect(readRes.status).toBe(200);
    expect(readRes.data.success).toBe(true);
    expect(readRes.data.content).toBe("initial-content");

    const writeRes = await api("POST", "/api/ide/write", {
      path: filePath,
      content: "updated-content",
    });
    expect(writeRes.status).toBe(200);
    expect(writeRes.data.success).toBe(true);

    const rereadRes = await api("GET", `/api/ide/read?path=${encodeURIComponent(filePath)}`);
    expect(rereadRes.status).toBe(200);
    expect(rereadRes.data.success).toBe(true);
    expect(rereadRes.data.content).toBe("updated-content");

    const createdFileName = `ide-created-${Date.now()}.md`;
    const createRes = await api("POST", "/api/ide/create", {
      parentPath: testHome,
      name: createdFileName,
      type: "file",
    });
    expect(createRes.status).toBe(200);
    expect(createRes.data.success).toBe(true);
    expect(createRes.data.type).toBe("file");

    const ideMetricsAfter = countMetrics("ide_operation");
    const fileMetricsAfter = countMetrics("file_operation");
    expect(ideMetricsAfter).toBeGreaterThan(ideMetricsBefore);
    expect(fileMetricsAfter).toBeGreaterThan(fileMetricsBefore);
  });

  test("IDE routes block sibling paths that only share HOME prefix", async () => {
    const siblingDir = `${testHome}-outside-${Date.now()}`;
    const siblingFile = join(siblingDir, "escape.txt");
    mkdirSync(siblingDir, { recursive: true });
    writeFileSync(siblingFile, "outside-home", "utf8");

    try {
      const browseRes = await api("GET", `/api/ide/browse?path=${encodeURIComponent(siblingDir)}`);
      expect(browseRes.status).toBe(200);
      expect(browseRes.data.success).toBe(false);
      expect(String(browseRes.data.error || "")).toContain("Access denied");

      const readRes = await api("GET", `/api/ide/read?path=${encodeURIComponent(siblingFile)}`);
      expect(readRes.status).toBe(200);
      expect(readRes.data.success).toBe(false);
      expect(String(readRes.data.error || "")).toContain("Access denied");

      const writeRes = await api("POST", "/api/ide/write", {
        path: siblingFile,
        content: "mutated",
      });
      expect(writeRes.status).toBe(200);
      expect(writeRes.data.success).toBe(false);
      expect(String(writeRes.data.error || "")).toContain("Access denied");

      const createRes = await api("POST", "/api/ide/create", {
        parentPath: siblingDir,
        name: "new.txt",
        type: "file",
      });
      expect(createRes.status).toBe(200);
      expect(createRes.data.success).toBe(false);
      expect(String(createRes.data.error || "")).toContain("Access denied");
    } finally {
      rmSync(siblingDir, { recursive: true, force: true });
    }
  });

  test("IDE routes block symlink escapes outside HOME", async () => {
    const outsideDir = `${testHome}-symlink-outside-${Date.now()}`;
    const outsideFile = join(outsideDir, "outside.txt");
    const linkPath = join(testHome, `ide-symlink-${Date.now()}`);

    mkdirSync(outsideDir, { recursive: true });
    writeFileSync(outsideFile, "outside-home", "utf8");
    try {
      symlinkSync(outsideDir, linkPath);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "EPERM" || code === "EACCES") {
        expect(true).toBe(true);
        rmSync(outsideDir, { recursive: true, force: true });
        return;
      }
      throw error;
    }

    try {
      const linkedFilePath = join(linkPath, "outside.txt");

      const browseRes = await api("GET", `/api/ide/browse?path=${encodeURIComponent(linkPath)}`);
      expect(browseRes.status).toBe(200);
      expect(browseRes.data.success).toBe(false);
      expect(String(browseRes.data.error || "")).toContain("Access denied");

      const readRes = await api("GET", `/api/ide/read?path=${encodeURIComponent(linkedFilePath)}`);
      expect(readRes.status).toBe(200);
      expect(readRes.data.success).toBe(false);
      expect(String(readRes.data.error || "")).toContain("Access denied");

      const writeRes = await api("POST", "/api/ide/write", {
        path: join(linkPath, "new.txt"),
        content: "mutated",
      });
      expect(writeRes.status).toBe(200);
      expect(writeRes.data.success).toBe(false);
      expect(String(writeRes.data.error || "")).toContain("Access denied");

      const createRes = await api("POST", "/api/ide/create", {
        parentPath: linkPath,
        name: "new.txt",
        type: "file",
      });
      expect(createRes.status).toBe(200);
      expect(createRes.data.success).toBe(false);
      expect(String(createRes.data.error || "")).toContain("Access denied");
    } finally {
      rmSync(linkPath, { force: true });
      rmSync(outsideDir, { recursive: true, force: true });
    }
  });

  test("Git status/branch routes return shaped responses and diff validates params", async () => {
    const statusRes = await api("GET", `/api/git/status?path=${encodeURIComponent(ROOT_DIR)}`);
    expect(statusRes.status).toBe(200);
    expect(typeof statusRes.data.isRepo).toBe("boolean");
    expect(Array.isArray(statusRes.data.staged)).toBe(true);
    expect(Array.isArray(statusRes.data.modified)).toBe(true);
    expect(Array.isArray(statusRes.data.untracked)).toBe(true);

    const branchRes = await api("GET", `/api/git/branch?path=${encodeURIComponent(ROOT_DIR)}`);
    expect(branchRes.status).toBe(200);
    expect("branch" in branchRes.data).toBe(true);

    const missingDiffPathRes = await api("GET", "/api/git/diff");
    expect(missingDiffPathRes.status).toBe(200);
    expect(missingDiffPathRes.data.success).toBe(false);
    expect(typeof missingDiffPathRes.data.error).toBe("string");
  });
});

describe("Channel Security API", () => {
  let testChannelId: string;

  beforeAll(async () => {
    const { data } = await api("POST", "/api/channels", {
      name: `security-test-${Date.now()}`,
      type: "telegram",
      config: { bot_token: "test-token" },
    });
    testChannelId = data?.id;
  });

  test("GET /api/channels/:id/pairings should return pairings", async () => {
    if (!testChannelId) return;
    const { status, data } = await api("GET", `/api/channels/${testChannelId}/pairings`);
    expect(status).toBe(200);
    expect(Array.isArray(data.pairings)).toBe(true);
    expect(typeof data.pendingCount).toBe("number");
    expect(data.config).toBeDefined();
  });

  test("GET /api/channels/:id/allowed-senders should return senders", async () => {
    if (!testChannelId) return;
    const { status, data } = await api("GET", `/api/channels/${testChannelId}/allowed-senders`);
    expect(status).toBe(200);
    expect(Array.isArray(data.senders)).toBe(true);
  });

  test("POST /api/channels/:id/allowed-senders should add sender", async () => {
    if (!testChannelId) return;
    const senderId = `test-sender-${Date.now()}`;
    const { status, data } = await api("POST", `/api/channels/${testChannelId}/allowed-senders`, {
      senderId,
    });
    expect(status).toBe(200);
    expect(data.success).toBe(true);
  });

  test("PUT /api/channels/:id/security should update security config", async () => {
    if (!testChannelId) return;
    const { status, data } = await api("PUT", `/api/channels/${testChannelId}/security`, {
      dm_policy: "allowlist",
    });
    expect(status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.config.dm_policy).toBe("allowlist");
  });

  afterAll(async () => {
    if (testChannelId) {
      await api("DELETE", `/api/channels/${testChannelId}`);
    }
  });
});
