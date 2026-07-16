import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const ROOT_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const AUTH_KEY = "cybara_cli_direct_auth_test_key";

let server: ReturnType<typeof Bun.serve>;
let apiBase = "";

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function requireAuth(request: Request): Response | null {
  const auth = request.headers.get("authorization");
  if (auth !== `Bearer ${AUTH_KEY}`) {
    return json({ error: "Missing Authorization header" }, 401);
  }
  return null;
}

async function route(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const method = request.method;
  const pathname = url.pathname;

  if (method === "GET" && pathname === "/api/sessions") {
    const unauthorized = requireAuth(request);
    if (unauthorized) return unauthorized;
    return json([]);
  }

  if (method === "PUT" && pathname === "/api/config") {
    const unauthorized = requireAuth(request);
    if (unauthorized) return unauthorized;
    return json({ success: true });
  }

  if (method === "POST" && pathname === "/api/providers") {
    const unauthorized = requireAuth(request);
    if (unauthorized) return unauthorized;
    return json({ id: "prov-1" });
  }

  if (method === "PUT" && pathname === "/api/providers/prov-1") {
    const unauthorized = requireAuth(request);
    if (unauthorized) return unauthorized;
    return json({ success: true });
  }

  if (method === "DELETE" && pathname === "/api/providers/prov-1") {
    const unauthorized = requireAuth(request);
    if (unauthorized) return unauthorized;
    return json({ success: true });
  }

  if (method === "POST" && pathname === "/api/providers/discover/ollama") {
    const unauthorized = requireAuth(request);
    if (unauthorized) return unauthorized;
    return json({ models: [{ id: "llama3.1:8b" }] });
  }

  if (method === "POST" && pathname === "/api/lsp/install") {
    const unauthorized = requireAuth(request);
    if (unauthorized) return unauthorized;
    return json({ success: true, path: "/mock/lsp/python" });
  }

  if (method === "POST" && pathname === "/api/lsp/uninstall") {
    const unauthorized = requireAuth(request);
    if (unauthorized) return unauthorized;
    return json({ success: true });
  }

  if (method === "POST" && pathname === "/api/subagents/spawn") {
    const unauthorized = requireAuth(request);
    if (unauthorized) return unauthorized;
    return json({ success: true, subagentId: "sub-1" });
  }

  if (method === "POST" && pathname === "/api/subagents/sub-1/kill") {
    const unauthorized = requireAuth(request);
    if (unauthorized) return unauthorized;
    return json({ success: true });
  }

  if (method === "GET" && pathname === "/api/subagents/sub-1") {
    const unauthorized = requireAuth(request);
    if (unauthorized) return unauthorized;
    return json({
      id: "sub-1",
      label: "Auth smoke",
      task: "Auth smoke",
      status: "completed",
      result: "done",
    });
  }

  if (method === "POST" && pathname === "/api/subagents/wait") {
    const unauthorized = requireAuth(request);
    if (unauthorized) return unauthorized;
    return json({
      status: "completed",
      runs: [{ runId: "sub-1", status: "completed", label: "Auth smoke", toolCallCount: 0 }],
      pendingRunIds: [],
      elapsedMs: 0,
    });
  }

  if (method === "DELETE" && pathname === "/api/subagents/sub-1") {
    const unauthorized = requireAuth(request);
    if (unauthorized) return unauthorized;
    return json({ success: true });
  }

  if (method === "POST" && pathname === "/api/chat") {
    const unauthorized = requireAuth(request);
    if (unauthorized) return unauthorized;
    const body = (await request.json().catch(() => ({}))) as { message?: string };
    const message = typeof body.message === "string" ? body.message : "";
    return json({
      sessionId: "sess-1",
      message: {
        content: `echo: ${message}`,
      },
    });
  }

  return json({ error: `Unhandled route: ${method} ${pathname}` }, 404);
}

async function runCli(
  args: string[],
  envOverride?: Record<string, string>
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const proc = Bun.spawn([process.execPath, "run", "src/cli/index.tsx", ...args], {
    cwd: ROOT_DIR,
    env: {
      ...process.env,
      CYBARA_API: apiBase,
      CYBARA_API_KEY: AUTH_KEY,
      ...envOverride,
    },
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  return { exitCode, stdout, stderr };
}

describe("CLI auth header forwarding", () => {
  beforeAll(() => {
    server = Bun.serve({
      port: 0,
      fetch: route,
    });
    apiBase = `http://127.0.0.1:${server.port}`;
  });

  afterAll(() => {
    server.stop(true);
  });

  test("provider direct-fetch commands include authorization header", async () => {
    const add = await runCli([
      "provider",
      "add",
      "openai",
      "--name",
      "Auth Test Provider",
      "--key",
      "sk",
    ]);
    expect(add.exitCode).toBe(0);
    expect(add.stdout).toContain("Added provider: Auth Test Provider");

    const update = await runCli(["provider", "update", "prov-1", "--name", "Auth Test Updated"]);
    expect(update.exitCode).toBe(0);
    expect(update.stdout).toContain("Updated provider: prov-1");

    const del = await runCli(["provider", "delete", "prov-1"]);
    expect(del.exitCode).toBe(0);
    expect(del.stdout).toContain("Deleted provider: prov-1");

    const discover = await runCli(["provider", "discover"]);
    expect(discover.exitCode).toBe(0);
    expect(discover.stdout).toContain("Discovered 1 Ollama models");
  });

  test("lsp direct-fetch install/uninstall commands include authorization header", async () => {
    const install = await runCli(["lsp", "install", "python"]);
    expect(install.exitCode).toBe(0);
    expect(install.stdout).toContain("Successfully installed python");

    const uninstall = await runCli(["lsp", "uninstall", "python"]);
    expect(uninstall.exitCode).toBe(0);
    expect(uninstall.stdout).toContain("Successfully uninstalled python");
  });

  test("subagent lifecycle commands include authorization header", async () => {
    const spawn = await runCli(["subagent", "spawn", "auth forwarding smoke"]);
    expect(spawn.exitCode).toBe(0);
    expect(spawn.stdout).toContain("Spawned subagent: sub-1");

    const kill = await runCli(["subagent", "kill", "sub-1"]);
    expect(kill.exitCode).toBe(0);
    expect(kill.stdout).toContain("Killed subagent: sub-1");

    const show = await runCli(["subagent", "show", "sub-1"]);
    expect(show.exitCode).toBe(0);
    expect(show.stdout).toContain("done");

    const wait = await runCli(["subagent", "wait", "sub-1", "--timeout", "0"]);
    expect(wait.exitCode).toBe(0);
    expect(wait.stdout).toContain("status: completed");

    const clear = await runCli(["subagent", "clear", "sub-1"]);
    expect(clear.exitCode).toBe(0);
    expect(clear.stdout).toContain("Cleared subagent: sub-1");
  });

  test("config set includes authorization header and fails without key", async () => {
    const setOk = await runCli(["config", "set", "theme", "auth-header-test"]);
    expect(setOk.exitCode).toBe(0);
    expect(setOk.stdout).toContain('Set theme = "auth-header-test"');

    const setNoAuth = await runCli(["config", "set", "theme", "auth-header-test-missing"], {
      CYBARA_API_KEY: "",
    });
    expect(setNoAuth.exitCode).toBe(1);
    expect(setNoAuth.stderr).toContain("Failed to set config: 401");
  });

  test("chat request path uses auth header helper for /api/chat", () => {
    const cliPath = join(ROOT_DIR, "src", "cli", "commands", "chat.ts");
    const cliSource = readFileSync(cliPath, "utf8");

    expect(cliSource).toContain("const resp = await fetch(`${current.apiBase}/api/chat`, {");
    expect(cliSource).toContain(
      'headers: current.withAuthHeaders({ "Content-Type": "application/json" }),'
    );
  });
});
