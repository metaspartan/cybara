import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { createServer } from "net";
import { tmpdir } from "os";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const ROOT_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

// Skip spawn-heavy e2e in constrained sandboxes where child bun processes get SIGTERM'd.
const SKIP_SPAWN =
  process.env.SKIP_SPAWN_TESTS === "1" ||
  process.env.CI_SANDBOX === "1" ||
  (process.env.GITHUB_ACTIONS !== "true" && process.env.CI !== "true" && !process.env.RUN_E2E);
const describeOrSkip = SKIP_SPAWN ? describe.skip : describe;

let serverProc: ReturnType<typeof Bun.spawn> | null = null;
let baseUrl = "";
let homeDir = "";
let apiKey = "";

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

async function runCli(
  args: string[],
  envOverride?: Record<string, string>
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const proc = Bun.spawn([process.execPath, "run", "src/cli/index.tsx", ...args], {
    cwd: ROOT_DIR,
    env: {
      ...process.env,
      CYBARA_API: baseUrl,
      CYBARA_API_KEY: "",
      CYBARA_HOME: join(homeDir, ".cybara"),
      HOME: homeDir,
      USERPROFILE: homeDir,
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

function apiKeyPath(): string {
  return join(homeDir, ".cybara", "api_key");
}

function writeApiKeyFile(value: string): void {
  mkdirSync(join(homeDir, ".cybara"), { recursive: true });
  writeFileSync(apiKeyPath(), `${value}\n`, "utf-8");
}

function removeApiKeyFile(): void {
  rmSync(apiKeyPath(), { force: true });
}

describeOrSkip("CLI auth e2e", () => {
  beforeAll(async () => {
    homeDir = mkdtempSync(join(tmpdir(), "cybara-cli-auth-home-"));
    apiKey = `cybara_cli_auth_${Date.now()}`;
    const port = await getFreePort();
    baseUrl = `http://127.0.0.1:${port}`;

    serverProc = Bun.spawn([process.execPath, "run", "src/index.ts"], {
      cwd: ROOT_DIR,
      env: {
        ...process.env,
        NODE_ENV: "production",
        CYBARA_API_KEY: apiKey,
        CYBARA_HOME: join(homeDir, ".cybara"),
        HOME: homeDir,
        USERPROFILE: homeDir,
        PORT: String(port),
      },
      stdout: "ignore",
      stderr: "ignore",
    });

    await waitForServerReady(baseUrl);
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

  test("CLI rejects protected API calls without auth key", async () => {
    removeApiKeyFile();
    const metrics = await runCli(["metrics"]);
    expect(metrics.exitCode).toBe(1);
    expect(metrics.stderr).toContain("Unauthorized API request (401)");
  });

  test("CLI config set also fails without auth key", async () => {
    removeApiKeyFile();
    const setConfig = await runCli(["config", "set", "theme", `auth-missing-${Date.now()}`]);
    expect(setConfig.exitCode).toBe(1);
    expect(setConfig.stderr).toContain("Failed to set config: 401");
  });

  test("CLI succeeds with CYBARA_API_KEY env auth", async () => {
    removeApiKeyFile();
    const metrics = await runCli(["metrics"], { CYBARA_API_KEY: apiKey });
    expect(metrics.exitCode).toBe(0);
    expect(metrics.stdout).toContain("CYBARA METRICS");
  });

  test("CLI falls back to ~/.cybara/api_key for auth", async () => {
    writeApiKeyFile(apiKey);
    const providers = await runCli(["provider"]);
    expect(providers.exitCode).toBe(0);
    expect(providers.stdout).toContain("CYBARA PROVIDERS");
    expect(readFileSync(apiKeyPath(), "utf-8").trim()).toBe(apiKey);
  });

  test("CYBARA_API_KEY env takes precedence over ~/.cybara/api_key", async () => {
    writeApiKeyFile(apiKey);
    const metrics = await runCli(["metrics"], { CYBARA_API_KEY: "invalid_key" });
    expect(metrics.exitCode).toBe(1);
    expect(metrics.stderr).toContain("Unauthorized API request (401)");
  });

  test("CLI trims whitespace from ~/.cybara/api_key", async () => {
    writeApiKeyFile(`  ${apiKey}  `);
    const providers = await runCli(["provider"]);
    expect(providers.exitCode).toBe(0);
    expect(providers.stdout).toContain("CYBARA PROVIDERS");
    expect(readFileSync(apiKeyPath(), "utf-8").trim()).toBe(apiKey);
  });

  test("CLI direct-fetch mutation commands succeed when CYBARA_API_KEY is set", async () => {
    removeApiKeyFile();

    const setConfig = await runCli(["config", "set", "theme", `cli-auth-theme-${Date.now()}`], {
      CYBARA_API_KEY: apiKey,
    });
    expect(setConfig.exitCode).toBe(0);
    expect(setConfig.stdout).toContain("Set theme =");

    const providerName = `cli-auth-provider-${Date.now()}`;
    const addProvider = await runCli(
      ["provider", "add", "openai", "--name", providerName, "--key", "sk-cli-auth-test"],
      { CYBARA_API_KEY: apiKey }
    );
    expect(addProvider.exitCode).toBe(0);
    expect(addProvider.stdout).toContain(`Added provider: ${providerName}`);
    const providerIdMatch = addProvider.stdout.match(/ID:\s+([^\s]+)/);
    expect(providerIdMatch).toBeTruthy();
    if (!providerIdMatch) return;
    const providerId = providerIdMatch[1];

    const updateProvider = await runCli(
      ["provider", "update", providerId, "--name", `${providerName}-updated`],
      { CYBARA_API_KEY: apiKey }
    );
    expect(updateProvider.exitCode).toBe(0);
    expect(updateProvider.stdout).toContain(`Updated provider: ${providerId}`);

    const deleteProvider = await runCli(["provider", "delete", providerId], {
      CYBARA_API_KEY: apiKey,
    });
    expect(deleteProvider.exitCode).toBe(0);
    expect(deleteProvider.stdout).toContain(`Deleted provider: ${providerId}`);

    const agentResponse = await fetch(`${baseUrl}/api/agents/default`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    expect(agentResponse.status).toBe(200);
    const agent = (await agentResponse.json()) as { id?: string };
    expect(typeof agent.id).toBe("string");
    if (!agent.id) return;

    const spawnSubagent = await runCli(
      ["subagent", "spawn", "--agent", agent.id, "cli auth smoke subagent"],
      { CYBARA_API_KEY: apiKey }
    );
    expect(spawnSubagent.exitCode).toBe(0);
    const subagentIdMatch = spawnSubagent.stdout.match(/Spawned subagent:\s+([^\s]+)/);
    expect(subagentIdMatch).toBeTruthy();
    if (!subagentIdMatch) return;
    const subagentId = subagentIdMatch[1];

    const killSubagent = await runCli(["subagent", "kill", subagentId], { CYBARA_API_KEY: apiKey });
    expect(killSubagent.exitCode).toBe(0);
    expect(killSubagent.stdout).toContain(`Killed subagent: ${subagentId}`);
  });
});
