import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { createServer } from "net";
import { tmpdir } from "os";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const ROOT_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

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
    } catch {
      // server still starting
    }
    await sleep(250);
  }
  throw new Error(`Timed out waiting for server at ${url}`);
}

async function runCli(args: string[]): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const proc = Bun.spawn([process.execPath, "run", "src/cli.tsx", ...args], {
    cwd: ROOT_DIR,
    env: {
      ...process.env,
      CYBARA_API: baseUrl,
      HOME: homeDir,
      USERPROFILE: homeDir,
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

describe("Server + CLI + UI smoke", () => {
  beforeAll(async () => {
    homeDir = mkdtempSync(join(tmpdir(), "cybara-e2e-home-"));
    const port = await getFreePort();
    baseUrl = `http://127.0.0.1:${port}`;

    serverProc = Bun.spawn([process.execPath, "run", "src/index.ts"], {
      cwd: ROOT_DIR,
      env: {
        ...process.env,
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
      } catch {
        // already exited
      }
      await Promise.race([serverProc.exited, sleep(5000)]);
    }

    if (homeDir) {
      rmSync(homeDir, { recursive: true, force: true });
    }
  });

  test("serves API and UI routes", async () => {
    const healthRes = await fetch(`${baseUrl}/api/health`);
    expect(healthRes.status).toBe(200);
    const health = (await healthRes.json()) as { status: string; checks: Record<string, unknown> };
    expect(health.status).toBe("healthy");
    expect(typeof health.checks).toBe("object");

    const uiRes = await fetch(`${baseUrl}/`);
    expect(uiRes.status).toBe(200);
    expect(uiRes.headers.get("content-type")).toContain("text/html");
    const html = await uiRes.text();
    expect(html.toLowerCase()).toContain("<html");

    // When UI build assets are present, ensure module scripts are served as JavaScript.
    const moduleScript = html.match(/<script[^>]*type=["']module["'][^>]*src=["']([^"']+)["']/i);
    if (moduleScript?.[1]) {
      const assetPath = moduleScript[1].startsWith("http")
        ? moduleScript[1]
        : `${baseUrl}${moduleScript[1]}`;
      const moduleRes = await fetch(assetPath);
      expect(moduleRes.status).toBe(200);
      expect(moduleRes.headers.get("content-type")).toContain("javascript");
    }
  });

  test("missing static asset returns 404 and never falls back to HTML", async () => {
    const res = await fetch(`${baseUrl}/assets/__missing-module__.js`);
    expect(res.status).toBe(404);
    expect(res.headers.get("content-type")).toContain("text/plain");
    const body = await res.text();
    expect(body.toLowerCase()).not.toContain("<html");
  });

  test("SPA deep links return index HTML", async () => {
    const res = await fetch(`${baseUrl}/tasks`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    const html = await res.text();
    expect(html.toLowerCase()).toContain("<html");
  });

  test("terminal API is blocked when --enable-terminal is not set", async () => {
    const res = await fetch(`${baseUrl}/api/terminal/sessions`);
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error?: string };
    expect(body.error).toContain("Terminal disabled");
  });

  test("CLI talks to live API", async () => {
    const status = await runCli(["status"]);
    expect(status.exitCode).toBe(0);
    expect(status.stdout).toContain("CYBARA STATUS");
    expect(status.stdout).toContain("HEALTH CHECKS");

    const metrics = await runCli(["metrics"]);
    expect(metrics.exitCode).toBe(0);
    expect(metrics.stdout).toContain("CYBARA METRICS");
  });
});
