// API Security - Authentication, Rate Limiting, and Input Validation
// Implements security hardening for the Cybara API

import { createLogger } from "../core/logger";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { randomBytes } from "crypto";
import { cybaraDir } from "../core/paths";

const log = createLogger("Security");

// ============================================
// API KEY MANAGEMENT
// ============================================

const API_KEY_FILE = join(cybaraDir, "api_key");

/**
 * Get or generate API key
 * Priority: CYBARA_API_KEY env > ~/.cybara/api_key file > generate new key
 */
function getOrCreateApiKey(): string | null {
  // 1. Check environment variable
  if (process.env.CYBARA_API_KEY) {
    return process.env.CYBARA_API_KEY;
  }

  // 2. Check if key file exists
  if (existsSync(API_KEY_FILE)) {
    try {
      const key = readFileSync(API_KEY_FILE, "utf-8").trim();
      if (key.length >= 32) {
        return key;
      }
    } catch {
      // Fall through to generate new key
    }
  }

  // 3. Generate new key
  const newKey = `cybara_${randomBytes(24).toString("hex")}`;

  // Ensure directory exists
  const dir = cybaraDir;
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  // Save key to file
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

// ============================================
// CONFIGURATION
// ============================================

const config = {
  // API Key - auto-generated if not provided
  apiKey: getOrCreateApiKey(),

  // Allow localhost connections without auth in dev mode
  allowLocalhostBypass: process.env.NODE_ENV !== "production",

  // Rate limiting defaults
  rateLimits: {
    global: { windowMs: 60000, maxRequests: 200 }, // 200 req/min globally
    chat: { windowMs: 60000, maxRequests: 60 }, // 60 req/min for chat
    pairing: { windowMs: 60000, maxRequests: 10 }, // 10 req/min for pairing attempts
    auth: { windowMs: 300000, maxRequests: 5 }, // 5 failed auths per 5 min
  },

  // Max message size (32KB)
  maxMessageSize: 32 * 1024,

  // SSRF protection - blocked IP ranges
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

// ============================================
// RATE LIMITING
// ============================================

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

const rateLimitStore = new Map<string, RateLimitEntry>();

// Clean up expired entries every 5 minutes
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
    // New window
    rateLimitStore.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, remaining: maxRequests - 1, resetAt: now + windowMs };
  }

  if (entry.count >= maxRequests) {
    // Rate limited
    const retryAfterMs = entry.resetAt - now;
    log.warn(`Rate limit exceeded for ${key}`, { count: entry.count, retryAfterMs });
    return {
      allowed: false,
      remaining: 0,
      resetAt: entry.resetAt,
      retryAfterMs,
    };
  }

  // Increment counter
  entry.count++;
  return {
    allowed: true,
    remaining: maxRequests - entry.count,
    resetAt: entry.resetAt,
  };
}

// Convenience function for endpoint rate limiting
export function rateLimitEndpoint(
  endpoint: string,
  ip: string,
  limitType: keyof typeof config.rateLimits = "global"
): RateLimitResult {
  const limits = config.rateLimits[limitType];
  const key = `${limitType}:${ip}:${endpoint}`;
  return checkRateLimit(key, limits.windowMs, limits.maxRequests);
}

// ============================================
// AUTHENTICATION
// ============================================

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

export function authenticateRequest(headers: Record<string, string>, ip: string): AuthResult {
  // If no API key configured, allow all requests (open mode)
  if (!config.apiKey) {
    return { authenticated: true };
  }

  // Allow localhost bypass in dev mode
  if (config.allowLocalhostBypass && isLocalhostIP(ip)) {
    log.debug("Localhost bypass for auth", { ip });
    return { authenticated: true };
  }

  // Check Authorization header
  const authHeader = headers["authorization"] || headers["Authorization"];
  if (!authHeader) {
    return { authenticated: false, reason: "Missing Authorization header" };
  }

  // Support both "Bearer <token>" and raw token
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : authHeader;

  if (token !== config.apiKey) {
    log.warn("Invalid API key attempt", { ip });
    return { authenticated: false, reason: "Invalid API key" };
  }

  return { authenticated: true };
}

// ============================================
// SSRF PROTECTION
// ============================================

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
  // Handle IPv6 localhost
  if (ip === "::1" || ip === "::") return true;

  // Handle IPv4-mapped IPv6
  if (ip.startsWith("::ffff:")) {
    ip = ip.slice(7);
  }

  // Check hostnames
  const blockedHostnames = ["localhost", "0.0.0.0", "metadata.google.internal"];
  if (blockedHostnames.includes(ip.toLowerCase())) return true;

  // If this is not an IPv4 literal, treat as hostname and let caller apply hostname policies.
  const parts = ip.split(".");
  if (parts.length !== 4) return false;

  const nums = parts.map(Number);
  if (nums.some((n) => isNaN(n) || n < 0 || n > 255)) return false;

  // Check against blocked CIDR ranges
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

    // Only allow http and https
    if (!["http:", "https:"].includes(parsed.protocol)) {
      return { valid: false, error: `Blocked protocol: ${parsed.protocol}` };
    }

    // Resolve hostname to IP
    const hostname = parsed.hostname;

    // Block obvious private hostnames
    if (isPrivateOrBlockedIP(hostname)) {
      return { valid: false, error: `Blocked hostname: ${hostname}` };
    }

    // DNS resolution check would go here for production
    // For now, block known internal hostnames
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

    return { valid: true };
  } catch (error) {
    return { valid: false, error: `Invalid URL: ${(error as Error).message}` };
  }
}

// ============================================
// INPUT VALIDATION
// ============================================

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

  // Remove null bytes
  let sanitized = input.replace(/\0/g, "");

  // Trim to max length
  if (sanitized.length > maxLength) {
    sanitized = sanitized.substring(0, maxLength);
  }

  return sanitized.trim();
}

// ============================================
// MIDDLEWARE HELPER
// ============================================

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
  // Skip auth for health endpoints
  const publicPaths = ["/api/health", "/api/health/ready", "/api/health/live"];
  if (publicPaths.some((p) => path.startsWith(p))) {
    return { passed: true };
  }

  // Rate limit check
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

  // Auth check
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

// Export config for testing/debugging
export const securityConfig = config;
