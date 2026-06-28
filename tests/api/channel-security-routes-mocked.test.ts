import { afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { createRequire } from "module";
import { tables } from "../../src/core/database";
import { securityManager } from "../../src/core/channels/security";

const require = createRequire(import.meta.url);

let handleRequest: (req: {
  method: string;
  url: string;
  headers: Record<string, string>;
  body?: unknown;
}) => Promise<{ status: number; headers: Record<string, string>; body?: unknown }>;

let channelId = "";

function makeChannelId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

async function api(method: string, path: string, body?: unknown) {
  return await handleRequest({
    method,
    url: `http://localhost:4269${path}`,
    headers: { host: "localhost:4269", "sec-fetch-site": "same-origin" },
    body,
  });
}

describe("Channel security route contracts", () => {
  beforeAll(() => {
    const routes = require("../../src/api/routes") as {
      handleRequest: typeof handleRequest;
    };
    handleRequest = routes.handleRequest;
  });

  beforeEach(() => {
    channelId = makeChannelId("chan-sec");
    tables.channels.create({
      id: channelId,
      type: "telegram",
      name: "Channel Security Route Test",
      config: { bot_token: "test-bot-token" },
      enabled: true,
    });
    securityManager.setConfig(channelId, {
      dm_policy: "pairing",
      pairing_expiry_minutes: 15,
      max_pending_pairings: 25,
      allowed_senders: [],
    });
  });

  afterEach(() => {
    tables.channels.delete(channelId);
  });

  test("GET /api/channels/:id/pairings maps fields to API shape", async () => {
    const access = securityManager.checkAccess(channelId, "user-123", "telegram", "Alice");
    expect(access.permitted).toBe(false);
    expect(access.code).toBeDefined();

    const res = await api("GET", `/api/channels/${channelId}/pairings`);
    expect(res.status).toBe(200);

    const body = res.body as {
      pairings: Array<{
        id: string;
        senderId: string;
        code: string;
        platform: string;
        displayName?: string;
        status: string;
        createdAt: string;
        expiresAt: string;
      }>;
      pendingCount: number;
      config: Record<string, unknown>;
    };

    expect(body.pendingCount).toBe(1);
    expect(body.config.dm_policy).toBe("pairing");
    expect(body.pairings).toHaveLength(1);
    expect(body.pairings[0].senderId).toBe("user-123");
    expect(body.pairings[0].platform).toBe("telegram");
    expect(body.pairings[0].status).toBe("pending");
    expect(body.pairings[0].displayName).toBe("Alice");
    expect(body.pairings[0].createdAt).toBeDefined();
    expect(body.pairings[0].expiresAt).toBeDefined();
  });

  test("POST verify/reject pairings forwards ids and updates state", async () => {
    securityManager.checkAccess(channelId, "user-verify", "telegram", "Verifier");
    const pending = securityManager.getPendingPairings(channelId);
    expect(pending.length).toBe(1);
    const pairing = pending[0];

    const verifyRes = await api("POST", `/api/channels/${channelId}/pairings/verify`, {
      code: pairing.code,
    });
    expect(verifyRes.status).toBe(200);
    expect(verifyRes.body).toEqual({ success: true, senderId: "user-verify" });
    expect(securityManager.getAllowedSenders(channelId)).toContain("user-verify");

    securityManager.checkAccess(channelId, "user-reject", "telegram", "Reject Me");
    const rejectTarget = securityManager
      .getPendingPairings(channelId)
      .find((entry) => entry.sender_id === "user-reject");
    expect(rejectTarget).toBeDefined();

    const rejectRes = await api(
      "POST",
      `/api/channels/${channelId}/pairings/${rejectTarget!.id}/reject`
    );
    expect(rejectRes.status).toBe(200);
    expect(rejectRes.body).toEqual({ success: true });
    const stillPending = securityManager
      .getPendingPairings(channelId)
      .some((entry) => entry.id === rejectTarget!.id);
    expect(stillPending).toBe(false);
  });

  test("allowed-senders and security config endpoints stay wired", async () => {
    const listBefore = await api("GET", `/api/channels/${channelId}/allowed-senders`);
    expect(listBefore.status).toBe(200);
    expect(listBefore.body).toEqual({ senders: [] });

    const addRes = await api("POST", `/api/channels/${channelId}/allowed-senders`, {
      senderId: "allowed-1",
    });
    expect(addRes.status).toBe(200);
    expect(addRes.body).toEqual({ success: true });

    const listAfter = await api("GET", `/api/channels/${channelId}/allowed-senders`);
    expect(listAfter.status).toBe(200);
    expect(listAfter.body).toEqual({ senders: ["allowed-1"] });

    const removeRes = await api(
      "DELETE",
      `/api/channels/${channelId}/allowed-senders/${encodeURIComponent("allowed-1")}`
    );
    expect(removeRes.status).toBe(200);
    expect(removeRes.body).toEqual({ success: true });

    const updateSecurity = await api("PUT", `/api/channels/${channelId}/security`, {
      dm_policy: "open",
      pairing_expiry_minutes: 5,
    });
    expect(updateSecurity.status).toBe(200);
    expect((updateSecurity.body as { success?: boolean }).success).toBe(true);

    const config = securityManager.getConfig(channelId);
    expect(config.dm_policy).toBe("open");
    expect(config.pairing_expiry_minutes).toBe(5);
  });
});
