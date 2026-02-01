// Channel Security - DM Policies, Pairing Codes, and Allowed Senders
// Implements OpenClaw-style security for channel adapters

import { randomBytes } from "crypto";

// DM Policy options
export type DMPolicy = "pairing" | "allowlist" | "open" | "disabled";

// Pairing request stored in database
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

// Security configuration per channel
export interface ChannelSecurityConfig {
    dm_policy: DMPolicy;
    allowed_senders: string[]; // Platform-specific sender IDs
    pairing_expiry_minutes: number; // Default: 60
    max_pending_pairings: number; // Default: 3
}

// Access check result
export interface AccessCheckResult {
    permitted: boolean;
    reason?: "allowed" | "pending_pairing" | "new_pairing" | "blocked" | "disabled";
    code?: string; // Pairing code if new_pairing
    message?: string;
}

// Default security config
export const DEFAULT_SECURITY_CONFIG: ChannelSecurityConfig = {
    dm_policy: "pairing",
    allowed_senders: [],
    pairing_expiry_minutes: 60,
    max_pending_pairings: 3,
};

/**
 * Generate a cryptographically secure pairing code
 * Format: 6 alphanumeric characters (uppercase)
 */
export function generatePairingCode(): string {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // Removed confusing chars: 0, O, 1, I
    const bytes = randomBytes(6);
    let code = "";
    for (let i = 0; i < 6; i++) {
        code += chars[bytes[i] % chars.length];
    }
    return code;
}

/**
 * Channel Security Manager
 * Handles DM policies, pairing codes, and sender allowlists
 */
export class ChannelSecurityManager {
    // In-memory pairing storage (should be persisted to database in production)
    private pairings = new Map<string, PairingRequest[]>();
    private allowedSenders = new Map<string, Set<string>>();
    private securityConfigs = new Map<string, ChannelSecurityConfig>();

    /**
     * Set security configuration for a channel
     */
    setConfig(channelId: string, config: Partial<ChannelSecurityConfig>): void {
        const existing = this.securityConfigs.get(channelId) || { ...DEFAULT_SECURITY_CONFIG };
        this.securityConfigs.set(channelId, { ...existing, ...config });

        // Initialize allowed senders set
        if (config.allowed_senders) {
            this.allowedSenders.set(channelId, new Set(config.allowed_senders));
        }
    }

    /**
     * Get security configuration for a channel
     */
    getConfig(channelId: string): ChannelSecurityConfig {
        return this.securityConfigs.get(channelId) || { ...DEFAULT_SECURITY_CONFIG };
    }

    /**
     * Check if a sender is allowed to message on a channel
     */
    checkAccess(
        channelId: string,
        senderId: string,
        platform: string,
        senderName?: string
    ): AccessCheckResult {
        const config = this.getConfig(channelId);

        // Policy: disabled - ignore all messages
        if (config.dm_policy === "disabled") {
            return { permitted: false, reason: "disabled", message: "DMs are disabled for this channel" };
        }

        // Policy: open - allow everyone
        if (config.dm_policy === "open") {
            return { permitted: true, reason: "allowed" };
        }

        // Check allowlist
        const allowed = this.allowedSenders.get(channelId);
        if (allowed?.has(senderId) || allowed?.has("*")) {
            return { permitted: true, reason: "allowed" };
        }

        // Policy: allowlist only - block if not in allowlist
        if (config.dm_policy === "allowlist") {
            return {
                permitted: false,
                reason: "blocked",
                message: "You are not authorized to message this bot",
            };
        }

        // Policy: pairing - check for existing pairing or create new one
        if (config.dm_policy === "pairing") {
            // Check for existing pending pairing
            const existingPairing = this.getPendingPairing(channelId, senderId);
            if (existingPairing) {
                return {
                    permitted: false,
                    reason: "pending_pairing",
                    code: existingPairing.code,
                    message: `Your pairing request is pending approval. Code: ${existingPairing.code}`,
                };
            }

            // Check if max pending pairings reached
            const pending = this.getPendingPairings(channelId);
            if (pending.length >= config.max_pending_pairings) {
                return {
                    permitted: false,
                    reason: "blocked",
                    message: "Maximum pending pairing requests reached. Please try again later.",
                };
            }

            // Create new pairing request
            const pairing = this.createPairing(channelId, senderId, platform, senderName);
            return {
                permitted: false,
                reason: "new_pairing",
                code: pairing.code,
                message: `🔐 Pairing code: ${pairing.code}\n\nPlease provide this code to the admin to get access.`,
            };
        }

        // Default: block
        return { permitted: false, reason: "blocked" };
    }

    /**
     * Create a new pairing request
     */
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

        // Store pairing
        const channelPairings = this.pairings.get(channelId) || [];
        channelPairings.push(pairing);
        this.pairings.set(channelId, channelPairings);

        console.log(`[Security] Created pairing for ${platform}:${senderId} on channel ${channelId}: ${pairing.code}`);

        return pairing;
    }

    /**
     * Get pending pairing for a sender
     */
    getPendingPairing(channelId: string, senderId: string): PairingRequest | undefined {
        const now = Date.now();
        const channelPairings = this.pairings.get(channelId) || [];

        return channelPairings.find(
            (p) => p.sender_id === senderId && p.status === "pending" && p.expires_at > now
        );
    }

    /**
     * Get all pending pairings for a channel
     */
    getPendingPairings(channelId: string): PairingRequest[] {
        const now = Date.now();
        const channelPairings = this.pairings.get(channelId) || [];

        // Clean up expired pairings
        const valid = channelPairings.filter((p) => {
            if (p.status === "pending" && p.expires_at <= now) {
                p.status = "expired";
                return false;
            }
            return p.status === "pending";
        });

        return valid;
    }

    /**
     * Verify and approve a pairing code
     */
    verifyPairing(channelId: string, code: string): { success: boolean; senderId?: string; error?: string } {
        const channelPairings = this.pairings.get(channelId) || [];
        const now = Date.now();

        const pairing = channelPairings.find(
            (p) => p.code.toUpperCase() === code.toUpperCase() && p.status === "pending"
        );

        if (!pairing) {
            return { success: false, error: "Invalid or expired pairing code" };
        }

        if (pairing.expires_at <= now) {
            pairing.status = "expired";
            return { success: false, error: "Pairing code has expired" };
        }

        // Approve pairing
        pairing.status = "approved";

        // Add to allowed senders
        this.addAllowedSender(channelId, pairing.sender_id);

        console.log(`[Security] Approved pairing for ${pairing.platform}:${pairing.sender_id} on channel ${channelId}`);

        return { success: true, senderId: pairing.sender_id };
    }

    /**
     * Reject a pairing request
     */
    rejectPairing(channelId: string, pairingId: string): boolean {
        const channelPairings = this.pairings.get(channelId) || [];
        const pairing = channelPairings.find((p) => p.id === pairingId);

        if (!pairing || pairing.status !== "pending") {
            return false;
        }

        pairing.status = "rejected";
        console.log(`[Security] Rejected pairing ${pairingId} on channel ${channelId}`);
        return true;
    }

    /**
     * Add a sender to the allowed list
     */
    addAllowedSender(channelId: string, senderId: string): void {
        let allowed = this.allowedSenders.get(channelId);
        if (!allowed) {
            allowed = new Set();
            this.allowedSenders.set(channelId, allowed);
        }
        allowed.add(senderId);

        // Update config
        const config = this.getConfig(channelId);
        if (!config.allowed_senders.includes(senderId)) {
            config.allowed_senders.push(senderId);
        }

        console.log(`[Security] Added allowed sender ${senderId} to channel ${channelId}`);
    }

    /**
     * Remove a sender from the allowed list
     */
    removeAllowedSender(channelId: string, senderId: string): boolean {
        const allowed = this.allowedSenders.get(channelId);
        if (!allowed) return false;

        const removed = allowed.delete(senderId);

        // Update config
        if (removed) {
            const config = this.getConfig(channelId);
            config.allowed_senders = config.allowed_senders.filter((s) => s !== senderId);
        }

        return removed;
    }

    /**
     * Get all allowed senders for a channel
     */
    getAllowedSenders(channelId: string): string[] {
        const allowed = this.allowedSenders.get(channelId);
        return allowed ? Array.from(allowed) : [];
    }

    /**
     * Check if a sender is in the allowlist
     */
    isAllowed(channelId: string, senderId: string): boolean {
        const allowed = this.allowedSenders.get(channelId);
        return allowed?.has(senderId) || allowed?.has("*") || false;
    }

    /**
     * Get all pairings for a channel (for admin UI)
     */
    getAllPairings(channelId: string): PairingRequest[] {
        return this.pairings.get(channelId) || [];
    }

    /**
     * Clean up expired pairings
     */
    cleanupExpired(): number {
        const now = Date.now();
        let cleaned = 0;

        for (const [channelId, pairings] of this.pairings) {
            const valid = pairings.filter((p) => {
                if (p.status === "pending" && p.expires_at <= now) {
                    p.status = "expired";
                    cleaned++;
                }
                // Keep approved/rejected for audit, remove old expired
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

// Singleton instance
export const securityManager = new ChannelSecurityManager();

// Start cleanup interval
setInterval(() => {
    const cleaned = securityManager.cleanupExpired();
    if (cleaned > 0) {
        console.log(`[Security] Cleaned up ${cleaned} expired pairings`);
    }
}, 5 * 60 * 1000); // Every 5 minutes
