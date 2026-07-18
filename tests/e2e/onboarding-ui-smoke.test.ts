import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { chromium, type Browser, type Page } from "playwright";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  browserLaunchArgs,
  findSystemBrowserExecutable,
} from "../../src/core/browser/browser-executable";

const ROOT_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const RUN_BROWSER_E2E = process.env.RUN_BROWSER_E2E === "1" || process.env.CI_BROWSER_E2E === "1";
const describeOrSkip = RUN_BROWSER_E2E ? describe : describe.skip;
const apiKey = `cybara_onboarding_e2e_${Date.now()}`;

let browser: Browser | null = null;
let page: Page | null = null;
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
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close();
        reject(new Error("Failed to allocate onboarding test port"));
        return;
      }
      server.close((error) => {
        if (error) reject(error);
        else resolve(address.port);
      });
    });
  });
}

async function waitForServerReady(url: string): Promise<void> {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${url}/api/health`);
      if (response.ok) return;
    } catch {}
    await sleep(200);
  }
  throw new Error(`Timed out waiting for onboarding gateway at ${url}`);
}

describeOrSkip("fresh install onboarding UI", () => {
  beforeAll(async () => {
    homeDir = mkdtempSync(join(tmpdir(), "cybara-onboarding-e2e-"));
    const port = await getFreePort();
    baseUrl = `http://127.0.0.1:${port}`;
    serverProc = Bun.spawn([process.execPath, "run", "src/index.ts"], {
      cwd: ROOT_DIR,
      env: {
        ...process.env,
        CYBARA_API_KEY: apiKey,
        CYBARA_DISABLE_UPDATE_CHECK: "1",
        CYBARA_HOME: join(homeDir, ".cybara"),
        HOME: homeDir,
        USERPROFILE: homeDir,
        PORT: String(port),
      },
      stdout: "ignore",
      stderr: "ignore",
    });
    await waitForServerReady(baseUrl);

    const executablePath = findSystemBrowserExecutable();
    browser = await chromium.launch({
      headless: true,
      args: browserLaunchArgs(),
      ...(executablePath ? { executablePath } : {}),
    });
    page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    await page.addInitScript((token) => {
      window.localStorage.setItem("cybara_api_key", token);
      window.localStorage.setItem(
        "cybara-ui-settings",
        JSON.stringify({ state: { accent: "amber", mode: "sand-dune" }, version: 0 })
      );
    }, apiKey);
  }, 60_000);

  afterAll(async () => {
    await page?.close().catch(() => {});
    await browser?.close().catch(() => {});
    if (serverProc) {
      try {
        serverProc.kill("SIGTERM");
      } catch {}
      await Promise.race([serverProc.exited, sleep(5_000)]);
    }
    if (homeDir) rmSync(homeDir, { recursive: true, force: true });
  }, 30_000);

  test("inherits the saved theme and completes onboarding without credentials", async () => {
    if (!page) throw new Error("Onboarding browser page was not initialized");

    let delayedSetupStatus = false;
    await page.route("**/api/setup/status", async (route) => {
      if (!delayedSetupStatus) {
        delayedSetupStatus = true;
        await sleep(600);
      }
      await route.continue();
    });
    await page.goto(baseUrl, { waitUntil: "domcontentloaded" });

    const spinner = page.locator(".animate-spin").first();
    await spinner.waitFor({ state: "visible", timeout: 5_000 });
    const spinnerColor = await spinner.evaluate((node) => getComputedStyle(node).color);
    const accent = await page
      .locator("html")
      .evaluate((node) => getComputedStyle(node).getPropertyValue("--accent-primary").trim());
    expect(spinnerColor).toContain("245, 158, 11");
    expect(accent).toBe("245, 158, 11");

    await page.getByRole("heading", { name: "Welcome to Cybara!" }).waitFor();
    await page.getByRole("button", { name: /Get Started/ }).click();
    await page.getByRole("heading", { name: "Choose AI Provider" }).waitFor();
    await page.getByRole("button", { name: "Skip for now" }).last().click();
    await page.getByRole("heading", { name: "Tool Permissions" }).waitFor();
    await page.getByRole("button", { name: /Ask Me First/ }).click();
    await page.getByRole("button", { name: "Continue" }).click();
    await page.getByRole("heading", { name: "Create Your Agent" }).waitFor();
    await page.getByRole("button", { name: "Skip for Now" }).click();
    await page.getByRole("heading", { name: "You're All Set!" }).waitFor();
    await page.getByRole("button", { name: /Go to Dashboard/ }).click();
    await page.getByRole("heading", { name: "Dashboard" }).waitFor();

    const setupResponse = await fetch(`${baseUrl}/api/setup/status`);
    expect(setupResponse.status).toBe(200);
    expect(await setupResponse.json()).toEqual(
      expect.objectContaining({ complete: true, currentStep: "welcome" })
    );
    const configResponse = await fetch(`${baseUrl}/api/config`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    expect(configResponse.status).toBe(200);
    const config = (await configResponse.json()) as { tool_approval_mode?: string };
    expect(config.tool_approval_mode).toBe("ask");
  }, 45_000);
});
