import { createHash, randomBytes } from "crypto";
import { existsSync, readFileSync, statSync, writeFileSync } from "fs";
import { join } from "path";
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

/**
 * Capability scopes a paired device may hold. A device only gets the scopes it
 * was granted, so a stolen token can't reach capabilities the owner didn't opt
 * into (notably fund-moving wallet ops and terminal execution).
 */
export const MOBILE_SCOPES = ["chat", "manage", "read", "wallet", "terminal"] as const;
export type MobileScope = (typeof MOBILE_SCOPES)[number];

/** Default scopes for a new pairing: everything the mobile app needs, minus */
/* the dangerous wallet (transfers/signing) and terminal capabilities. */
export const DEFAULT_MOBILE_SCOPES: MobileScope[] = ["chat", "manage", "read"];

export function normalizeMobileScopes(value: unknown): MobileScope[] {
  if (!Array.isArray(value)) return [...DEFAULT_MOBILE_SCOPES];
  const valid = value.filter(
    (s): s is MobileScope => typeof s === "string" && (MOBILE_SCOPES as readonly string[]).includes(s)
  );
  return valid.length > 0 ? Array.from(new Set(valid)) : [...DEFAULT_MOBILE_SCOPES];
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
}

const storePath = join(secureDir, "mobile-devices.json");
let cachedStore: MobileDeviceStore | null = null;
// mtime of the file when we cached it, so a revoke/remove performed by another
// process (e.g. `cybara mobile revoke`) is honored by a running gateway instead
// of being masked by a stale in-memory cache.
let cachedMtimeMs = 0;

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
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

function readStore(): MobileDeviceStore {
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
    };
  } catch {
    cachedStore = { version: 1, devices: [] };
  }
  return cachedStore;
}

function saveStore(store: MobileDeviceStore): void {
  cachedStore = store;
  writeFileSync(storePath, JSON.stringify(store, null, 2), { mode: 0o600 });
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
    scopes: input.scopes === undefined ? [...DEFAULT_MOBILE_SCOPES] : normalizeMobileScopes(input.scopes),
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
  saveStore({ version: 1, devices: nextDevices });
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
  cachedStore = { version: 1, devices: [] };
  saveStore(cachedStore);
}
