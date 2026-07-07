export interface UrlGuardResult {
  ok: boolean;
  reason?: string;
}

const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "localhost.localdomain",
  "ip6-localhost",
  "ip6-loopback",
  "metadata.google.internal",
  "metadata",
]);

const BLOCKED_HOST_SUFFIXES = [".localhost", ".local", ".internal", ".lan", ".home.arpa"];

function stripBrackets(host: string): string {
  return host.startsWith("[") && host.endsWith("]") ? host.slice(1, -1) : host;
}

function ipv4ToParts(host: string): number[] | null {
  const parts = host.split(".");
  if (parts.length !== 4) return null;
  const nums: number[] = [];
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const n = Number(part);
    if (n > 255) return null;
    nums.push(n);
  }
  return nums;
}

function isPrivateIpv4(parts: number[]): boolean {
  const [a, b] = parts;
  if (a === 10) return true;
  if (a === 127) return true;
  if (a === 0) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  if (a === 192 && b === 0 && parts[2] === 0) return true;
  if (a >= 224) return true;
  return false;
}

function isBlockedIpv6(host: string): boolean {
  const lower = host.toLowerCase();
  if (lower === "::1" || lower === "::" || lower === "0:0:0:0:0:0:0:1") return true;
  if (lower.startsWith("fe80:") || lower.startsWith("fe80::")) return true;
  if (lower.startsWith("fc") || lower.startsWith("fd")) return true;
  const mappedDotted = lower.match(/^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  if (mappedDotted) {
    const parts = ipv4ToParts(mappedDotted[1]);
    return parts ? isPrivateIpv4(parts) : true;
  }
  const mappedHex = lower.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (mappedHex) {
    const hi = parseInt(mappedHex[1], 16);
    const lo = parseInt(mappedHex[2], 16);
    const parts = [(hi >> 8) & 0xff, hi & 0xff, (lo >> 8) & 0xff, lo & 0xff];
    return isPrivateIpv4(parts);
  }
  if (lower.includes(":") && lower.includes(".")) {
    const tail = lower.split(":").pop();
    if (tail && tail.includes(".")) {
      const parts = ipv4ToParts(tail);
      if (parts && isPrivateIpv4(parts)) return true;
    }
  }
  return false;
}

export function checkPublicHttpUrl(rawUrl: string): UrlGuardResult {
  const candidate = String(rawUrl || "").trim();
  if (!candidate) return { ok: false, reason: "URL cannot be empty" };

  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    return { ok: false, reason: "must be a valid URL" };
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { ok: false, reason: "must use http or https" };
  }

  const host = stripBrackets(parsed.hostname).toLowerCase();
  if (!host) return { ok: false, reason: "missing host" };

  if (BLOCKED_HOSTNAMES.has(host)) {
    return { ok: false, reason: `host '${host}' is not allowed` };
  }
  for (const suffix of BLOCKED_HOST_SUFFIXES) {
    if (host.endsWith(suffix)) {
      return { ok: false, reason: `host '${host}' is not allowed` };
    }
  }

  const ipv4 = ipv4ToParts(host);
  if (ipv4) {
    if (isPrivateIpv4(ipv4)) {
      return { ok: false, reason: `host '${host}' resolves to a private address` };
    }
    return { ok: true };
  }

  if (host.includes(":") || parsed.hostname.startsWith("[")) {
    if (isBlockedIpv6(host)) {
      return { ok: false, reason: `host '${host}' resolves to a private address` };
    }
  }

  return { ok: true };
}

export function assertPublicHttpUrl(rawUrl: string, label = "URL"): string {
  const result = checkPublicHttpUrl(rawUrl);
  if (!result.ok) {
    throw new Error(`Validation error: ${label} ${result.reason}`);
  }
  return String(rawUrl).trim();
}
