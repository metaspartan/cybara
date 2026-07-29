import { existsSync, mkdirSync, writeFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import {
  browserViewportPreset,
  inferBrowserViewportMode,
  isBrowserViewportMode,
} from "../../../../shared/browser-viewport";
import { validateUrl } from "../../../api/security";
import {
  fillField,
  getDomText,
  getFullAccessibilityTree,
  hoverElement,
  type RefInfo,
  scrollIntoView,
  selectOption,
  waitFor,
} from "../../browser/cdp-helpers";
import * as profileManager from "../../browser/profiles";
import * as pwManager from "../../browser/pw-manager";
import { CONTENT_ROLES, INTERACTIVE_ROLES, STRUCTURAL_ROLES } from "../../browser/pw-role-snapshot";
import { fetchPublicHttpUrl, type PublicHttpFetcher } from "../../outbound-url-policy";
import type { ToolContext } from "../index";
import { getWebResearchRuntimeEnv } from "../../web-research-settings";
import { enforceWebFetchAllowlist } from "./web-policy";
import {
  extractFirecrawl,
  extractParallel,
  firecrawlConfigured,
  parallelConfigured,
} from "./web-research-providers";

const SCREENSHOTS_DIR = join(
  process.env.HOME || process.env.USERPROFILE || homedir(),
  ".cybara",
  "screenshots"
);

const sessionPages = new Map<string, string>();

interface ElementRef {
  selector: string;
  role: string;
  name?: string;
  xpath?: string;
}
const sessionElementRefs = new Map<string, Map<string, ElementRef>>();

function getSessionRefs(sessionId: string): Map<string, ElementRef> {
  let refs = sessionElementRefs.get(sessionId);
  if (!refs) {
    refs = new Map();
    sessionElementRefs.set(sessionId, refs);
  }
  return refs;
}

function clearSessionRefs(sessionId: string): void {
  sessionElementRefs.delete(sessionId);
}

function resolveSessionSelector(sessionId: string, value: string): string {
  return getSessionRefs(sessionId).get(value)?.selector || value;
}

export function getBrowserPageIdForSession(sessionId: string): string | null {
  const pageId = sessionPages.get(sessionId);
  if (!pageId) return null;
  if (pwManager.getPageById(pageId)) return pageId;
  sessionPages.delete(sessionId);
  return null;
}

const sessionPageCreations = new Map<string, Promise<string>>();

export async function getOrCreateBrowserPageForSession(sessionId: string): Promise<string> {
  const existing = sessionPages.get(sessionId);
  if (existing && pwManager.getPageById(existing)) return existing;

  const inFlight = sessionPageCreations.get(sessionId);
  if (inFlight) return inFlight;

  const creation = (async () => {
    try {
      const pageId = await pwManager.createPage();
      sessionPages.set(sessionId, pageId);
      return pageId;
    } finally {
      sessionPageCreations.delete(sessionId);
    }
  })();
  sessionPageCreations.set(sessionId, creation);
  return creation;
}

export function releaseBrowserPage(pageId: string): void {
  for (const [sessionId, sessionPageId] of sessionPages.entries()) {
    if (sessionPageId === pageId) sessionPages.delete(sessionId);
  }
}

function useEmbeddedBrowser(args: Record<string, unknown>): boolean {
  return (
    args.headless !== false &&
    args.headless !== "false" &&
    args.visual !== true &&
    args.visual !== "true"
  );
}

function normalizeBrowserNavigationUrl(url: string): string {
  const input = url.trim();
  if (!input) throw new Error("Invalid URL: URL is empty");
  const hasProtocol = /^[a-z][a-z\d+.-]*:\/\//i.test(input);
  const candidate = hasProtocol ? input : `https://${input}`;
  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    throw new Error(`Invalid URL: ${url}`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`Invalid URL: unsupported protocol ${parsed.protocol}`);
  }
  if (!hasProtocol && isLocalBrowserHostname(parsed.hostname)) parsed.protocol = "http:";
  return parsed.toString();
}

function isLocalBrowserHostname(value: string): boolean {
  const hostname = value.toLowerCase().replace(/^\[|\]$/g, "");
  if (hostname === "localhost" || hostname === "::1" || hostname.endsWith(".local")) return true;
  if (
    hostname.startsWith("127.") ||
    hostname.startsWith("10.") ||
    hostname.startsWith("192.168.") ||
    hostname.startsWith("fc") ||
    hostname.startsWith("fd")
  ) {
    return true;
  }
  const secondOctet = Number(hostname.split(".")[1]);
  return hostname.startsWith("172.") && secondOctet >= 16 && secondOctet <= 31;
}

async function getVisualPage(
  sessionId: string
): Promise<Awaited<ReturnType<typeof profileManager.getActivePage>>> {
  const profileName = sessionId;

  const profile = profileManager.getProfile(profileName);
  if (!profile?.running) {
    console.log(`[Browser] Starting visual browser for session: ${sessionId}`);
    await profileManager.startBrowser(profileName);
  }

  return await profileManager.getActivePage(profileName);
}

export async function validateBrowserNavigationUrl(
  url: string,
  action: "Navigation" | "Request" = "Navigation"
): Promise<string> {
  const normalizedUrl = normalizeBrowserNavigationUrl(url);
  if (action === "Navigation" && isLocalBrowserHostname(new URL(normalizedUrl).hostname)) {
    return normalizedUrl;
  }

  const urlValidation = await validateUrl(normalizedUrl);
  if (!urlValidation.valid) {
    throw new Error(`Validation error: ${action} blocked: ${urlValidation.error}`);
  }

  if (action === "Request") enforceWebFetchAllowlist(normalizedUrl);
  return normalizedUrl;
}

export async function handleBrowser(
  args: Record<string, unknown>,
  context?: ToolContext
): Promise<unknown> {
  const action = args.action as string;
  const sessionId = context?.sessionId?.trim() || (args.sessionId as string) || "default";

  switch (action) {
    case "status": {
      const status = await pwManager.getStatus();
      return {
        available: status.chromiumAvailable,
        running: status.running,
        pages: status.pages,
        headless: status.headless,
        message: status.chromiumAvailable
          ? "Browser automation available via Playwright"
          : "Playwright not installed. Run: bun add playwright",
      };
    }

    case "start": {
      const status = await pwManager.getStatus();
      if (!status.chromiumAvailable) {
        throw new Error("Playwright not installed. Run: bun add playwright");
      }

      const useHeadless = useEmbeddedBrowser(args);
      const url = args.url as string | undefined;
      const profileName = (args.profile as string) || sessionId;

      console.log(
        `[Browser] Start requested - headless: ${args.headless}, useHeadless: ${useHeadless}, url: ${url}`
      );

      if (useHeadless) {
        const pageId = await getOrCreateBrowserPageForSession(sessionId);

        if (url) {
          const navigationUrl = await validateBrowserNavigationUrl(url);
          await pwManager.navigate(pageId, navigationUrl, { waitUntil: "domcontentloaded" });
        }

        return {
          success: true,
          mode: "headless",
          message: "Browser started in the embedded chat preview",
          pageId,
          url: url || undefined,
        };
      }

      console.log(`[Browser] Starting VISUAL browser with profile: ${profileName}`);
      await profileManager.startBrowser(profileName);
      const profile = profileManager.getProfile(profileName);

      if (url) {
        const navigationUrl = await validateBrowserNavigationUrl(url);
        await profileManager.createPage(profileName, navigationUrl);
        console.log(`[Browser] Started browser and navigated to ${url}`);
        return {
          success: true,
          mode: "visual",
          profile: profileName,
          cdpUrl: profile?.cdpUrl,
          userDataDir: profile?.userDataDir,
          url,
          message: `Visual browser started and navigated to ${url}. Use browser({ action: 'open', url }) for future navigation.`,
        };
      }

      console.log(`[Browser] Browser started. Use action='open' with url to load a page.`);
      return {
        success: true,
        mode: "visual",
        profile: profileName,
        cdpUrl: profile?.cdpUrl,
        userDataDir: profile?.userDataDir,
        message: `Browser started (profile: ${profileName}). To open a URL, use: browser({ action: 'open', url: 'https://example.com' })`,
      };
    }

    case "stop": {
      const pageId = sessionPages.get(sessionId);
      if (pageId) {
        await pwManager.closePage(pageId);
        sessionPages.delete(sessionId);
      }
      return {
        success: true,
        message: "Browser stopped",
      };
    }

    case "close": {
      const pageId = sessionPages.get(sessionId);
      if (pageId) {
        await pwManager.closePage(pageId);
        sessionPages.delete(sessionId);
      }
      return {
        success: true,
        message: "Browser closed",
      };
    }

    case "close_all": {
      await pwManager.closeAll();
      sessionPages.clear();
      return {
        success: true,
        message: "All browser pages and tabs closed",
      };
    }

    case "profiles": {
      const profiles = profileManager.listProfiles();
      return {
        success: true,
        profiles: profiles.map((p) => ({
          name: p.name,
          cdpPort: p.cdpPort,
          cdpUrl: p.cdpUrl,
          color: p.color,
          running: p.running,
          userDataDir: p.userDataDir,
        })),
      };
    }

    case "createProfile": {
      const name = args.name as string;
      const color = args.color as string;

      if (!name) throw new Error("Profile name required");

      const profile = await profileManager.createProfile({
        name,
        color,
      });

      return {
        success: true,
        profile: {
          name: profile.name,
          cdpPort: profile.cdpPort,
          cdpUrl: profile.cdpUrl,
          color: profile.color,
          userDataDir: profile.userDataDir,
        },
        message: `Profile "${name}" created with CDP port ${profile.cdpPort}`,
      };
    }

    case "deleteProfile": {
      const name = args.name as string;
      if (!name) throw new Error("Profile name required");

      await profileManager.deleteProfile(name);
      return {
        success: true,
        message: `Profile "${name}" deleted`,
      };
    }

    case "startProfile": {
      const name = args.name as string;
      if (!name) throw new Error("Profile name required");

      await profileManager.startBrowser(name);
      return {
        success: true,
        message: `Browser started for profile "${name}"`,
      };
    }

    case "stopProfile": {
      const name = args.name as string;
      if (!name) throw new Error("Profile name required");

      await profileManager.stopBrowser(name);
      return {
        success: true,
        message: `Browser stopped for profile "${name}"`,
      };
    }

    case "profileTabs": {
      const name = (args.profile as string) || sessionId;
      const tabs = profileManager.getProfilePages(name);
      return {
        success: true,
        profile: name,
        tabs,
      };
    }

    case "openProfileTab": {
      const name = (args.profile as string) || sessionId;
      const url = args.url as string;
      if (!url) throw new Error("URL required for openProfileTab action");
      const navigationUrl = await validateBrowserNavigationUrl(url);

      const page = await profileManager.createPage(name, navigationUrl);
      return {
        success: true,
        profile: name,
        pageId: page,
        url: navigationUrl,
        message: `Opened ${navigationUrl} in profile "${name}"`,
      };
    }

    case "closeProfileTab": {
      const name = (args.profile as string) || sessionId;
      const pageId = args.pageId as string;
      if (!pageId) throw new Error("pageId required for closeProfileTab action");

      const closed = await profileManager.closePage(name, pageId);
      if (!closed) throw new Error(`Page ${pageId} not found in profile "${name}"`);

      return {
        success: true,
        profile: name,
        pageId,
        message: `Closed page ${pageId} in profile "${name}"`,
      };
    }

    case "tabs": {
      const pageId = getBrowserPageIdForSession(sessionId);
      const tabs = (await pwManager.getAllPages()).filter((tab) => !pageId || tab.id === pageId);
      return {
        success: true,
        tabs,
      };
    }

    case "open": {
      const url = args.url as string;
      if (!url) throw new Error("URL required for open action");
      const navigationUrl = await validateBrowserNavigationUrl(url);

      const useHeadless = useEmbeddedBrowser(args);

      if (useHeadless) {
        const pageId = await getOrCreateBrowserPageForSession(sessionId);
        const result = await pwManager.navigate(pageId, navigationUrl, {
          waitUntil:
            (args.waitUntil as "load" | "domcontentloaded" | "networkidle") || "domcontentloaded",
        });
        return {
          success: true,
          mode: "headless",
          pageId,
          ...result,
        };
      }

      const profileName = (args.profile as string) || sessionId;
      console.log(`[Browser] Opening ${navigationUrl} in visual mode (profile: ${profileName})`);

      let profile = profileManager.getProfile(profileName);
      if (!profile?.running) {
        await profileManager.startBrowser(profileName);
        profile = profileManager.getProfile(profileName);
      }

      await profileManager.createPage(profileName, navigationUrl);

      return {
        success: true,
        mode: "visual",
        profile: profileName,
        cdpUrl: profile?.cdpUrl,
        userDataDir: profile?.userDataDir,
        url: navigationUrl,
        message: `Opened ${navigationUrl} in visible Chrome window (profile: ${profileName})`,
      };
    }

    case "openVisual": {
      const url = args.url as string;
      if (!url) throw new Error("URL required for openVisual action");
      const navigationUrl = await validateBrowserNavigationUrl(url);

      const profileName = (args.profile as string) || sessionId;
      console.log(`[Browser] openVisual: Opening ${navigationUrl} (profile: ${profileName})`);

      let profile = profileManager.getProfile(profileName);
      if (!profile?.running) {
        await profileManager.startBrowser(profileName);
        profile = profileManager.getProfile(profileName);
      }

      await profileManager.createPage(profileName, navigationUrl);

      return {
        success: true,
        mode: "visual",
        profile: profileName,
        cdpUrl: profile?.cdpUrl,
        userDataDir: profile?.userDataDir,
        url: navigationUrl,
        message: `Opened ${navigationUrl} in visible Chrome (profile: ${profileName})`,
      };
    }

    case "focus": {
      const targetId = args.targetId as string;
      if (!targetId) throw new Error("targetId required for focus action");

      const pages = await pwManager.getAllPages();
      const tab = pages.find((t: { id: string }) => t.id === targetId);
      if (!tab) throw new Error(`Tab not found: ${targetId}`);

      return {
        success: true,
        targetId,
        message: `Focused tab: ${targetId}`,
      };
    }

    case "navigate": {
      const url = args.url as string;
      if (!url) throw new Error("URL required for navigate action");
      const navigationUrl = await validateBrowserNavigationUrl(url);

      const useHeadless = useEmbeddedBrowser(args);
      const profileName = (args.profile as string) || sessionId;

      if (useHeadless) {
        const pageId = await getOrCreateBrowserPageForSession(sessionId);
        const result = await pwManager.navigate(pageId, navigationUrl, {
          waitUntil:
            (args.waitUntil as "load" | "domcontentloaded" | "networkidle") || "domcontentloaded",
        });
        return {
          success: true,
          mode: "headless",
          ...result,
        };
      }

      console.log(
        `[Browser] Navigating to ${navigationUrl} in visual mode (profile: ${profileName})`
      );

      let profile = profileManager.getProfile(profileName);
      if (!profile?.running) {
        await profileManager.startBrowser(profileName);
        profile = profileManager.getProfile(profileName);
      }

      await profileManager.createPage(profileName, navigationUrl);

      return {
        success: true,
        mode: "visual",
        profile: profileName,
        url: navigationUrl,
        message: `Navigated to ${navigationUrl} in visible Chrome (profile: ${profileName})`,
      };
    }

    case "snapshot": {
      const useHeadless = useEmbeddedBrowser(args);
      const waitForContent = args.wait !== false;

      if (useHeadless) {
        const pageId = await getOrCreateBrowserPageForSession(sessionId);
        const format =
          (args.snapshotFormat as "aria" | "ai") || (args.format as "aria" | "ai") || "ai";
        const result = await pwManager.getSnapshot(pageId, {
          format,
          maxChars: (args.maxChars as number) || 8000,
          compact: args.compact === true,
          interactive: args.interactive === true,
          depth: (args.depth as number) || undefined,
          selector: (args.selector as string) || undefined,
          refs: (args.refs as "aria" | "role") || "role",
        });
        clearSessionRefs(sessionId);
        const refs = getSessionRefs(sessionId);
        for (const node of result.nodes ?? []) {
          if (node.selector) {
            refs.set(node.ref, {
              selector: node.selector,
              role: node.role,
              name: node.name || undefined,
            });
          }
        }

        const captcha = await pwManager.detectCaptcha(pageId);

        return {
          success: true,
          mode: "headless",
          format,
          ...result,
          captchaDetected: captcha.detected,
          ...(captcha.detected ? { captchaVendor: captcha.vendor } : {}),
        };
      }

      const page = await getVisualPage(sessionId);
      console.log(`[Browser] Taking snapshot in visual mode for session: ${sessionId}`);

      if (waitForContent) {
        try {
          await Promise.race([
            page.waitForNetworkIdle({ timeout: 8000, idleTime: 500 }),
            new Promise((resolve) => setTimeout(resolve, 8000)),
          ]);
          await new Promise((resolve) => setTimeout(resolve, 300));
        } catch {
          console.log(`[Browser] Network idle wait timeout, continuing with available content`);
        }
      }

      const url = page.url();
      const title = await page.title();

      clearSessionRefs(sessionId);
      const refs = getSessionRefs(sessionId);

      const interactiveOnly = args.interactive === true;
      const compactMode = args.compact === true;
      const maxDepth = typeof args.depth === "number" ? args.depth : undefined;

      const snapshotLines: string[] = [];
      let refCounter = 0;

      try {
        const axNodes = await getFullAccessibilityTree(page, 1000);
        console.log(`[Browser] CDP getFullAXTree returned ${axNodes.length} nodes`);

        for (const node of axNodes) {
          const role = node.role || "";
          const name = node.name || "";
          const value = node.value || "";
          const depth = node.depth || 0;

          if (maxDepth !== undefined && depth > maxDepth) continue;

          const indent = "  ".repeat(depth);
          const roleLower = role.toLowerCase();

          const isGeneric =
            STRUCTURAL_ROLES.has(roleLower) || role === "none" || role === "unknown" || !role;
          const isContent = CONTENT_ROLES.has(roleLower);
          const isInteractive = INTERACTIVE_ROLES.has(roleLower);

          const isText =
            roleLower === "statictext" || roleLower === "text" || roleLower === "inlinetextbox";

          if (interactiveOnly && !isInteractive) continue;

          if (compactMode && isGeneric && !name) continue;

          if (isGeneric && !name && !value && !isText) continue;
          if (isText && !name && !value) continue;

          let line = `${indent}- ${role}`;
          if (name) {
            line += ` "${name.slice(0, 100)}${name.length > 100 ? "..." : ""}"`;
          }
          if (value && value !== name) {
            line += ` value="${value.slice(0, 50)}${value.length > 50 ? "..." : ""}"`;
          }

          if (isInteractive) {
            refCounter++;
            const refId = `e${refCounter}`;
            line += ` [ref=${refId}]`;
            refs.set(refId, { selector: "", role, name: name || undefined });
          }

          if (isContent && name && !isInteractive) {
            refCounter++;
            const refId = `e${refCounter}`;
            line += ` [ref=${refId}]`;
            refs.set(refId, { selector: "", role, name });
          }

          snapshotLines.push(line);
        }
      } catch (err) {
        console.log(`[Browser] CDP Accessibility.getFullAXTree failed:`, err);
      }

      console.log(`[Browser] Adding DOM text supplement for data extraction...`);
      try {
        const domText = await getDomText(page, { format: "text", maxChars: 80000 });
        if (domText.trim()) {
          const textLines = domText
            .split("\n")
            .map((l) => l.trim())
            .filter((l) => l.length > 0 && l.length < 500);

          if (textLines.length > 0) {
            snapshotLines.push("");
            snapshotLines.push("## Page Text Content");
            snapshotLines.push("");
            snapshotLines.push(...textLines.slice(0, 800));
          }
        }
      } catch (domErr) {
        console.log(`[Browser] getDomText failed:`, domErr);
      }

      const maxChars = (args.maxChars as number) || 30000;
      let snapshot = snapshotLines.join("\n");
      const truncated = snapshot.length > maxChars;
      if (truncated) {
        snapshot = snapshot.slice(0, maxChars) + "\n\n[...TRUNCATED - page too large]";
      }

      let captchaLine = "";
      try {
        const vendor = (await page.evaluate(`(function(){
          var h = document.documentElement.outerHTML;
          if (/recaptcha|g-recaptcha|google\\.com\\/recaptcha/i.test(h)) return "reCAPTCHA";
          if (/hcaptcha\\.com|h-captcha/i.test(h)) return "hCaptcha";
          if (/challenges\\.cloudflare\\.com\\/turnstile|cf-turnstile/i.test(h)) return "Cloudflare Turnstile";
          if (/funcaptcha|arkoselabs/i.test(h)) return "FunCaptcha/Arkose";
          return "";
        })()`)) as string;
        if (vendor) {
          captchaLine = `# ⚠ CAPTCHA detected (${vendor}) — automated interaction will likely be blocked\n`;
        }
      } catch {}

      const usageHint = `# Page: ${title}\n# URL: ${url}\n${captchaLine}# Interactive elements have [ref=eN] - use browser({action:'act', request:{kind:'click', ref:'eN'}}) to interact\n\n`;

      console.log(
        `[Browser] Snapshot stats: ${snapshotLines.length} lines, ${snapshot.length} chars, truncated=${truncated}`
      );

      const fullSnapshot = usageHint + snapshot;
      return fullSnapshot;
    }

    case "screenshot": {
      const useHeadless = useEmbeddedBrowser(args);

      if (useHeadless) {
        const pageId = await getOrCreateBrowserPageForSession(sessionId);
        const format = (args.type as "png" | "jpeg") || "png";
        const screenshotOptions: {
          fullPage: boolean;
          selector?: string;
          type: "png" | "jpeg";
          quality?: number;
        } = {
          fullPage: args.fullPage === true,
          selector: (args.selector as string) || undefined,
          type: format,
        };
        if (format === "jpeg") screenshotOptions.quality = (args.quality as number) || 92;
        const screenshot = await pwManager.screenshot(pageId, screenshotOptions);

        const mimeType = format === "jpeg" ? "image/jpeg" : "image/png";

        const timestamp = Date.now();
        const filename = `screenshot_${timestamp}.${format}`;

        if (!existsSync(SCREENSHOTS_DIR)) {
          mkdirSync(SCREENSHOTS_DIR, { recursive: true });
        }

        const filePath = join(SCREENSHOTS_DIR, filename);
        writeFileSync(filePath, screenshot);
        console.log(`[Browser] Screenshot saved to: ${filePath}`);

        return {
          success: true,
          mode: "headless",
          filePath: filePath,
          filename: filename,
          contentType: mimeType,
          message: `Screenshot saved to ${filePath}. To read text from the screenshot, use ocr({path: "${filePath}"})`,
        };
      }

      const page = await getVisualPage(sessionId);
      console.log(`[Browser] Taking screenshot in visual mode for session: ${sessionId}`);

      const screenshotOptions: {
        fullPage?: boolean;
        type?: "png" | "jpeg";
        quality?: number;
      } = {
        fullPage: args.fullPage === true,
        type: (args.type as "png" | "jpeg") || "png",
      };
      if (screenshotOptions.type === "jpeg") {
        screenshotOptions.quality = (args.quality as number) || 92;
      }

      const selector = args.selector as string | undefined;
      let screenshotData: Uint8Array | Buffer;

      if (selector) {
        const element = await page.$(selector);
        if (!element) throw new Error(`Element not found: ${selector}`);
        screenshotData = await element.screenshot(screenshotOptions);
      } else {
        screenshotData = await page.screenshot(screenshotOptions);
      }

      const screenshot = Buffer.from(screenshotData);
      const format = (args.type as "png" | "jpeg") || "png";
      const mimeType = format === "jpeg" ? "image/jpeg" : "image/png";

      const timestamp = Date.now();
      const filename = `screenshot_${timestamp}.${format}`;

      if (!existsSync(SCREENSHOTS_DIR)) {
        mkdirSync(SCREENSHOTS_DIR, { recursive: true });
      }

      const filePath = join(SCREENSHOTS_DIR, filename);
      writeFileSync(filePath, screenshot);
      console.log(`[Browser] Screenshot saved to: ${filePath}`);

      return {
        success: true,
        mode: "visual",
        filePath: filePath,
        filename: filename,
        contentType: mimeType,
        message: `Screenshot saved to ${filePath}. To read text from the screenshot, use ocr({path: "${filePath}"})`,
      };
    }

    case "pdf": {
      const pageId = await getOrCreateBrowserPageForSession(sessionId);
      const pdf = await pwManager.pdf(pageId, {
        format: (args.format as "letter" | "a4") || "a4",
        landscape: args.landscape === true,
        printBackground: args.printBackground !== false,
      });

      const base64 = pdf.toString("base64");
      return {
        success: true,
        pdf: base64,
        contentType: "application/pdf",
        message: "PDF generated",
      };
    }

    case "console": {
      const pageId = await getOrCreateBrowserPageForSession(sessionId);
      const consoleLogs = await pwManager.getConsoleLogs(pageId, {
        type: (args.type as string) || undefined,
      });

      return {
        success: true,
        logs: consoleLogs,
        message: `Retrieved ${consoleLogs.length} console messages`,
      };
    }

    case "upload": {
      const paths = args.paths as string[];
      if (!paths || !Array.isArray(paths))
        throw new Error("paths array required for upload action");

      const pageId = await getOrCreateBrowserPageForSession(sessionId);
      const inputRef = args.inputRef as string;
      await pwManager.uploadFiles(pageId, paths, inputRef);

      return {
        success: true,
        paths,
        message: `Uploaded ${paths.length} file(s)`,
      };
    }

    case "dialog": {
      const accept = args.accept as boolean;
      const promptText = args.promptText as string;

      const pageId = sessionPages.get(sessionId);
      if (!pageId) throw new Error("No active page for dialog action");

      if (accept) {
        await pwManager.acceptDialog(pageId, promptText);
      } else {
        await pwManager.dismissDialog(pageId);
      }

      return {
        success: true,
        accept,
        message: accept ? "Dialog accepted" : "Dialog dismissed",
      };
    }

    case "act": {
      const request = (args.request as Record<string, unknown>) || args;
      const kind = (request.kind as string) || (args.kind as string);
      if (!kind)
        throw new Error("kind required for act action (use request.kind or kind directly)");

      const rawRef = (request.ref as string) || (args.ref as string);
      let resolvedSelector = rawRef;

      if (rawRef && /^e\d+$/.test(rawRef)) {
        const refs = getSessionRefs(sessionId);
        const elementRef = refs.get(rawRef);
        if (elementRef) {
          resolvedSelector = elementRef.selector;
          console.log(`[Browser] Resolved ref ${rawRef} to selector: ${resolvedSelector}`);
        } else {
          console.log(
            `[Browser] Warning: ref ${rawRef} not found in session refs. Using as literal selector.`
          );
        }
      }

      const useHeadless = useEmbeddedBrowser(args);

      if (useHeadless) {
        const pageId = await getOrCreateBrowserPageForSession(sessionId);

        switch (kind) {
          case "click": {
            if (!resolvedSelector) throw new Error("ref required for click action");
            await pwManager.click(pageId, resolvedSelector, {
              button: (request.button as "left" | "right" | "middle") || "left",
              doubleClick: request.doubleClick === true,
              modifiers: (request.modifiers as string[]) || undefined,
            });
            return { success: true, kind: "click", ref: rawRef, selector: resolvedSelector };
          }

          case "type": {
            const text = (request.text as string) || (args.text as string);
            if (!resolvedSelector) throw new Error("ref required for type action");
            if (typeof text !== "string") throw new Error("text required for type action");
            await pwManager.type(pageId, resolvedSelector, text, {
              submit: request.submit === true,
              clear: request.clear !== false,
              slowly: request.slowly === true ? 100 : undefined,
            });
            return { success: true, kind: "type", ref: rawRef, text };
          }

          case "press": {
            const key = (request.key as string) || (args.key as string);
            if (!key) throw new Error("key required for press action");
            await pwManager.pressKey(pageId, key, (request.delayMs as number) || 0);
            return { success: true, kind: "press", key };
          }

          default:
            throw new Error(`Unknown act kind: ${kind}`);
        }
      }

      const page = await getVisualPage(sessionId);
      console.log(`[Browser] Executing act ${kind} in visual mode`);

      switch (kind) {
        case "click": {
          if (!resolvedSelector) throw new Error("ref required for click action");
          try {
            const selectors = resolvedSelector.split(", ");
            let clicked = false;
            for (const sel of selectors) {
              try {
                await page.click(sel.trim());
                clicked = true;
                break;
              } catch {
                continue;
              }
            }
            if (!clicked) {
              const refs = getSessionRefs(sessionId);
              const elementRef = refs.get(rawRef);
              if (elementRef?.name) {
                await page.evaluate(`
                  (function() {
                    const name = ${JSON.stringify(elementRef.name)};
                    const el = document.querySelector('[aria-label*="' + name.slice(0, 30) + '"]') ||
                               Array.from(document.querySelectorAll('button, a, [role="button"], [role="link"]'))
                                 .find(e => e.textContent?.includes(name.slice(0, 30)));
                    if (el) el.click();
                    else throw new Error('Element not found');
                  })()
                `);
              } else {
                throw new Error(`Could not find element for ref ${rawRef}`);
              }
            }
          } catch (err) {
            throw new Error(`Click failed for ref ${rawRef}: ${err}`);
          }
          return { success: true, kind: "click", ref: rawRef };
        }

        case "type": {
          const text = (request.text as string) || (args.text as string);
          if (!resolvedSelector) throw new Error("ref required for type action");
          if (typeof text !== "string") throw new Error("text required for type action");

          try {
            const selectors = resolvedSelector.split(", ");
            let typed = false;
            for (const sel of selectors) {
              try {
                const element = await page.$(sel.trim());
                if (element) {
                  if (request.clear !== false) {
                    await element.focus();
                    const selectModifier = process.platform === "darwin" ? "Meta" : "Control";
                    await page.keyboard.down(selectModifier);
                    await page.keyboard.press("A");
                    await page.keyboard.up(selectModifier);
                  }
                  await element.type(text, { delay: request.slowly === true ? 100 : 0 });
                  if (request.submit === true) {
                    await page.keyboard.press("Enter");
                  }
                  typed = true;
                  break;
                }
              } catch {
                continue;
              }
            }
            if (!typed) {
              throw new Error(`Could not find input element for ref ${rawRef}`);
            }
          } catch (err) {
            throw new Error(`Type failed for ref ${rawRef}: ${err}`);
          }
          return { success: true, kind: "type", ref: rawRef, text };
        }

        case "press": {
          const key = (request.key as string) || (args.key as string);
          if (!key) throw new Error("key required for press action");
          await page.keyboard.press(key as import("puppeteer-core").KeyInput);
          return { success: true, kind: "press", key };
        }

        case "hover": {
          if (!rawRef) throw new Error("ref required for hover action");
          const refs = getSessionRefs(sessionId);
          const refInfo = refs.get(rawRef);
          if (refInfo) {
            const info: RefInfo = { role: refInfo.role, name: refInfo.name };
            const success = await hoverElement(page, info);
            if (!success) {
              if (resolvedSelector) await page.hover(resolvedSelector);
            }
          } else if (resolvedSelector) {
            await page.hover(resolvedSelector);
          } else {
            throw new Error(`ref ${rawRef} not found`);
          }
          return { success: true, kind: "hover", ref: rawRef };
        }

        case "scroll": {
          if (rawRef) {
            const refs = getSessionRefs(sessionId);
            const refInfo = refs.get(rawRef);
            if (refInfo) {
              const info: RefInfo = { role: refInfo.role, name: refInfo.name };
              await scrollIntoView(page, info);
            } else if (resolvedSelector) {
              await page.evaluate(
                `document.querySelector('${resolvedSelector.replace(/'/g, "\\'")}')?.scrollIntoView({ behavior: 'smooth' })`
              );
            }
          } else {
            await page.evaluate(`window.scrollBy(0, 300)`);
          }
          return { success: true, kind: "scroll", ref: rawRef };
        }

        case "wait": {
          const timeMs = (request.timeMs as number) || (args.timeMs as number);
          const text = (request.text as string) || (args.text as string);
          const textGone = (request.textGone as string) || (args.textGone as string);
          const selector = (request.selector as string) || (args.selector as string);
          const url = (request.url as string) || (args.url as string);
          const networkIdle = request.networkIdle === true || args.networkIdle === true;
          const timeoutMs = (request.timeoutMs as number) || (args.timeoutMs as number) || 20000;

          await waitFor(page, { timeMs, text, textGone, selector, url, networkIdle, timeoutMs });
          return { success: true, kind: "wait", timeMs, text, selector, url };
        }

        case "fill": {
          const text = (request.text as string) || (args.text as string);
          if (!rawRef) throw new Error("ref required for fill action");
          if (typeof text !== "string") throw new Error("text required for fill action");

          const refs = getSessionRefs(sessionId);
          const refInfo = refs.get(rawRef);
          if (refInfo) {
            const info: RefInfo = { role: refInfo.role, name: refInfo.name };
            const success = await fillField(page, info, text, {
              submit: request.submit === true,
              slowly: request.slowly === true,
            });
            if (!success) throw new Error(`Could not find element for ref ${rawRef}`);
          } else {
            throw new Error(`ref ${rawRef} not found`);
          }
          return { success: true, kind: "fill", ref: rawRef, text };
        }

        case "select": {
          const values = (request.values as string[]) || (args.values as string[]) || [];
          if (!rawRef) throw new Error("ref required for select action");
          if (!values.length) throw new Error("values required for select action");

          const refs = getSessionRefs(sessionId);
          const refInfo = refs.get(rawRef);
          if (refInfo) {
            const info: RefInfo = { role: refInfo.role, name: refInfo.name };
            const success = await selectOption(page, info, values);
            if (!success) throw new Error(`Could not find element for ref ${rawRef}`);
          } else if (resolvedSelector) {
            await page.select(resolvedSelector, ...values);
          } else {
            throw new Error(`ref ${rawRef} not found`);
          }
          return { success: true, kind: "select", ref: rawRef, values };
        }

        case "evaluate": {
          const fn = (request.fn as string) || (args.fn as string);
          if (!fn) throw new Error("fn required for evaluate action");
          pwManager.assertSafeBrowserEvaluationScript(fn);
          const result = await page.evaluate(fn);
          return { success: true, kind: "evaluate", result };
        }

        default:
          throw new Error(
            `Unknown act kind: ${kind}. Supported: click, type, press, hover, scroll, wait, fill, select, evaluate`
          );
      }
    }

    case "click": {
      const rawSelector = (args.selector as string) || (args.ref as string);
      if (!rawSelector) throw new Error("Selector required for click action");
      const selector = resolveSessionSelector(sessionId, rawSelector);

      const pageId = await getOrCreateBrowserPageForSession(sessionId);
      await pwManager.click(pageId, selector, {
        button: (args.button as "left" | "right" | "middle") || "left",
        doubleClick: args.doubleClick === true,
        modifiers: (args.modifiers as string[]) || undefined,
      });

      return {
        success: true,
        selector,
        message: `Clicked element: ${selector}`,
      };
    }

    case "type": {
      const rawSelector = (args.selector as string) || (args.ref as string);
      const text = args.text as string;
      if (!rawSelector) throw new Error("Selector required for type action");
      if (typeof text !== "string") throw new Error("Text required for type action");
      const selector = resolveSessionSelector(sessionId, rawSelector);

      const pageId = await getOrCreateBrowserPageForSession(sessionId);
      await pwManager.type(pageId, selector, text, {
        submit: args.submit === true,
        clear: args.clear !== false,
        slowly: args.slowly === true ? 100 : undefined,
      });

      return {
        success: true,
        selector,
        text,
        message: `Typed "${text}" into ${selector}`,
      };
    }

    case "press": {
      const key = args.key as string;
      if (!key) throw new Error("Key required for press action");

      const pageId = await getOrCreateBrowserPageForSession(sessionId);
      await pwManager.pressKey(pageId, key, (args.delayMs as number) || 0);

      return {
        success: true,
        key,
        message: `Pressed key: ${key}`,
      };
    }

    case "select": {
      const rawSelector = (args.selector as string) || (args.ref as string);
      const values = args.values as string[];
      if (!rawSelector || !values)
        throw new Error("Selector and values required for select action");
      const selector = resolveSessionSelector(sessionId, rawSelector);

      const pageId = await getOrCreateBrowserPageForSession(sessionId);
      await pwManager.selectMultiple(pageId, selector, values);

      return {
        success: true,
        selector,
        values,
        message: `Selected "${values.join(", ")}" in ${selector}`,
      };
    }

    case "hover": {
      const rawSelector = (args.selector as string) || (args.ref as string);
      if (!rawSelector) throw new Error("Selector required for hover action");
      const selector = resolveSessionSelector(sessionId, rawSelector);

      const pageId = await getOrCreateBrowserPageForSession(sessionId);
      await pwManager.hover(pageId, selector);

      return {
        success: true,
        selector,
        message: `Hovered over ${selector}`,
      };
    }

    case "scroll": {
      const rawSelector = (args.selector as string) || (args.ref as string);
      const selector = rawSelector ? resolveSessionSelector(sessionId, rawSelector) : undefined;
      const direction = (args.direction as string) || "down";
      const amount = (args.amount as number) || 500;

      const useHeadless = useEmbeddedBrowser(args);

      if (useHeadless) {
        const pageId = await getOrCreateBrowserPageForSession(sessionId);
        if (selector) {
          await pwManager.scrollIntoView(pageId, selector);
          return {
            success: true,
            selector,
            message: `Scrolled ${selector} into view`,
          };
        } else {
          const scrollY = direction === "up" ? -amount : amount;
          await pwManager.evaluate(pageId, `window.scrollBy(0, ${scrollY})`);
          return {
            success: true,
            direction,
            amount,
            message: `Scrolled ${direction} by ${amount}px`,
          };
        }
      }

      const page = await getVisualPage(sessionId);
      if (selector) {
        await page.evaluate(
          `document.querySelector('${selector.replace(/'/g, "\\'")}')?.scrollIntoView({ behavior: 'smooth' })`
        );
        return {
          success: true,
          selector,
          message: `Scrolled ${selector} into view`,
        };
      } else {
        const scrollY = direction === "up" ? -amount : amount;
        await page.evaluate(`window.scrollBy(0, ${scrollY})`);
        return {
          success: true,
          direction,
          amount,
          message: `Scrolled ${direction} by ${amount}px`,
        };
      }
    }

    case "drag": {
      const startRef = args.startRef as string;
      const endRef = args.endRef as string;
      if (!startRef || !endRef) throw new Error("startRef and endRef required for drag action");

      const pageId = await getOrCreateBrowserPageForSession(sessionId);
      await pwManager.drag(
        pageId,
        resolveSessionSelector(sessionId, startRef),
        resolveSessionSelector(sessionId, endRef)
      );

      return {
        success: true,
        startRef,
        endRef,
        message: `Dragged from ${startRef} to ${endRef}`,
      };
    }

    case "fill": {
      const fields = args.fields as Array<{ ref: string; value: string }>;
      if (!fields || !Array.isArray(fields))
        throw new Error("fields array required for fill action");

      const pageId = await getOrCreateBrowserPageForSession(sessionId);
      for (const field of fields) {
        await pwManager.fill(pageId, resolveSessionSelector(sessionId, field.ref), field.value);
      }

      return {
        success: true,
        fields,
        message: `Filled ${fields.length} field(s)`,
      };
    }

    case "resize": {
      const requestedMode = args.viewportMode;
      if (requestedMode !== undefined && !isBrowserViewportMode(requestedMode)) {
        throw new Error("viewportMode must be responsive, mobile, or desktop");
      }
      const preset = isBrowserViewportMode(requestedMode)
        ? browserViewportPreset(requestedMode)
        : null;
      const width = preset?.width ?? args.width;
      const height = preset?.height ?? args.height;
      if (
        typeof width !== "number" ||
        typeof height !== "number" ||
        !Number.isFinite(width) ||
        !Number.isFinite(height)
      ) {
        throw new Error("viewportMode or finite width and height are required for resize action");
      }
      const viewportMode = requestedMode ?? inferBrowserViewportMode({ width, height });

      const pageId = await getOrCreateBrowserPageForSession(sessionId);
      await pwManager.resize(pageId, width, height, viewportMode);

      return {
        success: true,
        width,
        height,
        viewportMode,
        message: viewportMode
          ? `Set ${viewportMode} viewport (${width}x${height})`
          : `Resized to ${width}x${height}`,
      };
    }

    case "wait": {
      const timeMs = args.timeMs as number;
      const rawSelector = (args.selector as string) || (args.ref as string);
      const selector = rawSelector ? resolveSessionSelector(sessionId, rawSelector) : undefined;
      const text = args.text as string;
      const textGone = args.textGone as string;
      const url = args.url as string;
      const fn = args.fn as string;
      const loadState = args.loadState as "load" | "domcontentloaded" | "networkidle";

      const pageId = await getOrCreateBrowserPageForSession(sessionId);

      if (timeMs) {
        await pwManager.wait(pageId, timeMs);
        return { success: true, message: `Waited ${timeMs}ms` };
      } else if (selector) {
        await pwManager.waitForSelector(pageId, selector, {
          timeout: (args.timeoutMs as number) || 30000,
          state: (args.state as "visible" | "hidden" | "attached" | "detached") || "visible",
        });
        return { success: true, selector, message: `Element ${selector} is ready` };
      } else if (text) {
        await pwManager.waitForText(pageId, text, {
          timeout: (args.timeoutMs as number) || 30000,
        });
        return { success: true, text, message: `Text "${text}" appeared` };
      } else if (textGone) {
        await pwManager.waitForTextGone(pageId, textGone, {
          timeout: (args.timeoutMs as number) || 30000,
        });
        return { success: true, textGone, message: `Text "${textGone}" disappeared` };
      } else if (url) {
        await pwManager.waitForNavigation(pageId, url);
        return { success: true, url, message: `Navigated to ${url}` };
      } else if (loadState) {
        await pwManager.waitForLoadState(pageId, loadState);
        return { success: true, loadState, message: `Load state: ${loadState}` };
      } else if (fn) {
        await pwManager.evaluate(pageId, fn);
        return { success: true, fn, message: "Script executed" };
      } else {
        throw new Error("No wait condition specified");
      }
    }

    case "evaluate": {
      const script =
        typeof args.script === "string" ? args.script : typeof args.fn === "string" ? args.fn : "";
      if (!script) throw new Error("Script required for evaluate action");

      const pageId = await getOrCreateBrowserPageForSession(sessionId);
      const result = await pwManager.evaluate(pageId, script);

      return {
        success: true,
        result,
        message: "Script executed",
      };
    }

    default:
      throw new Error(`Unknown browser action: ${action}`);
  }
}

export async function handleWebFetch(
  args: Record<string, unknown>,
  _context?: ToolContext,
  fetchUrl: PublicHttpFetcher = fetchPublicHttpUrl
): Promise<{ content: string; url: string; title?: string; provider?: string }> {
  const url = typeof args.url === "string" ? args.url.trim() : "";
  const extractMode = args.extractMode === "text" ? "text" : "markdown";
  const requestedMaxChars =
    typeof args.maxChars === "number" && Number.isFinite(args.maxChars) ? args.maxChars : 50_000;
  const maxChars = Math.max(1_000, Math.min(200_000, Math.floor(requestedMaxChars)));

  if (!url) {
    throw new Error("URL is required");
  }

  const validatedUrl = await validateBrowserNavigationUrl(url, "Request");
  const requestedProvider =
    args.provider === "direct" || args.provider === "firecrawl" || args.provider === "parallel"
      ? args.provider
      : undefined;
  const env = getWebResearchRuntimeEnv();
  const external = [
    ...(firecrawlConfigured(env) ? (["firecrawl"] as const) : []),
    ...(parallelConfigured(env) ? (["parallel"] as const) : []),
  ];
  const providers: Array<"direct" | "firecrawl" | "parallel"> = requestedProvider
    ? [requestedProvider, "direct", ...external]
    : /\.pdf(?:$|[?#])/i.test(validatedUrl)
      ? [...external, "direct"]
      : ["direct", ...external];
  const uniqueProviders = [...new Set(providers)];
  const errors: string[] = [];

  for (const provider of uniqueProviders) {
    try {
      if (provider === "firecrawl") {
        return await extractFirecrawl(validatedUrl, extractMode, maxChars, env);
      }
      if (provider === "parallel") {
        const apiKey = env.PARALLEL_API_KEY;
        if (!apiKey) throw new Error("PARALLEL_API_KEY is not configured");
        return await extractParallel(
          validatedUrl,
          maxChars,
          apiKey,
          typeof args.objective === "string" ? args.objective : undefined
        );
      }
      const result = await fetchDirectWebContent(validatedUrl, extractMode, maxChars, fetchUrl);
      if (!result.content.trim()) throw new Error("page contained no readable content");
      return { ...result, provider: "direct" };
    } catch (error) {
      errors.push(`${provider}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  throw new Error(`Failed to fetch ${url}: ${errors.join("; ")}`);
}

async function fetchDirectWebContent(
  url: string,
  extractMode: "markdown" | "text",
  maxChars: number,
  fetchUrl: PublicHttpFetcher
): Promise<{ content: string; url: string; title?: string }> {
  const maxRedirects = 5;
  let currentUrl = url;
  let response: Response | undefined;
  for (let hop = 0; hop <= maxRedirects; hop++) {
    currentUrl = await validateBrowserNavigationUrl(currentUrl, "Request");
    const hopResponse = await fetchUrl(currentUrl, {
      redirect: "manual",
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_7_2) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
      },
      signal: AbortSignal.timeout(30_000),
    });

    if (hopResponse.status >= 300 && hopResponse.status < 400) {
      const location = hopResponse.headers.get("location");
      if (!location) {
        response = hopResponse;
        break;
      }
      if (hop === maxRedirects) throw new Error("Too many redirects");
      currentUrl = new URL(location, currentUrl).toString();
      continue;
    }

    response = hopResponse;
    break;
  }

  if (!response) throw new Error("Too many redirects");
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  if ((response.headers.get("content-type") || "").toLowerCase().includes("application/pdf")) {
    throw new Error("PDF extraction requires a configured extraction provider");
  }
  const { title, content } = extractReadableContent(await response.text(), extractMode);
  return {
    content: content.length > maxChars ? `${content.slice(0, maxChars)}\n... [truncated]` : content,
    url: currentUrl,
    title: title || undefined,
  };
}

function extractReadableContent(
  html: string,
  mode: string = "markdown"
): { title: string; content: string } {
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = titleMatch ? titleMatch[1].trim().replace(/\s+/g, " ") : "";

  let text = html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<noscript[^>]*>[\s\S]*?<\/noscript>/gi, "")
    .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, "")
    .replace(/<header[^>]*>[\s\S]*?<\/header>/gi, "")
    .replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, "")
    .replace(/<aside[^>]*>[\s\S]*?<\/aside>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "");

  if (mode === "markdown") {
    text = text
      .replace(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, "\n# $1\n")
      .replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, "\n## $1\n")
      .replace(/<h3[^>]*>([\s\S]*?)<\/h3>/gi, "\n### $1\n")
      .replace(/<h4[^>]*>([\s\S]*?)<\/h4>/gi, "\n#### $1\n")
      .replace(/<strong[^>]*>([\s\S]*?)<\/strong>/gi, "**$1**")
      .replace(/<b[^>]*>([\s\S]*?)<\/b>/gi, "**$1**")
      .replace(/<em[^>]*>([\s\S]*?)<\/em>/gi, "*$1*")
      .replace(/<i[^>]*>([\s\S]*?)<\/i>/gi, "*$1*")
      .replace(/<a[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, "[$2]($1)")
      .replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, "- $1\n")
      .replace(/<br[^>]*\/?>/gi, "\n")
      .replace(/<p[^>]*>([\s\S]*?)<\/p>/gi, "\n$1\n")
      .replace(/<div[^>]*>([\s\S]*?)<\/div>/gi, "\n$1\n");
  }

  text = text
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .replace(/\n\s*\n/g, "\n\n")
    .trim();

  return { title, content: text };
}

export async function handleOpenUrl(args: Record<string, unknown>): Promise<unknown> {
  const url = args.url as string;
  if (!url) {
    throw new Error("url is required for open_url");
  }
  const navigationUrl = await validateBrowserNavigationUrl(url);

  const profileName = (args.profile as string) || "default";

  console.log(
    `[Browser] open_url: Opening ${navigationUrl} in visual browser (profile: ${profileName})`
  );

  let profile = profileManager.getProfile(profileName);
  if (!profile?.running) {
    await profileManager.startBrowser(profileName);
    profile = profileManager.getProfile(profileName);
  }

  const page = await profileManager.createPage(profileName, navigationUrl);

  await new Promise((resolve) => setTimeout(resolve, 500));

  const title = await page.title();
  const currentUrl = page.url();

  console.log(`[Browser] open_url: Successfully loaded ${currentUrl} - "${title}"`);

  return {
    success: true,
    url: currentUrl,
    title,
    profile: profileName,
    message: `Opened ${navigationUrl} in visible Chrome window`,
  };
}
