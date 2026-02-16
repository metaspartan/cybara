// Playwright Browser Manager - Moltbot-compatible with Profile Support
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
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
  getPage,
  getProfilePages,
  closePage as closeProfilePage,
  closeAllPages,
  getStatus as getProfileStatus,
  shutdownAll,
  getPagesMap,
  getBrowsersMap,
} from "./profiles";
import { randomUUID } from "crypto";

// Local AXNode interface for accessibility tree (Playwright removed this export)
interface AXNode {
  role?: string;
  name?: string;
  value?: string;
  description?: string;
  children?: AXNode[];
}

// Legacy single-browser mode (for backward compatibility)
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

// Get or create browser instance (legacy mode)
async function getLegacyBrowser(): Promise<Browser> {
  if (legacyBrowser) return legacyBrowser;

  try {
    // Try to connect to existing Chrome/Chromium if available via CDP
    try {
      legacyBrowser = await chromium.connectOverCDP("http://localhost:9222");
      console.log("[Browser] Connected to existing Chrome instance via CDP");
      return legacyBrowser;
    } catch {
      // Fall back to launching new browser
    }

    legacyBrowser = await chromium.launch({
      headless: process.env.BROWSER_HEADLESS !== "false",
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-accelerated-2d-canvas",
        "--disable-gpu",
        "--window-size=1920,1080",
      ],
    });

    console.log("[Browser] Launched new browser instance");
    return legacyBrowser;
  } catch (error) {
    console.error("[Browser] Failed to launch browser:", error);
    throw new Error(
      "Failed to launch browser. Make sure Playwright is installed: bun add playwright"
    );
  }
}

// Get or create legacy browser context
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

// ===== Profile-Based API =====

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
  // Returns Puppeteer Browser (profiles.ts uses puppeteer-core)
  return await startBrowser(name);
}

export async function stopBrowserProfile(name: string): Promise<void> {
  return await stopBrowser(name);
}

export async function createPageInProfile(profileName: string, url?: string): Promise<string> {
  const page = await createProfilePage(profileName, url);
  // createProfilePage returns a Page object - we need a page ID
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

// ===== Legacy Single-Browser API (backward compatible) =====

// Create a new page/tab in legacy mode
export async function createPage(): Promise<string> {
  const ctx = await getLegacyContext();
  const page = await ctx.newPage();
  const id = randomUUID();
  legacyPages.set(id, page);
  consoleLogs.set(id, []);

  // Set up event handlers
  page.on("close", () => {
    legacyPages.delete(id);
    consoleLogs.delete(id);
  });

  // Collect console messages
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

// Get page by ID
export function getPageById(id: string): Page | undefined {
  return legacyPages.get(id);
}

// Get all pages
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

// Close page
export async function closePage(id: string): Promise<boolean> {
  const page = legacyPages.get(id);
  if (!page) return false;

  await page.close();
  legacyPages.delete(id);
  consoleLogs.delete(id);
  return true;
}

// Navigate to URL
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

// Take screenshot
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

// Generate PDF
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

// Get console logs
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

// Get page snapshot (ARIA or AI format)
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
    // ARIA snapshot format - use ariaSnapshot() instead of deprecated accessibility.snapshot()
    let ariaSnapshot: AXNode | null = null;
    try {
      // Try using the new API
      const snapshotStr = await page.locator("body").ariaSnapshot();
      // Parse the ARIA snapshot string into a node structure
      ariaSnapshot = {
        role: "document",
        name: "document",
        children: [{ role: "text", name: snapshotStr }],
      };
    } catch {
      // Fallback: create a simple snapshot from page content
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

  // AI format - text-based snapshot
  let snapshotText: string;

  if (options?.selector) {
    const element = await page.locator(options.selector).first();
    try {
      // Use ariaSnapshot for the element
      snapshotText = await element.ariaSnapshot();
    } catch {
      // Fallback to text content
      snapshotText = await element.innerText().catch(() => "");
    }
  } else {
    try {
      // Use ariaSnapshot for the entire page
      snapshotText = await page.locator("body").ariaSnapshot();
      // Apply depth truncation if specified
      if (options?.depth) {
        const lines = snapshotText.split("\n");
        snapshotText = lines.slice(0, options.depth * 10).join("\n");
      }
    } catch {
      // Fallback to page text content
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

// Format accessibility tree as text
function formatAccessibilityTree(node: AXNode, depth = 0, maxDepth?: number): string {
  if (maxDepth && depth > maxDepth) return "";

  const indent = "  ".repeat(depth);
  let result = "";

  if (node.name || node.role) {
    const role = node.role || "unknown";
    const name = node.name || "";
    const value = node.value ? `="${node.value}"` : "";
    const description = node.description ? ` (${node.description})` : "";

    if (name || role !== "generic") {
      result += `${indent}[${role}]${name ? " " + name : ""}${value}${description}\n`;
    }
  }

  if (node.children) {
    for (const child of node.children) {
      result += formatAccessibilityTree(child, depth + 1, maxDepth);
    }
  }

  return result;
}

// Click element
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
    await locator.click({ button: options?.button, modifiers: options?.modifiers as any });
  }
}

// Type text
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

// Press key
export async function pressKey(pageId: string, key: string, delayMs = 0): Promise<void> {
  const page = getPageById(pageId) || getPageById("default");
  if (!page) throw new Error(`Page ${pageId} not found`);

  if (delayMs > 0) {
    await page.keyboard.press(key, { delay: delayMs });
  } else {
    await page.keyboard.press(key);
  }
}

// Select single option
export async function select(pageId: string, selector: string, value: string): Promise<void> {
  const page = getPageById(pageId) || getPageById("default");
  if (!page) throw new Error(`Page ${pageId} not found`);

  await page.locator(selector).first().selectOption(value);
}

// Select multiple options
export async function selectMultiple(
  pageId: string,
  selector: string,
  values: string[]
): Promise<void> {
  const page = getPageById(pageId) || getPageById("default");
  if (!page) throw new Error(`Page ${pageId} not found`);

  await page.locator(selector).first().selectOption(values);
}

// Fill form fields
export async function fill(pageId: string, selector: string, value: string): Promise<void> {
  const page = getPageById(pageId) || getPageById("default");
  if (!page) throw new Error(`Page ${pageId} not found`);

  await page.locator(selector).first().fill(value);
}

// Hover element
export async function hover(pageId: string, selector: string): Promise<void> {
  const page = getPageById(pageId) || getPageById("default");
  if (!page) throw new Error(`Page ${pageId} not found`);

  await page.locator(selector).first().hover();
}

// Scroll element into view
export async function scrollIntoView(pageId: string, selector: string): Promise<void> {
  const page = getPageById(pageId) || getPageById("default");
  if (!page) throw new Error(`Page ${pageId} not found`);

  await page.locator(selector).first().scrollIntoViewIfNeeded();
}

// Drag and drop
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

// Resize viewport
export async function resize(pageId: string, width: number, height: number): Promise<void> {
  const page = getPageById(pageId) || getPageById("default");
  if (!page) throw new Error(`Page ${pageId} not found`);

  await page.setViewportSize({ width, height });
}

// Upload files
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

// Accept dialog (alert/confirm/prompt)
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

// Dismiss dialog
export async function dismissDialog(pageId: string): Promise<void> {
  const page = getPageById(pageId) || getPageById("default");
  if (!page) throw new Error(`Page ${pageId} not found`);

  page.on("dialog", async (dialog) => {
    await dialog.dismiss();
  });
}

// Evaluate JavaScript
export async function evaluate<T = unknown>(pageId: string, script: string): Promise<T> {
  const page = getPageById(pageId) || getPageById("default");
  if (!page) throw new Error(`Page ${pageId} not found`);

  return await page.evaluate((code) => {
    return eval(code);
  }, script);
}

// Wait for milliseconds
export async function wait(pageId: string, timeMs: number): Promise<void> {
  const page = getPageById(pageId) || getPageById("default");
  if (!page) throw new Error(`Page ${pageId} not found`);

  await page.waitForTimeout(timeMs);
}

// Wait for selector
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

// Wait for text to appear
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

// Wait for text to disappear
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

// Wait for navigation
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

// Wait for load state
export async function waitForLoadState(
  pageId: string,
  state: "load" | "domcontentloaded" | "networkidle"
): Promise<void> {
  const page = getPageById(pageId) || getPageById("default");
  if (!page) throw new Error(`Page ${pageId} not found`);

  await page.waitForLoadState(state);
}

// Close all pages and browser
export async function closeAll(): Promise<void> {
  // Close profile-based pages
  await shutdownAll();

  // Close legacy pages
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

// Get browser status
export async function getStatus(): Promise<BrowserStatus> {
  try {
    const executablePath = chromium.executablePath();

    const profileStatus = await getProfileStatus();
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
