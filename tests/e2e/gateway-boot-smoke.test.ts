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

describe("gateway boot smoke e2e", () => {
  beforeAll(async () => {
    homeDir = mkdtempSync(join(tmpdir(), "cybara-boot-e2e-home-"));
    apiKey = `cybara_e2e_boot_key_${Date.now()}`;
    const port = await getFreePort();
    baseUrl = `http://127.0.0.1:${port}`;
    proc = startServer(port);
    await waitForServerReady(baseUrl);
  }, 45000);

  afterAll(async () => {
    await stopServer(proc);
    if (homeDir) rmSync(homeDir, { recursive: true, force: true });
  });

  test("health endpoint reports healthy", async () => {
    const health = await api("GET", "/api/health", { token: null });
    expect(health.status).toBe(200);
    expect(health.data.status).toBe("healthy");
  });

  test("pairing code lifecycle: mint, redeem for scoped token, scope-gated 403, one-time", async () => {
    const minted = await api("POST", "/api/mobile/devices/pair-code", {
      body: { baseUrl, role: "standard", deviceName: "e2e phone" },
    });
    expect(minted.status).toBe(200);
    expect(minted.data.success).toBe(true);
    const code = minted.data.code as string;
    expect(code).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/);

    const unauthorizedMint = await api("POST", "/api/mobile/devices/pair-code", {
      body: { baseUrl },
      token: null,
    });
    expect(unauthorizedMint.status).toBe(401);

    const redeemed = await api("POST", "/api/mobile/pair/redeem", {
      body: { code },
      token: null,
    });
    expect(redeemed.status).toBe(200);
    expect(redeemed.data.success).toBe(true);
    const deviceToken = redeemed.data.apiKey as string;
    expect(deviceToken).toMatch(/^cybara_mobile_/);
    const device = redeemed.data.device as { scopes: string[] };
    expect(device.scopes.sort()).toEqual(["chat", "manage", "read"]);

    const scopedAllowed = await api("GET", "/api/info", { token: deviceToken });
    expect(scopedAllowed.status).toBe(200);

    const walletSend = await api("POST", "/api/wallet/send", {
      body: { to: "nobody", amount: 0.001 },
      token: deviceToken,
    });
    expect(walletSend.status).toBe(403);
    expect(String(walletSend.data.error)).toContain("wallet");

    const reRedeem = await api("POST", "/api/mobile/pair/redeem", {
      body: { code },
      token: null,
    });
    expect(reRedeem.status).toBe(200);
    expect(reRedeem.data.success).toBe(false);
    expect(String(reRedeem.data.error)).toContain("pairing code");
  }, 30000);

  test("skills: status includes builtin packs; create then list a local skill", async () => {
    const status = await api("GET", "/api/skills/status");
    expect(status.status).toBe(200);
    const statusSkills = status.data.skills as Array<{ name: string; location: string }>;
    const builtins = statusSkills.filter((s) => s.location.startsWith("builtin:"));
    expect(builtins.length).toBeGreaterThanOrEqual(10);
    expect(builtins.map((s) => s.name)).toContain("web-research");

    const created = await api("POST", "/api/skills", {
      body: {
        name: "E2E Boot Smoke Skill",
        description: "created by gateway-boot-smoke e2e",
        content: "# E2E Boot Smoke Skill\n\nAlways reply with OK.",
      },
    });
    expect(created.status).toBe(200);
    expect(String(created.data.name)).toContain("E2E Boot Smoke Skill");

    const list = await api("GET", "/api/skills");
    expect(list.status).toBe(200);
    const skills = list.data as unknown as Array<{ name: string }>;
    expect(Array.isArray(skills)).toBe(true);
    expect(skills.map((s) => s.name)).toContain("E2E Boot Smoke Skill");
  }, 30000);

  test("router config round-trips a mixture_of_agents strategy", async () => {
    const put = await api("PUT", "/api/router/config", {
      body: {
        enabled: true,
        strategy: "mixture_of_agents",
        fallbackToAny: true,
        routes: {},
        moaMaxAgents: 2,
      },
    });
    expect(put.status).toBe(200);
    expect(put.data.success).toBe(true);

    const got = await api("GET", "/api/router/config");
    expect(got.status).toBe(200);
    expect(got.data.strategy).toBe("mixture_of_agents");
    expect(got.data.enabled).toBe(true);
    expect(got.data.moaMaxAgents).toBe(2);
  }, 15000);
});
