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

function route(method: string, url: URL, body: string): Response {
  const pathname = url.pathname;

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

  if (method === "POST" && pathname === "/api/providers") {
    const parsed = body
      ? (JSON.parse(body) as { provider?: string; name?: string; api_key?: string })
      : {};
    if (!parsed.provider) {
      return json({ error: "missing provider" }, 400);
    }
    return json({ id: "prov-created", name: parsed.name || parsed.provider });
  }

  if (method === "PUT" && pathname === "/api/providers/prov-1") {
    return json({ success: true });
  }

  if (method === "DELETE" && pathname === "/api/providers/prov-1") {
    return json({ success: true });
  }

  if (method === "GET" && pathname === "/api/providers/prov-1/models") {
    return json([
      { id: "claude-sonnet", name: "Claude Sonnet", context: 200000 },
      { id: "claude-haiku", name: "Claude Haiku", context: 200000 },
    ]);
  }

  if (method === "POST" && pathname === "/api/providers/discover/ollama") {
    return json({
      models: [{ id: "llama3.1:8b" }, { id: "qwen2.5:14b" }],
    });
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

  if (method === "GET" && pathname === "/api/channels/chan-1/pairings") {
    return json({
      pairings: [
        {
          id: "pair-1",
          senderId: "user-777",
          code: "PAIR42",
          platform: "discord",
          displayName: "Alice",
          status: "pending",
          createdAt: new Date().toISOString(),
          expiresAt: new Date(Date.now() + 5 * 60_000).toISOString(),
        },
      ],
      pendingCount: 1,
    });
  }

  if (method === "GET" && pathname === "/api/channels/chan-2/pairings") {
    return json({ pairings: [], pendingCount: 0 });
  }

  if (method === "POST" && pathname === "/api/channels/chan-1/pairings/verify") {
    const parsed = body ? (JSON.parse(body) as { code?: string }) : {};
    if (parsed.code === "PAIR42") {
      return json({ success: true, senderId: "user-777" });
    }
    return json({ success: false, error: "invalid code" });
  }

  if (method === "POST" && pathname === "/api/channels/chan-2/pairings/verify") {
    return json({ success: false, error: "not found" });
  }

  if (method === "POST" && pathname === "/api/channels/chan-1/pairings/pair-1/reject") {
    return json({ success: true });
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

  if (method === "GET" && pathname === "/api/memory/search") {
    const query = url.searchParams.get("query") || "";
    return json({
      results: [
        {
          id: "m-search-1",
          content: `result for ${query}`,
          similarity: 0.93,
          createdAt: new Date().toISOString(),
        },
      ],
    });
  }

  if (method === "GET" && pathname === "/api/logs/system") {
    return json([
      { timestamp: new Date().toISOString(), level: "info", module: "api", message: "ok" },
    ]);
  }

  if (method === "GET" && pathname === "/api/subagents") {
    return json([
      {
        id: "sub-1",
        task: "Analyze logs",
        label: "Analyze logs for errors",
        status: "running",
        createdAt: new Date().toISOString(),
      },
      {
        id: "sub-2",
        task: "Write summary",
        label: "Write release summary",
        status: "completed",
        createdAt: new Date().toISOString(),
      },
    ]);
  }

  if (method === "POST" && pathname === "/api/subagents/spawn") {
    const parsed = body ? (JSON.parse(body) as { task?: string }) : {};
    if (!parsed.task) return json({ error: "missing task" }, 400);
    return json({ id: "sub-2" });
  }

  if (method === "POST" && pathname === "/api/subagents/sub-2/kill") {
    return json({ success: true });
  }

  if (method === "GET" && pathname === "/api/mcp") {
    return json([
      {
        id: "mcp-1",
        name: "Filesystem MCP",
        command: "npx @modelcontextprotocol/server-filesystem",
        status: "running",
        toolCount: 12,
      },
    ]);
  }

  if (method === "GET" && pathname === "/api/mcp/registry/popular") {
    return json([
      {
        id: "filesystem",
        name: "Filesystem",
        description: "Read and write files",
        registry: "modelcontextprotocol",
        package: "@modelcontextprotocol/server-filesystem",
        command: "npx",
      },
    ]);
  }

  if (method === "GET" && pathname === "/api/mcp/registry/search") {
    const q = (url.searchParams.get("q") || "").toLowerCase();
    return json([
      {
        id: q || "filesystem",
        name: q ? `Result for ${q}` : "Filesystem",
        description: "Registry search result",
        registry: "modelcontextprotocol",
        package: "@modelcontextprotocol/server-git",
        command: "npx",
      },
    ]);
  }

  if (method === "POST" && pathname === "/api/mcp/registry/install") {
    const parsed = body ? (JSON.parse(body) as { package?: string }) : {};
    if (!parsed.package) return json({ success: false, error: "missing package" }, 400);
    return json({ success: true, id: "mcp-installed-1" });
  }

  if (method === "GET" && pathname === "/api/lsp/install-status") {
    return json({
      status: [
        {
          language: "typescript",
          displayName: "TypeScript",
          description: "Bundled TS/JS server",
          type: "bundled",
          installed: true,
          available: true,
          path: null,
        },
        {
          language: "python",
          displayName: "Python",
          description: "Pyright",
          type: "binary",
          installed: false,
          available: true,
          path: "/usr/local/bin/pyright-langserver",
          requiresRuntime: "node",
        },
      ],
    });
  }

  if (method === "POST" && pathname === "/api/lsp/install") {
    const parsed = body ? (JSON.parse(body) as { language?: string }) : {};
    if (!parsed.language) return json({ success: false, error: "language required" }, 400);
    return json({ success: true, path: `/mock/lsp/${parsed.language}` });
  }

  if (method === "POST" && pathname === "/api/lsp/uninstall") {
    const parsed = body ? (JSON.parse(body) as { language?: string }) : {};
    if (!parsed.language) return json({ success: false, error: "language required" }, 400);
    return json({ success: true });
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
        return route(req.method, url, body);
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

  test("memory search query path is wired", async () => {
    const search = await runCli(["memory", "integration"]);
    expect(search.exitCode).toBe(0);
    expect(search.stdout).toContain('query: "integration"');
    expect(search.stdout).toContain("results: 1");
  });

  test("pairing commands list, approve, and reject are wired", async () => {
    const list = await runCli(["pair", "list"]);
    expect(list.exitCode).toBe(0);
    expect(list.stdout).toContain("PENDING PAIRINGS");
    expect(list.stdout).toContain("PAIR42");

    const approve = await runCli(["pair", "pair42"]);
    expect(approve.exitCode).toBe(0);
    expect(approve.stdout).toContain("Pairing approved");
    expect(approve.stdout).toContain("sender: user-777");

    const reject = await runCli(["pair", "reject", "PAIR42"]);
    expect(reject.exitCode).toBe(0);
    expect(reject.stdout).toContain("Pairing rejected");
    expect(reject.stdout).toContain("sender: user-777");
  });

  test("provider write/model/discover commands are wired", async () => {
    const add = await runCli([
      "provider",
      "add",
      "anthropic",
      "--name",
      "Anthropic CI",
      "--key",
      "test-key",
      "--default",
    ]);
    expect(add.exitCode).toBe(0);
    expect(add.stdout).toContain("Added provider: Anthropic CI");

    const update = await runCli(["provider", "update", "prov-1", "--name", "Anthropic Updated"]);
    expect(update.exitCode).toBe(0);
    expect(update.stdout).toContain("Updated provider: prov-1");

    const models = await runCli(["provider", "models", "prov-1"]);
    expect(models.exitCode).toBe(0);
    expect(models.stdout).toContain("MODELS FOR PROVIDER prov-1");
    expect(models.stdout).toContain("claude-sonnet");

    const discover = await runCli(["provider", "discover"]);
    expect(discover.exitCode).toBe(0);
    expect(discover.stdout).toContain("Discovered 2 Ollama models");

    const del = await runCli(["provider", "delete", "prov-1"]);
    expect(del.exitCode).toBe(0);
    expect(del.stdout).toContain("Deleted provider: prov-1");
  });

  test("subagent and mcp command groups are wired", async () => {
    const subagents = await runCli(["subagent"]);
    expect(subagents.exitCode).toBe(0);
    expect(subagents.stdout).toContain("CYBARA SUBAGENTS");

    const spawn = await runCli(["subagent", "spawn", "compile release notes"]);
    expect(spawn.exitCode).toBe(0);
    expect(spawn.stdout).toContain("Spawned subagent: sub-2");

    const kill = await runCli(["subagent", "kill", "sub-2"]);
    expect(kill.exitCode).toBe(0);
    expect(kill.stdout).toContain("Killed subagent: sub-2");

    const mcpList = await runCli(["mcp", "list"]);
    expect(mcpList.exitCode).toBe(0);
    expect(mcpList.stdout).toContain("MCP SERVERS");
    expect(mcpList.stdout).toContain("Filesystem MCP");

    const mcpSearch = await runCli(["mcp", "search", "filesystem"]);
    expect(mcpSearch.exitCode).toBe(0);
    expect(mcpSearch.stdout).toContain("MCP REGISTRY SEARCH");
    expect(mcpSearch.stdout).toContain("filesystem");

    const mcpInstall = await runCli(["mcp", "install", "@modelcontextprotocol/server-git"]);
    expect(mcpInstall.exitCode).toBe(0);
    expect(mcpInstall.stdout).toContain("SUCCESS: Installed @modelcontextprotocol/server-git");

    const mcpPopular = await runCli(["mcp", "popular"]);
    expect(mcpPopular.exitCode).toBe(0);
    expect(mcpPopular.stdout).toContain("POPULAR MCP SERVERS");
  });

  test("usage and validation errors return non-zero for invalid args", async () => {
    const badMcpSearch = await runCli(["mcp", "search"]);
    expect(badMcpSearch.exitCode).toBe(1);
    expect(badMcpSearch.stderr).toContain("Usage: cybara mcp search <query>");

    const badPairPolicy = await runCli(["pair", "policy", "Discord Ops", "invalid-policy"]);
    expect(badPairPolicy.exitCode).toBe(1);
    expect(badPairPolicy.stderr).toContain("Invalid policy: invalid-policy");
  });

  test("lsp list/install/uninstall commands are wired", async () => {
    const list = await runCli(["lsp", "list"]);
    expect(list.exitCode).toBe(0);
    expect(list.stdout).toContain("LSP STATUS");
    expect(list.stdout).toContain("TypeScript");
    expect(list.stdout).toContain("python");

    const install = await runCli(["lsp", "install", "python"]);
    expect(install.exitCode).toBe(0);
    expect(install.stdout).toContain("Successfully installed python");
    expect(install.stdout).toContain("/mock/lsp/python");

    const uninstall = await runCli(["lsp", "uninstall", "python"]);
    expect(uninstall.exitCode).toBe(0);
    expect(uninstall.stdout).toContain("Successfully uninstalled python");
  });

  test("missing required args return non-zero for pair/subagent/lsp", async () => {
    const badPairReject = await runCli(["pair", "reject"]);
    expect(badPairReject.exitCode).toBe(1);
    expect(badPairReject.stderr).toContain("Usage: cybara pair reject <CODE>");

    const badSubagentSpawn = await runCli(["subagent", "spawn"]);
    expect(badSubagentSpawn.exitCode).toBe(1);
    expect(badSubagentSpawn.stderr).toContain("ERROR: Please specify a task");

    const badLspInstall = await runCli(["lsp", "install"]);
    expect(badLspInstall.exitCode).toBe(1);
    expect(badLspInstall.stderr).toContain("ERROR: Please specify a language to install");
  });

  test("status exits non-zero when API is unreachable", async () => {
    const { exitCode, stderr } = await runCli(["status"], { CYBARA_API: "http://127.0.0.1:0" });
    expect(exitCode).toBe(1);
    expect(stderr).toContain("Failed to connect to Cybara server");
  });
});
