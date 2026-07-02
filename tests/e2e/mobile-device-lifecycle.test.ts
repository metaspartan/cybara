import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { createServer } from "net";
import { tmpdir } from "os";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const ROOT_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

let homeDir = "";
let baseUrl = "";
let apiKey = "";
let proc: ReturnType<typeof Bun.spawn> | null = null;

let standardToken = "";
let standardDeviceId = "";

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
  } catch {
  }
  await Promise.race([target.exited, sleep(5000)]);
}

async function waitForServerReady(url: string, timeoutMs = 30000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const response = await fetch(`${url}/api/health`);
      if (response.ok) return;
    } catch {
    }
    await sleep(250);
  }
  throw new Error(`Timed out waiting for server at ${url}`);
}

async function api(
  method: string,
  path: string,
  options: { body?: unknown; token?: string | null } = {}
): Promise<{ status: number; data: Record<string, unknown> }> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const token = options.token === undefined ? apiKey : options.token;
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const contentType = response.headers.get("content-type") || "";
  const data = contentType.includes("application/json")
    ? ((await response.json()) as Record<string, unknown>)
    : { text: await response.text() };
  return { status: response.status, data };
}

async function mintCode(role: string, deviceName: string): Promise<string> {
  const minted = await api("POST", "/api/mobile/devices/pair-code", {
    body: { baseUrl, role, deviceName },
  });
  expect(minted.status).toBe(200);
  expect(minted.data.success).toBe(true);
  const code = minted.data.code as string;
  expect(code).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
  return code;
}

describe("mobile device lifecycle e2e", () => {
  beforeAll(async () => {
    homeDir = mkdtempSync(join(tmpdir(), "cybara-mobile-e2e-home-"));
    apiKey = `cybara_e2e_mobile_key_${Date.now()}`;
    const port = await getFreePort();
    baseUrl = `http://127.0.0.1:${port}`;
    proc = startServer(port);
    await waitForServerReady(baseUrl);
  }, 45000);

  afterAll(async () => {
    await stopServer(proc);
    if (homeDir) rmSync(homeDir, { recursive: true, force: true });
  });

  test("lowercase code redeems (normalizer) and the token reaches GET /api/sessions", async () => {
    const code = await mintCode("standard", "lifecycle phone");
    const redeemed = await api("POST", "/api/mobile/pair/redeem", {
      body: { code: code.toLowerCase() },
      token: null,
    });
    expect(redeemed.status).toBe(200);
    expect(redeemed.data.success).toBe(true);
    standardToken = redeemed.data.apiKey as string;
    expect(standardToken).toMatch(/^cybara_mobile_/);
    const device = redeemed.data.device as { id: string; scopes: string[]; status: string };
    standardDeviceId = device.id;
    expect(device.status).toBe("active");
    expect(device.scopes.sort()).toEqual(["chat", "manage", "read"]);

    const sessions = await api("GET", "/api/sessions", { token: standardToken });
    expect(sessions.status).toBe(200);
    expect(Array.isArray(sessions.data)).toBe(true);
  }, 20000);

  test("root key lists the paired device as active with its scopes", async () => {
    const list = await api("GET", "/api/mobile/devices");
    expect(list.status).toBe(200);
    const devices = list.data.devices as Array<{
      id: string;
      status: string;
      scopes: string[];
      name: string;
    }>;
    const device = devices.find((d) => d.id === standardDeviceId);
    expect(device).toBeDefined();
    expect(device!.status).toBe("active");
    expect(device!.name).toBe("lifecycle phone");
    expect(device!.scopes.sort()).toEqual(["chat", "manage", "read"]);
  }, 15000);

  test("device-management routes reject scoped tokens (403) and anonymous callers (401)", async () => {
    const scopedList = await api("GET", "/api/mobile/devices", { token: standardToken });
    expect(scopedList.status).toBe(403);
    expect(String(scopedList.data.error)).toContain("Root API key required");

    const scopedMint = await api("POST", "/api/mobile/devices/pair-code", {
      body: { baseUrl },
      token: standardToken,
    });
    expect(scopedMint.status).toBe(403);
    expect(String(scopedMint.data.error)).toContain("Root API key required");

    const anonymousList = await api("GET", "/api/mobile/devices", { token: null });
    expect(anonymousList.status).toBe(401);
  }, 15000);

  test("standard scoped tokens cannot mutate wallet policy or MCP process surfaces", async () => {
    const walletAccess = await api("PUT", "/api/wallet/agent-access", {
      body: { enabled: true },
      token: standardToken,
    });
    expect(walletAccess.status).toBe(403);
    expect(String(walletAccess.data.error)).toContain("not authorized for 'wallet'");

    const walletPolicy = await api("PUT", "/api/wallet/agent-policy", {
      body: { allowNativeSend: true, allowTokenSend: true },
      token: standardToken,
    });
    expect(walletPolicy.status).toBe(403);
    expect(String(walletPolicy.data.error)).toContain("not authorized for 'wallet'");

    const mcpInstall = await api("POST", "/api/mcp/registry/install", {
      body: { package: "@modelcontextprotocol/server-memory" },
      token: standardToken,
    });
    expect(mcpInstall.status).toBe(403);
    expect(String(mcpInstall.data.error)).toContain("not authorized for 'mcp'");

    const mcpStart = await api("POST", "/api/mcp/any-server/start", {
      token: standardToken,
    });
    expect(mcpStart.status).toBe(403);
    expect(String(mcpStart.data.error)).toContain("not authorized for 'mcp'");
  }, 15000);

  test("revoking the device invalidates its token", async () => {
    const revoked = await api("POST", `/api/mobile/devices/${standardDeviceId}/revoke`);
    expect(revoked.status).toBe(200);
    expect(revoked.data.success).toBe(true);
    const device = revoked.data.device as { status: string };
    expect(device.status).toBe("revoked");

    const sessions = await api("GET", "/api/sessions", { token: standardToken });
    expect(sessions.status).toBe(401);
    expect(String(sessions.data.error)).toContain("Invalid API key");

    const list = await api("GET", "/api/mobile/devices");
    const devices = list.data.devices as Array<{ id: string; status: string }>;
    expect(devices.find((d) => d.id === standardDeviceId)?.status).toBe("revoked");
  }, 15000);

  test("full-role token passes the wallet scope gate and hits wallet validation instead", async () => {
    const code = await mintCode("full", "full phone");
    const redeemed = await api("POST", "/api/mobile/pair/redeem", {
      body: { code },
      token: null,
    });
    expect(redeemed.status).toBe(200);
    expect(redeemed.data.success).toBe(true);
    const device = redeemed.data.device as { scopes: string[] };
    expect(device.scopes.sort()).toEqual(["chat", "manage", "mcp", "read", "terminal", "wallet"]);
    const fullToken = redeemed.data.apiKey as string;

    const send = await api("POST", "/api/wallet/send", {
      body: { chain: "sol", to: "nobody", amount: "0.001" },
      token: fullToken,
    });
    expect(send.status).not.toBe(403);
    expect(String(send.data.error)).not.toContain("not authorized for 'wallet'");
    expect(send.status).toBe(400);
    expect(send.data.code).toBe("VALIDATION_ERROR");
  }, 20000);

  test("garbage redeem inputs get clean JSON errors, never a 500", async () => {
    const empty = await api("POST", "/api/mobile/pair/redeem", {
      body: { code: "" },
      token: null,
    });
    expect(empty.status).toBe(400);
    expect(empty.data.code).toBe("VALIDATION_ERROR");
    expect(String(empty.data.error)).toContain("code is required");

    const unknown = await api("POST", "/api/mobile/pair/redeem", {
      body: { code: "AAAA-AAAA" },
      token: null,
    });
    expect(unknown.status).toBe(200);
    expect(unknown.data.success).toBe(false);
    expect(String(unknown.data.error)).toContain("pairing code");

    const noBody = await api("POST", "/api/mobile/pair/redeem", { token: null });
    expect(noBody.status).toBe(400);
    expect(noBody.data.code).toBe("VALIDATION_ERROR");
  }, 15000);
});
