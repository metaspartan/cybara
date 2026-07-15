import { isIP } from "net";
import { networkInterfaces } from "os";

export interface NearbyLanInterface {
  address: string;
  netmask: string;
}

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

function ipv4Number(value: string): number | null {
  if (isIP(value) !== 4) return null;
  return (
    value
      .split(".")
      .map(Number)
      .reduce((total, part) => (total << 8) + part, 0) >>> 0
  );
}

function sharesSubnet(address: string, local: NearbyLanInterface): boolean {
  const candidate = ipv4Number(address);
  const localAddress = ipv4Number(local.address);
  const netmask = ipv4Number(local.netmask);
  return (
    candidate !== null &&
    localAddress !== null &&
    netmask !== null &&
    (candidate & netmask) === (localAddress & netmask)
  );
}

export function nearbyLanInterfaces(): NearbyLanInterface[] {
  const interfaces: NearbyLanInterface[] = [];
  for (const entries of Object.values(networkInterfaces())) {
    for (const entry of entries || []) {
      if (
        entry.family === "IPv4" &&
        !entry.internal &&
        isNearbyPrivateAddress(entry.address) &&
        isIP(entry.netmask) === 4
      ) {
        interfaces.push({ address: entry.address, netmask: entry.netmask });
      }
    }
  }
  return interfaces.filter(
    (entry, index, values) => values.findIndex((value) => value.address === entry.address) === index
  );
}

export function selectNearbyAddress(
  addresses: readonly string[],
  localInterfaces: readonly NearbyLanInterface[] = nearbyLanInterfaces()
): string | null {
  const candidates = addresses.map(normalizeNearbyAddress).filter((address, index, values) => {
    return isNearbyPrivateAddress(address) && values.indexOf(address) === index;
  });
  candidates.sort((left, right) => {
    const score = (address: string): number => {
      if (localInterfaces.some((local) => sharesSubnet(address, local))) return 0;
      if (isIP(address) === 4 && !address.startsWith("127.")) return 1;
      if (isIP(address) === 6 && address !== "::1") return 2;
      return 3;
    };
    return score(left) - score(right);
  });
  return candidates[0] || null;
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
