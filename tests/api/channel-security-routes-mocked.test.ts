import { beforeAll, beforeEach, describe, expect, mock, test } from "bun:test";

type RawPairing = {
  id: string;
  sender_id: string;
  code: string;
  platform: string;
  sender_name?: string;
  status: string;
  created_at: number;
  expires_at: number;
};

const pairingNow = Date.now();

const mockState = {
  pairingsByChannel: new Map<string, RawPairing[]>(),
  pendingByChannel: new Map<string, RawPairing[]>(),
  allowedByChannel: new Map<string, string[]>(),
  configByChannel: new Map<string, Record<string, unknown>>(),
  verifyCalls: [] as Array<{ channelId: string; code: string }>,
  rejectCalls: [] as Array<{ channelId: string; pairingId: string }>,
  addCalls: [] as Array<{ channelId: string; senderId: string }>,
  removeCalls: [] as Array<{ channelId: string; senderId: string }>,
  setConfigCalls: [] as Array<{ channelId: string; config: Record<string, unknown> }>,
};

function resetState() {
  mockState.pairingsByChannel.clear();
  mockState.pendingByChannel.clear();
  mockState.allowedByChannel.clear();
  mockState.configByChannel.clear();
  mockState.verifyCalls = [];
  mockState.rejectCalls = [];
  mockState.addCalls = [];
  mockState.removeCalls = [];
  mockState.setConfigCalls = [];

  const initialPairing: RawPairing = {
    id: "pair-1",
    sender_id: "user-123",
    code: "PAIR42",
    platform: "telegram",
    sender_name: "Alice",
    status: "pending",
    created_at: pairingNow,
    expires_at: pairingNow + 5 * 60_000,
  };
  mockState.pairingsByChannel.set("chan-1", [initialPairing]);
  mockState.pendingByChannel.set("chan-1", [initialPairing]);
  mockState.allowedByChannel.set("chan-1", ["allowed-1", "allowed-2"]);
  mockState.configByChannel.set("chan-1", {
    dm_policy: "pairing",
    pairing_expiry_minutes: 15,
    max_pending_pairings: 25,
  });
}

mock.module("../../src/core/channels", () => ({
  telegramBot: {
    isRunning: () => true,
    start: async () => {},
    stop: async () => {},
    setMessageHandler: () => {},
    sendMessage: async () => true,
    sendPhoto: async () => true,
    sendDocument: async () => true,
    sendVideo: async () => true,
  },
  telegramSessions: new Map<string, string>(),
  channelManager: {
    list: () => [],
    get: () => null,
    update: () => true,
    delete: () => true,
    create: () => ({ id: "mock-channel", type: "web", name: "Mock", config: {}, enabled: true }),
    setupTelegram: async () => ({
      id: "telegram-1",
      type: "telegram",
      name: "Telegram",
      config: {},
      enabled: true,
    }),
    getAdapter: () => ({
      isRunning: () => true,
      start: async () => {},
    }),
    getStats: () => ({ total: 0 }),
    initializeAll: async () => {},
  },
  channels: {
    telegram: { fields: [{ name: "bot_token", required: true }] },
    web: { fields: [] },
  },
  processTelegramWebhook: async () => true,
  securityManager: {
    getAllPairings: (channelId: string) => mockState.pairingsByChannel.get(channelId) || [],
    getPendingPairings: (channelId: string) => mockState.pendingByChannel.get(channelId) || [],
    getConfig: (channelId: string) => mockState.configByChannel.get(channelId) || {},
    verifyPairing: (channelId: string, code: string) => {
      mockState.verifyCalls.push({ channelId, code });
      return { success: code === "PAIR42", senderId: "user-123" };
    },
    rejectPairing: (channelId: string, pairingId: string) => {
      mockState.rejectCalls.push({ channelId, pairingId });
      return pairingId !== "missing";
    },
    getAllowedSenders: (channelId: string) => mockState.allowedByChannel.get(channelId) || [],
    addAllowedSender: (channelId: string, senderId: string) => {
      mockState.addCalls.push({ channelId, senderId });
      const current = mockState.allowedByChannel.get(channelId) || [];
      if (!current.includes(senderId)) {
        mockState.allowedByChannel.set(channelId, [...current, senderId]);
      }
    },
    removeAllowedSender: (channelId: string, senderId: string) => {
      mockState.removeCalls.push({ channelId, senderId });
      const current = mockState.allowedByChannel.get(channelId) || [];
      const exists = current.includes(senderId);
      mockState.allowedByChannel.set(
        channelId,
        current.filter((id) => id !== senderId)
      );
      return exists;
    },
    setConfig: (channelId: string, config: Record<string, unknown>) => {
      mockState.setConfigCalls.push({ channelId, config });
      const existing = mockState.configByChannel.get(channelId) || {};
      mockState.configByChannel.set(channelId, { ...existing, ...config });
    },
  },
}));

let handleRequest: (req: {
  method: string;
  url: string;
  headers: Record<string, string>;
  body?: unknown;
}) => Promise<{ status: number; headers: Record<string, string>; body?: unknown }>;

async function api(method: string, path: string, body?: unknown) {
  return await handleRequest({
    method,
    url: `http://localhost:4269${path}`,
    headers: { host: "localhost:4269" },
    body,
  });
}

describe("Channel security route contracts (mocked manager)", () => {
  beforeAll(async () => {
    const routes = await import("../../src/api/routes");
    handleRequest = routes.handleRequest;
  });

  beforeEach(() => {
    resetState();
  });

  test("GET /api/channels/:id/pairings maps snake_case fields to camelCase", async () => {
    const res = await api("GET", "/api/channels/chan-1/pairings");
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
    expect(body.pairings[0]).toEqual({
      id: "pair-1",
      senderId: "user-123",
      code: "PAIR42",
      platform: "telegram",
      displayName: "Alice",
      status: "pending",
      createdAt: new Date(pairingNow).toISOString(),
      expiresAt: new Date(pairingNow + 5 * 60_000).toISOString(),
    });
  });

  test("POST /api/channels/:id/pairings/verify forwards channel and code", async () => {
    const res = await api("POST", "/api/channels/chan-1/pairings/verify", { code: "PAIR42" });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, senderId: "user-123" });
    expect(mockState.verifyCalls).toEqual([{ channelId: "chan-1", code: "PAIR42" }]);
  });

  test("POST /api/channels/:id/pairings/:pairingId/reject forwards ids", async () => {
    const res = await api("POST", "/api/channels/chan-1/pairings/pair-1/reject");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true });
    expect(mockState.rejectCalls).toEqual([{ channelId: "chan-1", pairingId: "pair-1" }]);
  });

  test("GET /api/channels/:id/allowed-senders returns sender list", async () => {
    const res = await api("GET", "/api/channels/chan-1/allowed-senders");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ senders: ["allowed-1", "allowed-2"] });
  });

  test("POST /api/channels/:id/allowed-senders adds sender and returns success", async () => {
    const res = await api("POST", "/api/channels/chan-1/allowed-senders", {
      senderId: "new-sender",
    });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true });
    expect(mockState.addCalls).toEqual([{ channelId: "chan-1", senderId: "new-sender" }]);

    const list = await api("GET", "/api/channels/chan-1/allowed-senders");
    expect(list.body).toEqual({ senders: ["allowed-1", "allowed-2", "new-sender"] });
  });

  test("DELETE /api/channels/:id/allowed-senders/:senderId returns remove result", async () => {
    const res = await api("DELETE", "/api/channels/chan-1/allowed-senders/allowed-2");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true });
    expect(mockState.removeCalls).toEqual([{ channelId: "chan-1", senderId: "allowed-2" }]);
  });

  test("PUT /api/channels/:id/security stores config and returns latest config", async () => {
    const res = await api("PUT", "/api/channels/chan-1/security", {
      dm_policy: "allowlist",
      pairing_expiry_minutes: 60,
      max_pending_pairings: 10,
    });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      success: true,
      config: {
        dm_policy: "allowlist",
        pairing_expiry_minutes: 60,
        max_pending_pairings: 10,
      },
    });
    expect(mockState.setConfigCalls).toEqual([
      {
        channelId: "chan-1",
        config: {
          dm_policy: "allowlist",
          pairing_expiry_minutes: 60,
          max_pending_pairings: 10,
        },
      },
    ]);
  });
});
