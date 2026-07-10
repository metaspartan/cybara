import { randomUUID } from "crypto";
import type { LaunchOptions } from "playwright";
import { systemLogger } from "../logging";
import {
  browserExecutableLabel,
  browserLaunchArgs,
  buildBrowserLaunchPlan,
  findBundledBrowserExecutable,
  findSystemBrowserExecutable,
  findSystemBrowserExecutables,
} from "./browser-executable";
import {
  type AutomationBrowser as Browser,
  type AutomationContext as BrowserContext,
  automationDriverForPlatform,
  type AutomationLocator as Locator,
  type AutomationPage as Page,
  launchPuppeteerBrowser,
  wrapPlaywrightBrowser,
} from "./automation-driver";
import { findHermeticPlaywrightBrowserPath, getChromium } from "./playwright-loader";
import {
  type BrowserProfile,
  type BrowserProfileConfig,
  closePage as closeProfilePage,
  createProfile,
  createPage as createProfilePage,
  deleteProfile,
  getBrowsersMap,
  getPagesMap,
  getProfile,
  getProfilePages,
  listProfiles,
  shutdownAll,
  startBrowser,
  stopBrowser,
} from "./profiles";

async function launchWithFallback(
  chromium: Awaited<ReturnType<typeof getChromium>>,
  headless: boolean,
  args: string[]
): Promise<Browser> {
  const systemExecutables = findSystemBrowserExecutables();
  const explicitExecutable =
    process.env.CYBARA_BROWSER_PATH?.trim() || process.env.CHROME_PATH?.trim();
  const bundledExecutable = findBundledBrowserExecutable(chromium);
  const attempts: Array<{
    label: string;
    executablePath?: string;
    launch(timeout: number): Promise<Browser>;
  }> = [];

  if (automationDriverForPlatform(process.platform) === "puppeteer") {
    const normalizePath = (value: string) => value.toLowerCase();
    const explicitMatch = explicitExecutable
      ? systemExecutables.find(
          (candidate) => normalizePath(candidate) === normalizePath(explicitExecutable)
        )
      : undefined;
    const executables = [explicitMatch, bundledExecutable, ...systemExecutables]
      .filter((value): value is string => typeof value === "string")
      .filter(
        (value, index, values) =>
          values.findIndex((candidate) => normalizePath(candidate) === normalizePath(value)) ===
          index
      );
    for (const executablePath of executables) {
      const label =
        executablePath === bundledExecutable
          ? "Packaged Chromium"
          : browserExecutableLabel(executablePath);
      attempts.push({
        label,
        executablePath,
        launch: async (timeout) =>
          await launchPuppeteerBrowser({ executablePath, headless, args, timeout }),
      });
    }
  } else {
    const playwrightAttempts: Array<{ label: string; options: LaunchOptions }> = [
      { label: "Packaged Chromium", options: { headless, args } },
    ];
    for (const target of buildBrowserLaunchPlan(
      process.platform,
      explicitExecutable,
      null,
      systemExecutables
    )) {
      playwrightAttempts.push({
        label: target.label,
        options: {
          headless,
          args,
          ...(target.channel ? { channel: target.channel } : {}),
          ...(target.executablePath ? { executablePath: target.executablePath } : {}),
        },
      });
    }
    for (const attempt of playwrightAttempts) {
      attempts.push({
        label: attempt.label,
        executablePath: attempt.options.executablePath,
        launch: async (timeout) =>
          wrapPlaywrightBrowser(await chromium.launch({ ...attempt.options, timeout })),
      });
    }
  }

  const failures: string[] = [];
  const startedAt = Date.now();
  const total = attempts.length;
  let attempted = 0;

  const launchAttempt = async (attempt: (typeof attempts)[number]): Promise<Browser | null> => {
    const remainingMs = BROWSER_LAUNCH_BUDGET_MS - (Date.now() - startedAt);
    if (remainingMs <= 0) return null;
    attempted += 1;
    browserLaunchState = {
      phase: "starting",
      attempt: attempt.label,
      attempted,
      total,
    };
    void systemLogger.info("Starting browser preview", {
      attempt: attempt.label,
      attempted,
      total,
      driver: automationDriverForPlatform(process.platform),
      runtime: `Bun ${Bun.version}`,
      platform: process.platform,
      arch: process.arch,
      executablePath: attempt.executablePath,
    });
    try {
      const browser = await attempt.launch(
        Math.min(BROWSER_LAUNCH_ATTEMPT_TIMEOUT_MS, remainingMs)
      );
      browserLaunchState = {
        phase: "running",
        attempt: attempt.label,
        attempted,
        total,
      };
      return browser;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      failures.push(attempt.label);
      void systemLogger.warn("Browser preview launch attempt failed", {
        attempt: attempt.label,
        error: message,
        executablePath: attempt.executablePath,
      });
      return null;
    }
  };

  for (const attempt of attempts) {
    const browser = await launchAttempt(attempt);
    if (browser) return browser;
  }
  browserLaunchState = {
    phase: "failed",
    attempted,
    total,
    error: failures.length
      ? "Installed browsers could not be started. Open Logs for browser launch details."
      : "No compatible browser was detected.",
  };
  throw new Error(
    `Unable to launch a browser after trying ${failures.join(", ")}. Open Logs for details.`
  );
}

export interface BrowserLaunchState {
  phase: "idle" | "starting" | "running" | "failed";
  attempt?: string;
  attempted?: number;
  total?: number;
  error?: string;
}

const BROWSER_LAUNCH_ATTEMPT_TIMEOUT_MS = 30_000;
const BROWSER_LAUNCH_BUDGET_MS = 60_000;
let browserLaunchState: BrowserLaunchState = { phase: "idle" };

export interface BrowserSnapshotNode {
  ref: string;
  role: string;
  name: string;
  value?: string;
  depth: number;
  selector?: string;
}

interface BrowserDomElement {
  tagName: string;
  nodeType: number;
  localName: string;
  previousElementSibling: BrowserDomElement | null;
  parentElement: BrowserDomElement | null;
  scrollIntoView(options: { block: "center"; inline: "center" }): void;
}

type ClickModifier = "Alt" | "Control" | "ControlOrMeta" | "Meta" | "Shift";

function isClickModifier(value: string): value is ClickModifier {
  return ["Alt", "Control", "ControlOrMeta", "Meta", "Shift"].includes(value);
}

let legacyBrowser: Browser | null = null;
let legacyContext: BrowserContext | null = null;
const legacyPages = new Map<string, Page>();
const consoleLogs = new Map<string, Array<{ type: string; text: string; location?: string }>>();
const pointerStates = new Map<string, BrowserPointerState>();
const BROWSER_PREVIEW_STYLE = `
:root { --cybara-agent-browser-preview: 1; }
button[aria-label^="Cybara pet"] { display: none !important; }
`;

export interface BrowserPointerState {
  x: number;
  y: number;
  visible: boolean;
  updatedAt: number;
  action: "move" | "click" | "type";
  source: "agent" | "user";
}

export interface BrowserViewportSize {
  width: number;
  height: number;
}

export interface BrowserStatus {
  running: boolean;
  pages: number;
  chromiumAvailable: boolean;
  headless: boolean;
  profiles: BrowserProfile[];
  launch: BrowserLaunchState;
}

function resetLegacyBrowserState(): void {
  legacyBrowser = null;
  legacyContext = null;
  legacyBrowserPromise = null;
  legacyContextPromise = null;
  legacyPages.clear();
  consoleLogs.clear();
  pointerStates.clear();
  if (browserLaunchState.phase !== "failed") browserLaunchState = { phase: "idle" };
}

let legacyBrowserPromise: Promise<Browser> | null = null;
let legacyContextPromise: Promise<BrowserContext> | null = null;

async function getLegacyBrowser(): Promise<Browser> {
  if (legacyBrowser) return legacyBrowser;
  if (legacyBrowserPromise) return legacyBrowserPromise;

  legacyBrowserPromise = (async () => {
    const chromium = await getChromium();
    try {
      let browser: Browser;
      if (automationDriverForPlatform(process.platform) === "puppeteer") {
        const launchArgs = browserLaunchArgs();
        const headless = process.env.BROWSER_HEADLESS !== "false";
        browser = await launchWithFallback(chromium, headless, launchArgs);
        console.log("[Browser] Launched new browser instance");
      } else {
        try {
          browser = wrapPlaywrightBrowser(
            await chromium.connectOverCDP("http://127.0.0.1:9222", { timeout: 750 })
          );
          browserLaunchState = { phase: "running", attempt: "existing browser" };
          console.log("[Browser] Connected to existing Chrome instance via CDP");
        } catch {
          const launchArgs = browserLaunchArgs();
          const headless = process.env.BROWSER_HEADLESS !== "false";
          browser = await launchWithFallback(chromium, headless, launchArgs);
          console.log("[Browser] Launched new browser instance");
        }
      }
      browser.onDisconnected(() => {
        console.warn("[Browser] Browser disconnected; clearing cached state");
        resetLegacyBrowserState();
      });
      legacyBrowser = browser;
      return browser;
    } catch (error) {
      legacyBrowserPromise = null;
      const detail = error instanceof Error ? error.message : String(error);
      console.error("[Browser] Failed to launch browser:", error);
      void systemLogger.error("Failed to launch browser preview", { error: detail });
      throw new Error(`Failed to launch browser: ${detail}`);
    }
  })();
  return legacyBrowserPromise;
}

async function getLegacyContext(): Promise<BrowserContext> {
  if (legacyContext) return legacyContext;
  if (legacyContextPromise) return legacyContextPromise;

  legacyContextPromise = (async () => {
    try {
      const bw = await getLegacyBrowser();
      const context = await bw.newContext({
        viewport: { width: 1920, height: 1080 },
      });
      legacyContext = context;
      return context;
    } catch (error) {
      legacyContextPromise = null;
      throw error;
    }
  })();
  return legacyContextPromise;
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

  page.onClose(() => {
    legacyPages.delete(id);
    consoleLogs.delete(id);
    pointerStates.delete(id);
  });

  page.onConsole((msg) => {
    const logs = consoleLogs.get(id) || [];
    logs.push({
      type: msg.type(),
      text: msg.text(),
      location: msg.location()?.url,
    });
    if (logs.length > 500) logs.splice(0, logs.length - 500);
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

export async function getPageSummary(
  pageId: string
): Promise<{ id: string; url: string; title: string } | null> {
  const page = getPageById(pageId) || getPageById("default");
  if (!page) return null;
  return { id: pageId, url: page.url(), title: await page.title() };
}

export async function closePage(id: string): Promise<boolean> {
  const page = legacyPages.get(id);
  if (!page) return false;

  await page.close();
  legacyPages.delete(id);
  consoleLogs.delete(id);
  pointerStates.delete(id);
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

export async function goBack(pageId: string): Promise<{ url: string; title: string }> {
  const page = getPageById(pageId) || getPageById("default");
  if (!page) throw new Error(`Page ${pageId} not found`);
  await page.goBack({ waitUntil: "domcontentloaded", timeout: 30000 });
  return { url: page.url(), title: await page.title() };
}

export async function goForward(pageId: string): Promise<{ url: string; title: string }> {
  const page = getPageById(pageId) || getPageById("default");
  if (!page) throw new Error(`Page ${pageId} not found`);
  await page.goForward({ waitUntil: "domcontentloaded", timeout: 30000 });
  return { url: page.url(), title: await page.title() };
}

export async function reload(pageId: string): Promise<{ url: string; title: string }> {
  const page = getPageById(pageId) || getPageById("default");
  if (!page) throw new Error(`Page ${pageId} not found`);
  await page.reload({ waitUntil: "domcontentloaded", timeout: 30000 });
  return { url: page.url(), title: await page.title() };
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
  await prepareBrowserPreviewPage(page);

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
  nodes?: BrowserSnapshotNode[];
  truncated?: boolean;
  stats?: { lines: number; chars: number; refs: number; interactive: number };
}> {
  const page = getPageById(pageId) || getPageById("default");
  if (!page) throw new Error(`Page ${pageId} not found`);
  await prepareBrowserPreviewPage(page);

  const format = options?.format || "ai";
  const maxChars = options?.maxChars || 8000;
  const interactiveNodes = await getInteractiveSnapshotNodes(page);

  if (format === "aria") {
    return {
      url: page.url(),
      title: await page.title(),
      nodes: interactiveNodes,
      stats: {
        lines: interactiveNodes.length,
        chars: interactiveNodes.reduce((acc, node) => acc + node.name.length + node.role.length, 0),
        refs: interactiveNodes.length,
        interactive: interactiveNodes.length,
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

  const interactionText = interactiveNodes
    .map((node) => `- ${node.role} "${node.name}" [ref=${node.ref}]`)
    .join("\n");
  if (interactionText) {
    snapshotText = `${snapshotText}\n\nInteractive elements\n${interactionText}`;
  }
  const truncated = snapshotText.length > maxChars;
  const truncatedText = truncated
    ? snapshotText.slice(0, maxChars) + "\n... [truncated]"
    : snapshotText;

  return {
    url: page.url(),
    title: await page.title(),
    snapshot: truncatedText,
    nodes: interactiveNodes,
    truncated,
    stats: {
      lines: truncatedText.split("\n").length,
      chars: truncatedText.length,
      refs: interactiveNodes.length,
      interactive: interactiveNodes.length,
    },
  };
}

async function getInteractiveSnapshotNodes(page: Page): Promise<BrowserSnapshotNode[]> {
  const elements = page.locator(
    'a, button, input, textarea, select, [role], [tabindex]:not([tabindex="-1"])'
  );
  const count = Math.min(await elements.count(), 200);
  const nodes: BrowserSnapshotNode[] = [];
  for (let index = 0; index < count; index += 1) {
    const element = elements.nth(index);
    if (!(await element.isVisible().catch(() => false))) continue;
    const tag = await element.evaluate((node) =>
      (node as unknown as BrowserDomElement).tagName.toLowerCase()
    );
    const explicitRole = await element.getAttribute("role");
    const role = explicitRole || elementRoleForTag(tag, await element.getAttribute("type"));
    const name = firstNonEmptyBrowserValue(
      await element.getAttribute("aria-label"),
      await element.getAttribute("placeholder"),
      await element.getAttribute("title"),
      await element.getAttribute("alt"),
      await element.innerText().catch(() => ""),
      await element.getAttribute("value")
    );
    if (!role || !name) continue;
    const selector = await element.evaluate((node) => {
      const segments: string[] = [];
      let current: BrowserDomElement | null = node as unknown as BrowserDomElement;
      while (current && current.nodeType === 1) {
        const name = current.localName;
        let position = 1;
        let sibling = current.previousElementSibling;
        while (sibling) {
          if (sibling.localName === name) position += 1;
          sibling = sibling.previousElementSibling;
        }
        segments.unshift(name + "[" + position + "]");
        current = current.parentElement;
      }
      return "xpath=/" + segments.join("/");
    });
    nodes.push({
      ref: `e${nodes.length + 1}`,
      role,
      name: name.slice(0, 160),
      depth: 0,
      selector,
    });
  }
  return nodes;
}

async function prepareBrowserPreviewPage(page: Page): Promise<void> {
  const existing = page.locator("style").filter({ hasText: "--cybara-agent-browser-preview" });
  if ((await existing.count()) > 0) return;
  await page.addStyleTag({ content: BROWSER_PREVIEW_STYLE });
}

function firstNonEmptyBrowserValue(...values: Array<string | null>): string {
  return values.find((value) => value?.trim())?.trim() ?? "";
}

function elementRoleForTag(tag: string, type: string | null): string {
  if (tag === "a") return "link";
  if (tag === "button") return "button";
  if (tag === "textarea") return "textbox";
  if (tag === "select") return "combobox";
  if (tag !== "input") return tag;
  if (type === "checkbox") return "checkbox";
  if (type === "radio") return "radio";
  if (type === "submit" || type === "button") return "button";
  return "textbox";
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

  const locator = await resolveActionLocator(page, selector);
  await movePointerToLocator(pageId, page, locator);

  if (options?.doubleClick) {
    await locator.dblclick({ button: options.button, timeout: 5000 });
  } else {
    const modifiers = options?.modifiers?.filter(isClickModifier);
    try {
      await locator.click({ button: options?.button, modifiers, timeout: 5000 });
    } catch (error) {
      if (!(await locator.isVisible())) throw error;
      await locator.dispatchEvent("click");
    }
  }
  setPointerAction(pageId, "click");
}

export async function clickAt(pageId: string, x: number, y: number): Promise<void> {
  const page = getPageById(pageId) || getPageById("default");
  if (!page) throw new Error(`Page ${pageId} not found`);
  const viewport = page.viewportSize();
  if (!viewport) throw new Error("Browser viewport is unavailable");
  const targetX = Math.min(viewport.width - 1, Math.max(0, Math.round(x)));
  const targetY = Math.min(viewport.height - 1, Math.max(0, Math.round(y)));
  await movePointer(pageId, page, targetX, targetY, "user");
  await page.mouse.click(targetX, targetY);
  setPointerAction(pageId, "click", "user");
}

export async function scrollPage(pageId: string, deltaX: number, deltaY: number): Promise<void> {
  const page = getPageById(pageId) || getPageById("default");
  if (!page) throw new Error(`Page ${pageId} not found`);
  await page.mouse.wheel(deltaX, deltaY);
}

export async function sendKey(pageId: string, key: string): Promise<void> {
  const page = getPageById(pageId) || getPageById("default");
  if (!page) throw new Error(`Page ${pageId} not found`);
  if (key.length === 1) {
    await page.keyboard.insertText(key);
  } else {
    await page.keyboard.press(key);
  }
  setPointerAction(pageId, "type", "user");
}

export async function type(
  pageId: string,
  selector: string,
  text: string,
  options?: { submit?: boolean; clear?: boolean; slowly?: number }
): Promise<void> {
  const page = getPageById(pageId) || getPageById("default");
  if (!page) throw new Error(`Page ${pageId} not found`);

  const locator = await resolveActionLocator(page, selector);
  await movePointerToLocator(pageId, page, locator);

  if (options?.slowly) {
    await locator.click();
    await page.keyboard.type(text, { delay: options.slowly });
  } else {
    await locator.fill(text);
  }

  if (options?.submit) {
    await locator.press("Enter");
  }
  setPointerAction(pageId, "type");
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

  const locator = await resolveActionLocator(page, selector);
  await movePointerToLocator(pageId, page, locator);
  await locator.selectOption(value);
}

export async function selectMultiple(
  pageId: string,
  selector: string,
  values: string[]
): Promise<void> {
  const page = getPageById(pageId) || getPageById("default");
  if (!page) throw new Error(`Page ${pageId} not found`);

  const locator = await resolveActionLocator(page, selector);
  await movePointerToLocator(pageId, page, locator);
  await locator.selectOption(values);
}

export async function fill(pageId: string, selector: string, value: string): Promise<void> {
  const page = getPageById(pageId) || getPageById("default");
  if (!page) throw new Error(`Page ${pageId} not found`);

  const locator = await resolveActionLocator(page, selector);
  await movePointerToLocator(pageId, page, locator);
  await locator.fill(value);
}

export async function hover(pageId: string, selector: string): Promise<void> {
  const page = getPageById(pageId) || getPageById("default");
  if (!page) throw new Error(`Page ${pageId} not found`);

  const locator = await resolveActionLocator(page, selector);
  await movePointerToLocator(pageId, page, locator);
}

export async function scrollIntoView(pageId: string, selector: string): Promise<void> {
  const page = getPageById(pageId) || getPageById("default");
  if (!page) throw new Error(`Page ${pageId} not found`);

  await (await resolveActionLocator(page, selector)).scrollIntoViewIfNeeded();
}

export async function drag(
  pageId: string,
  startSelector: string,
  endSelector: string
): Promise<void> {
  const page = getPageById(pageId) || getPageById("default");
  if (!page) throw new Error(`Page ${pageId} not found`);

  const start = await resolveActionLocator(page, startSelector);
  const end = await resolveActionLocator(page, endSelector);

  await movePointerToLocator(pageId, page, start);
  await start.dragTo(end);
  await recordPointerFromLocator(pageId, end);
}

async function recordPointerFromLocator(pageId: string, locator: Locator): Promise<void> {
  const box = await locator.boundingBox();
  if (!box) return;
  pointerStates.set(pageId, {
    x: Math.round(box.x + box.width / 2),
    y: Math.round(box.y + box.height / 2),
    visible: true,
    updatedAt: Date.now(),
    action: "move",
    source: "agent",
  });
}

async function resolveActionLocator(page: Page, selector: string): Promise<Locator> {
  const matches = page.locator(selector);
  const count = Math.min(await matches.count(), 100);
  if (count === 0) {
    const first = matches.first();
    await first.waitFor({ state: "visible", timeout: 5000 });
    return first;
  }

  let visible: Locator | null = null;
  for (let index = 0; index < count; index += 1) {
    const candidate = matches.nth(index);
    if (!(await candidate.isVisible())) continue;
    visible ??= candidate;
    await candidate
      .evaluate((element) =>
        (element as unknown as BrowserDomElement).scrollIntoView({
          block: "center",
          inline: "center",
        })
      )
      .catch(() => undefined);
    const box = await candidate.boundingBox();
    const viewport = page.viewportSize();
    if (
      box &&
      viewport &&
      box.x < viewport.width &&
      box.y < viewport.height &&
      box.x + box.width > 0 &&
      box.y + box.height > 0
    ) {
      return candidate;
    }
  }

  if (visible) return visible;
  throw new Error(`No visible element matched selector: ${selector}`);
}

async function movePointerToLocator(pageId: string, page: Page, locator: Locator): Promise<void> {
  await locator.scrollIntoViewIfNeeded().catch(() => undefined);
  const box = await locator.boundingBox();
  if (!box) return;
  const x = Math.round(box.x + box.width / 2);
  const y = Math.round(box.y + box.height / 2);
  await movePointer(pageId, page, x, y, "agent");
}

async function movePointer(
  pageId: string,
  page: Page,
  x: number,
  y: number,
  source: BrowserPointerState["source"]
): Promise<void> {
  const current = pointerStates.get(pageId);
  const startX = current?.x ?? Math.round((page.viewportSize()?.width ?? x) / 2);
  const startY = current?.y ?? Math.round((page.viewportSize()?.height ?? y) / 2);
  const steps = 12;
  for (let step = 1; step <= steps; step += 1) {
    const progress = step / steps;
    const nextX = Math.round(startX + (x - startX) * progress);
    const nextY = Math.round(startY + (y - startY) * progress);
    await page.mouse.move(nextX, nextY);
    pointerStates.set(pageId, {
      x: nextX,
      y: nextY,
      visible: true,
      updatedAt: Date.now(),
      action: "move",
      source,
    });
    if (step < steps) await Bun.sleep(24);
  }
}

function setPointerAction(
  pageId: string,
  action: BrowserPointerState["action"],
  source: BrowserPointerState["source"] = "agent"
): void {
  const pointer = pointerStates.get(pageId);
  if (!pointer) return;
  pointerStates.set(pageId, { ...pointer, action, source, updatedAt: Date.now() });
}

export function getPointerState(pageId: string): BrowserPointerState | null {
  return pointerStates.get(pageId) ?? null;
}

export function getViewportSize(pageId: string): BrowserViewportSize | null {
  const page = getPageById(pageId) || getPageById("default");
  return page?.viewportSize() ?? null;
}

export async function resize(pageId: string, width: number, height: number): Promise<void> {
  const page = getPageById(pageId) || getPageById("default");
  if (!page) throw new Error(`Page ${pageId} not found`);

  const current = page.viewportSize();
  if (current?.width === width && current.height === height) return;
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

  page.onDialog(async (dialog) => {
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

  page.onDialog(async (dialog) => {
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

export async function detectCaptcha(
  pageId: string
): Promise<{ detected: boolean; vendor?: string }> {
  const page = getPageById(pageId) || getPageById("default");
  if (!page) return { detected: false };
  try {
    const vendor = (await page.evaluate(`(function(){
      var h = document.documentElement.outerHTML;
      if (/recaptcha|g-recaptcha|google\\.com\\/recaptcha/i.test(h)) return "reCAPTCHA";
      if (/hcaptcha\\.com|h-captcha/i.test(h)) return "hCaptcha";
      if (/challenges\\.cloudflare\\.com\\/turnstile|cf-turnstile/i.test(h)) return "Cloudflare Turnstile";
      if (/funcaptcha|arkoselabs/i.test(h)) return "FunCaptcha/Arkose";
      return "";
    })()`)) as string;
    return vendor ? { detected: true, vendor } : { detected: false };
  } catch {
    return { detected: false };
  }
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
  }

  if (legacyBrowser) {
    await legacyBrowser.close().catch(() => {});
  }
  resetLegacyBrowserState();

  console.log("[Browser] Closed all sessions");
}

export async function getStatus(): Promise<BrowserStatus> {
  try {
    const chromium = await getChromium();
    const executablePath = findSystemBrowserExecutable() ?? findBundledBrowserExecutable(chromium);
    const hermeticBrowserPath = findHermeticPlaywrightBrowserPath();
    const browsersMap = getBrowsersMap();

    return {
      running: legacyBrowser !== null || browsersMap.size > 0,
      pages: legacyPages.size + Array.from(getPagesMap().values()).length,
      chromiumAvailable: !!executablePath || !!hermeticBrowserPath,
      headless: process.env.BROWSER_HEADLESS !== "false",
      profiles: listBrowserProfiles(),
      launch: browserLaunchState,
    };
  } catch {
    return {
      running: legacyBrowser !== null,
      pages: legacyPages.size,
      chromiumAvailable: false,
      headless: true,
      profiles: [],
      launch: browserLaunchState,
    };
  }
}
