import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { createServer } from "net";
import { tmpdir } from "os";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const ROOT_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

const READ_ONLY_PATHS = [
  "/api/health",
  "/api/info",
  "/api/providers",
  "/api/channels",
  "/api/tools",
  "/api/skills",
  "/api/agents",
  "/api/sessions",
  "/api/router/status",
  "/api/router/config",
  "/api/wallet/status",
  "/api/metrics",
  "/api/subagents",
  "/api/plugins",
  "/api/checkpoints",
  "/api/mcp/servers",
  "/api/lsp/languages",
  "/api/system-prompt",
];

let homeDir = "";
let baseUrl = "";
let apiKey = "";
let proc: ReturnType<typeof Bun.spawn> | null = null;

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

function startServer(port: number): ReturnType<typeof Bun.spawn> {
  return Bun.spawn([process.execPath, "run", "src/index.ts"], {
    cwd: ROOT_DIR,
    env: {
      ...process.env,
      HOME: homeDir,
      USERPROFILE: homeDir,
      PORT: String(port),
      NODE_ENV: "production",
      CYBARA_API_KEY: apiKey,
    },
    stdout: "ignore",
    stderr: "ignore",
  });
}

async function stopServer(target: ReturnType<typeof Bun.spawn> | null): Promise<void> {
  if (!target) return;
  try {
    target.kill("SIGTERM");
  } catch {}
  await Promise.race([target.exited, sleep(5000)]);
}

async function waitForServerReady(url: string, timeoutMs = 30000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const response = await fetch(`${url}/api/health`);
      if (response.ok) return;
    } catch {}
    await sleep(250);
  }
  throw new Error(`Timed out waiting for server at ${url}`);
}

async function rawRequest(
  method: string,
  path: string,
  options: { body?: BodyInit; token?: string | null } = {}
): Promise<Response> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const token = options.token === undefined ? apiKey : options.token;
  if (token) headers.Authorization = `Bearer ${token}`;
  return await fetch(`${baseUrl}${path}`, { method, headers, body: options.body });
}

describe("API error contract e2e", () => {
  beforeAll(async () => {
    homeDir = mkdtempSync(join(tmpdir(), "cybara-errors-e2e-home-"));
    apiKey = `cybara_e2e_errors_key_${Date.now()}`;
    const port = await getFreePort();
    baseUrl = `http://127.0.0.1:${port}`;
    proc = startServer(port);
    await waitForServerReady(baseUrl);
  }, 45000);

  afterAll(async () => {
    await stopServer(proc);
    if (homeDir) rmSync(homeDir, { recursive: true, force: true });
  });

  test("read-only GET surface returns 2xx parseable JSON with the root key", async () => {
    for (const path of READ_ONLY_PATHS) {
      const response = await rawRequest("GET", path);
      expect(`${path} ${response.status}`).toBe(`${path} 200`);
      expect(response.headers.get("content-type") || "").toContain("application/json");
      const parsed = (await response.json()) as unknown;
      expect(parsed === null).toBe(false);
      expect(typeof parsed).toBe("object");
    }
  }, 30000);

  test("unknown route returns a 404 JSON error", async () => {
    const response = await rawRequest("GET", "/api/nope");
    expect(response.status).toBe(404);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body.error).toBe("Not found");
  }, 15000);

  test("security headers are present on 200 and 404 responses", async () => {
    const ok = await rawRequest("GET", "/api/info");
    expect(ok.status).toBe(200);
    expect(ok.headers.get("x-content-type-options")).toBe("nosniff");
    expect(ok.headers.get("x-frame-options")).toBe("DENY");

    const missing = await rawRequest("GET", "/api/nope");
    expect(missing.status).toBe(404);
    expect(missing.headers.get("x-content-type-options")).toBe("nosniff");
    expect(missing.headers.get("x-frame-options")).toBe("DENY");
  }, 15000);

  test("production error messages redact absolute filesystem paths", async () => {
    const response = await rawRequest("POST", "/api/tools/execute", {
      body: JSON.stringify({
        name: "read",
        args: { path: `${homeDir}/definitely-missing-e2e-probe.txt` },
      }),
    });
    expect(response.status).toBe(404);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body.code).toBe("NOT_FOUND");
    const text = JSON.stringify(body);
    expect(String(body.error)).toContain("[path]");
    expect(text).not.toContain("/Users/");
    expect(text).not.toContain(homeDir);
  }, 15000);

  test("malformed JSON body to POST /api/agents yields a sanitized JSON error, no internals leaked", async () => {
    const response = await rawRequest("POST", "/api/agents", { body: "{bad json" });
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(response.headers.get("content-type") || "").toContain("application/json");
    const body = (await response.json()) as Record<string, unknown>;
    expect(typeof body.error).toBe("string");
    expect(typeof body.code).toBe("string");
    expect(body.message).toBeUndefined();
    const text = JSON.stringify(body);
    expect(text).not.toContain("TypeError");
    expect(text).not.toContain("at ");
    expect(text).not.toContain("/Users/");
  }, 15000);
});
