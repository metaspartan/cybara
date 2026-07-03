import { createLogger } from "../core/logger";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { randomBytes, timingSafeEqual } from "crypto";
import { lookup } from "dns/promises";
import type { LookupAddress } from "dns";
import { isIP } from "net";
import { cybaraDir } from "../core/paths";
import { authenticateMobileDeviceToken } from "../core/mobile-devices";

const log = createLogger("Security");

const API_KEY_FILE = join(cybaraDir, "api_key");
let cachedApiKey: string | null | undefined;

function getOrCreateApiKey(): string | null {
  if (existsSync(API_KEY_FILE)) {
    try {
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
    mkdirSync(dir, { recursive: true });
  }

  try {
    writeFileSync(API_KEY_FILE, newKey, { mode: 0o600 }); // Read/write only by owner
    log.info("Generated new API key", { path: API_KEY_FILE });
    console.log(`
╔══════════════════════════════════════════════════════════════════╗
║  🔐 API KEY GENERATED                                            ║
╠══════════════════════════════════════════════════════════════════╣
║  Your API key has been saved to: ~/.cybara/api_key               ║
║                                                                  ║
║  To authenticate API requests, use:                              ║
║    curl -H "Authorization: Bearer ${newKey.slice(0, 20)}..."     ║
║                                                                  ║
║  Localhost connections are allowed without auth in dev mode.     ║
║  Set CYBARA_API_KEY env var to override.                         ║
╚══════════════════════════════════════════════════════════════════╝
`);
  } catch (error) {
    log.error("Failed to save API key", { error: (error as Error).message });
    return newKey; // Still use the key, just don't persist
  }

  return newKey;
}

function getEffectiveApiKey(): string | null {
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

const config = {
  get apiKey() {
    return getEffectiveApiKey();
  },

  allowLocalhostBypass:
    process.env.CYBARA_REQUIRE_AUTH === "1" ? false : process.env.NODE_ENV !== "production",

  rateLimits: {
    global: { windowMs: 60000, maxRequests: 200 }, // 200 req/min globally
    chat: { windowMs: 60000, maxRequests: 60 }, // 60 req/min for chat
    pairing: { windowMs: 60000, maxRequests: 10 }, // 10 req/min for pairing attempts
    auth: { windowMs: 300000, maxRequests: 5 }, // 5 failed auths per 5 min
  },

  maxMessageSize: 32 * 1024,

  blockedIpRanges: [
    "127.0.0.0/8", // localhost
    "10.0.0.0/8", // private class A
    "172.16.0.0/12", // private class B
    "192.168.0.0/16", // private class C
    "169.254.0.0/16", // link-local
    "0.0.0.0/8", // current network
    "224.0.0.0/4", // multicast
    "255.255.255.255/32", // broadcast
  ],
};

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

const rateLimitStore = new Map<string, RateLimitEntry>();

setInterval(
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
    return { allowed: true, remaining: maxRequests - 1, resetAt: now + windowMs };
  }

  if (entry.count >= maxRequests) {
    const retryAfterMs = entry.resetAt - now;
    log.warn(`Rate limit exceeded for ${key}`, { count: entry.count, retryAfterMs });
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
  /**
   * Capability scopes for a scoped principal (a paired mobile device). Undefined
   * means full access (root API key / trusted localhost) — no scope gating.
   */
  scopes?: string[];
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
  // Browser fetch-metadata: real same-origin fetch/XHR/SSE requests always send
  // `Sec-Fetch-Site`. Non-browser local clients (curl, other local processes,
  // daemons) do NOT — so a header-less request must NOT be treated as
  // same-origin. This closes the "any local process inherits the localhost auth
  // bypass" hole while keeping the same-origin web UI working.
  const secFetchSite = (headers["sec-fetch-site"] || headers["Sec-Fetch-Site"] || "")
    .toString()
    .toLowerCase();
  if (secFetchSite) {
    // "same-origin" = UI fetch/SSE; "none" = top-level navigation to our own page.
    return secFetchSite === "same-origin" || secFetchSite === "none";
  }

  // WebSocket upgrades (and some clients) send Origin but no Sec-Fetch-Site.
  const origin = headers.origin || headers.Origin;
  if (!origin) return false; // no browser signal at all -> require the API key

  const host = headers.host || headers.Host;
  if (!host) return false;

  try {
    const parsedOrigin = new URL(origin);
    return parsedOrigin.host === host;
  } catch {
    return false;
  }
}

/** Length-safe constant-time string compare, to avoid token timing leaks. */
function constantTimeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

export function authenticateRequest(headers: Record<string, string>, ip: string): AuthResult {
  const effectiveApiKey = config.apiKey;

  if (!effectiveApiKey) {
    return { authenticated: true };
  }

  if (config.allowLocalhostBypass && isLocalhostIP(ip) && isSameOriginRequest(headers)) {
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
      return { authenticated: true, scopes: mobileDevice.scopes };
    }

    log.warn("Invalid API key attempt", { ip });
    return { authenticated: false, reason: "Invalid API key" };
  }

  return { authenticated: true };
}

/**
 * The scope a route requires, or null when any authenticated principal may use
 * it. Mutating management surfaces require `manage`; wallet, terminal, and MCP
 * process-management routes keep narrower high-risk scopes so paired-device
 * tokens cannot escalate into fund movement or local code execution.
 */
export function routeRequiredScope(method: string, path: string): string | null {
  if (path.startsWith("/api/wallet")) {
    if (method === "GET") return null;
    return "wallet";
  }
  if (path === "/api/ide/open-terminal" || path.startsWith("/api/terminal")) {
    return "terminal";
  }
  if (path.startsWith("/api/mcp")) {
    if (method === "GET") return null;
    return "mcp";
  }
  if (path === "/api/config") {
    if (method === "GET") return null;
    return "manage";
  }
  if (path.startsWith("/api/providers")) {
    if (method === "GET") return null;
    return "manage";
  }
  if (path.startsWith("/api/router")) {
    if (method === "GET") return null;
    return "manage";
  }
  if (
    path.startsWith("/api/agents") ||
    path.startsWith("/api/subagents") ||
    path.startsWith("/api/tasks") ||
    path.startsWith("/api/channels") ||
    path.startsWith("/api/checkpoints") ||
    path === "/api/setup/complete"
  ) {
    if (method === "GET") return null;
    return "manage";
  }
  return null;
}

function getBearerToken(headers: Record<string, string>): string | null {
  const authHeader = headers["authorization"] || headers["Authorization"];
  if (!authHeader) return null;
  return authHeader.startsWith("Bearer ") ? authHeader.slice(7) : authHeader;
}

function usesRootApiKey(headers: Record<string, string>): boolean {
  const effectiveApiKey = config.apiKey;
  const token = getBearerToken(headers);
  return Boolean(effectiveApiKey && token && token === effectiveApiKey);
}

function isPrivateIpv6(ip: string): boolean {
  const normalized = ip
    .toLowerCase()
    .replace(/^\[|\]$/g, "")
    .split("%")[0];
  if (normalized === "::1" || normalized === "::") return true;

  if (normalized.startsWith("::ffff:")) {
    return isPrivateOrBlockedIP(normalized.slice(7));
  }

  if (normalized.startsWith("fc") || normalized.startsWith("fd")) return true;
  if (/^fe[89ab]/.test(normalized)) return true;
  return false;
}

function ipToInt(ip: string): number {
  const parts = ip.split(".").map(Number);
  return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
}

function isInCidr(ip: string, cidr: string): boolean {
  const [range, bits] = cidr.split("/");
  const mask = ~(2 ** (32 - parseInt(bits)) - 1) >>> 0;
  const ipInt = ipToInt(ip);
  const rangeInt = ipToInt(range);
  return (ipInt & mask) === (rangeInt & mask);
}

export function isPrivateOrBlockedIP(ip: string): boolean {
  const normalized = ip
    .trim()
    .toLowerCase()
    .replace(/^\[|\]$/g, "");
  if (!normalized) return true;

  if (normalized.includes(":")) {
    return isPrivateIpv6(normalized);
  }

  const blockedHostnames = ["localhost", "0.0.0.0", "metadata.google.internal"];
  if (blockedHostnames.includes(normalized)) return true;

  const ipVersion = isIP(normalized);
  if (ipVersion === 6) {
    return isPrivateIpv6(normalized);
  }
  if (ipVersion !== 4) {
    return false;
  }

  const parts = normalized.split(".");
  if (parts.length !== 4) return false;

  const nums = parts.map(Number);
  if (nums.some((n) => isNaN(n) || n < 0 || n > 255)) return false;

  for (const cidr of config.blockedIpRanges) {
    if (isInCidr(normalized, cidr)) {
      return true;
    }
  }

  return false;
}

export async function validateUrl(url: string): Promise<{ valid: boolean; error?: string }> {
  try {
    const parsed = new URL(url);

    if (!["http:", "https:"].includes(parsed.protocol)) {
      return { valid: false, error: `Blocked protocol: ${parsed.protocol}` };
    }

    if (parsed.username || parsed.password) {
      return { valid: false, error: "URLs with embedded credentials are not allowed" };
    }

    const hostname = parsed.hostname.toLowerCase();

    if (isPrivateOrBlockedIP(hostname)) {
      return { valid: false, error: `Blocked hostname: ${hostname}` };
    }

    const blockedPatterns = [
      /localhost/i,
      /\.local$/i,
      /\.internal$/i,
      /^192\.168\./,
      /^10\./,
      /^172\.(1[6-9]|2[0-9]|3[01])\./,
      /^127\./,
    ];

    for (const pattern of blockedPatterns) {
      if (pattern.test(hostname)) {
        return { valid: false, error: `Blocked hostname pattern: ${hostname}` };
      }
    }

    const ipVersion = isIP(hostname);
    if (ipVersion === 0) {
      try {
        // Bound the DNS lookup so a slow/absent resolver can't hang the request
        // (or a test) indefinitely. On timeout we fall through to the permissive
        // catch, same as any other resolution failure.
        const addresses: LookupAddress[] = await Promise.race([
          lookup(hostname, { all: true, verbatim: true }),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error("DNS lookup timed out")), 3000)
          ),
        ]);
        for (const address of addresses) {
          if (isPrivateOrBlockedIP(address.address)) {
            return {
              valid: false,
              error: `Blocked resolved address: ${address.address}`,
            };
          }
        }
      } catch {
        // Keep behavior permissive when DNS lookup fails to avoid false negatives
        // offline. NOTE: closing the residual DNS-rebinding/TOCTOU gap requires
        // pinning the resolved IP and dialing it directly (an SSRF-safe agent),
        // not a fail-closed flip here — a flip would block offline use and any
        // operator-allowlisted host that does not resolve in the current env.
      }
    }

    return { valid: true };
  } catch (error) {
    return { valid: false, error: `Invalid URL: ${(error as Error).message}` };
  }
}

export function validateMessageSize(message: string): { valid: boolean; error?: string } {
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
}

function getRateLimitType(method: string, path: string): keyof typeof config.rateLimits {
  if (path === "/api/chat" || path.startsWith("/api/chat/") || path.endsWith("/chat")) {
    return "chat";
  }

  if (method === "POST" && path.includes("/pairings/verify")) {
    return "pairing";
  }

  if (path === "/api/providers/oauth/callback-status" || path === "/api/providers/oauth/poll") {
    return "global";
  }

  if (path.startsWith("/api/providers/oauth/")) {
    return "auth";
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
  if (publicPaths.some((p) => path.startsWith(p))) {
    return { passed: true };
  }

  // Onboarding-safe, read-only catalog/status endpoints: needed by the first-run
  // setup wizard before any API key exists, and expose only the static provider/
  // channel catalog (no secrets, same data as the open-source registry).
  const onboardingPublicPaths = [
    "/api/providers/available",
    "/api/channels/available",
    "/api/setup/status",
  ];
  if (method === "GET" && onboardingPublicPaths.some((p) => path === p)) {
    return { passed: true };
  }

  // Pairing-code redemption is reachable by an unpaired device (it has no token
  // yet). The pairing code itself is the secret — one-time and expiring — and
  // this endpoint is pairing-rate-limited to blunt guessing.
  if (method === "POST" && path === "/api/mobile/pair/redeem") {
    const limit = rateLimitEndpoint(path, ip, "pairing");
    if (!limit.allowed) {
      return {
        passed: false,
        error: "Rate limit exceeded",
        statusCode: 429,
        headers: { "Retry-After": String(Math.ceil((limit.retryAfterMs || 60000) / 1000)) },
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
        headers: { "Retry-After": String(Math.ceil((limit.retryAfterMs || 60000) / 1000)) },
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

  if (path.startsWith("/api/mobile/devices")) {
    const sameOriginLocalhost =
      config.allowLocalhostBypass && isLocalhostIP(ip) && isSameOriginRequest(headers);
    if (!sameOriginLocalhost && !usesRootApiKey(headers)) {
      return {
        passed: false,
        error: "Root API key required for mobile device management",
        statusCode: 403,
      };
    }
  }

  // Scope enforcement: a scoped principal (paired device) may only reach a
  // gated capability if it holds the required scope. Full-access principals
  // (root key / trusted localhost) have `auth.scopes` undefined and skip this.
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
    headers: {
      "X-RateLimit-Remaining": String(rateLimit.remaining),
      "X-RateLimit-Reset": String(rateLimit.resetAt),
    },
  };
}

export const securityConfig = config;
