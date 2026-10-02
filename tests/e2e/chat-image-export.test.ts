import { Database } from "bun:sqlite";
import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import sharp from "sharp";
import { getChromium } from "../../src/core/browser/playwright-loader";

const key = "image-export-fixture-key";
const sessionId = `image-export-${crypto.randomUUID()}`;
let home = "";
let base = "";
let gateway: ReturnType<typeof Bun.spawn> | undefined;
let provider: ReturnType<typeof Bun.serve> | undefined;
let browser: Browser | undefined;
let context: BrowserContext | undefined;
let page: Page | undefined;
let png = Buffer.alloc(0);
let pixels = Buffer.alloc(0);
let mediaPath = "";
let agentId = "";
let turn: Promise<unknown> | undefined;
let release: (() => void) | undefined;
let providerReached: Promise<void>;
let providerNotify: (() => void) | undefined;
const mediaRequests: Array<{ authorized: boolean; status: number }> = [];
const errors: string[] = [];

async function api(path: string, body?: unknown): Promise<Record<string, unknown>> {
  const response = await fetch(`${base}${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const result = (await response.json()) as Record<string, unknown>;
  if (!response.ok || result.error || result.failure)
    throw new Error(`Image export fixture ${path} failed`);
  return result;
}

beforeAll(async () => {
  home = mkdtempSync(join(tmpdir(), "cybara-image-export-e2e-"));
  const allocation = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response("ok") });
  base = `http://127.0.0.1:${allocation.port}`;
  allocation.stop(true);
  pixels = Buffer.alloc(32 * 32 * 4);
  for (let index = 0; index < pixels.length; index += 4) {
    pixels[index] = (index / 4) % 2 ? 255 : 0;
    pixels[index + 1] = 120;
    pixels[index + 2] = 210;
    pixels[index + 3] = 255;
  }
  png = await sharp(pixels, { raw: { width: 32, height: 32, channels: 4 } })
    .png()
    .toBuffer();
  mediaPath = join(home, ".cybara", "media", "viewed", "fixture.png");
  await Bun.write(mediaPath, png);
  providerReached = new Promise((resolve) => {
    providerNotify = resolve;
  });
  const wait = new Promise<void>((resolve) => {
    release = resolve;
  });
  provider = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      if (request.method !== "POST") return Response.json({ data: [{ id: "image-export-model" }] });
      providerNotify?.();
      await wait;
      return Response.json({
        id: "image-export-response",
        object: "chat.completion",
        created: 1,
        model: "image-export-model",
        choices: [
          {
            index: 0,
            message: { role: "assistant", content: "Image export test turn completed." },
            finish_reason: "stop",
          },
        ],
        usage: { prompt_tokens: 100, completion_tokens: 8, total_tokens: 108 },
      });
    },
  });
  gateway = Bun.spawn([process.execPath, "run", "src/index.ts"], {
    cwd: join(import.meta.dir, "..", ".."),
    env: {
      ...process.env,
      CYBARA_HOME: join(home, ".cybara"),
      CONFIG_DIR: join(home, ".cybara"),
      HOME: home,
      USERPROFILE: home,
      LOCALAPPDATA: join(home, "Local"),
      PORT: new URL(base).port,
      CYBARA_HOST: "127.0.0.1",
      CYBARA_API_KEY: key,
      NODE_ENV: "test",
    },
    stdout: "ignore",
    stderr: "ignore",
  });
  for (let attempt = 0; attempt < 150; attempt += 1) {
    try {
      if ((await fetch(`${base}/api/health`)).ok) break;
    } catch {}
    await Bun.sleep(100);
  }
  await api("/api/setup/complete", {});
  const p = await api("/api/providers", {
    provider: "llamacpp",
    name: "Image export fixture",
    base_url: `http://127.0.0.1:${provider.port}/v1`,
  });
  const agent = await api("/api/agents", {
    name: "Image export fixture",
    model: "image-export-model",
    provider_id: p.id,
    memory_enabled: false,
  });
  if (typeof agent.id !== "string") throw new Error("Fixture agent missing");
  agentId = agent.id;
  const timestamp = new Date().toISOString();
  const metadata = {
    tool_calls: [
      {
        id: "fixture-read",
        name: "read",
        args: { path: mediaPath },
        result: { snapshot: mediaPath, image: mediaPath, content: mediaPath },
        status: "completed",
      },
    ],
    process_activities: [
      {
        id: "fixture-read",
        phase: "result",
        text: "Viewed running chat.png",
        timestamp: Date.now(),
        toolName: "read",
        toolCallId: "fixture-read",
        imagePath: mediaPath,
      },
    ],
  };
  const db = new Database(join(home, ".cybara", "data", "platform.db"));
  db.query("INSERT INTO chat_sessions(id,agent_id,title,messages) VALUES(?,?,?,?)").run(
    sessionId,
    agentId,
    "Running chat image export",
    JSON.stringify([
      { role: "user", content: "View this image", timestamp },
      { role: "assistant", content: "Image inspected.", timestamp, ...metadata },
    ])
  );
  db.query(
    "INSERT INTO session_messages(id,session_id,agent_id,role,content,metadata,created_at) VALUES(?,?,?,?,?,?,?)"
  ).run(
    crypto.randomUUID(),
    sessionId,
    agentId,
    "user",
    "View this image",
    JSON.stringify({
      images: [{ data: png.toString("base64"), mimeType: "image/png", name: "inline.png" }],
    }),
    timestamp
  );
  db.query(
    "INSERT INTO session_messages(id,session_id,agent_id,role,content,metadata,created_at) VALUES(?,?,?,?,?,?,?)"
  ).run(
    crypto.randomUUID(),
    sessionId,
    agentId,
    "assistant",
    "Image inspected.",
    JSON.stringify(metadata),
    timestamp
  );
  db.close();
  const executablePath = process.env.CYBARA_BROWSER_PATH ?? (await getChromium()).executablePath();
  browser = await chromium.launch({ executablePath, headless: true });
  context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    acceptDownloads: true,
  });
  await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: base });
  page = await context.newPage();
  await page.addInitScript((token) => sessionStorage.setItem("cybara_api_key", token), key);
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("response", (response) => {
    if (new URL(response.url()).pathname !== "/api/media") return;
    mediaRequests.push({
      authorized: response.request().headers().authorization === `Bearer ${key}`,
      status: response.status(),
    });
  });
  await page.goto(`${base}/chat?session=${sessionId}`, { waitUntil: "domcontentloaded" });
  await page.getByText("Image inspected.", { exact: true }).waitFor({ timeout: 10000 });
  await page.locator('img[alt="Tool output"]').first().waitFor();
  turn = api("/api/chat", {
    sessionId,
    agentId,
    message: "Continue working while I export the viewed image.",
    tools: false,
    stream: false,
  });
  await providerReached;
  await page.getByRole("button", { name: /Stop/ }).first().waitFor({ timeout: 15000 });
}, 50_000);

afterAll(async () => {
  release?.();
  await turn?.catch(() => undefined);
  await browser?.close();
  if (gateway) {
    gateway.kill();
    await gateway.exited;
  }
  provider?.stop(true);
  if (home) rmSync(home, { recursive: true, force: true });
});

async function imagePage(): Promise<Page> {
  if (!page) throw new Error("Fixture UI missing");
  if ((await page.getByRole("dialog", { name: "Image preview" }).count()) === 0)
    await page.locator('img[alt="Tool output"]').first().click();
  await page.getByRole("dialog", { name: "Image preview" }).waitFor();
  return page;
}

async function openMenu(target: Page): Promise<void> {
  const bounds = await target
    .getByRole("dialog", { name: "Image preview" })
    .locator("img")
    .boundingBox();
  if (!bounds) throw new Error("Preview image is not visible");
  await target.mouse.click(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2, {
    button: "right",
  });
  await target.getByRole("menu", { name: "Image actions" }).waitFor();
}

test("copy from the viewed thumbnail writes actual PNG pixels to the clipboard while the agent turn is active", async () => {
  const target = await imagePage();
  await target.bringToFront();
  await openMenu(target);
  await target.getByRole("menuitem", { name: "Copy image", exact: true }).click();
  await target
    .locator('[role="dialog"] [role="alert"], [role="dialog"] [role="status"]')
    .waitFor({ timeout: 10000 });
  expect(await target.getByText("Image copied", { exact: true }).isVisible()).toBe(true);
  const copied = await target.evaluate(async () => {
    const items = await navigator.clipboard.read();
    const item = items.find((entry) => entry.types.includes("image/png"));
    if (!item) throw new Error("Clipboard image missing");
    return Array.from(new Uint8Array(await (await item.getType("image/png")).arrayBuffer()));
  });
  const decoded = await sharp(Buffer.from(copied))
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  expect(decoded.info.width).toBe(32);
  expect(decoded.info.height).toBe(32);
  expect(decoded.data).toEqual(pixels);
  expect(await target.getByRole("button", { name: /Stop/ }).first().isVisible()).toBe(true);
}, 25_000);

test("Save image as and Download use exact authenticated image bytes while the chat is active", async () => {
  const target = await imagePage();
  await openMenu(target);
  const [download] = await Promise.all([
    target.waitForEvent("download"),
    target.getByRole("menuitem", { name: "Save image as…", exact: true }).click(),
  ]);
  const saved = join(home, "saved-context-menu.png");
  await download.saveAs(saved);
  expect(await Bun.file(saved).bytes()).toEqual(new Uint8Array(png));
  expect(download.suggestedFilename()).toBe("Tool output.png");
  const [toolbar] = await Promise.all([
    target.waitForEvent("download"),
    target.getByRole("button", { name: "Download image", exact: true }).click(),
  ]);
  const toolbarFile = join(home, "saved-toolbar.png");
  await toolbar.saveAs(toolbarFile);
  expect(await Bun.file(toolbarFile).bytes()).toEqual(new Uint8Array(png));
  expect(mediaRequests.length).toBeGreaterThan(0);
  expect(mediaRequests.every((entry) => entry.authorized && entry.status === 200)).toBe(true);
  expect(errors).toEqual([]);
}, 25_000);

test("inline image attachments copy and save without a data-URL fetch", async () => {
  if (!page) throw new Error("Fixture UI missing");
  await page.getByRole("button", { name: "Close image preview", exact: true }).click();
  await page.locator('img[alt="inline.png"]').click();
  await page.getByRole("dialog", { name: "Image preview" }).waitFor();
  await openMenu(page);
  await page.getByRole("menuitem", { name: "Copy image", exact: true }).click();
  await page.getByText("Image copied", { exact: true }).waitFor();
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "Download image", exact: true }).click(),
  ]);
  const saved = join(home, "inline-download.png");
  await download.saveAs(saved);
  expect(await Bun.file(saved).bytes()).toEqual(new Uint8Array(png));
  expect(download.suggestedFilename()).toBe("inline.png");
  await page.getByRole("button", { name: "Close image preview", exact: true }).click();
  await page.locator('img[alt="Tool output"]').click();
}, 25_000);
test("blocked browser clipboard gives actionable guidance and keeps Save image as available", async () => {
  if (!context) throw new Error("Fixture context missing");
  const target = await imagePage();
  await target.route("**/chat?session=*", async (route) => {
    const response = await route.fetch();
    await route.fulfill({
      response,
      headers: { ...response.headers(), "Permissions-Policy": "clipboard-write=()" },
    });
  });
  await target.goto(`${base}/chat?session=${sessionId}`, { waitUntil: "domcontentloaded" });
  await target.locator('img[alt="Tool output"]').first().click();
  await target.getByRole("dialog", { name: "Image preview" }).waitFor();
  await openMenu(target);
  await target.getByRole("menuitem", { name: "Copy image", exact: true }).click();
  await target
    .getByText(
      "The browser blocked clipboard access. Allow clipboard access for this site and try again, or use Save image as.",
      { exact: true }
    )
    .waitFor({ timeout: 10_000 });
  await openMenu(target);
  const [download] = await Promise.all([
    target.waitForEvent("download"),
    target.getByRole("menuitem", { name: "Save image as…", exact: true }).click(),
  ]);
  const file = join(home, "permission-denied-save.png");
  await download.saveAs(file);
  expect(await Bun.file(file).bytes()).toEqual(new Uint8Array(png));
  await target.unroute("**/chat?session=*");
}, 20_000);
