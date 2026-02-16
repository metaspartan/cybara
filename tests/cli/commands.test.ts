import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const ROOT_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

let server: ReturnType<typeof Bun.serve>;
let apiBase = "";

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function route(method: string, pathname: string, body: string): Response {
  if (method === "GET" && pathname === "/api/health") {
    return json({
      status: "healthy",
      uptime: 321,
      timestamp: new Date().toISOString(),
      checks: {
        database: { status: "healthy", total: 1 },
        providers: { status: "healthy", total: 1 },
      },
    });
  }

  if (method === "GET" && pathname === "/api/metrics/overview") {
    return json({
      tokenUsage: { total: 42, input: 20, output: 22, cache: 0 },
      fileOperations: { filesRead: 3, filesWritten: 1, filesEdited: 1 },
      toolCalls: { totalCalls: 4 },
      apiCalls: { totalCalls: 8, successfulCalls: 8, failedCalls: 0 },
      agentExecutions: { totalExecutions: 2, totalMessages: 5 },
    });
  }

  if (method === "GET" && pathname === "/api/agents") {
    return json([
      {
        id: "agent-1",
        name: "Primary Agent",
        type: "assistant",
        status: "running",
        model: "claude-sonnet",
      },
    ]);
  }

  if (method === "GET" && pathname === "/api/providers") {
    return json([
      {
        id: "prov-1",
        provider: "anthropic",
        name: "Anthropic Main",
        is_default: true,
      },
    ]);
  }

  if (method === "GET" && pathname === "/api/providers/available") {
    return json([
      {
        id: "anthropic",
        name: "Anthropic",
        description: "Claude models",
        baseUrl: "https://api.anthropic.com",
        authType: "apiKey",
        models: [{ id: "claude-sonnet", name: "Claude Sonnet", context: 200000 }],
      },
    ]);
  }

  if (method === "GET" && pathname === "/api/channels") {
    return json([
      { id: "chan-1", name: "Discord Ops", type: "discord", enabled: true, dmPolicy: "pairing" },
      {
        id: "chan-2",
        name: "Telegram Support",
        type: "telegram",
        enabled: false,
        dmPolicy: "allowlist",
      },
    ]);
  }

  if (method === "PUT" && pathname === "/api/channels/chan-1/security") {
    const parsed = body ? (JSON.parse(body) as { dm_policy?: string }) : {};
    return json({ success: true, config: { dm_policy: parsed.dm_policy || "pairing" } });
  }

  if (method === "GET" && pathname === "/api/tasks") {
    return json([
      { id: "task-1", name: "Nightly Check", status: "pending", schedule: "0 2 * * *" },
    ]);
  }

  if (method === "GET" && pathname === "/api/skills/status") {
    return json({
      skills: [
        { name: "checks", description: "Checks", eligible: true, source: "system" },
        { name: "ops", description: "Ops", eligible: false, source: "workspace" },
      ],
    });
  }

  if (method === "GET" && pathname === "/api/chat/sessions") {
    return json([
      {
        id: "session-1",
        agent_id: "agent-1",
        message_count: 4,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    ]);
  }

  if (method === "GET" && pathname === "/api/memory") {
    return json([{ id: "m-1", content: "remember this", createdAt: new Date().toISOString() }]);
  }

  if (method === "GET" && pathname === "/api/logs/system") {
    return json([
      { timestamp: new Date().toISOString(), level: "info", module: "api", message: "ok" },
    ]);
  }

  return json({ error: `Unhandled route: ${method} ${pathname}` }, 404);
}

async function runCli(
  args: string[],
  envOverride?: Record<string, string>
): Promise<{
  exitCode: number;
  stdout: string;
  stderr: string;
}> {
  const proc = Bun.spawn([process.execPath, "run", "src/cli.tsx", ...args], {
    cwd: ROOT_DIR,
    env: {
      ...process.env,
      CYBARA_API: apiBase,
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

  return {
    exitCode,
    stdout,
    stderr,
  };
}

describe("CLI Commands", () => {
  beforeAll(() => {
    server = Bun.serve({
      port: 0,
      async fetch(req) {
        const url = new URL(req.url);
        let body = "";
        if (req.method !== "GET" && req.method !== "HEAD") {
          try {
            body = await req.text();
          } catch {
            body = "";
          }
        }
        return route(req.method, url.pathname, body);
      },
    });
    apiBase = `http://127.0.0.1:${server.port}`;
  });

  afterAll(() => {
    server.stop(true);
  });

  test("--version prints CLI version", async () => {
    const { exitCode, stdout } = await runCli(["--version"]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("cybara v");
  });

  test("help prints command summary", async () => {
    const { exitCode, stdout } = await runCli(["help"]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("CYBARA CLI");
    expect(stdout).toContain("provider");
    expect(stdout).toContain("channels");
  });

  test("status command renders health summary", async () => {
    const { exitCode, stdout } = await runCli(["status"]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("CYBARA STATUS");
    expect(stdout).toContain("status: healthy");
    expect(stdout).toContain("HEALTH CHECKS");
  });

  test("metrics command renders usage summary", async () => {
    const { exitCode, stdout } = await runCli(["metrics"]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("CYBARA METRICS");
    expect(stdout).toContain("TOKEN USAGE");
    expect(stdout).toContain("total: 42");
  });

  test("provider list/available commands are wired", async () => {
    const list = await runCli(["provider"]);
    expect(list.exitCode).toBe(0);
    expect(list.stdout).toContain("CYBARA PROVIDERS");
    expect(list.stdout).toContain("Anthropic Main");

    const available = await runCli(["provider", "available"]);
    expect(available.exitCode).toBe(0);
    expect(available.stdout).toContain("AVAILABLE PROVIDER TYPES");
    expect(available.stdout).toContain("anthropic");
  });

  test("channels command renders list and pair policy updates config", async () => {
    const channels = await runCli(["channels"]);
    expect(channels.exitCode).toBe(0);
    expect(channels.stdout).toContain("CYBARA CHANNELS");
    expect(channels.stdout).toContain("Discord Ops");

    const policy = await runCli(["pair", "policy", "Discord Ops", "allowlist"]);
    expect(policy.exitCode).toBe(0);
    expect(policy.stdout).toContain("DM policy updated");
    expect(policy.stdout).toContain("allowlist");
  });

  test("tasks/skills/sessions/logs/memory commands are wired", async () => {
    const tasks = await runCli(["tasks"]);
    expect(tasks.exitCode).toBe(0);
    expect(tasks.stdout).toContain("CYBARA TASKS");

    const skills = await runCli(["skills"]);
    expect(skills.exitCode).toBe(0);
    expect(skills.stdout).toContain("CYBARA SKILLS");

    const sessions = await runCli(["sessions"]);
    expect(sessions.exitCode).toBe(0);
    expect(sessions.stdout).toContain("CYBARA SESSIONS");

    const memory = await runCli(["memory"]);
    expect(memory.exitCode).toBe(0);
    expect(memory.stdout).toContain("CYBARA MEMORY");

    const logs = await runCli(["logs", "1"]);
    expect(logs.exitCode).toBe(0);
    expect(logs.stdout).toContain("CYBARA LOGS");
  });

  test("status exits non-zero when API is unreachable", async () => {
    const { exitCode, stderr } = await runCli(["status"], { CYBARA_API: "http://127.0.0.1:0" });
    expect(exitCode).toBe(1);
    expect(stderr).toContain("Failed to connect to Cybara server");
  });
});
