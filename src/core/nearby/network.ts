import { isIP } from "net";

export function normalizeNearbyAddress(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/^\[|\]$/g, "")
    .split("%")[0]
    .replace(/^::ffff:/, "");
}

function isPrivateIpv4(value: string): boolean {
  const parts = value.split(".").map(Number);
  if (
    parts.length !== 4 ||
    parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)
  ) {
    return false;
  }
  return (
    parts[0] === 10 ||
    parts[0] === 127 ||
    (parts[0] === 169 && parts[1] === 254) ||
    (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
    (parts[0] === 192 && parts[1] === 168)
  );
}

export function isNearbyPrivateAddress(value: string): boolean {
  const normalized = normalizeNearbyAddress(value);
  if (normalized === "localhost") return true;
  const version = isIP(normalized);
  if (version === 4) return isPrivateIpv4(normalized);
  if (version !== 6) return false;
  return (
    normalized === "::1" ||
    normalized.startsWith("fc") ||
    normalized.startsWith("fd") ||
    /^fe[89ab]/.test(normalized)
  );
}

export function parseNearbyBaseUrl(value: string): string {
  const parsed = new URL(value);
  if (parsed.protocol !== "http:") throw new Error("Nearby peers must use private HTTP URLs");
  if (!isNearbyPrivateAddress(parsed.hostname)) {
    throw new Error("Nearby peers must use a private network address");
  }
  if (
    parsed.username ||
    parsed.password ||
    parsed.pathname !== "/" ||
    parsed.search ||
    parsed.hash
  ) {
    throw new Error("Nearby peer URL is invalid");
  }
  return parsed.origin;
}
