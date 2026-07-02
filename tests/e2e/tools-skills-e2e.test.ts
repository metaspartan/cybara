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
  options: { body?: unknown } = {}
): Promise<{ status: number; data: unknown }> {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const contentType = response.headers.get("content-type") || "";
  const data = contentType.includes("application/json")
    ? ((await response.json()) as unknown)
    : { text: await response.text() };
  return { status: response.status, data };
}

describe("tools and skills e2e", () => {
  beforeAll(async () => {
    homeDir = mkdtempSync(join(tmpdir(), "cybara-tools-e2e-home-"));
    apiKey = `cybara_e2e_tools_key_${Date.now()}`;
    const port = await getFreePort();
    baseUrl = `http://127.0.0.1:${port}`;
    proc = startServer(port);
    await waitForServerReady(baseUrl);
  }, 45000);

  afterAll(async () => {
    await stopServer(proc);
    if (homeDir) rmSync(homeDir, { recursive: true, force: true });
  });

  test("GET /api/tools lists 70+ tools including skill_save, calc, mixture_of_agents", async () => {
    const result = await api("GET", "/api/tools");
    expect(result.status).toBe(200);
    const tools = result.data as Array<{ name: string; description: string }>;
    expect(Array.isArray(tools)).toBe(true);
    expect(tools.length).toBeGreaterThanOrEqual(70);
    const names = tools.map((t) => t.name);
    expect(names).toContain("skill_save");
    expect(names).toContain("calc");
    expect(names).toContain("mixture_of_agents");
  }, 15000);

  test("calc tool executes and returns 4 for 2+2", async () => {
    const result = await api("POST", "/api/tools/execute", {
      body: { name: "calc", args: { expression: "2+2" } },
    });
    expect(result.status).toBe(200);
    const data = result.data as { result: number; expression: string };
    expect(data.result).toBe(4);
    expect(data.expression).toBe("2+2");
  }, 15000);

  test("unknown tool name returns a 400 validation error", async () => {
    const result = await api("POST", "/api/tools/execute", {
      body: { name: "totally_bogus_tool_e2e", args: {} },
    });
    expect(result.status).toBe(400);
    const data = result.data as Record<string, unknown>;
    expect(data.code).toBe("VALIDATION_ERROR");
    expect(String(data.error)).toContain("Invalid tool");
  }, 15000);

  test("dangerous exec tool is blocked by the approval gate with a clean 400, not a 500", async () => {
    const dangerous = await api("GET", "/api/tools/dangerous");
    expect(dangerous.status).toBe(200);
    const gated = dangerous.data as { tools: string[] };
    expect(gated.tools).toContain("exec");

    const result = await api("POST", "/api/tools/execute", {
      body: { name: "exec", args: { command: "echo e2e-should-not-run" } },
    });
    expect(result.status).toBe(400);
    const data = result.data as Record<string, unknown>;
    expect(data.code).toBe("VALIDATION_ERROR");
    expect(String(data.error)).toContain("requires approval");
  }, 15000);

  test("local skill CRUD: create, fetch, duplicate conflict, delete", async () => {
    const created = await api("POST", "/api/skills", {
      body: {
        name: "E2E Tools Suite Skill",
        description: "created by tools-skills e2e",
        content: "# E2E Tools Suite Skill\n\nAlways reply with OK.",
      },
    });
    expect(created.status).toBe(200);
    const createdSkill = created.data as { name: string; location: string };
    expect(createdSkill.name).toBe("E2E Tools Suite Skill");

    const slug = "e2e-tools-suite-skill";
    const fetched = await api("GET", `/api/skills/${slug}`);
    expect(fetched.status).toBe(200);
    expect((fetched.data as { name: string }).name).toBe("E2E Tools Suite Skill");

    const list = await api("GET", "/api/skills");
    expect(list.status).toBe(200);
    const skills = list.data as Array<{ name: string }>;
    expect(skills.map((s) => s.name)).toContain("E2E Tools Suite Skill");

    const duplicate = await api("POST", "/api/skills", {
      body: { name: "E2E Tools Suite Skill", content: "# E2E Tools Suite Skill\n\nDup." },
    });
    expect(duplicate.status).toBe(409);
    expect((duplicate.data as Record<string, unknown>).code).toBe("CONFLICT");

    const deleted = await api("DELETE", `/api/skills/${slug}`);
    expect(deleted.status).toBe(200);
    expect((deleted.data as { success: boolean }).success).toBe(true);

    const afterDelete = await api("GET", "/api/skills");
    const remaining = afterDelete.data as Array<{ name: string }>;
    expect(remaining.map((s) => s.name)).not.toContain("E2E Tools Suite Skill");
  }, 20000);

  test("missing skill fields return 400 validation errors", async () => {
    const noName = await api("POST", "/api/skills", { body: { content: "# X" } });
    expect(noName.status).toBe(400);
    expect((noName.data as Record<string, unknown>).code).toBe("VALIDATION_ERROR");

    const noContent = await api("POST", "/api/skills", { body: { name: "No Content E2E" } });
    expect(noContent.status).toBe(400);
    expect((noContent.data as Record<string, unknown>).code).toBe("VALIDATION_ERROR");
  }, 15000);
});
