import { isIP } from "net";

export interface PublicHttpUrlValidation {
  valid: boolean;
  error?: string;
}

export const PUBLIC_HTTP_BLOCKED_CIDRS = [
  "127.0.0.0/8",
  "100.64.0.0/10",
  "169.254.0.0/16",
  "10.0.0.0/8",
  "172.16.0.0/12",
  "192.168.0.0/16",
  "0.0.0.0/8",
  "224.0.0.0/4",
  "255.255.255.255/32",
] as const;

const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "localhost.localdomain",
  "ip6-localhost",
  "ip6-loopback",
  "metadata.google.internal",
  "metadata",
]);
const BLOCKED_HOST_SUFFIXES = [".localhost", ".local", ".internal", ".lan", ".home.arpa"];

function normalizeIp(value: string): string {
  return (
    value
      .trim()
      .toLowerCase()
      .replace(/^\[|\]$/g, "")
      .split("%")[0] || ""
  );
}

function ipv4ToInteger(value: string): number | null {
  const parts = value.split(".");
  if (parts.length !== 4) return null;
  const values = parts.map((part) => Number(part));
  if (values.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return null;
  return (
    (((values[0] || 0) << 24) |
      ((values[1] || 0) << 16) |
      ((values[2] || 0) << 8) |
      (values[3] || 0)) >>>
    0
  );
}

function ipv4InCidr(value: string, cidr: string): boolean {
  const [range, rawBits] = cidr.split("/");
  const bits = Number(rawBits);
  const address = ipv4ToInteger(value);
  const network = ipv4ToInteger(range || "");
  if (address === null || network === null || !Number.isInteger(bits) || bits < 0 || bits > 32) {
    return false;
  }
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return (address & mask) === (network & mask);
}

function mappedIpv4(value: string): string | null {
  const dotted = value.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i)?.[1];
  if (dotted) return dotted;
  const hex = value.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i);
  if (!hex) return null;
  const high = Number.parseInt(hex[1] || "", 16);
  const low = Number.parseInt(hex[2] || "", 16);
  return `${(high >> 8) & 0xff}.${high & 0xff}.${(low >> 8) & 0xff}.${low & 0xff}`;
}

export function isPrivateOrBlockedIp(value: string): boolean {
  const normalized = normalizeIp(value);
  if (!normalized) return true;
  if (BLOCKED_HOSTNAMES.has(normalized)) return true;
  if (isIP(normalized) === 4) {
    return PUBLIC_HTTP_BLOCKED_CIDRS.some((cidr) => ipv4InCidr(normalized, cidr));
  }
  const mapped = mappedIpv4(normalized);
  if (mapped) return isPrivateOrBlockedIp(mapped);
  if (isIP(normalized) === 6 || normalized.includes(":")) {
    return (
      normalized === "::" ||
      normalized === "::1" ||
      normalized.startsWith("fc") ||
      normalized.startsWith("fd") ||
      /^fe[89ab]/.test(normalized)
    );
  }
  return false;
}

export function validatePublicHttpUrlShape(rawUrl: string): PublicHttpUrlValidation {
  let parsed: URL;
  try {
    parsed = new URL(String(rawUrl || "").trim());
  } catch {
    return { valid: false, error: "Invalid URL" };
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { valid: false, error: `Blocked protocol: ${parsed.protocol}` };
  }
  if (parsed.username || parsed.password) {
    return { valid: false, error: "URLs with embedded credentials are not allowed" };
  }
  const hostname = normalizeIp(parsed.hostname);
  if (!hostname) return { valid: false, error: "Missing hostname" };
  if (
    BLOCKED_HOSTNAMES.has(hostname) ||
    BLOCKED_HOST_SUFFIXES.some((suffix) => hostname.endsWith(suffix)) ||
    isPrivateOrBlockedIp(hostname)
  ) {
    return { valid: false, error: `Blocked hostname: ${hostname}` };
  }
  return { valid: true };
}

export async function validatePublicHttpUrl(rawUrl: string): Promise<PublicHttpUrlValidation> {
  const shape = validatePublicHttpUrlShape(rawUrl);
  if (!shape.valid) return shape;
  try {
    const parsed = new URL(rawUrl);
    const hostname = normalizeIp(parsed.hostname);
    if (isIP(hostname) !== 0) return { valid: true };
    const addresses = await Bun.dns.lookup(hostname, { family: 0, backend: "system" });
    if (addresses.length === 0) return { valid: false, error: "Hostname has no public addresses" };
    for (const address of addresses) {
      if (isPrivateOrBlockedIp(address.address)) {
        return { valid: false, error: `Blocked resolved address: ${address.address}` };
      }
    }
    return { valid: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { valid: false, error: `Unable to resolve hostname: ${message}` };
  }
}
