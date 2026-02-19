import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import db, { tables } from "../../src/core/database";
import { securityManager } from "../../src/core/channels/security";
import { processTelegramWebhook, telegramBot } from "../../src/core/channels/adapters/telegram";
import { configureChannelChatRuntime, resetChannelChatRuntime } from "../../src/core/channels/chat-runtime";
import { config } from "../../src/core/config";

function makeChannelId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function makeTelegramUpdate(text: string) {
  return {
    update_id: Date.now(),
    message: {
      message_id: 101,
      from: {
        id: 555001,
        is_bot: false,
        first_name: "Alice",
        username: "alice",
      },
      chat: {
        id: 880011,
        type: "private" as const,
      },
      date: Math.floor(Date.now() / 1000),
      text,
    },
  };
}

function makeTelegramReactionUpdate() {
  return {
    update_id: Date.now(),
    message_reaction: {
      chat: {
        id: 880011,
        type: "private" as const,
      },
      message_id: 101,
      date: Math.floor(Date.now() / 1000),
      old_reaction: [{ type: "emoji", emoji: "👍" }],
      new_reaction: [{ type: "emoji", emoji: "🔥" }],
      user: {
        id: 555001,
        is_bot: false,
        first_name: "Alice",
        username: "alice",
      },
    },
  };
}

type FetchCall = {
  url: string;
  method: string;
  body: unknown;
};

const originalFetch = globalThis.fetch;
const memoryMockState = {
  context: "## Durable Memory\n- prefers bun tooling",
  files: [{ name: "2026-02-18.md", date: "2026-02-18", size: 128 }],
  searchResults: [
    {
      file: "2026-02-18.md",
      content: "release notes prepared for wallet permissions rollout",
      score: 0.91,
      method: "keyword",
    },
  ] as Array<{ file: string; content: string; score: number; method: string }>,
  searchMethod: "keyword",
};

mock.module("../../src/core/tools/handlers/memory", () => ({
  handleMemoryContext: async () => ({
    context: memoryMockState.context,
    lines: memoryMockState.context.split("\n").length,
  }),
  handleMemoryList: async () => ({
    files: [...memoryMockState.files],
  }),
  handleMemorySearch: async () => ({
    results: [...memoryMockState.searchResults],
    query: "mock-query",
    searchMethod: memoryMockState.searchMethod,
  }),
  handleMemoryGet: async () => ({
    content: memoryMockState.context,
    file: "2026-02-18.md",
  }),
  handleMemorySave: async () => ({
    success: true,
    file: "2026-02-18.md",
    bytesWritten: 64,
  }),
  getTodayMemoryPath: () => "/tmp/cybara-memory-2026-02-18.md",
  initializeTodayMemory: () => {},
  handleMemorySaveDurable: async () => ({
    success: true,
    file: "2026-02-18.md",
    bytesWritten: 64,
  }),
  handleHeartbeatState: async () => ({
    status: "ok",
    runs: [],
  }),
}));

describe("Telegram webhook mocked flows", () => {
  let channelId = "";
  let fetchCalls: FetchCall[] = [];

  beforeEach(() => {
    channelId = makeChannelId("telegram-webhook");
    fetchCalls = [];
    memoryMockState.context = "## Durable Memory\n- prefers bun tooling";
    memoryMockState.files = [{ name: "2026-02-18.md", date: "2026-02-18", size: 128 }];
    memoryMockState.searchResults = [
      {
        file: "2026-02-18.md",
        content: "release notes prepared for wallet permissions rollout",
        score: 0.91,
        method: "keyword",
      },
    ];
    memoryMockState.searchMethod = "keyword";

    tables.channels.create({
      id: channelId,
      type: "telegram",
      name: "Telegram Test",
      enabled: true,
      config: { bot_token: "test-bot-token" },
    });

    configureChannelChatRuntime({
      memoryContext: async () => ({
        context: memoryMockState.context,
        lines: memoryMockState.context.split("\n").length,
      }),
      memoryList: async () => ({
        files: [...memoryMockState.files],
      }),
      memorySearch: async (args) => ({
        results: [...memoryMockState.searchResults],
        query: String(args.query || ""),
        searchMethod: memoryMockState.searchMethod,
      }),
      listTools: () => ["read", "write", "memory_search", "memory_context"],
    });

    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      let body: unknown = null;
      if (typeof init?.body === "string") {
        try {
          body = JSON.parse(init.body);
        } catch {
          body = init.body;
        }
      }
      fetchCalls.push({
        url,
        method: init?.method || "GET",
        body,
      });

      return new Response(JSON.stringify({ ok: true, result: {} }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    tables.channels.delete(channelId);
    resetChannelChatRuntime();
  });

  test("returns false for unknown channel id", async () => {
    const ok = await processTelegramWebhook("missing-channel", makeTelegramUpdate("hello"));
    expect(ok).toBe(false);
  });

  test("blocks unpaired sender and sends pairing message", async () => {
    let handlerCalls = 0;

    telegramBot.setMessageHandler(async () => {
      handlerCalls += 1;
      return "should not run";
    });
    securityManager.setConfig(channelId, { dm_policy: "pairing", allowed_senders: [] });

    const ok = await processTelegramWebhook(channelId, makeTelegramUpdate("hello"));

    expect(ok).toBe(true);
    expect(handlerCalls).toBe(0);
    expect(fetchCalls.some((call) => call.url.includes("/sendChatAction"))).toBe(false);

    const sendMessageCall = fetchCalls.find((call) => call.url.includes("/sendMessage"));
    expect(sendMessageCall).toBeDefined();
    const payload = sendMessageCall?.body as { text?: string };
    expect(payload.text).toContain("Pairing Required");
  });

  test("processes allowed sender message, triggers typing, and sends reply", async () => {
    const handlerInputs: Array<{
      message: string;
      chatId: string | number;
      userId: number;
      incomingChannelId: string;
    }> = [];

    telegramBot.setMessageHandler(async (message, chatId, userId, incomingChannelId) => {
      handlerInputs.push({ message, chatId, userId, incomingChannelId });
      return "pong";
    });
    securityManager.setConfig(channelId, { dm_policy: "open" });

    const ok = await processTelegramWebhook(channelId, makeTelegramUpdate("ping"));

    expect(ok).toBe(true);
    expect(handlerInputs).toHaveLength(1);
    expect(handlerInputs[0].message).toBe("ping");
    expect(handlerInputs[0].chatId).toBe(880011);
    expect(handlerInputs[0].userId).toBe(555001);
    expect(handlerInputs[0].incomingChannelId).toBe(channelId);

    expect(fetchCalls.some((call) => call.url.includes("/sendChatAction"))).toBe(true);

    const sendMessageCall = fetchCalls.find((call) => call.url.includes("/sendMessage"));
    expect(sendMessageCall).toBeDefined();
    const payload = sendMessageCall?.body as {
      text?: string;
      parse_mode?: string;
      reply_to_message_id?: number;
    };
    expect(payload.text).toBe("pong");
    expect(payload.parse_mode).toBe("Markdown");
    expect(payload.reply_to_message_id).toBe(101);
  });

  test("malformed stored channel config uses missing-token path instead of parse-error catch path", async () => {
    db.query("UPDATE channels SET config = ? WHERE id = ?").run("{bad-json", channelId);

    const errorMessages: string[] = [];
    const originalError = console.error;
    console.error = (...args: unknown[]) => {
      errorMessages.push(String(args[0] || ""));
    };

    try {
      const ok = await processTelegramWebhook(channelId, makeTelegramUpdate("hello"));
      expect(ok).toBe(false);
      expect(fetchCalls).toHaveLength(0);
      expect(errorMessages.some((msg) => msg.includes("No bot token"))).toBe(true);
      expect(errorMessages.some((msg) => msg.includes("Error processing update"))).toBe(false);
    } finally {
      console.error = originalError;
    }
  });

  test("handles /model command and updates the default agent model", async () => {
    const providerId = makeChannelId("telegram-provider");
    const agentId = makeChannelId("telegram-agent");

    tables.providers.create({
      id: providerId,
      provider: "openai",
      name: "Telegram Command Provider",
      base_url: "https://api.openai.com/v1",
      api_key: "test-key",
      is_default: false,
    });
    tables.providerModels.upsert({
      id: makeChannelId("telegram-provider-model-1"),
      provider_id: providerId,
      model_id: "model-one",
      model_name: "model-one",
    });
    tables.providerModels.upsert({
      id: makeChannelId("telegram-provider-model-2"),
      provider_id: providerId,
      model_id: "model-two",
      model_name: "model-two",
    });
    tables.agents.create({
      id: agentId,
      name: "Telegram Command Agent",
      type: "main",
      model: "model-one",
      provider_id: providerId,
      status: "stopped",
      memory_enabled: false,
    });
    config.set("default_agent_id", agentId);

    let handlerCalls = 0;
    telegramBot.setMessageHandler(async () => {
      handlerCalls += 1;
      return "should not run";
    });
    securityManager.setConfig(channelId, { dm_policy: "open" });

    try {
      const ok = await processTelegramWebhook(channelId, makeTelegramUpdate("/model 2"));

      expect(ok).toBe(true);
      expect(handlerCalls).toBe(0);

      const updatedAgent = tables.agents.get(agentId) as { model?: string } | undefined;
      expect(updatedAgent?.model).toBe("model-two");

      const sendMessageCall = fetchCalls.find((call) => call.url.includes("/sendMessage"));
      expect(sendMessageCall).toBeDefined();
      const payload = sendMessageCall?.body as { text?: string };
      expect(payload.text).toContain("model-two");
    } finally {
      config.set("default_agent_id", "");
      tables.agents.delete(agentId);
      tables.providers.delete(providerId);
    }
  });

  test("handles /memory command for summary and search without invoking chat handler", async () => {
    let handlerCalls = 0;
    telegramBot.setMessageHandler(async () => {
      handlerCalls += 1;
      return "should not run";
    });
    securityManager.setConfig(channelId, { dm_policy: "open" });

    const summaryOk = await processTelegramWebhook(channelId, makeTelegramUpdate("/memory"));
    expect(summaryOk).toBe(true);
    expect(handlerCalls).toBe(0);

    const summaryCall = fetchCalls.find((call) => call.url.includes("/sendMessage"));
    expect(summaryCall).toBeDefined();
    const summaryPayload = summaryCall?.body as { text?: string };
    expect(summaryPayload.text).toContain("Recent Memory Context");
    expect(summaryPayload.text).toContain("2026-02-18.md");

    fetchCalls = [];
    memoryMockState.searchResults = [
      {
        file: "2026-02-17.md",
        content: "wallet policy migration complete",
        score: 0.88,
        method: "semantic",
      },
    ];
    memoryMockState.searchMethod = "semantic";

    const searchOk = await processTelegramWebhook(
      channelId,
      makeTelegramUpdate("/memory wallet policy")
    );
    expect(searchOk).toBe(true);
    expect(handlerCalls).toBe(0);

    const searchCall = fetchCalls.find((call) => call.url.includes("/sendMessage"));
    expect(searchCall).toBeDefined();
    const searchPayload = searchCall?.body as { text?: string };
    expect(searchPayload.text).toContain("Memory Search");
    expect(searchPayload.text).toContain("2026-02-17.md");
  });

  test("processes reaction updates and logs reaction events without invoking chat handler", async () => {
    let handlerCalls = 0;
    telegramBot.setMessageHandler(async () => {
      handlerCalls += 1;
      return "should not run";
    });
    securityManager.setConfig(channelId, { dm_policy: "open" });
    tables.channels.update(channelId, {
      config: {
        bot_token: "test-bot-token",
        reaction_notifications: "all",
      },
    });

    const ok = await processTelegramWebhook(channelId, makeTelegramReactionUpdate());

    expect(ok).toBe(true);
    expect(handlerCalls).toBe(0);
    expect(fetchCalls).toHaveLength(0);

    const logs = tables.channelLogs.getByChannel("telegram", "880011") as Array<{
      content: string;
      metadata?: string;
    }>;
    const reactionLog = logs.find((entry) => entry.content.includes("Telegram reaction by alice"));
    expect(reactionLog).toBeDefined();
    const metadata = reactionLog?.metadata ? JSON.parse(reactionLog.metadata) : {};
    expect(metadata.event).toBe("reaction");
    expect(metadata.messageId).toBe(101);
  });
});
