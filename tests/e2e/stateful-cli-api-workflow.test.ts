import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { createServer } from "net";
import { tmpdir } from "os";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const ROOT_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const API_KEY = "stateful-cli-e2e-key";

// Skip spawn-heavy e2e in constrained environments (CI sandboxes, containers
// where child bun processes get SIGTERM'd). Set SKIP_SPAWN_TESTS=1 to opt out.
// Also auto-detect constrained environments by checking if we're in a sandbox.
const SKIP_SPAWN =
  process.env.SKIP_SPAWN_TESTS === "1" ||
  process.env.CI_SANDBOX === "1" ||
  (process.env.GITHUB_ACTIONS !== "true" && process.env.CI !== "true" && !process.env.RUN_E2E);
const describeOrSkip = SKIP_SPAWN ? describe.skip : describe;

let serverProc: ReturnType<typeof Bun.spawn> | null = null;
let baseUrl = "";
let homeDir = "";

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

async function waitForServerReady(url: string, timeoutMs = 30000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`${url}/api/health`);
      if (res.ok) return;
    } catch {}
    await sleep(250);
  }
  throw new Error(`Timed out waiting for server at ${url}`);
}

async function api(method: string, path: string, body?: unknown) {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${API_KEY}`,
  };
  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
  }

  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  const contentType = response.headers.get("content-type") || "";
  const data = contentType.includes("application/json")
    ? await response.json()
    : await response.text();

  return { status: response.status, data };
}

async function runCli(
  args: string[]
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const proc = Bun.spawn([process.execPath, "run", "src/cli/index.tsx", ...args], {
    cwd: ROOT_DIR,
    env: {
      ...process.env,
      CYBARA_API: baseUrl,
      CYBARA_API_KEY: API_KEY,
      CYBARA_HOME: join(homeDir, ".cybara"),
      HOME: homeDir,
      USERPROFILE: homeDir,
      // Skip auto-update checks during e2e to avoid network calls.
      CYBARA_DISABLE_UPDATE_CHECK: "1",
    },
    stdout: "pipe",
    stderr: "pipe",
    // Ensure the process isn't killed by the test runner's cleanup.
    onExit: () => {},
  });

  // Add a timeout so the CLI can't hang forever.
  const timeoutMs = 30_000;
  const timeoutPromise = new Promise<{ exitCode: number; stdout: string; stderr: string }>(
    (resolve) => {
      setTimeout(() => {
        try {
          proc.kill("SIGKILL");
        } catch {}
        resolve({ exitCode: 143, stdout: "", stderr: "CLI timed out" });
      }, timeoutMs);
    }
  );

  const result = await Promise.race([
    Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]).then(([stdout, stderr, exitCode]) => ({ exitCode, stdout, stderr })),
    timeoutPromise,
  ]);

  return result;
}

describeOrSkip("Stateful CLI + API e2e", () => {
  beforeAll(async () => {
    homeDir = mkdtempSync(join(tmpdir(), "cybara-stateful-cli-e2e-home-"));
    const port = await getFreePort();
    baseUrl = `http://127.0.0.1:${port}`;

    serverProc = Bun.spawn([process.execPath, "run", "src/index.ts"], {
      cwd: ROOT_DIR,
      env: {
        ...process.env,
        CYBARA_API_KEY: API_KEY,
        CYBARA_HOME: join(homeDir, ".cybara"),
        HOME: homeDir,
        USERPROFILE: homeDir,
        PORT: String(port),
      },
      stdout: "ignore",
      stderr: "ignore",
    });

    await waitForServerReady(baseUrl);
    const setup = await api("POST", "/api/setup/complete");
    expect(setup.status).toBe(200);
  });

  afterAll(async () => {
    if (serverProc) {
      try {
        serverProc.kill("SIGTERM");
      } catch {}
      await Promise.race([serverProc.exited, sleep(5000)]);
    }

    if (homeDir) {
      rmSync(homeDir, { recursive: true, force: true });
    }
  });

  test("provider/config/channels/tasks CLI commands mutate and read live server state", async () => {
    const providerName = `e2e-provider-${Date.now()}`;
    const addProvider = await runCli([
      "provider",
      "add",
      "openai",
      "--name",
      providerName,
      "--key",
      "sk-e2e-test-key",
    ]);
    expect(addProvider.exitCode).toBe(0);
    expect(addProvider.stdout).toContain(`Added provider: ${providerName}`);

    const providerList = await runCli(["provider"]);
    expect(providerList.exitCode).toBe(0);
    expect(providerList.stdout).toContain(providerName);

    const configValue = `e2e-theme-${Date.now()}`;
    const setConfig = await runCli(["config", "set", "theme", configValue]);
    expect(setConfig.exitCode).toBe(0);
    expect(setConfig.stdout).toContain(`Set theme = "${configValue}"`);

    const getConfig = await runCli(["config", "get", "theme"]);
    expect(getConfig.exitCode).toBe(0);
    expect(getConfig.stdout).toContain(`theme = "${configValue}"`);

    const channelName = `e2e-channel-${Date.now()}`;
    const channelRes = await api("POST", "/api/channels", {
      name: channelName,
      type: "web",
      config: {},
    });
    expect(channelRes.status).toBe(200);
    expect(typeof channelRes.data?.id).toBe("string");
    const channelId = channelRes.data.id as string;

    const channelsCmd = await runCli(["channels"]);
    expect(channelsCmd.exitCode).toBe(0);
    expect(channelsCmd.stdout).toContain(channelName);

    const pairPolicy = await runCli(["pair", "policy", channelName, "allowlist"]);
    expect(pairPolicy.exitCode).toBe(0);
    expect(pairPolicy.stdout).toContain("DM policy updated");
    expect(pairPolicy.stdout).toContain("allowlist");

    const pairingsRes = await api("GET", `/api/channels/${channelId}/pairings`);
    expect(pairingsRes.status).toBe(200);
    expect(pairingsRes.data.config.dm_policy).toBe("allowlist");

    const taskName = `e2e-task-${Date.now()}`;
    const taskRes = await api("POST", "/api/tasks", {
      name: taskName,
      description: "stateful cli e2e task",
      action: "say hello",
      schedule: "0 * * * *",
      enabled: false,
    });
    expect(taskRes.status).toBe(200);
    expect(typeof taskRes.data?.id).toBe("string");
    const taskId = taskRes.data.id as string;

    const tasksCmd = await runCli(["tasks"]);
    expect(tasksCmd.exitCode).toBe(0);
    expect(tasksCmd.stdout).toContain(taskName);

    await api("DELETE", `/api/tasks/${taskId}`);
    await api("DELETE", `/api/channels/${channelId}`);
  });

  test("sessions and memory CLI commands surface API-created artifacts", async () => {
    const createAgent = await api("POST", "/api/agents", {
      name: `e2e-cli-agent-${Date.now()}`,
      type: "basic",
      provider: "anthropic",
      model: "claude-sonnet-4-20250514",
    });

    expect(createAgent.status).toBe(200);
    expect(typeof createAgent.data?.id).toBe("string");
    const agentId = createAgent.data.id as string;

    const marker = `e2e-cli-session-marker-${Date.now()}`;
    const chatRes = await api("POST", "/api/chat", {
      agentId,
      message: `CLI session listing marker: ${marker}`,
    });
    expect(chatRes.status).toBe(200);
    expect(typeof chatRes.data?.sessionId).toBe("string");
    const sessionId = chatRes.data.sessionId as string;

    const sessionsCmd = await runCli(["sessions"]);
    expect(sessionsCmd.exitCode).toBe(0);
    expect(sessionsCmd.stdout).toContain("CYBARA SESSIONS");
    expect(sessionsCmd.stdout).toContain(sessionId.slice(0, 8));

    const memoryNeedle = `e2e-memory-needle-${Date.now()}`;
    const memoryFile = `e2e-cli-memory-${Date.now()}.md`;
    const memoryCreate = await api("POST", "/api/memory", {
      file: memoryFile,
      content: `memory test content ${memoryNeedle}`,
    });
    expect(memoryCreate.status).toBe(200);
    expect(memoryCreate.data.success).toBe(true);

    const memoryCmd = await runCli(["memory", memoryNeedle]);
    expect(memoryCmd.exitCode).toBe(0);
    expect(memoryCmd.stdout).toContain(`query: "${memoryNeedle}"`);
    expect(memoryCmd.stdout).toContain("results:");

    await api("DELETE", `/api/memory/${memoryFile}`);
    await api("DELETE", `/api/chat/sessions/${sessionId}`);
    await api("DELETE", `/api/agents/${agentId}`);
  });

  test("wallet CLI and API state flows stay consistent", async () => {
    const initialStatus = await api("GET", "/api/wallet/status");
    expect(initialStatus.status).toBe(200);
    expect(initialStatus.data.exists).toBe(false);

    const create = await runCli(["wallet", "create", "--password", "stateful-wallet-pass"]);
    expect(create.exitCode).toBe(0);
    expect(create.stdout).toContain("Wallet created and unlocked");

    const statusAfterCreate = await api("GET", "/api/wallet/status");
    expect(statusAfterCreate.status).toBe(200);
    expect(statusAfterCreate.data.exists).toBe(true);
    expect(statusAfterCreate.data.unlocked).toBe(true);
    expect(statusAfterCreate.data.primaryAddresses.eth).toMatch(/^0x/);
    expect(statusAfterCreate.data.primaryAddresses.btc).toMatch(/^bc1/);
    expect(typeof statusAfterCreate.data.primaryAddresses.sol).toBe("string");

    const accounts = await runCli([
      "wallet",
      "accounts",
      "--chains",
      "eth,btc,sol",
      "--count",
      "1",
      "--start",
      "0",
    ]);
    expect(accounts.exitCode).toBe(0);
    expect(accounts.stdout).toContain("WALLET ACCOUNTS");
    expect(accounts.stdout).toContain("ETH index 0");
    expect(accounts.stdout).toContain("BTC index 0");
    expect(accounts.stdout).toContain("SOL index 0");

    const rpcSet = await runCli([
      "wallet",
      "rpc",
      "set",
      "--eth",
      "https://ethereum-rpc.publicnode.com",
      "--sol",
      "https://api.mainnet-beta.solana.com",
      "--btc",
      "https://mempool.space/api",
    ]);
    expect(rpcSet.exitCode).toBe(0);
    expect(rpcSet.stdout).toContain("Wallet RPC settings updated");

    const agentAccess = await runCli(["wallet", "agent-access", "on"]);
    expect(agentAccess.exitCode).toBe(0);
    expect(agentAccess.stdout).toContain("Agent wallet access enabled");

    const statusAfterAgentToggle = await api("GET", "/api/wallet/status");
    expect(statusAfterAgentToggle.status).toBe(200);
    expect(statusAfterAgentToggle.data.agentAccessEnabled).toBe(true);

    const lock = await runCli(["wallet", "lock"]);
    expect(lock.exitCode).toBe(0);
    expect(lock.stdout).toContain("Wallet locked");

    const statusAfterLock = await api("GET", "/api/wallet/status");
    expect(statusAfterLock.status).toBe(200);
    expect(statusAfterLock.data.unlocked).toBe(false);

    const unlock = await runCli(["wallet", "unlock", "--password", "stateful-wallet-pass"]);
    expect(unlock.exitCode).toBe(0);
    expect(unlock.stdout).toContain("Wallet unlocked");

    const statusAfterUnlock = await api("GET", "/api/wallet/status");
    expect(statusAfterUnlock.status).toBe(200);
    expect(statusAfterUnlock.data.unlocked).toBe(true);

    const dapps = await runCli(["wallet", "dapps"]);
    expect(dapps.exitCode).toBe(0);
    expect(dapps.stdout).toContain("WALLET DAPP ADAPTERS");
    expect(dapps.stdout).toContain("x402_http");

    const localX402Url = "http://127.0.0.1:4020/x402";
    const x402DryRun = await runCli([
      "wallet",
      "x402",
      "--url",
      localX402Url,
      "--network",
      "eip155:1",
      "--dry-run",
    ]);
    expect(x402DryRun.exitCode).toBe(1);
    expect(x402DryRun.stderr).toContain("Blocked hostname: 127.0.0.1");

    const x402Api = await api("POST", "/api/wallet/x402", {
      url: localX402Url,
      network: "eip155:1",
      method: "GET",
      dryRun: true,
    });
    expect(x402Api.status).toBe(400);
    expect(x402Api.data.code).toBe("VALIDATION_ERROR");

    const policyUpdate = await api("PUT", "/api/wallet/agent-policy", {
      allowDappInteraction: true,
      allowX402Payments: true,
      allowedDappHosts: ["127.0.0.1"],
      allowedX402Networks: ["eip155:1"],
      x402MaxAmountAtomic: "1000000",
    });
    expect(policyUpdate.status).toBe(200);

    const allowToolExecution = await api("PUT", "/api/config", {
      tool_approval_mode: "always_allow",
    });
    expect(allowToolExecution.status).toBe(200);
    expect(allowToolExecution.data.success).toBe(true);

    const deniedTool = await api("POST", "/api/tools/execute", {
      name: "wallet",
      args: {
        action: "x402_request",
        url: localX402Url,
        network: "eip155:1",
      },
    });
    expect(deniedTool.status).toBe(400);
    expect(deniedTool.data.code).toBe("VALIDATION_ERROR");

    const dappCapabilities = await api("POST", "/api/tools/execute", {
      name: "wallet",
      args: { action: "dapp_capabilities" },
    });
    expect(dappCapabilities.status).toBe(200);
    expect(Array.isArray(dappCapabilities.data.adapters)).toBe(true);
    expect(
      dappCapabilities.data.adapters.some(
        (entry: { adapter: string }) => entry.adapter === "x402_http"
      )
    ).toBe(true);
  }, 120_000);
});
