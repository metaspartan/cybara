import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { chromium, type Browser, type Page } from "playwright";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const RUN_BROWSER_E2E = process.env.RUN_BROWSER_E2E === "1" || process.env.CI_BROWSER_E2E === "1";
const describeOrSkip = RUN_BROWSER_E2E ? describe : describe.skip;

let serverProc: ReturnType<typeof Bun.spawn> | null = null;
let browser: Browser | null = null;
let page: Page | null = null;
let baseUrl = "";
let homeDir = "";
let cybaraHome = "";
let alphaPath = "";
let betaPath = "";
let browserMessages: string[] = [];
const apiKey = `cybara_ide_browser_e2e_${Date.now()}`;

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

async function waitForServerReady(url: string, timeoutMs = 30_000): Promise<void> {
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

async function runBun(args: string[], timeoutMs = 120_000): Promise<void> {
  const proc = Bun.spawn([process.execPath, ...args], {
    cwd: ROOT_DIR,
    env: process.env,
    stdout: "pipe",
    stderr: "pipe",
  });

  const timeout = setTimeout(() => {
    try {
      proc.kill("SIGKILL");
    } catch {}
  }, timeoutMs);

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  clearTimeout(timeout);

  if (exitCode !== 0) {
    throw new Error(
      `bun ${args.join(" ")} failed with exit ${exitCode}\n${stdout}\n${stderr}`.trim()
    );
  }
}

function reactRuntimeFailures(): string[] {
  return browserMessages.filter((message) =>
    /Minified React error #300|Rendered fewer hooks|React has detected|Uncaught Error/i.test(
      message
    )
  );
}

describeOrSkip("IDE web UI browser smoke", () => {
  beforeAll(async () => {
    homeDir = mkdtempSync(join(tmpdir(), "cybara-ide-browser-e2e-home-"));
    cybaraHome = join(homeDir, ".cybara");
    const workspaceDir = join(homeDir, "workspace", "src");
    mkdirSync(workspaceDir, { recursive: true });
    alphaPath = join(workspaceDir, "alpha.ts");
    betaPath = join(workspaceDir, "beta.ts");
    writeFileSync(
      alphaPath,
      [
        "export const alphaValue = 42;",
        "export function describeAlpha(): string {",
        "  return `alpha:${alphaValue}`;",
        "}",
        "",
      ].join("\n")
    );
    writeFileSync(
      betaPath,
      [
        "export const betaValue = 84;",
        "export function describeBeta(): string {",
        "  return `beta:${betaValue}`;",
        "}",
        "",
      ].join("\n")
    );

    await runBun(["run", "ui:build"]);

    const port = await getFreePort();
    baseUrl = `http://127.0.0.1:${port}`;
    serverProc = Bun.spawn([process.execPath, "run", "src/index.ts"], {
      cwd: ROOT_DIR,
      env: {
        ...process.env,
        CYBARA_DISABLE_UPDATE_CHECK: "1",
        CYBARA_HOME: cybaraHome,
        CYBARA_API_KEY: apiKey,
        HOME: homeDir,
        USERPROFILE: homeDir,
        HOST: "127.0.0.1",
        PORT: String(port),
      },
      stdout: "ignore",
      stderr: "ignore",
    });

    await waitForServerReady(baseUrl);
    const setupResponse = await fetch(`${baseUrl}/api/setup/complete`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    expect(setupResponse.status).toBe(200);

    browser = await chromium.launch({ headless: true });
    page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    await page.addInitScript((token) => {
      window.localStorage.setItem("cybara_api_key", token);
    }, apiKey);
    page.on("console", (message) => {
      if (message.type() === "error" || message.type() === "warning") {
        browserMessages.push(`${message.type()}: ${message.text()}`);
      }
    });
    page.on("pageerror", (error) => {
      browserMessages.push(`pageerror: ${error.message}`);
    });
  }, 120_000);

  afterAll(async () => {
    if (page) {
      await page.close().catch(() => {});
      page = null;
    }
    if (browser) {
      await browser.close().catch(() => {});
      browser = null;
    }
    if (serverProc) {
      try {
        serverProc.kill("SIGTERM");
      } catch {}
      await Promise.race([serverProc.exited, sleep(5000)]);
      serverProc = null;
    }
    if (homeDir) {
      rmSync(homeDir, { recursive: true, force: true });
    }
  }, 30_000);

  test("opens a TypeScript file and switches to another file without React hook-order errors", async () => {
    expect(page).not.toBeNull();
    const targetPage = page!;

    await targetPage.goto(
      `${baseUrl}/ide?path=${encodeURIComponent(alphaPath)}&token=${encodeURIComponent(apiKey)}`,
      {
        waitUntil: "domcontentloaded",
      }
    );
    await targetPage.waitForSelector("textarea", { timeout: 15_000 });
    await targetPage.waitForFunction(
      () => document.querySelector("textarea")?.value.includes("alphaValue") === true,
      null,
      { timeout: 15_000 }
    );

    const initialEditorText = await targetPage.locator("textarea").inputValue();
    expect(initialEditorText).toContain("alphaValue");
    expect(await targetPage.locator("#root").evaluate((node) => node.textContent || "")).toContain(
      "alpha.ts"
    );

    await targetPage.getByText("beta.ts", { exact: true }).click();
    await targetPage.waitForFunction(
      () => document.querySelector("textarea")?.value.includes("betaValue") === true,
      null,
      { timeout: 15_000 }
    );

    const switchedEditorText = await targetPage.locator("textarea").inputValue();
    expect(switchedEditorText).toContain("betaValue");
    expect(switchedEditorText).not.toContain("alphaValue");
    expect(await targetPage.locator("#root").evaluate((node) => node.textContent || "")).toContain(
      "beta.ts"
    );
    expect(reactRuntimeFailures()).toEqual([]);
  }, 45_000);
});
