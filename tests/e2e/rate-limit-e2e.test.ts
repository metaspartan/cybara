import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { createServer } from "net";
import { tmpdir } from "os";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const ROOT_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const PAIRING_LIMIT = 10;

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

async function redeemInvalid(): Promise<Response> {
  return await fetch(`${baseUrl}/api/mobile/pair/redeem`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code: "ZZZZ-ZZZZ" }),
  });
}

describe("pairing rate limit e2e", () => {
  beforeAll(async () => {
    homeDir = mkdtempSync(join(tmpdir(), "cybara-ratelimit-e2e-home-"));
    apiKey = `cybara_e2e_ratelimit_key_${Date.now()}`;
    const port = await getFreePort();
    baseUrl = `http://127.0.0.1:${port}`;
    proc = startServer(port);
    await waitForServerReady(baseUrl);
  }, 45000);

  afterAll(async () => {
    await stopServer(proc);
    if (homeDir) rmSync(homeDir, { recursive: true, force: true });
  });

  test("hammering pair/redeem flips to 429 with Retry-After after the pairing budget", async () => {
    const total = PAIRING_LIMIT + 4;
    const statuses: number[] = [];
    let firstLimited: Response | null = null;

    for (let i = 0; i < total; i++) {
      const response = await redeemInvalid();
      statuses.push(response.status);
      if (response.status === 429 && !firstLimited) {
        firstLimited = response;
        continue;
      }
      const body = (await response.json()) as Record<string, unknown>;
      if (response.status === 200) {
        expect(body.success).toBe(false);
        expect(String(body.error)).toContain("pairing code");
      } else {
        expect(typeof body.error).toBe("string");
      }
    }

    for (let i = 0; i < PAIRING_LIMIT; i++) {
      expect(statuses[i]).toBe(200);
    }
    for (let i = PAIRING_LIMIT; i < total; i++) {
      expect(statuses[i]).toBe(429);
    }

    expect(firstLimited).not.toBeNull();
    const retryAfter = firstLimited!.headers.get("retry-after");
    expect(retryAfter).not.toBeNull();
    expect(Number(retryAfter)).toBeGreaterThan(0);
    expect(Number(retryAfter)).toBeLessThanOrEqual(60);
    const limitedBody = (await firstLimited!.json()) as Record<string, unknown>;
    expect(String(limitedBody.error)).toContain("Rate limit");
  }, 30000);

  test("the pairing bucket does not starve other endpoints", async () => {
    const health = await fetch(`${baseUrl}/api/health`);
    expect(health.status).toBe(200);

    const info = await fetch(`${baseUrl}/api/info`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    expect(info.status).toBe(200);

    const stillLimited = await redeemInvalid();
    expect(stillLimited.status).toBe(429);
  }, 15000);
});
