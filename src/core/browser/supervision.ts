import { config } from "../config";
import { isSealedSecret, openSecret, sealSecret } from "../secret-storage";

export type BrowserDownloadPolicy = "ask" | "allow" | "deny";

export interface BrowserSupervisionSettings {
  autoRestart: boolean;
  healthCheckIntervalMs: number;
  downloadPolicy: BrowserDownloadPolicy;
  remoteRoutingEnabled: boolean;
  remoteEndpoint: string;
  remoteToken: string;
}

export interface BrowserSupervisionStatus {
  owner: "none" | "local" | "existing" | "remote";
  healthy: boolean;
  restartCount: number;
  lastHealthCheckAt: string | null;
  lastDisconnectAt: string | null;
  lastError: string | null;
}

const DEFAULT_SETTINGS: BrowserSupervisionSettings = {
  autoRestart: true,
  healthCheckIntervalMs: 30_000,
  downloadPolicy: "ask",
  remoteRoutingEnabled: false,
  remoteEndpoint: "",
  remoteToken: "",
};
const TOKEN_CONTEXT = "browser:remote-token";
const REDACTED = "***redacted***";
const settingsListeners = new Set<(settings: BrowserSupervisionSettings) => void>();
let status: BrowserSupervisionStatus = {
  owner: "none",
  healthy: false,
  restartCount: 0,
  lastHealthCheckAt: null,
  lastDisconnectAt: null,
  lastError: null,
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function normalizeEndpoint(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) return "";
  const endpoint = new URL(value.trim());
  if (!["http:", "https:", "ws:", "wss:"].includes(endpoint.protocol)) {
    throw new Error("Remote browser endpoint must use HTTP, HTTPS, WS, or WSS");
  }
  if (endpoint.username || endpoint.password) {
    throw new Error("Remote browser endpoint cannot contain credentials");
  }
  return endpoint.toString().replace(/\/$/, "");
}

function openToken(value: unknown): string {
  if (typeof value !== "string" || !value) return "";
  if (!isSealedSecret(value)) return value;
  try {
    return openSecret(value, TOKEN_CONTEXT);
  } catch {
    return "";
  }
}

function normalize(value: unknown): BrowserSupervisionSettings {
  const record = asRecord(value);
  let remoteEndpoint = "";
  try {
    remoteEndpoint = normalizeEndpoint(record.remoteEndpoint);
  } catch {
    remoteEndpoint = "";
  }
  return {
    autoRestart: record.autoRestart !== false,
    healthCheckIntervalMs:
      typeof record.healthCheckIntervalMs === "number" &&
      Number.isFinite(record.healthCheckIntervalMs)
        ? Math.min(300_000, Math.max(5_000, Math.floor(record.healthCheckIntervalMs)))
        : DEFAULT_SETTINGS.healthCheckIntervalMs,
    downloadPolicy:
      record.downloadPolicy === "allow" || record.downloadPolicy === "deny"
        ? record.downloadPolicy
        : "ask",
    remoteRoutingEnabled: record.remoteRoutingEnabled === true,
    remoteEndpoint,
    remoteToken: openToken(record.remoteToken),
  };
}

export function getBrowserSupervisionSettings(options?: {
  redact?: boolean;
}): BrowserSupervisionSettings {
  const settings = normalize(config.get<unknown>("browser_supervision"));
  return options?.redact === false
    ? settings
    : { ...settings, remoteToken: settings.remoteToken ? REDACTED : "" };
}

export function setBrowserSupervisionSettings(value: unknown): BrowserSupervisionSettings {
  const current = getBrowserSupervisionSettings({ redact: false });
  const update = asRecord(value);
  const requestedToken =
    typeof update.remoteToken === "string" ? update.remoteToken : current.remoteToken;
  const remoteToken = requestedToken === REDACTED ? current.remoteToken : requestedToken;
  const remoteEndpoint = Object.hasOwn(update, "remoteEndpoint")
    ? normalizeEndpoint(update.remoteEndpoint)
    : current.remoteEndpoint;
  const settings = normalize({ ...current, ...update, remoteEndpoint, remoteToken });
  config.set("browser_supervision", {
    ...settings,
    remoteToken: settings.remoteToken ? sealSecret(settings.remoteToken, TOKEN_CONTEXT) : "",
  });
  for (const listener of settingsListeners) {
    try {
      listener(settings);
    } catch {
      continue;
    }
  }
  return { ...settings, remoteToken: settings.remoteToken ? REDACTED : "" };
}

export function browserDownloadsAccepted(policy: BrowserDownloadPolicy): boolean {
  return policy === "allow";
}

export function onBrowserSupervisionSettingsChanged(
  listener: (settings: BrowserSupervisionSettings) => void
): () => void {
  settingsListeners.add(listener);
  return () => settingsListeners.delete(listener);
}

export function recordBrowserHealthy(owner: BrowserSupervisionStatus["owner"]): void {
  status = {
    ...status,
    owner,
    healthy: true,
    lastHealthCheckAt: new Date().toISOString(),
    lastError: null,
  };
}

export function recordBrowserDisconnect(error?: string): void {
  status = {
    ...status,
    owner: "none",
    healthy: false,
    lastDisconnectAt: new Date().toISOString(),
    lastError: error || null,
  };
}

export function recordBrowserRestart(): void {
  status = { ...status, restartCount: status.restartCount + 1 };
}

export function getBrowserSupervisionStatus(): BrowserSupervisionStatus {
  return { ...status };
}
