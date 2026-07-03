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

async function api(
  method: string,
  path: string,
  body?: unknown
): Promise<{ status: number; data: unknown }> {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let data: unknown = null;
  try {
    data = await response.json();
  } catch {
    data = null;
  }
  return { status: response.status, data };
}

async function listToolNames(): Promise<string[]> {
  const result = await api("GET", "/api/tools");
  const raw = result.data as { tools?: Array<{ name: string }> } | Array<{ name: string }>;
  const tools = Array.isArray(raw) ? raw : (raw?.tools ?? []);
  return tools.map((t) => t.name);
}

beforeAll(async () => {
  homeDir = mkdtempSync(join(tmpdir(), "cybara-selfimprove-e2e-"));
  apiKey = `cybara_${"e".repeat(40)}`;
  const port = await getFreePort();
  baseUrl = `http://127.0.0.1:${port}`;
  proc = Bun.spawn([process.execPath, "run", "src/index.ts"], {
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
  for (let i = 0; i < 60; i++) {
    try {
      const response = await fetch(`${baseUrl}/api/health`, {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      if (response.ok) return;
    } catch {
      /* not up yet */
    }
    await sleep(500);
  }
  throw new Error("Gateway did not become healthy in time");
}, 45000);

afterAll(async () => {
  try {
    proc?.kill();
    if (proc) await proc.exited;
  } catch {
    /* already gone */
  }
  rmSync(homeDir, { recursive: true, force: true });
});

describe("self-improving skills toggle e2e", () => {
  test("defaults to enabled: config reports true and skill_save is offered", async () => {
    const config = await api("GET", "/api/config");
    expect(config.status).toBe(200);
    expect((config.data as Record<string, unknown>).self_improving_skills_enabled).toBe(true);

    const names = await listToolNames();
    expect(names).toContain("skill_save");
  }, 20000);

  test("disabling via PUT /api/config withholds skill_save from the tool list", async () => {
    const update = await api("PUT", "/api/config", {
      self_improving_skills_enabled: false,
    });
    expect(update.status).toBe(200);

    const config = await api("GET", "/api/config");
    expect((config.data as Record<string, unknown>).self_improving_skills_enabled).toBe(false);

    const names = await listToolNames();
    expect(names).not.toContain("skill_save");
    expect(names).toContain("calc");
  }, 20000);

  test("executing skill_save while disabled is refused cleanly", async () => {
    const result = await api("POST", "/api/tools/execute", {
      name: "skill_save",
      args: { name: "Blocked Skill", content: "## Steps\n1. no" },
    });
    expect(result.status).toBeGreaterThanOrEqual(400);
    expect(result.status).toBeLessThan(500);
  }, 20000);

  test("re-enabling restores the tool", async () => {
    const update = await api("PUT", "/api/config", {
      self_improving_skills_enabled: true,
    });
    expect(update.status).toBe(200);

    const names = await listToolNames();
    expect(names).toContain("skill_save");
  }, 20000);
});
