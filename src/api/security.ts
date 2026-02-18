import { createLogger } from "../core/logger";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { randomBytes } from "crypto";
import { lookup } from "dns/promises";
import { isIP } from "net";
import { cybaraDir } from "../core/paths";

const log = createLogger("Security");

const API_KEY_FILE = join(cybaraDir, "api_key");

function getOrCreateApiKey(): string | null {
  if (process.env.CYBARA_API_KEY) {
    return process.env.CYBARA_API_KEY;
  }

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
║    curl -H "Authorization: Bearer ${newKey.slice(0, 20)}..."    ║
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

const config = {
  apiKey: getOrCreateApiKey(),

  allowLocalhostBypass: process.env.NODE_ENV !== "production",

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
  const origin = headers.origin || headers.Origin;
  if (!origin) return true;

  const host = headers.host || headers.Host;
  if (!host) return false;

  try {
    const parsedOrigin = new URL(origin);
    return parsedOrigin.host === host;
  } catch {
    return false;
  }
}

export function authenticateRequest(headers: Record<string, string>, ip: string): AuthResult {
  const effectiveApiKey = process.env.CYBARA_API_KEY || config.apiKey;

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

  if (token !== effectiveApiKey) {
    log.warn("Invalid API key attempt", { ip });
    return { authenticated: false, reason: "Invalid API key" };
  }

  return { authenticated: true };
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
    if (isInCidr(ip, cidr)) {
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
        const addresses = await lookup(hostname, { all: true, verbatim: true });
        for (const address of addresses) {
          if (isPrivateOrBlockedIP(address.address)) {
            return {
              valid: false,
              error: `Blocked resolved address: ${address.address}`,
            };
          }
        }
      } catch {
        // Keep behavior permissive when DNS lookup fails to avoid false negatives offline.
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

  return {
    passed: true,
    headers: {
      "X-RateLimit-Remaining": String(rateLimit.remaining),
      "X-RateLimit-Reset": String(rateLimit.resetAt),
    },
  };
}

export const securityConfig = config;
