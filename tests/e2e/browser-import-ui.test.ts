import { Database } from "bun:sqlite";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, type Browser, type Page } from "playwright";
import { getChromium } from "../../src/core/browser/playwright-loader";

const key = "browser-import-ui-fixture-key";
const secret = "browser-import-ui-password-fixture";
const session = "browser-import-ui-fixture";
let home = "";
let baseUrl = "";
let fixtureUrl = "";
let gateway: ReturnType<typeof Bun.spawn> | undefined;
let fixture: ReturnType<typeof Bun.serve> | undefined;
let browser: Browser | undefined;
let page: Page | undefined;
const submissions: Array<{ username: string | null; password: string | null; cookie: string }> = [];
const runtimeErrors: string[] = [];

async function api(path: string, body?: unknown): Promise<Record<string, unknown>> {
  const response = await fetch(`${baseUrl}${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const result = (await response.json()) as Record<string, unknown>;
  if (!response.ok || result.success === false || result.error)
    throw new Error(`Fixture API ${path}: ${JSON.stringify(result)}`);
  return result;
}

async function startGateway(): Promise<void> {
  gateway = Bun.spawn([process.execPath, "run", "src/index.ts"], {
    cwd: join(import.meta.dir, "..", ".."),
    env: {
      ...process.env,
      CYBARA_HOME: join(home, ".cybara"),
      CONFIG_DIR: join(home, ".cybara"),
      HOME: home,
      USERPROFILE: home,
      LOCALAPPDATA: join(home, "Local"),
      CYBARA_HOST: "127.0.0.1",
      PORT: new URL(baseUrl).port,
      CYBARA_API_KEY: key,
      NODE_ENV: "test",
    },
    stdout: "ignore",
    stderr: "ignore",
  });
  for (let attempt = 0; attempt < 120; attempt += 1) {
    try {
      if ((await fetch(`${baseUrl}/api/health`)).ok) return;
    } catch {}
    await Bun.sleep(250);
  }
  throw new Error("Isolated browser-import UI gateway did not start.");
}

function activePage(): Page {
  if (!page) throw new Error("Fixture browser page unavailable");
  return page;
}

async function openWorkspace(): Promise<void> {
  const target = activePage();
  await target.goto(`${baseUrl}/chat?session=${session}`, { waitUntil: "domcontentloaded" });
  await target.getByRole("button", { name: "Workspace panel", exact: true }).click();
  await target.getByRole("button", { name: "Browser", exact: true }).click();
  await target.locator("[data-browser-session-id]").waitFor();
}

async function openSettings(): Promise<void> {
  const target = activePage();
  await target.goto(`${baseUrl}/settings?section=safety`, { waitUntil: "domcontentloaded" });
  await target.locator(".browser-import-settings-entry").waitFor();
}

async function file(category: string, name: string, content: string): Promise<void> {
  await activePage()
    .getByLabel(category, { exact: true })
    .setInputFiles({ name, mimeType: "text/plain", buffer: Buffer.from(content) });
}

beforeAll(async () => {
  home = mkdtempSync(join(tmpdir(), "cybara-browser-import-ui-"));
  const allocation = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response("ok") });
  baseUrl = `http://127.0.0.1:${allocation.port}`;
  allocation.stop(true);
  fixture = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request) {
      const url = new URL(request.url);
      if (url.pathname === "/signed-in") {
        submissions.push({
          username: url.searchParams.get("username"),
          password: url.searchParams.get("password"),
          cookie: request.headers.get("cookie") ?? "",
        });
        return new Response("Fixture sign-in received", {
          headers: { "Content-Type": "text/html" },
        });
      }
      if (url.pathname === "/cookie") return new Response(request.headers.get("cookie") ?? "none");
      return new Response(
        '<!DOCTYPE html><title>Fixture login</title><form method="get" action="/signed-in"><label>User<input name="username" autocomplete="username"></label><label>Password<input type="password" name="password" autocomplete="current-password"></label><button type="submit">Sign in</button></form>',
        { headers: { "Content-Type": "text/html" } }
      );
    },
  });
  fixtureUrl = `http://127.0.0.1:${fixture.port}`;
  const profile = join(home, "Local", "Google", "Chrome", "User Data", "Default");
  mkdirSync(profile, { recursive: true });
  writeFileSync(
    join(profile, "Bookmarks"),
    JSON.stringify({
      roots: {
        bookmark_bar: {
          type: "folder",
          children: [
            { type: "url", name: "Detected source bookmark", url: `${fixtureUrl}/source` },
          ],
        },
      },
    })
  );
  await startGateway();
  await api("/api/setup/complete", {});
  const defaultAgent = await api("/api/agents/default", {});
  const id = typeof defaultAgent.id === "string" ? defaultAgent.id : "fixture-agent";
  const db = new Database(join(home, ".cybara", "data", "platform.db"));
  db.query("INSERT INTO chat_sessions (id, agent_id, title, messages) VALUES (?, ?, ?, ?)").run(
    session,
    id,
    "Browser import UI fixture",
    "[]"
  );
  db.close();
  const executablePath = process.env.CYBARA_BROWSER_PATH ?? (await getChromium()).executablePath();
  browser = await chromium.launch({ executablePath, headless: true });
  page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await page.addInitScript((token) => sessionStorage.setItem("cybara_api_key", token), key);
  page.on("pageerror", (error) => runtimeErrors.push(error.message));
}, 60_000);

afterAll(async () => {
  await browser?.close();
  if (gateway) {
    gateway.kill();
    await gateway.exited;
  }
  fixture?.stop(true);
  if (home) rmSync(home, { recursive: true, force: true });
});

describe("browser import through the rendered application", () => {
  test("dismisses top banner without bottom popup and imports all categories through Settings", async () => {
    const target = activePage();
    await openWorkspace();
    await target.locator(".browser-import-banner").waitFor();
    expect(await target.locator(".browser-import-banner").count()).toBe(1);
    await target.getByRole("button", { name: "Dismiss browser import banner" }).click();
    expect(await target.locator(".browser-import-banner").count()).toBe(0);
    await target.getByRole("button", { name: "Workspace panel", exact: true }).click();
    expect(
      await target
        .locator(
          '[data-testid="floating-browser-preview"], [data-testid="floating-browser-preview-show"]'
        )
        .count()
    ).toBe(0);
    await openSettings();
    await target.getByRole("button", { name: "Import browser data", exact: true }).click();
    const modal = target.getByRole("dialog", { name: "Import browser data" });
    await modal.waitFor();
    await target.getByLabel("Import from", { exact: true }).selectOption("");
    const consent = target.locator(".browser-import-consent input");
    expect(await consent.isChecked()).toBe(false);
    expect(
      await target.getByRole("button", { name: "Import selected data", exact: true }).isEnabled()
    ).toBe(false);
    await target.getByLabel("Saved passwords", { exact: true }).check();
    await target.getByLabel("Cookies & sign-ins", { exact: true }).check();
    await file(
      "Choose saved passwords export file",
      "passwords.csv",
      `url,username,password\n${fixtureUrl}/login,alice,${secret}\n`
    );
    await file(
      "Choose cookies & sign-ins export file",
      "cookies.json",
      JSON.stringify([
        { domain: "127.0.0.1", name: "imported_fixture", value: "cookie-fixture", httpOnly: true },
      ])
    );
    await file(
      "Choose browsing history export file",
      "history.json",
      JSON.stringify([{ url: `${fixtureUrl}/history`, title: "Fixture history", visited_at: 123 }])
    );
    await file(
      "Choose bookmarks export file",
      "bookmarks.html",
      `<DL><A HREF="${fixtureUrl}/login">Fixture login</A></DL>`
    );
    expect(
      await target.getByRole("button", { name: "Import selected data", exact: true }).isEnabled()
    ).toBe(false);
    await consent.check();
    await target.getByRole("button", { name: "Import selected data", exact: true }).click();
    await target.locator(".browser-import-success-title").waitFor();
    expect(await target.locator(".browser-import-counts strong").allTextContents()).toEqual([
      "1",
      "1",
      "1",
      "1",
    ]);
    await target.getByRole("button", { name: "Browse imported data", exact: true }).click();
    expect(await modal.innerText()).not.toContain(secret);
    expect(await target.locator(".browser-import-library-summary").innerText()).toContain(
      "1 saved logins · 1 cookies · 1 bookmarks · 1 history entries"
    );
    expect(await target.locator(".browser-import-page").first().isEnabled()).toBe(false);
    await target.getByRole("button", { name: "Close dialog" }).click();
    await target.reload({ waitUntil: "domcontentloaded" });
    await target.getByRole("button", { name: "Manage imported data", exact: true }).click();
    await target.getByText("Fixture history", { exact: true }).waitFor();
    await target.setViewportSize({ width: 390, height: 844 });
    const geometry = await target.evaluate(() => ({
      width: window.innerWidth,
      scroll: document.documentElement.scrollWidth,
      dialog: document.querySelector('[role="dialog"]')?.getBoundingClientRect().width ?? 0,
    }));
    expect(geometry.scroll).toBeLessThanOrEqual(geometry.width);
    expect(geometry.dialog).toBeLessThanOrEqual(390);
    await target.getByRole("button", { name: "Close dialog" }).click();
    await target.setViewportSize({ width: 1440, height: 1000 });
    expect((await api("/api/browser/import/sources")).counts).toEqual({
      passwords: 1,
      cookies: 1,
      history: 1,
      bookmarks: 1,
    });
  }, 60_000);

  test("keeps dismissal across reload, uses detected profile, and retains successful result after a failed library refresh", async () => {
    const target = activePage();
    await openWorkspace();
    expect(await target.locator(".browser-import-banner").count()).toBe(0);
    expect(
      await target
        .locator(
          '[data-testid="floating-browser-preview"], [data-testid="floating-browser-preview-show"]'
        )
        .count()
    ).toBe(0);
    await openSettings();
    await target.getByRole("button", { name: "Import browser data", exact: true }).click();
    const source = target.getByLabel("Import from", { exact: true });
    await target
      .getByRole("option", { name: "Chrome · Default profile" })
      .waitFor({ state: "attached" });
    const sourceId = await source
      .locator("option")
      .filter({ hasText: "Chrome · Default profile" })
      .getAttribute("value");
    if (!sourceId) throw new Error("Detected source missing");
    await source.selectOption(sourceId);
    await target.getByLabel("Saved passwords", { exact: true }).uncheck();
    await target.getByLabel("Cookies & sign-ins", { exact: true }).uncheck();
    await target.getByLabel("Browsing history", { exact: true }).uncheck();
    await target.route("**/api/browser/import/library", (route) =>
      route.fulfill({
        status: 503,
        contentType: "application/json",
        body: '{"success":false,"error":"Fixture refresh unavailable"}',
      })
    );
    await target.locator(".browser-import-consent input").check();
    await target.getByRole("button", { name: "Import selected data", exact: true }).click();
    await target.getByText("Import complete", { exact: true }).waitFor();
    await target
      .getByText(
        "Your import succeeded, but the library could not refresh. Reopen Imported data to see the latest items."
      )
      .waitFor();
    expect(await target.locator(".browser-import-error").count()).toBe(0);
    await target.unroute("**/api/browser/import/library");
    await target.getByRole("button", { name: "Done", exact: true }).click();
    await target.getByRole("button", { name: "Manage imported data", exact: true }).click();
    await target.getByText("Detected source bookmark", { exact: true }).waitFor();
    await target.getByRole("button", { name: "Close dialog" }).click();
    expect((await api("/api/browser/import/sources")).counts).toEqual({
      passwords: 1,
      cookies: 1,
      history: 1,
      bookmarks: 2,
    });
  }, 60_000);

  test("invalid exports remain errors without changes and deselecting clears plaintext file state", async () => {
    const target = activePage();
    await openSettings();
    await target.getByRole("button", { name: "Import browser data", exact: true }).click();
    await target.getByLabel("Import from", { exact: true }).selectOption("");
    await target.getByLabel("Browsing history", { exact: true }).check();
    await target.getByLabel("Bookmarks", { exact: true }).uncheck();
    await file("Choose browsing history export file", "invalid.json", '{"secret-fixture":');
    await target.locator(".browser-import-consent input").check();
    await target.getByRole("button", { name: "Import selected data", exact: true }).click();
    await target.getByRole("alert").waitFor();
    expect(await target.getByRole("alert").innerText()).not.toContain("secret-fixture");
    expect(await target.locator(".browser-import-success").count()).toBe(0);
    await target.getByLabel("Browsing history", { exact: true }).uncheck();
    await target.getByLabel("Browsing history", { exact: true }).check();
    expect(await target.locator(".browser-import-file").innerText()).not.toContain("invalid.json");
    expect(await target.locator(".browser-import-consent input").isChecked()).toBe(false);
    await target.getByRole("button", { name: "Cancel", exact: true }).click();
    expect((await api("/api/browser/import/sources")).counts).toEqual({
      passwords: 1,
      cookies: 1,
      history: 1,
      bookmarks: 2,
    });
  }, 45_000);

  test("restores cookies after gateway restart and manually fills the exact-site login from the browser banner", async () => {
    const target = activePage();
    if (!gateway) throw new Error("Gateway unavailable");
    gateway.kill();
    await gateway.exited;
    await startGateway();
    await openSettings();
    await target.getByRole("button", { name: "Restore browser banner", exact: true }).click();
    expect(
      await target.getByRole("button", { name: "Restore browser banner", exact: true }).count()
    ).toBe(0);
    await openWorkspace();
    await target.locator(".browser-import-banner").waitFor();
    await target.locator(".browser-import-library-action").click();
    await target.getByText("Fixture login", { exact: true }).waitFor();
    const [navigation] = await Promise.all([
      target.waitForResponse((response) =>
        /\/api\/browser\/tabs\/[^/]+\/navigate$/.test(new URL(response.url()).pathname)
      ),
      target.locator(".browser-import-page").filter({ hasText: "Fixture login" }).click(),
    ]);
    const navigationResult = (await navigation.json()) as {
      success?: boolean;
      error?: string;
      data?: { url?: string };
    };
    if (!navigation.ok() || navigationResult.success === false || navigationResult.error)
      throw new Error(`Embedded navigation failed: ${JSON.stringify(navigationResult)}`);
    expect(navigationResult.data?.url).toBe(`${fixtureUrl}/login`);
    const tabId = /\/api\/browser\/tabs\/([^/]+)\/navigate$/.exec(
      new URL(navigation.url()).pathname
    )?.[1];
    if (!tabId) throw new Error("Embedded navigation tab missing");
    await target.waitForFunction(
      (url) =>
        document.querySelector<HTMLInputElement>('input[aria-label="Browser address"]')?.value ===
        url,
      `${fixtureUrl}/login`
    );
    await target.locator(".browser-import-library-action").click();
    await target.getByRole("button", { name: /alice.*Fill login/ }).click();
    await target
      .getByText("Saved login filled. Review the form and sign in when you’re ready.")
      .waitFor();
    expect(submissions).toEqual([]);
    expect(await target.getByRole("dialog").innerText()).not.toContain(secret);
    await target.getByRole("button", { name: "Close dialog" }).click();
    await api(`/api/browser/tabs/${tabId}/click`, { selector: 'button[type="submit"]' });
    for (let attempt = 0; attempt < 40 && submissions.length === 0; attempt += 1)
      await Bun.sleep(50);
    expect(submissions).toEqual([
      { username: "alice", password: secret, cookie: "imported_fixture=cookie-fixture" },
    ]);
    expect(runtimeErrors).toEqual([]);
  }, 60_000);
});
