import { connectPuppeteerBrowser } from "./automation-driver";
import type { AutomationBrowser } from "./automation-driver";
import { getBrowserSupervisionSettings, getBrowserSupervisionStatus } from "./supervision";

export const DEFAULT_LOCAL_CHROME_CDP_PORT = 9222;
const MIN_CDP_PORT = 1024;
const MAX_CDP_PORT = 65_535;
const PROBE_TIMEOUT_MS = 2_500;
const CONNECT_TIMEOUT_MS = 20_000;
const MAX_TARGET_URL_LENGTH = 2_048;

interface ChromeVersionPayload {
  Browser?: unknown;
  webSocketDebuggerUrl?: unknown;
}

export interface LocalChromeTarget {
  id: string;
  title: string;
  url: string;
}

export interface LocalChromeStatus {
  supported: boolean;
  attached: boolean;
  reachable: boolean;
  product: string | null;
  port: number;
  targets: LocalChromeTarget[];
  reason?: string;
}

export function normalizeLocalChromePort(value: unknown): number {
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric)) return DEFAULT_LOCAL_CHROME_CDP_PORT;
  const port = Math.floor(numeric);
  if (port < MIN_CDP_PORT || port > MAX_CDP_PORT) return DEFAULT_LOCAL_CHROME_CDP_PORT;
  return port;
}

export function localChromeLaunchHint(port: number): string {
  return `Start Chrome with --remote-debugging-port=${port}, open http://localhost:${port} in your browser to confirm it is listening, then connect.`;
}

function supervisionAllowsAttach(): string | null {
  const supervision = getBrowserSupervisionSettings({ redact: false });
  const status = getBrowserSupervisionStatus();
  if (supervision.remoteRoutingEnabled) {
    return "Remote browser routing is enabled, so Cybara will not attach to a local Chrome.";
  }
  if (status.owner !== "local") {
    return "The active browser session is not owned locally, so Cybara will not attach to a local Chrome.";
  }
  return null;
}

export async function probeLocalChrome(
  port: number = DEFAULT_LOCAL_CHROME_CDP_PORT
): Promise<{ reachable: boolean; product: string | null; reason?: string }> {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/json/version`, {
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    if (!response.ok) {
      return { reachable: false, product: null, reason: `debug port returned ${response.status}` };
    }
    const payload = (await response.json()) as ChromeVersionPayload;
    const product = typeof payload.Browser === "string" ? payload.Browser : null;
    const endpoint =
      typeof payload.webSocketDebuggerUrl === "string" ? payload.webSocketDebuggerUrl : null;
    if (!endpoint) {
      return { reachable: false, product, reason: "no debugger endpoint was advertised" };
    }
    return { reachable: true, product };
  } catch (error) {
    return {
      reachable: false,
      product: null,
      reason: error instanceof Error ? error.message.slice(0, 160) : String(error).slice(0, 160),
    };
  }
}

let attached: { browser: AutomationBrowser; port: number } | null = null;

export function getAttachedLocalChromePort(): number | null {
  return attached?.port ?? null;
}

export async function localChromeStatus(): Promise<LocalChromeStatus> {
  const port = attached?.port ?? DEFAULT_LOCAL_CHROME_CDP_PORT;
  const denial = supervisionAllowsAttach();
  if (attached) {
    return {
      supported: true,
      attached: true,
      reachable: true,
      product: null,
      port,
      targets: await attachedTargets(attached.browser),
    };
  }
  const probe = await probeLocalChrome(port);
  const status: LocalChromeStatus = {
    supported: true,
    attached: false,
    reachable: probe.reachable,
    product: probe.product,
    port,
    targets: [],
  };
  if (denial) status.reason = denial;
  else if (!probe.reachable)
    status.reason = `${probe.reason ?? "no debugger answered"}. ${localChromeLaunchHint(port)}`;
  return status;
}

async function attachedTargets(browser: AutomationBrowser): Promise<LocalChromeTarget[]> {
  const targets: LocalChromeTarget[] = [];
  for (const page of await browser.pages()) {
    const url = typeof page.url === "function" ? page.url() : "";
    targets.push({
      id: pageId(page),
      title: truncate(pageTitle(page), 200),
      url: truncate(url, MAX_TARGET_URL_LENGTH),
    });
  }
  return targets;
}

function pageId(page: unknown): string {
  const candidate = page as { id?: unknown };
  return typeof candidate.id === "string" ? candidate.id : "";
}

function pageTitle(page: unknown): string {
  const candidate = page as { title?: unknown };
  return typeof candidate.title === "string" ? candidate.title : "";
}

function truncate(value: string, maximum: number): string {
  return value.length > maximum ? `${value.slice(0, maximum)}…` : value;
}

export async function attachToLocalChrome(
  options: { port?: unknown } = {}
): Promise<LocalChromeStatus> {
  const denial = supervisionAllowsAttach();
  if (denial) throw new Error(denial);
  if (attached) await detachFromLocalChrome();
  const port = normalizeLocalChromePort(options.port);
  const probe = await probeLocalChrome(port);
  if (!probe.reachable) {
    throw new Error(
      `No Chrome debugger is listening on 127.0.0.1:${port}. ${localChromeLaunchHint(port)}`
    );
  }
  const browser = await Promise.race([
    connectPuppeteerBrowser({ endpoint: `http://127.0.0.1:${port}` }),
    new Promise<never>((_resolve, reject) =>
      setTimeout(() => reject(new Error("Timed out connecting to Chrome")), CONNECT_TIMEOUT_MS)
    ),
  ]);
  attached = { browser, port };
  return localChromeStatus();
}

export async function detachFromLocalChrome(): Promise<LocalChromeStatus> {
  const current = attached;
  attached = null;
  if (current) {
    try {
      await current.browser.disconnect();
    } catch {
      void 0;
    }
  }
  return localChromeStatus();
}
