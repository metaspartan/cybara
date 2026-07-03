export interface ClientIpOptions {
  trustProxy?: boolean;
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
    .find(Boolean);
  if (forwardedFor) return forwardedFor;

  const realIp = headerValue(headers, "x-real-ip")?.trim();
  return realIp || undefined;
}

export function shouldTrustProxy(options?: ClientIpOptions): boolean {
  if (typeof options?.trustProxy === "boolean") return options.trustProxy;
  return process.env.CYBARA_TRUST_PROXY === "1" || process.env.CYBARA_TRUST_PROXY === "true";
}

export function getClientIp(
  headers: Record<string, string | undefined>,
  directIp?: string,
  options?: ClientIpOptions
): string {
  const forwarded = forwardedClientIp(headers);
  if (shouldTrustProxy(options) && forwarded) {
    return forwarded;
  }

  if (directIp) {
    // A same-host reverse proxy connects over loopback but represents a remote
    // client in X-Forwarded-For. Treat that remote address as the client so the
    // development localhost bypass is not inherited by public proxy traffic.
    if (isLoopbackIp(directIp) && forwarded && !isLoopbackIp(forwarded)) {
      return forwarded;
    }
    return directIp;
  }

  return "127.0.0.1";
}
