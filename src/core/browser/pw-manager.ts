import type { Browser, BrowserContext, Page, LaunchOptions } from "playwright";
import { getChromium } from "./playwright-loader";

async function launchWithFallback(
  chromium: Awaited<ReturnType<typeof getChromium>>,
  headless: boolean,
  args: string[]
): Promise<Browser> {
  let bundledAvailable = false;
  try {
    bundledAvailable = Boolean(chromium.executablePath());
  } catch {
    bundledAvailable = false;
  }

  const attempts: Array<{ label: string; options: LaunchOptions }> = [];
  if (bundledAvailable) {
    attempts.push({ label: "bundled-chromium", options: { headless, args } });
  }
  for (const channel of ["chrome", "msedge"]) {
    attempts.push({ label: `channel:${channel}`, options: { headless, args, channel } });
  }
  if (!bundledAvailable) {
    attempts.push({ label: "bundled-chromium", options: { headless, args } });
  }

  const failures: string[] = [];
  for (const attempt of attempts) {
    try {
      return await chromium.launch(attempt.options);
    } catch (error) {
      failures.push(`${attempt.label}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  throw new Error(`Unable to launch a browser (${failures.join(" | ")})`);
}
import {
  type BrowserProfile,
  type BrowserProfileConfig,
  createProfile,
  getProfile,
  listProfiles,
  deleteProfile,
  startBrowser,
  stopBrowser,
  createPage as createProfilePage,
  getProfilePages,
  closePage as closeProfilePage,
  shutdownAll,
  getPagesMap,
  getBrowsersMap,
} from "./profiles";
import { randomUUID } from "crypto";

interface AXNode {
  role?: string;
  name?: string;
  value?: string;
  description?: string;
  children?: AXNode[];
}

type ClickModifier = "Alt" | "Control" | "ControlOrMeta" | "Meta" | "Shift";

function isClickModifier(value: string): value is ClickModifier {
  return ["Alt", "Control", "ControlOrMeta", "Meta", "Shift"].includes(value);
}

let legacyBrowser: Browser | null = null;
let legacyContext: BrowserContext | null = null;
const legacyPages = new Map<string, Page>();
const consoleLogs = new Map<string, Array<{ type: string; text: string; location?: string }>>();

export interface BrowserStatus {
  running: boolean;
  pages: number;
  chromiumAvailable: boolean;
  headless: boolean;
  profiles: BrowserProfile[];
}

async function getLegacyBrowser(): Promise<Browser> {
  if (legacyBrowser) return legacyBrowser;

  const chromium = await getChromium();
  try {
    try {
      legacyBrowser = await chromium.connectOverCDP("http://localhost:9222");
      console.log("[Browser] Connected to existing Chrome instance via CDP");
      return legacyBrowser;
    } catch {
      void 0;
    }

    const launchArgs = [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-accelerated-2d-canvas",
      "--disable-gpu",
      "--window-size=1920,1080",
    ];
    const headless = process.env.BROWSER_HEADLESS !== "false";
    legacyBrowser = await launchWithFallback(chromium, headless, launchArgs);

    console.log("[Browser] Launched new browser instance");
    return legacyBrowser;
  } catch (error) {
    console.error("[Browser] Failed to launch browser:", error);
    throw new Error(
      "Failed to launch browser. Make sure Playwright is installed: bun add playwright"
    );
  }
}

async function getLegacyContext(): Promise<BrowserContext> {
  if (legacyContext) return legacyContext;

  const bw = await getLegacyBrowser();
  legacyContext = await bw.newContext({
    viewport: { width: 1920, height: 1080 },
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  });

  return legacyContext;
}

export async function createBrowserProfile(config: BrowserProfileConfig): Promise<BrowserProfile> {
  return await createProfile(config);
}

export function getBrowserProfile(name: string): BrowserProfile | undefined {
  return getProfile(name);
}

export function listBrowserProfiles(): BrowserProfile[] {
  return listProfiles();
}

export async function deleteBrowserProfile(name: string): Promise<void> {
  return await deleteProfile(name);
}

export async function startBrowserProfile(name: string): Promise<unknown> {
  return await startBrowser(name);
}

export async function stopBrowserProfile(name: string): Promise<void> {
  return await stopBrowser(name);
}

export async function createPageInProfile(profileName: string, url?: string): Promise<string> {
  await createProfilePage(profileName, url);
  return `${profileName}-${Date.now()}`;
}

export function getPagesInProfile(
  profileName: string
): Promise<Array<{ id: string; url: string; title: string }>> {
  return getProfilePages(profileName);
}

export async function closePageInProfile(profileName: string, pageId: string): Promise<boolean> {
  return await closeProfilePage(profileName, pageId);
}

export async function createPage(): Promise<string> {
  const ctx = await getLegacyContext();
  const page = await ctx.newPage();
  const id = randomUUID();
  legacyPages.set(id, page);
  consoleLogs.set(id, []);

  page.on("close", () => {
    legacyPages.delete(id);
    consoleLogs.delete(id);
  });

  page.on("console", (msg) => {
    const logs = consoleLogs.get(id) || [];
    logs.push({
      type: msg.type(),
      text: msg.text(),
      location: msg.location()?.url,
    });
    consoleLogs.set(id, logs);
  });

  console.log(`[Browser] Created page ${id.slice(0, 8)}...`);
  return id;
}

export function getPageById(id: string): Page | undefined {
  return legacyPages.get(id);
}

export async function getAllPages(): Promise<Array<{ id: string; url: string; title: string }>> {
  const result: Array<{ id: string; url: string; title: string }> = [];
  for (const [id, page] of legacyPages.entries()) {
    result.push({
      id,
      url: page.url(),
      title: await page.title(),
    });
  }
  return result;
}

export async function closePage(id: string): Promise<boolean> {
  const page = legacyPages.get(id);
  if (!page) return false;

  await page.close();
  legacyPages.delete(id);
  consoleLogs.delete(id);
  return true;
}

export async function navigate(
  pageId: string,
  url: string,
  options?: { waitUntil?: "load" | "domcontentloaded" | "networkidle" }
): Promise<{ url: string; title: string }> {
  const page = getPageById(pageId) || getPageById("default");
  if (!page) throw new Error(`Page ${pageId} not found`);

  await page.goto(url, {
    waitUntil: options?.waitUntil || "domcontentloaded",
    timeout: 30000,
  });

  return {
    url: page.url(),
    title: await page.title(),
  };
}

export async function screenshot(
  pageId: string,
  options?: {
    fullPage?: boolean;
    selector?: string;
    type?: "png" | "jpeg";
    quality?: number;
  }
): Promise<Buffer> {
  const page = getPageById(pageId) || getPageById("default");
  if (!page) throw new Error(`Page ${pageId} not found`);

  if (options?.selector) {
    const element = await page.locator(options.selector).first();
    return await element.screenshot({
      type: options.type || "png",
      quality: options.quality,
    });
  }

  return await page.screenshot({
    fullPage: options?.fullPage || false,
    type: options?.type || "png",
    quality: options?.quality,
  });
}

export async function pdf(
  pageId: string,
  options?: {
    format?: "letter" | "a4";
    landscape?: boolean;
    printBackground?: boolean;
  }
): Promise<Buffer> {
  const page = getPageById(pageId) || getPageById("default");
  if (!page) throw new Error(`Page ${pageId} not found`);

  const format = options?.format || "a4";
  return Buffer.from(
    await page.pdf({
      format,
      landscape: options?.landscape || false,
      printBackground: options?.printBackground !== false,
    })
  );
}

export async function getConsoleLogs(
  pageId: string,
  options?: { type?: string }
): Promise<Array<{ type: string; text: string; location?: string }>> {
  const page = getPageById(pageId);
  if (!page) throw new Error(`Page ${pageId} not found`);

  const logs = consoleLogs.get(pageId) || [];

  if (options?.type) {
    return logs.filter((log) => log.type === options.type);
  }

  return logs;
}

export async function getSnapshot(
  pageId: string,
  options?: {
    format?: "aria" | "ai";
    maxChars?: number;
    compact?: boolean;
    interactive?: boolean;
    depth?: number;
    selector?: string;
    refs?: "aria" | "role";
  }
): Promise<{
  url: string;
  title: string;
  snapshot?: string;
  nodes?: Array<{ ref: string; role: string; name: string; value?: string; depth: number }>;
  truncated?: boolean;
  stats?: { lines: number; chars: number; refs: number; interactive: number };
}> {
  const page = getPageById(pageId) || getPageById("default");
  if (!page) throw new Error(`Page ${pageId} not found`);

  const format = options?.format || "ai";
  const maxChars = options?.maxChars || 8000;

  if (format === "aria") {
    let ariaSnapshot: AXNode | null = null;
    try {
      const snapshotStr = await page.locator("body").ariaSnapshot();
      ariaSnapshot = {
        role: "document",
        name: "document",
        children: [{ role: "text", name: snapshotStr }],
      };
    } catch {
      const text = (await page.textContent("body").catch(() => "")) || "";
      ariaSnapshot = {
        role: "document",
        name: "Page Content",
        children: [{ role: "text", name: text.slice(0, 5000) }],
      };
    }

    const nodes: Array<{ ref: string; role: string; name: string; value?: string; depth: number }> =
      [];
    let refCounter = 0;

    function processNode(node: AXNode, depth: number) {
      if (node.role) {
        const ref = `ref${++refCounter}`;
        nodes.push({
          ref,
          role: node.role,
          name: node.name || "",
          value: node.value,
          depth,
        });
      }
      if (node.children) {
        for (const child of node.children) {
          processNode(child, depth + 1);
        }
      }
    }

    processNode(ariaSnapshot, 0);

    return {
      url: page.url(),
      title: await page.title(),
      nodes,
      stats: {
        lines: nodes.length,
        chars: nodes.reduce((acc, n) => acc + n.name.length + n.role.length, 0),
        refs: nodes.length,
        interactive: nodes.filter((n) =>
          ["button", "link", "input", "checkbox", "radio", "combobox", "textbox"].includes(n.role)
        ).length,
      },
    };
  }

  let snapshotText: string;

  if (options?.selector) {
    const element = await page.locator(options.selector).first();
    try {
      snapshotText = await element.ariaSnapshot();
    } catch {
      snapshotText = await element.innerText().catch(() => "");
    }
  } else {
    try {
      snapshotText = await page.locator("body").ariaSnapshot();
      if (options?.depth) {
        const lines = snapshotText.split("\n");
        snapshotText = lines.slice(0, options.depth * 10).join("\n");
      }
    } catch {
      snapshotText = (await page.textContent("body").catch(() => "")) || "";
      snapshotText = snapshotText.slice(0, 8000);
    }
  }

  const truncated = snapshotText.length > maxChars;
  const truncatedText = truncated
    ? snapshotText.slice(0, maxChars) + "\n... [truncated]"
    : snapshotText;

  return {
    url: page.url(),
    title: await page.title(),
    snapshot: truncatedText,
    truncated,
    stats: {
      lines: truncatedText.split("\n").length,
      chars: truncatedText.length,
      refs: 0,
      interactive: 0,
    },
  };
}

export async function click(
  pageId: string,
  selector: string,
  options?: {
    button?: "left" | "right" | "middle";
    doubleClick?: boolean;
    modifiers?: string[];
  }
): Promise<void> {
  const page = getPageById(pageId) || getPageById("default");
  if (!page) throw new Error(`Page ${pageId} not found`);

  const locator = page.locator(selector).first();

  if (options?.doubleClick) {
    await locator.dblclick({ button: options.button });
  } else {
    const modifiers = options?.modifiers?.filter(isClickModifier);
    await locator.click({ button: options?.button, modifiers });
  }
}

export async function type(
  pageId: string,
  selector: string,
  text: string,
  options?: { submit?: boolean; clear?: boolean; slowly?: number }
): Promise<void> {
  const page = getPageById(pageId) || getPageById("default");
  if (!page) throw new Error(`Page ${pageId} not found`);

  const locator = page.locator(selector).first();

  if (options?.slowly) {
    await locator.click();
    await page.keyboard.type(text, { delay: options.slowly });
  } else {
    await locator.fill(text);
  }

  if (options?.submit) {
    await locator.press("Enter");
  }
}

export async function pressKey(pageId: string, key: string, delayMs = 0): Promise<void> {
  const page = getPageById(pageId) || getPageById("default");
  if (!page) throw new Error(`Page ${pageId} not found`);

  if (delayMs > 0) {
    await page.keyboard.press(key, { delay: delayMs });
  } else {
    await page.keyboard.press(key);
  }
}

export async function select(pageId: string, selector: string, value: string): Promise<void> {
  const page = getPageById(pageId) || getPageById("default");
  if (!page) throw new Error(`Page ${pageId} not found`);

  await page.locator(selector).first().selectOption(value);
}

export async function selectMultiple(
  pageId: string,
  selector: string,
  values: string[]
): Promise<void> {
  const page = getPageById(pageId) || getPageById("default");
  if (!page) throw new Error(`Page ${pageId} not found`);

  await page.locator(selector).first().selectOption(values);
}

export async function fill(pageId: string, selector: string, value: string): Promise<void> {
  const page = getPageById(pageId) || getPageById("default");
  if (!page) throw new Error(`Page ${pageId} not found`);

  await page.locator(selector).first().fill(value);
}

export async function hover(pageId: string, selector: string): Promise<void> {
  const page = getPageById(pageId) || getPageById("default");
  if (!page) throw new Error(`Page ${pageId} not found`);

  await page.locator(selector).first().hover();
}

export async function scrollIntoView(pageId: string, selector: string): Promise<void> {
  const page = getPageById(pageId) || getPageById("default");
  if (!page) throw new Error(`Page ${pageId} not found`);

  await page.locator(selector).first().scrollIntoViewIfNeeded();
}

export async function drag(
  pageId: string,
  startSelector: string,
  endSelector: string
): Promise<void> {
  const page = getPageById(pageId) || getPageById("default");
  if (!page) throw new Error(`Page ${pageId} not found`);

  const start = page.locator(startSelector).first();
  const end = page.locator(endSelector).first();

  await start.dragTo(end);
}

export async function resize(pageId: string, width: number, height: number): Promise<void> {
  const page = getPageById(pageId) || getPageById("default");
  if (!page) throw new Error(`Page ${pageId} not found`);

  await page.setViewportSize({ width, height });
}

export async function uploadFiles(
  pageId: string,
  paths: string[],
  inputRef?: string
): Promise<void> {
  const page = getPageById(pageId) || getPageById("default");
  if (!page) throw new Error(`Page ${pageId} not found`);

  if (inputRef) {
    const input = page.locator(inputRef).first();
    await input.setInputFiles(paths);
  } else {
    const input = page.locator('input[type="file"]').first();
    await input.setInputFiles(paths);
  }
}

export async function acceptDialog(pageId: string, promptText?: string): Promise<void> {
  const page = getPageById(pageId) || getPageById("default");
  if (!page) throw new Error(`Page ${pageId} not found`);

  page.on("dialog", async (dialog) => {
    if (promptText) {
      await dialog.accept(promptText);
    } else {
      await dialog.accept();
    }
  });
}

export async function dismissDialog(pageId: string): Promise<void> {
  const page = getPageById(pageId) || getPageById("default");
  if (!page) throw new Error(`Page ${pageId} not found`);

  page.on("dialog", async (dialog) => {
    await dialog.dismiss();
  });
}

export async function evaluate<T = unknown>(pageId: string, script: string): Promise<T> {
  const page = getPageById(pageId) || getPageById("default");
  if (!page) throw new Error(`Page ${pageId} not found`);

  // Security: Validate script doesn't contain dangerous patterns before execution
  // This prevents obvious injection attempts from being passed to browser context
  const dangerousPatterns = [
    /eval\s*\(/i,
    /Function\s*\(/i,
    /setTimeout\s*\(\s*['"`]/i,
    /setInterval\s*\(\s*['"`]/i,
    /\.\s*constructor\s*\.\s*constructor/i,
    /__proto__/i,
    /prototype\s*=/i,
  ];

  for (const pattern of dangerousPatterns) {
    if (pattern.test(script)) {
      throw new Error("Security: Script contains potentially dangerous patterns");
    }
  }

  // Execute directly in browser context - Playwright's evaluate already runs this in browser
  // No need for additional eval/Function wrapper
  return await page.evaluate(script);
}

export async function wait(pageId: string, timeMs: number): Promise<void> {
  const page = getPageById(pageId) || getPageById("default");
  if (!page) throw new Error(`Page ${pageId} not found`);

  await page.waitForTimeout(timeMs);
}

export async function waitForSelector(
  pageId: string,
  selector: string,
  options?: { timeout?: number; state?: "visible" | "hidden" | "attached" | "detached" }
): Promise<void> {
  const page = getPageById(pageId) || getPageById("default");
  if (!page) throw new Error(`Page ${pageId} not found`);

  await page.waitForSelector(selector, {
    timeout: options?.timeout || 30000,
    state: options?.state || "visible",
  });
}

export async function waitForText(
  pageId: string,
  text: string,
  options?: { timeout?: number }
): Promise<void> {
  const page = getPageById(pageId) || getPageById("default");
  if (!page) throw new Error(`Page ${pageId} not found`);

  await page.waitForSelector(`text=${text}`, {
    timeout: options?.timeout || 30000,
  });
}

export async function waitForTextGone(
  pageId: string,
  text: string,
  options?: { timeout?: number }
): Promise<void> {
  const page = getPageById(pageId) || getPageById("default");
  if (!page) throw new Error(`Page ${pageId} not found`);

  await page.waitForSelector(`text=${text}`, {
    state: "hidden",
    timeout: options?.timeout || 30000,
  });
}

export async function waitForNavigation(
  pageId: string,
  url?: string,
  options?: { timeout?: number; waitUntil?: "load" | "domcontentloaded" | "networkidle" }
): Promise<void> {
  const page = getPageById(pageId) || getPageById("default");
  if (!page) throw new Error(`Page ${pageId} not found`);

  if (url) {
    await page.waitForURL(url, {
      timeout: options?.timeout || 30000,
    });
  } else {
    await page.waitForLoadState(options?.waitUntil || "networkidle", {
      timeout: options?.timeout || 30000,
    });
  }
}

export async function waitForLoadState(
  pageId: string,
  state: "load" | "domcontentloaded" | "networkidle"
): Promise<void> {
  const page = getPageById(pageId) || getPageById("default");
  if (!page) throw new Error(`Page ${pageId} not found`);

  await page.waitForLoadState(state);
}

export async function closeAll(): Promise<void> {
  await shutdownAll();

  for (const [id, page] of legacyPages) {
    await page.close().catch(() => {});
    legacyPages.delete(id);
  }

  consoleLogs.clear();

  if (legacyContext) {
    await legacyContext.close().catch(() => {});
    legacyContext = null;
  }

  if (legacyBrowser) {
    await legacyBrowser.close().catch(() => {});
    legacyBrowser = null;
  }

  console.log("[Browser] Closed all sessions");
}

export async function getStatus(): Promise<BrowserStatus> {
  try {
    const executablePath = (await getChromium()).executablePath();
    const browsersMap = getBrowsersMap();

    return {
      running: legacyBrowser !== null || browsersMap.size > 0,
      pages: legacyPages.size + Array.from(getPagesMap().values()).length,
      chromiumAvailable: !!executablePath,
      headless: process.env.BROWSER_HEADLESS !== "false",
      profiles: listBrowserProfiles(),
    };
  } catch {
    return {
      running: legacyBrowser !== null,
      pages: legacyPages.size,
      chromiumAvailable: false,
      headless: true,
      profiles: [],
    };
  }
}
