import { Database } from "bun:sqlite";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createCipheriv, randomBytes } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, type Browser, type Page } from "playwright";
import { getChromium } from "../../src/core/browser/playwright-loader";

const key = "browser-import-auto-ui-fixture-key";
const secret = "browser-import-auto-password-fixture";
const session = "browser-import-auto-ui-fixture";
const chromiumKey = randomBytes(32);
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
  for (let attempt = 0; attempt < 200; attempt += 1) {
    try {
      if ((await fetch(`${baseUrl}/api/health`)).ok) return;
    } catch {}
    await Bun.sleep(250);
  }
  throw new Error("Isolated browser-import gateway did not start.");
}

function tabIdOf(response: Record<string, unknown>): string {
  const data = response.data as { id?: unknown } | undefined;
  return typeof data?.id === "string" ? data.id : "";
}

function activePage(): Page {
  if (!page) throw new Error("Fixture browser page unavailable");
  return page;
}

async function openSettings(): Promise<void> {
  const target = activePage();
  await target.goto(`${baseUrl}/settings?section=safety`, { waitUntil: "domcontentloaded" });
  await target.locator(".browser-import-settings-entry").waitFor();
}

async function openWorkspace(): Promise<void> {
  const target = activePage();
  await target.goto(`${baseUrl}/chat?session=${session}`, { waitUntil: "domcontentloaded" });
  await target.getByRole("button", { name: "Workspace panel", exact: true }).click();
  await target.getByRole("button", { name: "Browser", exact: true }).click();
  await target.locator("[data-browser-session-id]").waitFor();
}

async function openImportModal(): Promise<void> {
  const target = activePage();
  await openSettings();
  await target.getByRole("button", { name: "Import browser data", exact: true }).click();
  await target.getByRole("dialog", { name: "Import browser data" }).waitFor();
}

function encrypt(value: string): string {
  const iv = randomBytes(16);
  const cipher = createCipheriv("aes-256-cbc", chromiumKey, iv);
  const body = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return Buffer.concat([Buffer.from("v10"), iv, body]).toString("base64");
}

function writeBrowserProfile(): void {
  const userData = join(home, "Local", "Google", "Chrome", "User Data");
  const profile = join(userData, "Default");
  mkdirSync(join(profile, "Network"), { recursive: true });
  writeFileSync(
    join(userData, "Local State"),
    JSON.stringify({ os_crypt: { encrypted_key: chromiumKey.toString("base64") } })
  );
  writeFileSync(
    join(profile, "Bookmarks"),
    JSON.stringify({
      roots: {
        bookmark_bar: {
          type: "folder",
          children: [
            { type: "url", name: "Auto detected bookmark", url: `${fixtureUrl}/bookmarked` },
          ],
        },
      },
    })
  );
  const cookies = new Database(join(profile, "Network", "Cookies"));
  cookies.exec(
    "CREATE TABLE cookies (host_key TEXT, top_frame_site_key TEXT, name TEXT, value TEXT, encrypted_value BLOB, path TEXT, expires_utc INTEGER, is_httponly INTEGER, is_secure INTEGER, samesite INTEGER)"
  );
  cookies
    .query(
      "INSERT INTO cookies (host_key,name,value,encrypted_value,path,expires_utc,is_httponly,is_secure,samesite) VALUES (?,?,?,?,?,?,?,?,?)"
    )
    .run(
      new URL(fixtureUrl).hostname,
      "imported_fixture",
      "",
      encrypt("cookie-fixture"),
      "/",
      Math.floor((Date.now() / 1000 + 86_400 + 11_644_473_600_000 / 1000) * 1_000_000),
      0,
      0,
      1
    );
  cookies.close();
  const logins = new Database(join(profile, "Login Data"));
  logins.exec(
    "CREATE TABLE logins (origin_url TEXT, username_value TEXT, password_value TEXT, blacklisted_by_user INTEGER)"
  );
  logins
    .query("INSERT INTO logins VALUES (?,?,?,0)")
    .run(`${fixtureUrl}/login`, "alice", encrypt(secret));
  logins.close();
}

beforeAll(async () => {
  home = mkdtempSync(join(tmpdir(), "cybara-browser-import-auto-"));
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
  writeBrowserProfile();
  await startGateway();
  await api("/api/setup/complete", {});
  const defaultAgent = await api("/api/agents/default", {});
  const id = typeof defaultAgent.id === "string" ? defaultAgent.id : "fixture-agent";
  const db = new Database(join(home, ".cybara", "data", "platform.db"));
  db.query("INSERT INTO chat_sessions (id, agent_id, title, messages) VALUES (?, ?, ?, ?)").run(
    session,
    id,
    "Browser import auto fixture",
    "[]"
  );
  db.close();
  const executablePath = process.env.CYBARA_BROWSER_PATH ?? (await getChromium()).executablePath();
  browser = await chromium.launch({ executablePath, headless: true });
  page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await page.addInitScript((token) => sessionStorage.setItem("cybara_api_key", token), key);
  page.on("pageerror", (error) => runtimeErrors.push(error.message));
}, 90_000);

afterAll(async () => {
  await browser?.close();
  if (gateway) {
    gateway.kill();
    await gateway.exited;
  }
  fixture?.stop(true);
  if (home) rmSync(home, { recursive: true, force: true });
});

describe("one-click automatic browser import", () => {
  test("detects local browser profiles and reports what was found", async () => {
    const target = activePage();
    await openImportModal();
    const detected = target.locator(".browser-import-category-choice");
    await detected.first().waitFor();
    const modal = await target.getByRole("dialog").innerText();
    expect(modal).toContain("Chrome");
    expect(modal).toContain("Detected");
    expect(modal).not.toContain("Choose export file");
    expect(
      await target.getByRole("button", { name: "Import everything", exact: true }).isEnabled()
    ).toBe(false);
    if (process.env.CYBARA_BROWSER_IMPORT_SCREENSHOT)
      await target.getByRole("dialog").screenshot({
        path: process.env.CYBARA_BROWSER_IMPORT_SCREENSHOT,
      });
  }, 60_000);

  test("imports every category in one click with no manual selection", async () => {
    const target = activePage();
    await openImportModal();
    await target.locator(".browser-import-category-choice").first().waitFor();
    await target.locator(".browser-import-consent input").check();
    const trigger = target.getByRole("button", { name: "Import everything", exact: true });
    expect(await trigger.isEnabled()).toBe(true);
    await trigger.click();
    await target.getByText("Import complete").waitFor({ timeout: 60_000 });

    const counts = (await api("/api/browser/import/sources")).counts as Record<string, number>;
    expect(counts.bookmarks).toBeGreaterThan(0);
    expect(counts.cookies).toBeGreaterThan(0);
    expect(counts.passwords).toBeGreaterThan(0);
    const library = await api("/api/browser/import/library");
    expect(library.logins).toMatchObject([{ username: "alice" }]);
    if (process.env.CYBARA_BROWSER_IMPORT_DONE_SCREENSHOT)
      await target.getByRole("dialog").screenshot({
        path: process.env.CYBARA_BROWSER_IMPORT_DONE_SCREENSHOT,
      });
    expect(runtimeErrors).toEqual([]);
  }, 90_000);

  test("an imported cookie reaches the embedded browser without re-selection", async () => {
    const open = await api("/api/browser/tabs", {});
    const tabId = tabIdOf(open);
    expect(tabId).not.toBe("");
    await api(`/api/browser/tabs/${tabId}/navigate`, { url: `${fixtureUrl}/cookie` });
    const snapshot = await api(`/api/browser/tabs/${tabId}/snapshot`);
    expect(JSON.stringify(snapshot)).toContain("imported_fixture=cookie-fixture");
    expect(runtimeErrors).toEqual([]);
  }, 60_000);

  test("an imported saved login fills the matching form only", async () => {
    const target = activePage();
    await openWorkspace();
    const open = await api("/api/browser/tabs", { sessionId: session });
    const tabId = tabIdOf(open);
    expect(tabId).not.toBe("");
    const navigated = await api(`/api/browser/tabs/${tabId}/navigate`, {
      url: `${fixtureUrl}/login`,
    });
    expect(JSON.stringify(navigated)).toContain("/login");
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
