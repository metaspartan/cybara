import { hostname } from "os";
import { config } from "../config";
import { openSecret, sealSecret } from "../secret-storage";
import { createNearbyIdentity } from "./crypto";
import type { NearbyIdentity, NearbyIncomingTransfer, NearbyPeer, NearbySettings } from "./types";

const SETTINGS_KEY = "nearby_settings";
const IDENTITY_KEY = "nearby_identity";
const PEERS_KEY = "nearby_peers";
const TRANSFERS_KEY = "nearby_transfers";
const IDENTITY_CONTEXT = "nearby-identity-private-key";
const PEER_CONTEXT_PREFIX = "nearby-peer-shared-key:";

export const DEFAULT_NEARBY_SETTINGS: NearbySettings = {
  enabled: false,
  displayName: hostname().trim().slice(0, 64) || "Cybara",
  port: 4270,
  discoveryMinutes: 10,
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function boundedInteger(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, Math.round(parsed))) : fallback;
}

export function normalizeNearbySettings(value: unknown): NearbySettings {
  const record = asRecord(value);
  const displayName =
    typeof record?.displayName === "string" && record.displayName.trim()
      ? record.displayName.trim().slice(0, 64)
      : DEFAULT_NEARBY_SETTINGS.displayName;
  return {
    enabled: record?.enabled === true,
    displayName,
    port: boundedInteger(record?.port, DEFAULT_NEARBY_SETTINGS.port, 1024, 65_535),
    discoveryMinutes: boundedInteger(
      record?.discoveryMinutes,
      DEFAULT_NEARBY_SETTINGS.discoveryMinutes,
      1,
      60
    ),
  };
}

export function getNearbySettings(): NearbySettings {
  return normalizeNearbySettings(config.get<unknown>(SETTINGS_KEY));
}

export function setNearbySettings(value: unknown): NearbySettings {
  const settings = normalizeNearbySettings(value);
  config.set(SETTINGS_KEY, settings);
  return settings;
}

export function getNearbyIdentity(): NearbyIdentity {
  const stored = asRecord(config.get<unknown>(IDENTITY_KEY));
  if (
    typeof stored?.id === "string" &&
    typeof stored.publicKey === "string" &&
    typeof stored.privateKey === "string" &&
    typeof stored.fingerprint === "string"
  ) {
    try {
      return {
        id: stored.id,
        publicKey: stored.publicKey,
        privateKey: openSecret(stored.privateKey, IDENTITY_CONTEXT),
        fingerprint: stored.fingerprint,
      };
    } catch {
      void 0;
    }
  }
  const identity = createNearbyIdentity();
  config.set(IDENTITY_KEY, {
    ...identity,
    privateKey: sealSecret(identity.privateKey, IDENTITY_CONTEXT),
  });
  return identity;
}

export function getNearbyPeers(): NearbyPeer[] {
  const stored = config.get<unknown>(PEERS_KEY);
  if (!Array.isArray(stored)) return [];
  const peers: NearbyPeer[] = [];
  for (const value of stored) {
    const record = asRecord(value);
    if (
      typeof record?.id !== "string" ||
      typeof record.name !== "string" ||
      typeof record.baseUrl !== "string" ||
      typeof record.publicKey !== "string" ||
      typeof record.fingerprint !== "string" ||
      typeof record.sharedKey !== "string" ||
      typeof record.pairedAt !== "string"
    ) {
      continue;
    }
    try {
      peers.push({
        id: record.id,
        name: record.name,
        baseUrl: record.baseUrl,
        publicKey: record.publicKey,
        fingerprint: record.fingerprint,
        sharedKey: openSecret(record.sharedKey, `${PEER_CONTEXT_PREFIX}${record.id}`),
        pairedAt: record.pairedAt,
        lastSeenAt: typeof record.lastSeenAt === "string" ? record.lastSeenAt : undefined,
        syncEnabled: record.syncEnabled === true,
      });
    } catch {
      continue;
    }
  }
  return peers;
}

export function setNearbyPeers(peers: NearbyPeer[]): void {
  config.set(
    PEERS_KEY,
    peers.map((peer) => ({
      ...peer,
      sharedKey: sealSecret(peer.sharedKey, `${PEER_CONTEXT_PREFIX}${peer.id}`),
    }))
  );
}

export function getNearbyIncomingTransfers(): NearbyIncomingTransfer[] {
  const stored = config.get<unknown>(TRANSFERS_KEY);
  return Array.isArray(stored) ? (stored as NearbyIncomingTransfer[]) : [];
}

export function setNearbyIncomingTransfers(transfers: NearbyIncomingTransfer[]): void {
  config.set(TRANSFERS_KEY, transfers.slice(-100));
}
