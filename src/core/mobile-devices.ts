import { createHash, randomBytes, timingSafeEqual } from "crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "fs";
import { networkInterfaces, tmpdir, type NetworkInterfaceInfo } from "os";
import { dirname, join, resolve } from "path";
import { secureDir } from "./paths";

export const MOBILE_CONNECT_PROTOCOL = "cybara-mobile-connect-v1";

export interface MobileConnectPayload {
  protocol: typeof MOBILE_CONNECT_PROTOCOL;
  name: string;
  baseUrl: string;
  apiKey: string;
  deviceId: string;
  createdAt: string;
}

export interface MobileConnectInfo {
  baseUrl: string;
  currentBaseUrl: string;
  candidates: string[];
  lanAddresses: string[];
  lanAccessEnabled: boolean;
  isCurrentLoopback: boolean;
  warnings: string[];
  exposeCommand: string;
}

/**
 * Capability scopes a paired device may hold. A device only gets the scopes it
 * was granted, so a stolen token can't reach capabilities the owner didn't opt
 * into (notably fund-moving wallet ops and terminal execution).
 */
export const MOBILE_SCOPES = ["chat", "manage", "read", "wallet", "terminal", "mcp"] as const;
export type MobileScope = (typeof MOBILE_SCOPES)[number];

/** Default scopes for a new pairing: everything the mobile app needs, minus */
/* the dangerous wallet (transfers/signing) and terminal capabilities. */
export const DEFAULT_MOBILE_SCOPES: MobileScope[] = ["chat", "manage", "read"];

export function normalizeMobileScopes(value: unknown): MobileScope[] {
  if (!Array.isArray(value)) return [...DEFAULT_MOBILE_SCOPES];
  const valid = value.filter(
    (s): s is MobileScope =>
      typeof s === "string" && (MOBILE_SCOPES as readonly string[]).includes(s)
  );
  return valid.length > 0 ? Array.from(new Set(valid)) : [...DEFAULT_MOBILE_SCOPES];
}

/** Named scope bundles so pairing UIs can offer simple roles instead of raw scopes. */
export const MOBILE_ROLES = {
  full: ["chat", "manage", "read", "wallet", "terminal", "mcp"],
  standard: ["chat", "manage", "read"],
  readonly: ["chat", "read"],
} as const satisfies Record<string, MobileScope[]>;
export type MobileRole = keyof typeof MOBILE_ROLES;

export function scopesForRole(role: unknown): MobileScope[] | null {
  if (typeof role === "string" && Object.prototype.hasOwnProperty.call(MOBILE_ROLES, role)) {
    return [...MOBILE_ROLES[role as MobileRole]];
  }
  return null;
}

export const MOBILE_PAIRING_PROTOCOL = "cybara-mobile-pair-v1";
export const DEFAULT_PAIRING_CODE_TTL_MS = 10 * 60 * 1000; // 10 minutes

export interface MobilePairingCodePayload {
  protocol: typeof MOBILE_PAIRING_PROTOCOL;
  name: string;
  baseUrl: string;
  code: string;
  role?: string;
  expiresAt: number;
}

interface PendingPairingCode {
  code: string;
  scopes: MobileScope[];
  role?: string;
  deviceName?: string;
  gatewayName?: string;
  baseUrl: string;
  createdAt: string;
  expiresAt: number;
}

interface MobileDeviceRecord {
  id: string;
  name: string;
  tokenHash: string;
  baseUrl: string;
  createdAt: string;
  scopes?: MobileScope[];
  lastSeenAt?: string;
  revokedAt?: string;
  userAgent?: string;
}

export interface MobileDeviceView {
  id: string;
  name: string;
  baseUrl: string;
  status: "active" | "revoked";
  scopes: MobileScope[];
  createdAt: string;
  lastSeenAt?: string;
  revokedAt?: string;
  userAgent?: string;
}

interface MobileDeviceStore {
  version: 1;
  devices: MobileDeviceRecord[];
  pairingCodes?: PendingPairingCode[];
}

let cachedStore: MobileDeviceStore | null = null;
let cachedStorePath = "";
// mtime of the file when we cached it, so a revoke/remove performed by another
// process (e.g. `cybara mobile revoke`) is honored by a running gateway instead
// of being masked by a stale in-memory cache.
let cachedMtimeMs = 0;

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

const testStoreName = createHash("sha256")
  .update(`${process.cwd()}:${process.pid}`)
  .digest("hex")
  .slice(0, 16);

export function getMobileDeviceStorePath(): string {
  const override = process.env.CYBARA_MOBILE_DEVICES_STORE?.trim();
  if (override) return resolve(override);
  if (process.env.NODE_ENV === "test") {
    return join(tmpdir(), "cybara-mobile-device-test-stores", `${testStoreName}.json`);
  }
  return join(secureDir, "mobile-devices.json");
}

function ensureCacheForPath(path: string): void {
  if (cachedStorePath === path) return;
  cachedStorePath = path;
  cachedStore = null;
  cachedMtimeMs = 0;
}

function sanitizeName(value: unknown): string {
  if (typeof value !== "string") return "Mobile Device";
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed.slice(0, 80) : "Mobile Device";
}

export function normalizeMobileGatewayUrl(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) throw new Error("Gateway URL is required");
  const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
  const parsed = new URL(withProtocol);
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error("Gateway URL must use http or https");
  }
  parsed.search = "";
  parsed.hash = "";
  return parsed.toString().replace(/\/+$/, "");
}

function normalizeMobileBasePath(value?: string): string {
  const trimmed = value?.trim() || "";
  if (!trimmed || trimmed === "/") return "";
  return `/${trimmed.replace(/^\/+|\/+$/g, "")}`;
}

function isLoopbackHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  return host === "localhost" || host === "::1" || host === "0.0.0.0" || host.startsWith("127.");
}

export function isLoopbackMobileGatewayUrl(input: string): boolean {
  try {
    const parsed = new URL(/^https?:\/\//i.test(input) ? input : `http://${input}`);
    return isLoopbackHost(parsed.hostname);
  } catch {
    return false;
  }
}

function readLanIPv4Addresses(
  interfaces: NodeJS.Dict<NetworkInterfaceInfo[]> = networkInterfaces()
): string[] {
  const addresses = new Set<string>();
  for (const entries of Object.values(interfaces)) {
    const list: NetworkInterfaceInfo[] = entries ?? [];
    for (const entry of list) {
      if (entry.family !== "IPv4" || entry.internal) continue;
      if (isLoopbackHost(entry.address) || entry.address.startsWith("169.254.")) continue;
      addresses.add(entry.address);
    }
  }
  return [...addresses].sort();
}

function addUniqueUrl(target: string[], value: string): void {
  try {
    const normalized = normalizeMobileGatewayUrl(value);
    if (!target.includes(normalized)) target.push(normalized);
  } catch {}
}

function hostEnablesLan(hostname: string): boolean {
  const host = hostname.trim().toLowerCase();
  if (!host) return false;
  if (host === "0.0.0.0" || host === "::" || host === "[::]") return true;
  return !isLoopbackHost(host);
}

function buildLanEnableCommand(lanAddresses: string[]): string {
  const address = lanAddresses[0];
  return address ? `CYBARA_HOST=${address} cybara start` : "cybara start --expose";
}

export function buildMobileConnectInfo(input: {
  requestUrl?: string;
  configuredHost?: string;
  port?: number;
  basePath?: string;
  mobileBaseUrl?: string;
  interfaces?: NodeJS.Dict<NetworkInterfaceInfo[]>;
}): MobileConnectInfo {
  const basePath = normalizeMobileBasePath(input.basePath);
  const fallbackPort = input.port || 4269;
  const requestUrl = input.requestUrl || `http://127.0.0.1:${fallbackPort}${basePath || "/"}`;
  const parsed = new URL(requestUrl, `http://127.0.0.1:${fallbackPort}`);
  const port = parsed.port || (parsed.protocol === "https:" ? "443" : "80");
  const currentBaseUrl = normalizeMobileGatewayUrl(`${parsed.protocol}//${parsed.host}${basePath}`);
  const lanAddresses = readLanIPv4Addresses(input.interfaces);
  const candidates: string[] = [];
  const mobileBaseUrl = input.mobileBaseUrl?.trim();
  const isCurrentLoopback = isLoopbackMobileGatewayUrl(currentBaseUrl);
  const lanAccessEnabled = hostEnablesLan(input.configuredHost || parsed.hostname);
  const warnings: string[] = [];

  if (mobileBaseUrl) addUniqueUrl(candidates, mobileBaseUrl);
  if (!isCurrentLoopback) {
    addUniqueUrl(candidates, currentBaseUrl);
  }
  if (lanAccessEnabled) {
    for (const address of lanAddresses) {
      addUniqueUrl(candidates, `${parsed.protocol}//${address}:${port}${basePath}`);
    }
  }
  addUniqueUrl(candidates, currentBaseUrl);
  if (!lanAccessEnabled) {
    for (const address of lanAddresses) {
      addUniqueUrl(candidates, `${parsed.protocol}//${address}:${port}${basePath}`);
    }
  }

  if (isCurrentLoopback) {
    warnings.push("127.0.0.1 and localhost only work on this computer. Use a LAN URL for a phone.");
  }
  if (!lanAccessEnabled) {
    warnings.push("Restart the gateway bound to a LAN address before pairing a physical phone.");
  }
  if (!mobileBaseUrl && lanAddresses.length === 0) {
    warnings.push("No non-loopback IPv4 LAN address was detected on this machine.");
  }

  return {
    baseUrl: candidates[0] || currentBaseUrl,
    currentBaseUrl,
    candidates,
    lanAddresses,
    lanAccessEnabled,
    isCurrentLoopback,
    warnings,
    exposeCommand: buildLanEnableCommand(lanAddresses),
  };
}

function readStore(): MobileDeviceStore {
  const storePath = getMobileDeviceStorePath();
  ensureCacheForPath(storePath);
  if (!existsSync(storePath)) {
    cachedStore = { version: 1, devices: [] };
    cachedMtimeMs = 0;
    return cachedStore;
  }

  // Reuse the cache only while the file on disk hasn't changed under us.
  let mtimeMs = 0;
  try {
    mtimeMs = statSync(storePath).mtimeMs;
  } catch {
    mtimeMs = 0;
  }
  if (cachedStore && mtimeMs === cachedMtimeMs) return cachedStore;

  try {
    const parsed = JSON.parse(readFileSync(storePath, "utf8")) as Partial<MobileDeviceStore>;
    cachedMtimeMs = mtimeMs;
    cachedStore = {
      version: 1,
      devices: Array.isArray(parsed.devices)
        ? parsed.devices.filter((device): device is MobileDeviceRecord =>
            Boolean(device?.id && device?.name && device?.tokenHash && device?.createdAt)
          )
        : [],
      pairingCodes: Array.isArray(parsed.pairingCodes)
        ? parsed.pairingCodes.filter((c): c is PendingPairingCode =>
            Boolean(c?.code && c?.baseUrl && typeof c?.expiresAt === "number")
          )
        : [],
    };
  } catch {
    cachedStore = { version: 1, devices: [] };
    cachedMtimeMs = mtimeMs;
  }
  return cachedStore;
}

function saveStore(store: MobileDeviceStore): void {
  const storePath = getMobileDeviceStorePath();
  ensureCacheForPath(storePath);
  cachedStore = store;
  // Atomic write (tmp + rename) so a crash mid-write can't corrupt the store
  // and wipe paired devices on the next read.
  mkdirSync(dirname(storePath), { recursive: true });
  const tmpPath = `${storePath}.tmp`;
  writeFileSync(tmpPath, JSON.stringify(store, null, 2), { mode: 0o600 });
  renameSync(tmpPath, storePath);
  try {
    cachedMtimeMs = statSync(storePath).mtimeMs;
  } catch {
    cachedMtimeMs = 0;
  }
}

function toView(device: MobileDeviceRecord): MobileDeviceView {
  return {
    id: device.id,
    name: device.name,
    baseUrl: device.baseUrl,
    status: device.revokedAt ? "revoked" : "active",
    scopes: normalizeMobileScopes(device.scopes),
    createdAt: device.createdAt,
    lastSeenAt: device.lastSeenAt,
    revokedAt: device.revokedAt,
    userAgent: device.userAgent,
  };
}

export function listMobileDevices(): MobileDeviceView[] {
  return [...readStore().devices]
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
    .map(toView);
}

export function buildMobileConnectPayload(input: {
  gatewayName?: string;
  baseUrl: string;
  apiKey: string;
  deviceId: string;
  createdAt?: string;
}): MobileConnectPayload {
  const apiKey = input.apiKey.trim();
  if (!apiKey) throw new Error("API key is required");
  return {
    protocol: MOBILE_CONNECT_PROTOCOL,
    name: sanitizeName(input.gatewayName || "Cybara Gateway"),
    baseUrl: normalizeMobileGatewayUrl(input.baseUrl),
    apiKey,
    deviceId: input.deviceId,
    createdAt: input.createdAt || new Date().toISOString(),
  };
}

export function encodeMobileConnectPayload(payload: MobileConnectPayload): string {
  return JSON.stringify(payload);
}

export function createMobileDevice(input: {
  deviceName?: string;
  gatewayName?: string;
  baseUrl: string;
  scopes?: unknown;
}): { device: MobileDeviceView; token: string; payload: MobileConnectPayload; encoded: string } {
  const now = new Date().toISOString();
  const id = `mobile_${randomBytes(9).toString("hex")}`;
  const token = `cybara_mobile_${randomBytes(24).toString("hex")}`;
  const baseUrl = normalizeMobileGatewayUrl(input.baseUrl);
  const store = readStore();
  const record: MobileDeviceRecord = {
    id,
    name: sanitizeName(input.deviceName),
    tokenHash: hashToken(token),
    baseUrl,
    createdAt: now,
    scopes:
      input.scopes === undefined ? [...DEFAULT_MOBILE_SCOPES] : normalizeMobileScopes(input.scopes),
  };

  store.devices.unshift(record);
  saveStore(store);

  const payload = buildMobileConnectPayload({
    gatewayName: input.gatewayName,
    baseUrl,
    apiKey: token,
    deviceId: id,
    createdAt: now,
  });
  return { device: toView(record), token, payload, encoded: encodeMobileConnectPayload(payload) };
}

function generatePairingCode(): string {
  // 8 base32-ish chars (no ambiguous 0/O/1/I), grouped as XXXX-XXXX.
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = randomBytes(8);
  const chars = Array.from(bytes, (b) => alphabet[b % alphabet.length]);
  return `${chars.slice(0, 4).join("")}-${chars.slice(4).join("")}`;
}

function constantTimeCodeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a.toUpperCase());
  const bufB = Buffer.from(b.toUpperCase());
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

function prunePairingCodes(store: MobileDeviceStore, now: number): PendingPairingCode[] {
  return (store.pairingCodes ?? []).filter((c) => c.expiresAt > now);
}

/**
 * Create a short-lived, single-use pairing code (not a token). The QR/link
 * carries only this code; the device redeems it for a scoped device token. The
 * code carries the role/scopes and expires, so a leaked QR can't be reused.
 */
export function createPairingCode(input: {
  baseUrl: string;
  gatewayName?: string;
  deviceName?: string;
  role?: string;
  scopes?: unknown;
  ttlMs?: number;
}): { code: string; expiresAt: number; payload: MobilePairingCodePayload; encoded: string } {
  const now = Date.now();
  const baseUrl = normalizeMobileGatewayUrl(input.baseUrl);
  const ttl = input.ttlMs && input.ttlMs > 0 ? input.ttlMs : DEFAULT_PAIRING_CODE_TTL_MS;
  const roleScopes = scopesForRole(input.role);
  const scopes =
    roleScopes ??
    (input.scopes === undefined ? [...DEFAULT_MOBILE_SCOPES] : normalizeMobileScopes(input.scopes));

  const store = readStore();
  const code = generatePairingCode();
  const expiresAt = now + ttl;
  const pending: PendingPairingCode = {
    code,
    scopes,
    role: typeof input.role === "string" ? input.role : undefined,
    deviceName: input.deviceName ? sanitizeName(input.deviceName) : undefined,
    gatewayName: input.gatewayName,
    baseUrl,
    createdAt: new Date(now).toISOString(),
    expiresAt,
  };
  saveStore({ ...store, pairingCodes: [...prunePairingCodes(store, now), pending] });

  const payload: MobilePairingCodePayload = {
    protocol: MOBILE_PAIRING_PROTOCOL,
    name: sanitizeName(input.gatewayName || "Cybara Gateway"),
    baseUrl,
    code,
    role: pending.role,
    expiresAt,
  };
  return { code, expiresAt, payload, encoded: JSON.stringify(payload) };
}

export interface PairingRedemptionResult {
  device: MobileDeviceView;
  token: string;
  payload: MobileConnectPayload;
  encoded: string;
}

/**
 * Redeem a pairing code for a scoped device token. One-time: the code is
 * consumed on success. Returns null when the code is unknown, expired, or
 * already used. Case/whitespace-insensitive on the code.
 */
export function redeemPairingCode(
  rawCode: string,
  metadata: { userAgent?: string } = {}
): PairingRedemptionResult | null {
  const now = Date.now();
  const code = rawCode.trim().toUpperCase();
  if (!code) return null;

  const store = readStore();
  const live = prunePairingCodes(store, now);
  const match = live.find((c) => constantTimeCodeEqual(c.code, code));
  if (!match) {
    // Persist the pruning of any expired codes even on a miss.
    if ((store.pairingCodes ?? []).length !== live.length) {
      saveStore({ ...store, pairingCodes: live });
    }
    return null;
  }

  // Consume the code (one-time) before issuing the token.
  const remaining = live.filter((c) => c.code !== match.code);
  saveStore({ ...store, pairingCodes: remaining });

  const created = createMobileDevice({
    deviceName: match.deviceName,
    gatewayName: match.gatewayName,
    baseUrl: match.baseUrl,
    scopes: match.scopes,
  });
  if (metadata.userAgent?.trim()) {
    const s = readStore();
    const rec = s.devices.find((d) => d.id === created.device.id);
    if (rec) {
      rec.userAgent = metadata.userAgent.trim().slice(0, 160);
      saveStore(s);
    }
  }
  return {
    device: created.device,
    token: created.token,
    payload: created.payload,
    encoded: created.encoded,
  };
}

export function revokeMobileDevice(id: string): MobileDeviceView | null {
  const store = readStore();
  const device = store.devices.find((item) => item.id === id);
  if (!device) return null;
  if (!device.revokedAt) {
    device.revokedAt = new Date().toISOString();
    saveStore(store);
  }
  return toView(device);
}

export function removeMobileDevice(id: string): boolean {
  const store = readStore();
  const nextDevices = store.devices.filter((device) => device.id !== id);
  if (nextDevices.length === store.devices.length) return false;
  saveStore({ ...store, devices: nextDevices });
  return true;
}

export function authenticateMobileDeviceToken(
  token: string,
  metadata: { userAgent?: string } = {}
): MobileDeviceView | null {
  const normalized = token.trim();
  if (!normalized) return null;
  const store = readStore();
  const tokenHash = hashToken(normalized);
  const device = store.devices.find((item) => item.tokenHash === tokenHash && !item.revokedAt);
  if (!device) return null;

  const now = Date.now();
  const previousSeenAt = device.lastSeenAt ? Date.parse(device.lastSeenAt) : 0;
  if (!previousSeenAt || now - previousSeenAt > 60_000) {
    device.lastSeenAt = new Date(now).toISOString();
    if (metadata.userAgent?.trim()) {
      device.userAgent = metadata.userAgent.trim().slice(0, 160);
    }
    saveStore(store);
  }
  return toView(device);
}

export function resetMobileDeviceStoreForTests(): void {
  if (process.env.NODE_ENV !== "test") {
    cachedStore = null;
    cachedMtimeMs = 0;
    return;
  }
  cachedStore = { version: 1, devices: [] };
  saveStore(cachedStore);
}
