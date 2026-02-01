// Channel Security Tests
import { describe, test, expect, beforeEach } from "bun:test";
import {
    securityManager,
    generatePairingCode,
    DEFAULT_SECURITY_CONFIG,
} from "../../src/core/channels/security";

describe("Security Manager", () => {
    let testChannelId: string;

    beforeEach(() => {
        // Generate unique channel ID for each test to avoid state leakage
        testChannelId = `test-channel-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

        // Reset the security manager state for each test
        securityManager.setConfig(testChannelId, {
            dm_policy: "pairing",
            allowed_senders: [],
            pairing_expiry_minutes: 60,
            max_pending_pairings: 3,
        });
    });

    describe("generatePairingCode", () => {
        test("should generate a 6-character code", () => {
            const code = generatePairingCode();
            expect(code).toHaveLength(6);
        });

        test("should only contain valid characters", () => {
            const validChars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
            for (let i = 0; i < 100; i++) {
                const code = generatePairingCode();
                for (const char of code) {
                    expect(validChars.includes(char)).toBe(true);
                }
            }
        });

        test("should not contain confusing characters (0, O, 1, I)", () => {
            const confusingChars = "0O1I";
            for (let i = 0; i < 100; i++) {
                const code = generatePairingCode();
                for (const char of code) {
                    expect(confusingChars.includes(char)).toBe(false);
                }
            }
        });
    });

    describe("checkAccess with 'pairing' policy", () => {
        beforeEach(() => {
            securityManager.setConfig(testChannelId, {
                dm_policy: "pairing",
                allowed_senders: [],
            });
        });

        test("should permit already allowed senders", () => {
            securityManager.addAllowedSender(testChannelId, "user123");
            const result = securityManager.checkAccess(testChannelId, "user123", "telegram");
            expect(result.permitted).toBe(true);
        });

        test("should create pairing for new sender", () => {
            const result = securityManager.checkAccess(testChannelId, "newuser", "telegram");
            expect(result.permitted).toBe(false);
            expect(result.reason).toBe("new_pairing");
            expect(result.code).toBeDefined();
            expect(result.code).toHaveLength(6);
        });

        test("should return pending_pairing for sender who already has a pairing", () => {
            // First access creates pairing
            securityManager.checkAccess(testChannelId, "pendinguser", "telegram");

            // Second access should return pending
            const result = securityManager.checkAccess(testChannelId, "pendinguser", "telegram");
            expect(result.permitted).toBe(false);
            expect(result.reason).toBe("pending_pairing");
        });
    });

    describe("checkAccess with 'allowlist' policy", () => {
        beforeEach(() => {
            securityManager.setConfig(testChannelId, {
                dm_policy: "allowlist",
                allowed_senders: ["allowed-user"],
            });
        });

        test("should permit allowlisted sender", () => {
            const result = securityManager.checkAccess(testChannelId, "allowed-user", "telegram");
            expect(result.permitted).toBe(true);
        });

        test("should block non-allowlisted sender", () => {
            const result = securityManager.checkAccess(testChannelId, "random-user", "telegram");
            expect(result.permitted).toBe(false);
            expect(result.reason).toBe("blocked");
        });
    });

    describe("checkAccess with 'open' policy", () => {
        beforeEach(() => {
            securityManager.setConfig(testChannelId, {
                dm_policy: "open",
                allowed_senders: [],
            });
        });

        test("should permit any sender", () => {
            const result = securityManager.checkAccess(testChannelId, "anyone", "telegram");
            expect(result.permitted).toBe(true);
        });
    });

    describe("checkAccess with 'disabled' policy", () => {
        beforeEach(() => {
            securityManager.setConfig(testChannelId, {
                dm_policy: "disabled",
                allowed_senders: [],
            });
        });

        test("should deny all senders silently", () => {
            const result = securityManager.checkAccess(testChannelId, "anyone", "telegram");
            expect(result.permitted).toBe(false);
            expect(result.reason).toBe("disabled");
        });
    });

    describe("verifyPairing", () => {
        test("should approve valid pairing code and add sender to allowed list", () => {
            // Create a pairing
            const accessResult = securityManager.checkAccess(testChannelId, "newuser", "telegram");
            expect(accessResult.code).toBeDefined();

            // Verify the pairing
            const verifyResult = securityManager.verifyPairing(testChannelId, accessResult.code!);
            expect(verifyResult.success).toBe(true);
            expect(verifyResult.senderId).toBe("newuser");

            // User should now be allowed
            const checkResult = securityManager.checkAccess(testChannelId, "newuser", "telegram");
            expect(checkResult.permitted).toBe(true);
        });

        test("should reject invalid pairing code", () => {
            const result = securityManager.verifyPairing(testChannelId, "INVALID");
            expect(result.success).toBe(false);
        });
    });

    describe("rejectPairing", () => {
        test("should remove pending pairing", () => {
            // Create a pairing
            securityManager.checkAccess(testChannelId, "userToReject", "telegram");

            const pairings = securityManager.getPendingPairings(testChannelId);
            expect(pairings.length).toBe(1);

            // Reject the pairing
            const rejected = securityManager.rejectPairing(testChannelId, pairings[0].id);
            expect(rejected).toBe(true);

            // Pairing should be gone
            const remaining = securityManager.getPendingPairings(testChannelId);
            expect(remaining.length).toBe(0);
        });
    });

    describe("allowed senders management", () => {
        test("addAllowedSender should add sender", () => {
            securityManager.addAllowedSender(testChannelId, "new-sender");
            const senders = securityManager.getAllowedSenders(testChannelId);
            expect(senders).toContain("new-sender");
        });

        test("removeAllowedSender should remove sender", () => {
            securityManager.addAllowedSender(testChannelId, "removable");
            securityManager.removeAllowedSender(testChannelId, "removable");
            const senders = securityManager.getAllowedSenders(testChannelId);
            expect(senders).not.toContain("removable");
        });

        test("should not add duplicate senders", () => {
            securityManager.addAllowedSender(testChannelId, "unique");
            securityManager.addAllowedSender(testChannelId, "unique");
            const senders = securityManager.getAllowedSenders(testChannelId);
            const count = senders.filter((s) => s === "unique").length;
            expect(count).toBe(1);
        });
    });

    describe("getConfig", () => {
        test("should return channel config", () => {
            securityManager.setConfig(testChannelId, {
                dm_policy: "open",
                allowed_senders: ["user1", "user2"],
            });

            const config = securityManager.getConfig(testChannelId);
            expect(config.dm_policy).toBe("open");
            expect(config.allowed_senders).toContain("user1");
            expect(config.allowed_senders).toContain("user2");
        });

        test("should return default config for unknown channel", () => {
            const config = securityManager.getConfig("unknown-channel");
            expect(config.dm_policy).toBe(DEFAULT_SECURITY_CONFIG.dm_policy);
        });
    });
});
