import { randomBytes, timingSafeEqual } from "crypto";
import { createLogger } from "../logger";
import db from "../database";

function pairingCodeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a.toUpperCase());
  const bufB = Buffer.from(b.toUpperCase());
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}


const log = createLogger("Security");

export type DMPolicy = "pairing" | "allowlist" | "open" | "disabled";
export type GroupPolicy = "owner_only" | "allowlist" | "open" | "disabled";

export interface PairingRequest {
  id: string;
  channel_id: string;
  sender_id: string;
  platform: string;
  code: string;
  created_at: number;
  expires_at: number;
  status: "pending" | "approved" | "expired" | "rejected";
  sender_name?: string;
  metadata?: Record<string, unknown>;
}

export interface ChannelSecurityConfig {
  dm_policy: DMPolicy;
  group_policy: GroupPolicy;
  group_owner_sender_id: string;
  allowed_senders: string[]; // Platform-specific sender IDs
  pairing_expiry_minutes: number; // Default: 60
  max_pending_pairings: number; // Default: 3
}

export interface AccessCheckResult {
  permitted: boolean;
  reason?: "allowed" | "pending_pairing" | "new_pairing" | "blocked" | "disabled";
  code?: string; // Pairing code if new_pairing
  message?: string;
  silent?: boolean;
}

export const DEFAULT_SECURITY_CONFIG: ChannelSecurityConfig = {
  dm_policy: "pairing",
  group_policy: "owner_only",
  group_owner_sender_id: "",
  allowed_senders: [],
  pairing_expiry_minutes: 60,
  max_pending_pairings: 3,
};

const VALID_DM_POLICIES: readonly DMPolicy[] = ["pairing", "allowlist", "open", "disabled"];
const VALID_GROUP_POLICIES: readonly GroupPolicy[] = [
  "owner_only",
  "allowlist",
  "open",
  "disabled",
];

export function buildChannelSecurityConfig(
  config: Record<string, unknown>
): Partial<ChannelSecurityConfig> {
  const dmPolicyRaw = config.dm_policy;
  const dmPolicy =
    typeof dmPolicyRaw === "string" && VALID_DM_POLICIES.includes(dmPolicyRaw as DMPolicy)
      ? (dmPolicyRaw as DMPolicy)
      : "pairing";
  const groupPolicyRaw = config.group_policy;
  const groupPolicy =
    typeof groupPolicyRaw === "string" &&
    VALID_GROUP_POLICIES.includes(groupPolicyRaw as GroupPolicy)
      ? (groupPolicyRaw as GroupPolicy)
      : "owner_only";
  const groupOwnerRaw = config.group_owner_sender_id ?? config.owner_sender_id;
  const groupOwnerSenderId =
    typeof groupOwnerRaw === "string" ? groupOwnerRaw.trim() : "";

  const securityConfig: Partial<ChannelSecurityConfig> = {
    dm_policy: dmPolicy,
    group_policy: groupPolicy,
    group_owner_sender_id: groupOwnerSenderId,
  };

  if (Array.isArray(config.allowed_senders)) {
    securityConfig.allowed_senders = config.allowed_senders
      .filter((sender): sender is string => typeof sender === "string")
      .map((sender) => sender.trim())
      .filter((sender) => sender.length > 0);
  }

  return securityConfig;
}

export function generatePairingCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // Removed confusing chars: 0, O, 1, I
  const bytes = randomBytes(6);
  let code = "";
  for (let i = 0; i < 6; i++) {
    code += chars[bytes[i] % chars.length];
  }
  return code;
}

export class ChannelSecurityManager {
  private pairings = new Map<string, PairingRequest[]>();
  private allowedSenders = new Map<string, Set<string>>();
  private securityConfigs = new Map<string, ChannelSecurityConfig>();
  private initialized = false;

  initialize(): void {
    if (this.initialized) return;

    try {
      const stmt = db.prepare("SELECT channel_id, sender_id FROM allowed_senders");
      const rows = stmt.all() as Array<{ channel_id: string; sender_id: string }>;

      for (const row of rows) {
        let allowed = this.allowedSenders.get(row.channel_id);
        if (!allowed) {
          allowed = new Set();
          this.allowedSenders.set(row.channel_id, allowed);
        }
        allowed.add(row.sender_id);
      }

      log.info(`Loaded ${rows.length} allowed senders from database`);
      this.initialized = true;
    } catch (error) {
      log.error("Failed to load allowed senders from database", {
        error: (error as Error).message,
      });
    }
  }

  setConfig(channelId: string, config: Partial<ChannelSecurityConfig>): void {
    const existing = this.securityConfigs.get(channelId) || { ...DEFAULT_SECURITY_CONFIG };
    this.securityConfigs.set(channelId, { ...existing, ...config });

    if (config.allowed_senders) {
      this.allowedSenders.set(channelId, new Set(config.allowed_senders));
    }
  }

  getConfig(channelId: string): ChannelSecurityConfig {
    if (!this.initialized) this.initialize();

    // Copy so callers/cache holders never see the stored config mutated under them.
    const config = { ...(this.securityConfigs.get(channelId) || DEFAULT_SECURITY_CONFIG) };
    const persistedSenders = this.allowedSenders.get(channelId);
    if (persistedSenders) {
      config.allowed_senders = Array.from(persistedSenders);
    }
    return config;
  }

  checkAccess(
    channelId: string,
    senderId: string,
    platform: string,
    senderName?: string,
    options?: { isGroup?: boolean }
  ): AccessCheckResult {
    const config = this.getConfig(channelId);
    const isGroup = options?.isGroup === true;

    const allowed = this.allowedSenders.get(channelId);
    if (allowed?.has(senderId) || allowed?.has("*")) {
      return { permitted: true, reason: "allowed" };
    }

    if (isGroup) {
      if (config.group_policy === "disabled") {
        return {
          permitted: false,
          reason: "disabled",
          message: "Group messages are disabled for this channel",
          silent: true,
        };
      }

      if (config.group_policy === "open") {
        return { permitted: true, reason: "allowed" };
      }

      if (config.group_policy === "owner_only") {
        const ownerSenderId = (config.group_owner_sender_id || "").trim();
        if (ownerSenderId && senderId === ownerSenderId) {
          return { permitted: true, reason: "allowed" };
        }
        return {
          permitted: false,
          reason: "blocked",
          message: ownerSenderId
            ? "Only the configured channel owner can use this bot in groups."
            : "Channel owner is not configured for group access.",
          silent: true,
        };
      }

      if (config.group_policy === "allowlist") {
        return {
          permitted: false,
          reason: "blocked",
          message: "You are not authorized to use this bot in this group.",
          silent: true,
        };
      }

      return { permitted: false, reason: "blocked", silent: true };
    }

    // DM policy: disabled - ignore all messages
    if (config.dm_policy === "disabled") {
      return { permitted: false, reason: "disabled", message: "DMs are disabled for this channel" };
    }

    if (config.dm_policy === "open") {
      return { permitted: true, reason: "allowed" };
    }

    if (config.dm_policy === "allowlist") {
      return {
        permitted: false,
        reason: "blocked",
        message: "You are not authorized to message this bot",
      };
    }

    if (config.dm_policy === "pairing") {
      const existingPairing = this.getPendingPairing(channelId, senderId);
      if (existingPairing) {
        return {
          permitted: false,
          reason: "pending_pairing",
          code: existingPairing.code,
          message: `Your pairing request is pending approval. Code: ${existingPairing.code}`,
        };
      }

      const pending = this.getPendingPairings(channelId);
      if (pending.length >= config.max_pending_pairings) {
        return {
          permitted: false,
          reason: "blocked",
          message: "Maximum pending pairing requests reached. Please try again later.",
        };
      }

      const pairing = this.createPairing(channelId, senderId, platform, senderName);
      return {
        permitted: false,
        reason: "new_pairing",
        code: pairing.code,
        message: `🔐 Pairing code: ${pairing.code}\n\nPlease provide this code to the admin to get access.`,
      };
    }

    return { permitted: false, reason: "blocked" };
  }

  createPairing(
    channelId: string,
    senderId: string,
    platform: string,
    senderName?: string
  ): PairingRequest {
    const config = this.getConfig(channelId);
    const now = Date.now();
    const expiresAt = now + config.pairing_expiry_minutes * 60 * 1000;

    const pairing: PairingRequest = {
      id: crypto.randomUUID(),
      channel_id: channelId,
      sender_id: senderId,
      platform,
      code: generatePairingCode(),
      created_at: now,
      expires_at: expiresAt,
      status: "pending",
      sender_name: senderName,
    };

    const channelPairings = this.pairings.get(channelId) || [];
    channelPairings.push(pairing);
    this.pairings.set(channelId, channelPairings);

    log.info(`Created pairing for ${platform}:${senderId}`, { channelId, code: pairing.code });

    return pairing;
  }

  getPendingPairing(channelId: string, senderId: string): PairingRequest | undefined {
    const now = Date.now();
    const channelPairings = this.pairings.get(channelId) || [];

    return channelPairings.find(
      (p) => p.sender_id === senderId && p.status === "pending" && p.expires_at > now
    );
  }

  getPendingPairings(channelId: string): PairingRequest[] {
    const now = Date.now();
    const channelPairings = this.pairings.get(channelId) || [];

    const valid = channelPairings.filter((p) => {
      if (p.status === "pending" && p.expires_at <= now) {
        p.status = "expired";
        return false;
      }
      return p.status === "pending";
    });

    return valid;
  }

  verifyPairing(
    channelId: string,
    code: string
  ): { success: boolean; senderId?: string; error?: string } {
    const channelPairings = this.pairings.get(channelId) || [];
    const now = Date.now();

    const pairing = channelPairings.find(
      (p) => pairingCodeEqual(p.code, code) && p.status === "pending"
    );

    if (!pairing) {
      return { success: false, error: "Invalid or expired pairing code" };
    }

    if (pairing.expires_at <= now) {
      pairing.status = "expired";
      return { success: false, error: "Pairing code has expired" };
    }

    pairing.status = "approved";

    this.addAllowedSender(channelId, pairing.sender_id);

    log.info(`Approved pairing for ${pairing.platform}:${pairing.sender_id}`, { channelId });

    return { success: true, senderId: pairing.sender_id };
  }

  rejectPairing(channelId: string, pairingId: string): boolean {
    const channelPairings = this.pairings.get(channelId) || [];
    const pairing = channelPairings.find((p) => p.id === pairingId);

    if (!pairing || pairing.status !== "pending") {
      return false;
    }

    pairing.status = "rejected";
    log.info(`Rejected pairing ${pairingId}`, { channelId });
    return true;
  }

  addAllowedSender(
    channelId: string,
    senderId: string,
    platform?: string,
    senderName?: string
  ): void {
    if (!this.initialized) this.initialize();

    let allowed = this.allowedSenders.get(channelId);
    if (!allowed) {
      allowed = new Set();
      this.allowedSenders.set(channelId, allowed);
    }

    if (allowed.has(senderId)) return;

    allowed.add(senderId);

    try {
      const id = crypto.randomUUID();
      const stmt = db.prepare(`
                INSERT OR IGNORE INTO allowed_senders (id, channel_id, sender_id, platform, sender_name)
                VALUES (?, ?, ?, ?, ?)
            `);
      stmt.run(id, channelId, senderId, platform || null, senderName || null);
      log.info(`Added allowed sender ${senderId}`, { channelId, persisted: true });
    } catch (error) {
      log.error("Failed to persist allowed sender", {
        channelId,
        senderId,
        error: (error as Error).message,
      });
    }
  }

  removeAllowedSender(channelId: string, senderId: string): boolean {
    const allowed = this.allowedSenders.get(channelId);
    if (!allowed) return false;

    const removed = allowed.delete(senderId);

    if (removed) {
      try {
        const stmt = db.prepare(
          "DELETE FROM allowed_senders WHERE channel_id = ? AND sender_id = ?"
        );
        stmt.run(channelId, senderId);
        log.info(`Removed allowed sender ${senderId}`, { channelId, persisted: true });
      } catch (error) {
        log.error("Failed to remove allowed sender from db", {
          channelId,
          senderId,
          error: (error as Error).message,
        });
      }
    }

    return removed;
  }

  getAllowedSenders(channelId: string): string[] {
    const allowed = this.allowedSenders.get(channelId);
    return allowed ? Array.from(allowed) : [];
  }

  isAllowed(channelId: string, senderId: string): boolean {
    const allowed = this.allowedSenders.get(channelId);
    return allowed?.has(senderId) || allowed?.has("*") || false;
  }

  getAllPairings(channelId: string): PairingRequest[] {
    return this.pairings.get(channelId) || [];
  }

  cleanupExpired(): number {
    const now = Date.now();
    let cleaned = 0;

    for (const [channelId, pairings] of this.pairings) {
      const valid = pairings.filter((p) => {
        if (p.status === "pending" && p.expires_at <= now) {
          p.status = "expired";
          cleaned++;
        }
        if (p.status === "expired" && p.expires_at < now - 24 * 60 * 60 * 1000) {
          return false;
        }
        return true;
      });
      this.pairings.set(channelId, valid);
    }

    return cleaned;
  }
}

export const securityManager = new ChannelSecurityManager();

// Periodic cleanup of expired pairings. unref() so it never keeps the process
// (or a test runner) alive, and keep the handle so it can be stopped.
const pairingCleanupInterval = setInterval(
  () => {
    const cleaned = securityManager.cleanupExpired();
    if (cleaned > 0) {
      log.debug(`Cleaned up ${cleaned} expired pairings`);
    }
  },
  5 * 60 * 1000
); // Every 5 minutes
pairingCleanupInterval.unref?.();

export function stopPairingCleanup(): void {
  clearInterval(pairingCleanupInterval);
}
