import { BlockList, isIP } from "node:net";

export interface ClientIpOptions {
  trustProxy?: boolean;
  trustedProxyCidrs?: string[];
}

function headerValue(
  headers: Record<string, string | undefined>,
  name: string
): string | undefined {
  const direct = headers[name] || headers[name.toLowerCase()];
  if (direct) return direct;
  const normalized = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === normalized) return value;
  }
  return undefined;
}

export function isLoopbackIp(ip: string | undefined): boolean {
  const normalized = (ip || "").trim().toLowerCase();
  return (
    normalized === "localhost" ||
    normalized === "::1" ||
    normalized === "127.0.0.1" ||
    normalized.startsWith("127.") ||
    normalized === "::ffff:127.0.0.1" ||
    normalized.startsWith("::ffff:127.")
  );
}

export function forwardedClientIp(headers: Record<string, string | undefined>): string | undefined {
  const forwardedFor = headerValue(headers, "x-forwarded-for")
    ?.split(",")
    .map((part) => part.trim())
    .filter((part) => isIP(part) !== 0)
    .at(-1);
  if (forwardedFor) return forwardedFor;

  const realIp = headerValue(headers, "x-real-ip")?.trim();
  return realIp && isIP(realIp) !== 0 ? realIp : undefined;
}

export function shouldTrustProxy(options?: ClientIpOptions): boolean {
  if (typeof options?.trustProxy === "boolean") return options.trustProxy;
  return process.env.CYBARA_TRUST_PROXY === "1" || process.env.CYBARA_TRUST_PROXY === "true";
}

function trustedProxyCidrs(options?: ClientIpOptions): string[] {
  if (options?.trustedProxyCidrs) return options.trustedProxyCidrs;
  return (process.env.CYBARA_TRUST_PROXY_CIDRS || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

function matchesTrustedProxyCidr(ip: string, cidr: string): boolean {
  const separator = cidr.lastIndexOf("/");
  const address = separator >= 0 ? cidr.slice(0, separator) : cidr;
  const family = isIP(address);
  const candidateFamily = isIP(ip);
  if (family === 0 || candidateFamily !== family) return false;
  const blockList = new BlockList();
  try {
    if (separator >= 0) {
      const prefix = Number.parseInt(cidr.slice(separator + 1), 10);
      const maxPrefix = family === 4 ? 32 : 128;
      if (!Number.isInteger(prefix) || prefix < 0 || prefix > maxPrefix) return false;
      blockList.addSubnet(address, prefix, family === 4 ? "ipv4" : "ipv6");
    } else {
      blockList.addAddress(address, family === 4 ? "ipv4" : "ipv6");
    }
    return blockList.check(ip, family === 4 ? "ipv4" : "ipv6");
  } catch {
    return false;
  }
}

export function isTrustedProxyPeer(
  directIp: string | undefined,
  options?: ClientIpOptions
): boolean {
  if (!shouldTrustProxy(options) || !directIp) return false;
  if (isLoopbackIp(directIp)) return true;
  return trustedProxyCidrs(options).some((cidr) => matchesTrustedProxyCidr(directIp, cidr));
}

export function getClientIp(
  headers: Record<string, string | undefined>,
  directIp?: string,
  options?: ClientIpOptions
): string {
  const forwarded = forwardedClientIp(headers);
  if (isTrustedProxyPeer(directIp, options) && forwarded) {
    if (isLoopbackIp(forwarded) && !isLoopbackIp(directIp)) return directIp || "0.0.0.0";
    return forwarded;
  }

  if (directIp) {
    return directIp;
  }

  return "0.0.0.0";
}
