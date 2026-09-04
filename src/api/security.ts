import { createHash, randomBytes, scryptSync, timingSafeEqual } from "crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { isIP } from "net";
import { join } from "path";
import { createLogger } from "../core/logger";
import {
  authenticateMobileDeviceToken,
  isLoopbackMobileGatewayUrl,
  type MobileDeviceView,
  type MobileScope,
  normalizeMobileGatewayUrl,
} from "../core/mobile-devices";
import {
  isPrivateOrBlockedIp,
  PUBLIC_HTTP_BLOCKED_CIDRS,
  validatePublicHttpUrl,
} from "../core/outbound-url-policy";
import { cybaraDir } from "../core/paths";
import { isGatewayNetworkExposed, isHostedRuntime } from "../core/runtime/runtime-mode";

const log = createLogger("Security");

const API_KEY_FILE = join(cybaraDir, "api_key");
const SECURITY_SETTINGS_FILE = join(cybaraDir, "security.json");
let cachedApiKey: string | undefined;

interface PersistedSecuritySettings {
  requireAuthForLocalhost?: boolean;
  basePath?: string;
  gatewayPassword?: {
    algorithm: "scrypt";
    salt: string;
    hash: string;
  };
  remoteAccess?: PersistedGatewayRemoteAccessSettings;
}

export type GatewayRemoteAccessMode = "private_overlay" | "public_tunnel";
export type GatewayRemoteAccessProvider =
  | "tailscale"
  | "cloudflare"
  | "zerotier"
  | "netbird"
  | "custom";

interface PersistedGatewayRemoteAccessSettings {
  enabled?: boolean;
  mode?: GatewayRemoteAccessMode;
  provider?: GatewayRemoteAccessProvider;
  baseUrl?: string;
}

export interface GatewayRemoteAccessSettings {
  enabled: boolean;
  mode: GatewayRemoteAccessMode;
  provider: GatewayRemoteAccessProvider;
  baseUrl: string;
  ready: boolean;
  requiresGatewayPassword: boolean;
  status: "off" | "ready" | "needs_url" | "needs_https" | "needs_password" | "invalid_url";
  message: string;
}

let cachedSecuritySettings: PersistedSecuritySettings | undefined;

function readPersistedSecuritySettings(): PersistedSecuritySettings {
  if (process.env.NODE_ENV === "test") return cachedSecuritySettings ?? {};
  if (cachedSecuritySettings !== undefined) return cachedSecuritySettings;
  try {
    if (existsSync(SECURITY_SETTINGS_FILE)) {
      const parsed = JSON.parse(readFileSync(SECURITY_SETTINGS_FILE, "utf-8")) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        const record = parsed as Record<string, unknown>;
        cachedSecuritySettings = {
          requireAuthForLocalhost:
            typeof record.requireAuthForLocalhost === "boolean"
              ? record.requireAuthForLocalhost
              : undefined,
          basePath:
            typeof record.basePath === "string"
              ? normalizeGatewayBasePath(record.basePath)
              : undefined,
          gatewayPassword: readPersistedGatewayPassword(record.gatewayPassword),
          remoteAccess: readPersistedRemoteAccessSettings(record.remoteAccess),
        };
        return cachedSecuritySettings;
      }
    }
  } catch (error) {
    log.warn("Failed to read security settings", {
      error: (error as Error).message,
    });
  }
  cachedSecuritySettings = {};
  return cachedSecuritySettings;
}

function writePersistedSecuritySettings(settings: PersistedSecuritySettings): void {
  if (process.env.NODE_ENV === "test") {
    cachedSecuritySettings = settings;
    return;
  }
  if (!existsSync(cybaraDir)) {
    mkdirSync(cybaraDir, { recursive: true, mode: 0o700 });
  }
  writeFileSync(SECURITY_SETTINGS_FILE, JSON.stringify(settings, null, 2), {
    mode: 0o600,
  });
  try {
    chmodSync(SECURITY_SETTINGS_FILE, 0o600);
  } catch {
    void 0;
  }
  cachedSecuritySettings = settings;
}

function readPersistedGatewayPassword(
  value: unknown
): PersistedSecuritySettings["gatewayPassword"] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  return record.algorithm === "scrypt" &&
    typeof record.salt === "string" &&
    /^[a-f0-9]{32}$/i.test(record.salt) &&
    typeof record.hash === "string" &&
    /^[a-f0-9]{64}$/i.test(record.hash)
    ? {
        algorithm: "scrypt",
        salt: record.salt.toLowerCase(),
        hash: record.hash.toLowerCase(),
      }
    : undefined;
}

function readPersistedRemoteAccessSettings(
  value: unknown
): PersistedSecuritySettings["remoteAccess"] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  const mode =
    record.mode === "public_tunnel" || record.mode === "private_overlay" ? record.mode : undefined;
  const provider =
    record.provider === "tailscale" ||
    record.provider === "cloudflare" ||
    record.provider === "zerotier" ||
    record.provider === "netbird" ||
    record.provider === "custom"
      ? record.provider
      : undefined;
  let baseUrl: string | undefined;
  try {
    baseUrl =
      typeof record.baseUrl === "string" && record.baseUrl.trim()
        ? normalizeRemoteAccessBaseUrl(record.baseUrl)
        : undefined;
  } catch {
    baseUrl = undefined;
  }
  return {
    enabled: typeof record.enabled === "boolean" ? record.enabled : undefined,
    mode,
    provider,
    baseUrl,
  };
}

function getOrCreateApiKey(): string {
  if (existsSync(API_KEY_FILE)) {
    try {
      chmodSync(API_KEY_FILE, 0o600);
      const key = readFileSync(API_KEY_FILE, "utf-8").trim();
      if (key.length >= 32) {
        return key;
      }
    } catch {
      void 0;
    }
  }

  const newKey = `cybara_${randomBytes(24).toString("hex")}`;

  const dir = cybaraDir;
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
  }

  try {
    writeFileSync(API_KEY_FILE, newKey, { mode: 0o600 });
    log.info("Generated new API key", { path: API_KEY_FILE });
    console.log(`
╔══════════════════════════════════════════════════════════════════╗
║  🔐 API KEY GENERATED                                            ║
╠══════════════════════════════════════════════════════════════════╣
║  Your API key has been saved to: ~/.cybara/api_key               ║
║  Read it with:  cat ~/.cybara/api_key                            ║
║                                                                  ║
║  Send it as:    Authorization: Bearer <your key>                 ║
║                                                                  ║
║  Browser clients can authenticate with the saved API key.        ║
║  Set CYBARA_API_KEY env var to override.                         ║
╚══════════════════════════════════════════════════════════════════╝
`);
  } catch (error) {
    log.error("Failed to save API key", { error: (error as Error).message });
    return newKey;
  }

  return newKey;
}

function getEffectiveApiKey(): string {
  const envKey = process.env.CYBARA_API_KEY?.trim();
  if (envKey) {
    return envKey;
  }

  if (cachedApiKey !== undefined) {
    return cachedApiKey;
  }

  cachedApiKey = getOrCreateApiKey();
  return cachedApiKey;
}

function isLocalhostAuthBypassForbidden(): boolean {
  return process.env.CYBARA_REQUIRE_AUTH === "1" || isHostedRuntime() || isGatewayNetworkExposed();
}

function isLocalhostBypassAllowed(): boolean {
  if (isLocalhostAuthBypassForbidden()) return false;
  if (process.env.CYBARA_ALLOW_LOCALHOST_AUTH_BYPASS === "1") return true;
  const settings = readPersistedSecuritySettings();
  if (settings.gatewayPassword) return false;
  return settings.requireAuthForLocalhost !== true;
}

const config = {
  get apiKey() {
    return getEffectiveApiKey();
  },

  get allowLocalhostBypass() {
    return isLocalhostBypassAllowed();
  },

  rateLimits: {
    global: { windowMs: 60000, maxRequests: 200 },
    read: { windowMs: 60000, maxRequests: 600 },
    chat: { windowMs: 60000, maxRequests: 60 },
    pairing: { windowMs: 60000, maxRequests: 10 },
    auth: { windowMs: 300000, maxRequests: 5 },
  },

  maxMessageSize: 32 * 1024,

  blockedIpRanges: [...PUBLIC_HTTP_BLOCKED_CIDRS],
};

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

const rateLimitStore = new Map<string, RateLimitEntry>();

const rateLimitCleanupTimer = setInterval(
  () => {
    const now = Date.now();
    let cleaned = 0;
    for (const [key, entry] of rateLimitStore.entries()) {
      if (now > entry.resetAt) {
        rateLimitStore.delete(key);
        cleaned++;
      }
    }
    if (cleaned > 0) {
      log.debug(`Cleaned ${cleaned} expired rate limit entries`);
    }
  },
  5 * 60 * 1000
);
rateLimitCleanupTimer.unref();

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: number;
  retryAfterMs?: number;
}

export function checkRateLimit(
  key: string,
  windowMs: number,
  maxRequests: number
): RateLimitResult {
  const now = Date.now();
  const entry = rateLimitStore.get(key);

  if (!entry || now > entry.resetAt) {
    rateLimitStore.set(key, { count: 1, resetAt: now + windowMs });
    return {
      allowed: true,
      remaining: maxRequests - 1,
      resetAt: now + windowMs,
    };
  }

  if (entry.count >= maxRequests) {
    const retryAfterMs = entry.resetAt - now;
    log.warn(`Rate limit exceeded for ${key}`, {
      count: entry.count,
      retryAfterMs,
    });
    return {
      allowed: false,
      remaining: 0,
      resetAt: entry.resetAt,
      retryAfterMs,
    };
  }

  entry.count++;
  return {
    allowed: true,
    remaining: maxRequests - entry.count,
    resetAt: entry.resetAt,
  };
}

export function rateLimitEndpoint(
  endpoint: string,
  ip: string,
  limitType: keyof typeof config.rateLimits = "global"
): RateLimitResult {
  const limits = config.rateLimits[limitType];
  const key = `${limitType}:${ip}:${endpoint}`;
  return checkRateLimit(key, limits.windowMs, limits.maxRequests);
}

export interface AuthResult {
  authenticated: boolean;
  reason?: string;
  scopes?: string[];
  mobileDevice?: MobileDeviceView;
}

function isLocalhostIP(ip: string): boolean {
  return (
    ip === "127.0.0.1" ||
    ip === "::1" ||
    ip === "localhost" ||
    ip.startsWith("127.") ||
    ip === "::ffff:127.0.0.1"
  );
}

function isSameOriginRequest(headers: Record<string, string>): boolean {
  const secFetchSite = (headers["sec-fetch-site"] || headers["Sec-Fetch-Site"] || "")
    .toString()
    .toLowerCase();
  if (secFetchSite) {
    return secFetchSite === "same-origin" || secFetchSite === "none";
  }

  const origin = headers.origin || headers.Origin;
  if (!origin) return false;

  const host = headers.host || headers.Host;
  if (!host) return false;

  try {
    const parsedOrigin = new URL(origin);
    return parsedOrigin.host === host;
  } catch {
    return false;
  }
}

function isLocalHostHeader(headers: Record<string, string>): boolean {
  const rawHost = (headers.host || headers.Host || "").toString().trim().toLowerCase();
  if (!rawHost) return true;

  let hostname = rawHost;
  if (hostname.startsWith("[")) {
    const end = hostname.indexOf("]");
    hostname = end > 0 ? hostname.slice(1, end) : hostname;
  } else {
    const colon = hostname.lastIndexOf(":");
    if (colon > -1 && hostname.indexOf(":") === colon) {
      hostname = hostname.slice(0, colon);
    }
  }

  return isLocalhostIP(hostname) || hostname === "::1" || hostname === "0.0.0.0";
}

export function hasLocalhostBypass(headers: Record<string, string>, ip: string): boolean {
  return (
    config.allowLocalhostBypass &&
    isLocalhostIP(ip) &&
    isSameOriginRequest(headers) &&
    isLocalHostHeader(headers)
  );
}

function constantTimeEqual(a: string, b: string): boolean {
  const bufA = createHash("sha256").update(a).digest();
  const bufB = createHash("sha256").update(b).digest();
  return timingSafeEqual(bufA, bufB);
}

function gatewayPasswordHeader(headers: Record<string, string>): string {
  return (
    headers["x-cybara-gateway-password"] ||
    headers["X-Cybara-Gateway-Password"] ||
    headers["X-CYBARA-GATEWAY-PASSWORD"] ||
    ""
  ).toString();
}

function normalizeGatewayPassword(value: unknown): string {
  if (typeof value !== "string") throw new Error("Gateway password must be a string");
  const trimmed = value.trim();
  if (trimmed.length < 12) throw new Error("Gateway password must be at least 12 characters");
  if (Buffer.byteLength(trimmed, "utf8") > 1024) {
    throw new Error("Gateway password must be 1024 bytes or less");
  }
  return trimmed;
}

function hashGatewayPassword(password: string, salt = randomBytes(16).toString("hex")) {
  return {
    algorithm: "scrypt" as const,
    salt,
    hash: scryptSync(password, salt, 32).toString("hex"),
  };
}

function verifyGatewayPassword(
  password: string,
  stored: NonNullable<PersistedSecuritySettings["gatewayPassword"]>
): boolean {
  try {
    const candidate = scryptSync(password, stored.salt, 32).toString("hex");
    return constantTimeEqual(candidate, stored.hash);
  } catch {
    return false;
  }
}

function gatewayPasswordSatisfied(headers: Record<string, string>, ip: string): boolean {
  const stored = readPersistedSecuritySettings().gatewayPassword;
  if (!stored) return true;
  if (hasLocalhostBypass(headers, ip)) return true;
  const provided = gatewayPasswordHeader(headers);
  return provided ? verifyGatewayPassword(provided, stored) : false;
}

export function authenticateRequest(headers: Record<string, string>, ip: string): AuthResult {
  const effectiveApiKey = config.apiKey;

  if (hasLocalhostBypass(headers, ip)) {
    log.debug("Localhost bypass for auth", { ip });
    return { authenticated: true };
  }

  const authHeader = headers["authorization"] || headers["Authorization"];
  if (!authHeader) {
    return { authenticated: false, reason: "Missing Authorization header" };
  }

  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : authHeader;

  if (!constantTimeEqual(token, effectiveApiKey)) {
    const mobileDevice = authenticateMobileDeviceToken(token, {
      userAgent: headers["user-agent"] || headers["User-Agent"],
    });
    if (mobileDevice) {
      return { authenticated: true, scopes: mobileDevice.scopes, mobileDevice };
    }

    log.warn("Invalid API key attempt", { ip });
    return { authenticated: false, reason: "Invalid API key" };
  }

  if (!gatewayPasswordSatisfied(headers, ip)) {
    return { authenticated: false, reason: "Gateway password required" };
  }

  return { authenticated: true };
}

export function normalizeGatewayBasePath(value: unknown): string {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  if (!trimmed || trimmed === "/") return "";
  const withSlash = trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
  const cleaned = withSlash.replace(/\/+$/, "");
  if (!/^(\/[A-Za-z0-9._~-]{1,64}){1,4}$/.test(cleaned)) return "";
  if (cleaned.split("/").some((segment) => /^\.+$/.test(segment) && segment !== "")) return "";
  if (cleaned === "/api" || cleaned.startsWith("/api/")) return "";
  return cleaned;
}

export function getGatewayBasePath(): string {
  const envBase = normalizeGatewayBasePath(process.env.CYBARA_BASE_PATH);
  if (envBase) return envBase;
  return normalizeGatewayBasePath(readPersistedSecuritySettings().basePath);
}

export function setGatewayBasePath(value: unknown): string {
  const raw = typeof value === "string" ? value.trim() : "";
  const normalized = normalizeGatewayBasePath(raw);
  if (raw && raw !== "/" && !normalized) {
    throw new Error(
      "Invalid base path: use 1-4 URL-safe segments like /cybara or /tools/cybara (the /api prefix is reserved)"
    );
  }
  writePersistedSecuritySettings({
    ...readPersistedSecuritySettings(),
    basePath: normalized || undefined,
  });
  log.info(`Gateway base path ${normalized ? `set to ${normalized}` : "cleared"}`);
  return normalized;
}

function normalizeRemoteAccessMode(value: unknown): GatewayRemoteAccessMode {
  return value === "public_tunnel" ? "public_tunnel" : "private_overlay";
}

function normalizeRemoteAccessProvider(value: unknown): GatewayRemoteAccessProvider {
  if (
    value === "tailscale" ||
    value === "cloudflare" ||
    value === "zerotier" ||
    value === "netbird" ||
    value === "custom"
  ) {
    return value;
  }
  return "tailscale";
}

function normalizeRemoteAccessBaseUrl(value: unknown): string {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  if (!trimmed) return "";
  const normalized = normalizeMobileGatewayUrl(trimmed);
  if (normalized.length > 2048) {
    throw new Error("Remote access URL must be 2048 characters or less");
  }
  return normalized;
}

function isPrivateOverlayHttpHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (isIP(host) === 4) {
    const [a, b] = host.split(".").map((part) => Number(part));
    return (
      a === 10 ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254)
    );
  }
  if (isIP(host) === 6) {
    return host.startsWith("fc") || host.startsWith("fd") || host.startsWith("fe80");
  }
  return host.endsWith(".local") || host.endsWith(".lan") || host.endsWith(".internal");
}

function remoteAccessStatus(input: {
  enabled: boolean;
  mode: GatewayRemoteAccessMode;
  baseUrl: string;
  gatewayPasswordEnabled: boolean;
}): Pick<GatewayRemoteAccessSettings, "ready" | "status" | "message"> {
  if (!input.enabled) {
    return {
      ready: false,
      status: "off",
      message: "Remote access is off. The gateway remains reachable only locally or on LAN.",
    };
  }
  if (!input.baseUrl) {
    return {
      ready: false,
      status: "needs_url",
      message: "Enter the HTTPS or private-mesh URL clients should use.",
    };
  }
  let parsed: URL;
  try {
    parsed = new URL(input.baseUrl);
  } catch {
    return {
      ready: false,
      status: "invalid_url",
      message: "Remote access URL is invalid.",
    };
  }
  if (isLoopbackMobileGatewayUrl(input.baseUrl)) {
    return {
      ready: false,
      status: "invalid_url",
      message: "Remote access cannot use localhost or 127.0.0.1 as the client URL.",
    };
  }
  if (input.mode === "public_tunnel" && parsed.protocol !== "https:") {
    return {
      ready: false,
      status: "needs_https",
      message: "Public tunnel and custom-domain access must use HTTPS.",
    };
  }
  if (
    input.mode === "private_overlay" &&
    parsed.protocol === "http:" &&
    !isPrivateOverlayHttpHost(parsed.hostname)
  ) {
    return {
      ready: false,
      status: "needs_https",
      message: "Private mesh HTTP URLs must use a private LAN or mesh IP. Use HTTPS for DNS names.",
    };
  }
  if (input.mode === "public_tunnel" && !input.gatewayPasswordEnabled) {
    return {
      ready: false,
      status: "needs_password",
      message: "Enable the gateway password before using a public tunnel or custom domain.",
    };
  }
  return {
    ready: true,
    status: "ready",
    message:
      input.mode === "public_tunnel"
        ? "Public remote URL is ready. Keep the tunnel behind HTTPS and gateway password protection."
        : "Private mesh URL is ready. Devices must still authenticate with a scoped token.",
  };
}

export function getGatewayRemoteAccessSettings(): GatewayRemoteAccessSettings {
  const persisted = readPersistedSecuritySettings().remoteAccess ?? {};
  const envBaseUrl = process.env.CYBARA_MOBILE_BASE_URL?.trim() || "";
  const enabled = Boolean(envBaseUrl) || persisted.enabled === true;
  const mode = normalizeRemoteAccessMode(persisted.mode);
  const provider = normalizeRemoteAccessProvider(persisted.provider);
  let baseUrl = "";
  let invalidUrl = false;
  try {
    baseUrl = normalizeRemoteAccessBaseUrl(envBaseUrl || persisted.baseUrl || "");
  } catch {
    invalidUrl = true;
  }
  const gatewayPasswordEnabled = Boolean(readPersistedSecuritySettings().gatewayPassword);
  const status = invalidUrl
    ? ({
        ready: false,
        status: "invalid_url",
        message: "Remote access URL is invalid.",
      } as const)
    : remoteAccessStatus({
        enabled,
        mode,
        baseUrl,
        gatewayPasswordEnabled,
      });
  return {
    enabled,
    mode,
    provider,
    baseUrl,
    requiresGatewayPassword: mode === "public_tunnel",
    ...status,
  };
}

export function setGatewayRemoteAccessSettings(value: unknown): GatewayRemoteAccessSettings {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("remoteAccess must be an object");
  }
  const record = value as Record<string, unknown>;
  const enabled = record.enabled === true;
  const mode = normalizeRemoteAccessMode(record.mode);
  const provider = normalizeRemoteAccessProvider(record.provider);
  const baseUrl = normalizeRemoteAccessBaseUrl(record.baseUrl);
  const current = readPersistedSecuritySettings();
  writePersistedSecuritySettings({
    ...current,
    remoteAccess: {
      enabled,
      mode,
      provider,
      baseUrl: baseUrl || undefined,
    },
  });
  log.info("Gateway remote access settings updated", {
    enabled,
    mode,
    provider,
    hasBaseUrl: Boolean(baseUrl),
  });
  return getGatewayRemoteAccessSettings();
}

export interface GatewayAuthSettings {
  apiKeyConfigured: boolean;
  apiKeyPreview: string | null;
  apiKeySource: "env" | "file" | "none";
  apiKeyPath: string;
  gatewayPasswordEnabled: boolean;
  requireAuthForLocalhost: boolean;
  requireAuthForLocalhostForced: boolean;
  localhostBypassActive: boolean;
  basePath: string;
  basePathForced: boolean;
  remoteAccess: GatewayRemoteAccessSettings;
  rateLimits: typeof config.rateLimits;
}

export function getGatewayAuthSettings(): GatewayAuthSettings {
  const envKey = process.env.CYBARA_API_KEY?.trim();
  const key = config.apiKey;
  const requireForced = isLocalhostAuthBypassForbidden();
  return {
    apiKeyConfigured: Boolean(key),
    apiKeyPreview: key ? `••••${key.slice(-4)}` : null,
    apiKeySource: envKey ? "env" : key ? "file" : "none",
    apiKeyPath: API_KEY_FILE,
    gatewayPasswordEnabled: Boolean(readPersistedSecuritySettings().gatewayPassword),
    requireAuthForLocalhost: !isLocalhostBypassAllowed(),
    requireAuthForLocalhostForced: requireForced,
    localhostBypassActive: isLocalhostBypassAllowed(),
    basePath: getGatewayBasePath(),
    basePathForced: Boolean(normalizeGatewayBasePath(process.env.CYBARA_BASE_PATH)),
    remoteAccess: getGatewayRemoteAccessSettings(),
    rateLimits: config.rateLimits,
  };
}

export function revealGatewayApiKey(): {
  apiKey: string | null;
  source: "env" | "file" | "none";
} {
  const envKey = process.env.CYBARA_API_KEY?.trim();
  const key = config.apiKey;
  return { apiKey: key, source: envKey ? "env" : key ? "file" : "none" };
}

export function setRequireAuthForLocalhost(value: boolean): GatewayAuthSettings {
  writePersistedSecuritySettings({
    ...readPersistedSecuritySettings(),
    requireAuthForLocalhost: value,
  });
  log.info(`Localhost auth requirement ${value ? "enabled" : "disabled"}`);
  return getGatewayAuthSettings();
}

export function setGatewayPassword(value: unknown): GatewayAuthSettings {
  const password = normalizeGatewayPassword(value);
  writePersistedSecuritySettings({
    ...readPersistedSecuritySettings(),
    gatewayPassword: hashGatewayPassword(password),
  });
  log.info("Gateway password enabled");
  return getGatewayAuthSettings();
}

export function clearGatewayPassword(): GatewayAuthSettings {
  const { gatewayPassword: _gatewayPassword, ...settings } = readPersistedSecuritySettings();
  writePersistedSecuritySettings(settings);
  log.info("Gateway password cleared");
  return getGatewayAuthSettings();
}

export function resetSecuritySettingsForTests(): void {
  if (process.env.NODE_ENV === "test") {
    cachedSecuritySettings = undefined;
  }
}

export function rotateGatewayApiKey(): { apiKey: string } {
  if (process.env.CYBARA_API_KEY?.trim()) {
    throw new Error(
      "API key is provided via the CYBARA_API_KEY environment variable; unset it to manage the key here"
    );
  }
  const newKey = `cybara_${randomBytes(24).toString("hex")}`;
  if (!existsSync(cybaraDir)) {
    mkdirSync(cybaraDir, { recursive: true });
  }
  writeFileSync(API_KEY_FILE, newKey, { mode: 0o600 });
  cachedApiKey = newKey;
  log.info("API key rotated", { path: API_KEY_FILE });
  return { apiKey: newKey };
}

export function routeRequiredScope(method: string, path: string): MobileScope | "root" | null {
  if (path.startsWith("/api/auth")) {
    return "root";
  }
  if (path.startsWith("/api/system/backups")) {
    return "root";
  }
  if (path.startsWith("/api/nearby")) {
    return "nearby";
  }
  if (path.startsWith("/api/checkpoints")) {
    return "root";
  }
  if (path === "/api/mobile/device" || path.startsWith("/api/mobile/push")) {
    return null;
  }
  if (path.startsWith("/api/mobile")) {
    return "root";
  }
  if (path === "/api/wallet/seed") {
    return "root";
  }
  if (path === "/api/system/restart") {
    return "manage";
  }
  if (path === "/api/media") {
    return method === "GET" ? "read" : "root";
  }
  if (path.startsWith("/api/migrations")) {
    return "manage";
  }
  if (path.startsWith("/api/evals")) {
    if (
      path === "/api/evals/export" ||
      path === "/api/evals/research/export" ||
      path === "/api/evals/benchmarks/export" ||
      path === "/api/evals/import" ||
      method === "PUT" ||
      method === "DELETE"
    ) {
      return "manage";
    }
    if (method === "GET") return "read";
    return "chat";
  }
  if (path.startsWith("/api/wallet")) {
    if (path === "/api/wallet/rpc" && method === "GET") return "wallet";
    if (method === "GET") return "read";
    return "wallet";
  }
  if (path === "/api/chat" || path.startsWith("/api/chat/")) {
    return "chat";
  }
  if (path.startsWith("/api/rooms")) {
    if (method === "GET") return "read";
    return "chat";
  }
  if (path.startsWith("/api/bots")) {
    if (method === "GET") return "read";
    if (/^\/api\/bots\/[^/]+\/session$/.test(path)) return "chat";
    return "manage";
  }
  if (path.startsWith("/api/sessions")) {
    if (method === "GET") return "read";
    return "chat";
  }
  if (path.startsWith("/api/artifacts")) {
    if (method === "GET") return "read";
    return "chat";
  }
  if (path.startsWith("/api/logs/sessions")) {
    return "read";
  }
  if (path === "/api/ide/open-terminal" || path.startsWith("/api/terminal")) {
    return "terminal";
  }
  if (path.startsWith("/api/computer-use")) {
    return "terminal";
  }
  if (path.startsWith("/api/simulators")) {
    return "terminal";
  }
  if (path.startsWith("/api/browser") || path === "/api/open-url") {
    return "terminal";
  }
  if (path.startsWith("/api/tools")) {
    if (method === "GET") return "read";
    return "manage";
  }
  if (path.startsWith("/api/ide")) {
    if (path === "/api/ide/inline-completion") return "chat";
    if (path.startsWith("/api/ide/index") || path.startsWith("/api/ide/lsp")) {
      if (method === "GET") return "read";
      return "manage";
    }
    return "terminal";
  }
  if (path.startsWith("/api/lsp")) {
    if (method === "GET") return "read";
    return "manage";
  }
  if (path.startsWith("/api/skills")) {
    if (method === "GET") return "read";
    return "manage";
  }
  if (path.startsWith("/api/memory")) {
    if (method === "GET") return "read";
    return "manage";
  }
  if (path.startsWith("/api/status") || path === "/api/ws/status") {
    return "read";
  }
  if (
    path === "/api/info" ||
    path === "/api/build-info" ||
    path === "/api/update-check" ||
    path === "/api/journey" ||
    path === "/api/identity"
  ) {
    if (method === "GET") return "read";
    return "manage";
  }
  if (path.startsWith("/api/metrics")) {
    if (method === "GET") return "read";
    return "manage";
  }
  if (path.startsWith("/api/logs")) {
    return "read";
  }
  if (path.startsWith("/api/git")) {
    if (method === "GET") return "read";
    return "manage";
  }
  if (path.startsWith("/api/loops")) {
    if (method === "GET") return "read";
    return "manage";
  }
  if (path.startsWith("/api/system-prompt")) {
    if (method === "GET") return "read";
    return "manage";
  }
  if (path.startsWith("/api/settings")) {
    if (method === "GET") return "read";
    return "manage";
  }
  if (path.startsWith("/api/telemetry")) {
    if (method === "GET") return "read";
    return "manage";
  }
  if (path.startsWith("/api/system")) {
    if (method === "GET") return "read";
    return "manage";
  }
  if (path.startsWith("/api/sandbox")) {
    if (method === "GET") return "read";
    return "manage";
  }
  if (path.startsWith("/api/session-runs")) {
    return "read";
  }
  if (path.startsWith("/api/mcp")) {
    if (method === "GET") return "read";
    return "mcp";
  }
  if (path.startsWith("/api/plugins")) {
    if (path === "/api/plugins/validate") return "manage";
    if (method === "GET") return "read";
    return "manage";
  }
  if (path.startsWith("/api/connectors")) {
    if (method === "GET") return "read";
    return "manage";
  }
  if (path === "/api/config") {
    if (method === "GET") return "read";
    return "manage";
  }
  if (path.startsWith("/api/speech")) {
    if (method === "GET") return "read";
    if (path === "/api/speech/dictate" || path === "/api/speech/synthesize") return "chat";
    if (path === "/api/speech/realtime/session") return "chat";
    return "manage";
  }
  if (path === "/api/web-research/settings") {
    if (method === "GET") return "read";
    return "manage";
  }
  if (path === "/api/integration-credentials") {
    if (method === "GET") return "read";
    return "manage";
  }
  if (path.startsWith("/api/providers")) {
    if (method === "GET") return "read";
    return "manage";
  }
  if (path.startsWith("/api/provider-plans")) {
    if (method === "GET") return "read";
    return "manage";
  }
  if (path.startsWith("/api/router")) {
    if (method === "GET") return "read";
    return "manage";
  }
  if (
    path.startsWith("/api/agents") ||
    path.startsWith("/api/subagents") ||
    path.startsWith("/api/tasks") ||
    path.startsWith("/api/channels") ||
    path === "/api/setup/complete"
  ) {
    if (method === "GET") return "read";
    return "manage";
  }
  return "root";
}

function getBearerToken(headers: Record<string, string>): string | null {
  const authHeader = headers["authorization"] || headers["Authorization"];
  if (!authHeader) return null;
  return authHeader.startsWith("Bearer ") ? authHeader.slice(7) : authHeader;
}

function usesRootApiKey(headers: Record<string, string>): boolean {
  const effectiveApiKey = config.apiKey;
  const token = getBearerToken(headers);
  return Boolean(effectiveApiKey && token && constantTimeEqual(token, effectiveApiKey));
}

export function isPrivateOrBlockedIP(ip: string): boolean {
  return isPrivateOrBlockedIp(ip);
}

export async function validateUrl(url: string): Promise<{ valid: boolean; error?: string }> {
  return await validatePublicHttpUrl(url);
}

export function validateMessageSize(message: string): {
  valid: boolean;
  error?: string;
} {
  if (!message) {
    return { valid: false, error: "Message is required" };
  }

  const size = new TextEncoder().encode(message).length;
  if (size > config.maxMessageSize) {
    return {
      valid: false,
      error: `Message too large: ${size} bytes (max: ${config.maxMessageSize})`,
    };
  }

  return { valid: true };
}

export function sanitizeString(input: string, maxLength = 1000): string {
  if (!input) return "";

  let sanitized = input.replace(/\0/g, "");

  if (sanitized.length > maxLength) {
    sanitized = sanitized.substring(0, maxLength);
  }

  return sanitized.trim();
}

export interface SecurityCheckResult {
  passed: boolean;
  error?: string;
  statusCode?: number;
  headers?: Record<string, string>;
  auth?: AuthResult;
}

export function getRateLimitType(method: string, path: string): keyof typeof config.rateLimits {
  if (method === "POST" && path.includes("/pairings/verify")) {
    return "pairing";
  }

  if (path === "/api/providers/oauth/callback-status" || path === "/api/providers/oauth/poll") {
    return "global";
  }

  if (path.startsWith("/api/providers/oauth/")) {
    return "auth";
  }

  if (method === "GET") {
    return "read";
  }

  if (path === "/api/chat" || path.startsWith("/api/chat/") || path.endsWith("/chat")) {
    return "chat";
  }

  return "global";
}

export function securityCheck(
  method: string,
  path: string,
  headers: Record<string, string>,
  ip: string
): SecurityCheckResult {
  const publicPaths = ["/api/health", "/api/health/ready", "/api/health/live"];
  if (path === "/api/mcp/oauth/callback") return { passed: true };
  if (path === "/api/connectors/oauth/callback") return { passed: true };
  if (publicPaths.includes(path)) {
    return { passed: true };
  }

  const onboardingPublicPaths = [
    "/api/providers/available",
    "/api/channels/available",
    "/api/setup/status",
  ];
  if (method === "GET" && onboardingPublicPaths.some((p) => path === p)) {
    return { passed: true };
  }

  if (method === "POST" && path === "/api/mobile/pair/redeem") {
    const limit = rateLimitEndpoint(path, ip, "pairing");
    if (!limit.allowed) {
      return {
        passed: false,
        error: "Rate limit exceeded",
        statusCode: 429,
        headers: {
          "Retry-After": String(Math.ceil((limit.retryAfterMs || 60000) / 1000)),
        },
      };
    }
    return { passed: true };
  }

  const isInboundWebhook =
    (method === "POST" || method === "GET") &&
    (path.startsWith("/api/webhooks/") ||
      (path.startsWith("/api/channels/") && path.endsWith("/webhook")));
  if (isInboundWebhook) {
    const limit = rateLimitEndpoint(path, ip, "global");
    if (!limit.allowed) {
      return {
        passed: false,
        error: "Rate limit exceeded",
        statusCode: 429,
        headers: {
          "Retry-After": String(Math.ceil((limit.retryAfterMs || 60000) / 1000)),
        },
      };
    }
    return { passed: true };
  }

  const limitType = getRateLimitType(method, path);
  const rateLimit = rateLimitEndpoint(path, ip, limitType);
  if (!rateLimit.allowed) {
    return {
      passed: false,
      error: "Rate limit exceeded",
      statusCode: 429,
      headers: {
        "Retry-After": String(Math.ceil((rateLimit.retryAfterMs || 60000) / 1000)),
        "X-RateLimit-Remaining": "0",
        "X-RateLimit-Reset": String(rateLimit.resetAt),
      },
    };
  }

  const auth = authenticateRequest(headers, ip);
  if (!auth.authenticated) {
    return {
      passed: false,
      error: auth.reason || "Unauthorized",
      statusCode: 401,
      headers: {
        "WWW-Authenticate": 'Bearer realm="cybara"',
      },
    };
  }

  const rootKeyRoute =
    (method === "GET" && path === "/api/auth/key") ||
    (method === "POST" && path === "/api/auth/rotate-key");
  if (rootKeyRoute && !usesRootApiKey(headers)) {
    return {
      passed: false,
      error: "Root API key required",
      statusCode: 403,
    };
  }

  if (path.startsWith("/api/mobile/devices")) {
    const sameOriginLocalhost = hasLocalhostBypass(headers, ip);
    if (!sameOriginLocalhost && !usesRootApiKey(headers)) {
      return {
        passed: false,
        error: "Root API key required for mobile device management",
        statusCode: 403,
      };
    }
  }

  if (
    (path === "/api/mobile/device" || path.startsWith("/api/mobile/push")) &&
    !auth.mobileDevice
  ) {
    return {
      passed: false,
      error: "Paired mobile device token required",
      statusCode: 403,
    };
  }

  if (auth.scopes) {
    const required = routeRequiredScope(method, path);
    if (required && !auth.scopes.includes(required)) {
      return {
        passed: false,
        error: `This device is not authorized for '${required}' operations`,
        statusCode: 403,
      };
    }
  }

  return {
    passed: true,
    auth,
    headers: {
      "X-RateLimit-Remaining": String(rateLimit.remaining),
      "X-RateLimit-Reset": String(rateLimit.resetAt),
    },
  };
}

export const securityConfig = config;
