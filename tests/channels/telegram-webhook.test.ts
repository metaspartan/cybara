import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import db, { tables } from "../../src/core/database";
import { securityManager } from "../../src/core/channels/security";
import {
  processTelegramWebhook,
  resetTelegramSessionTrackingForTests,
  telegramSessions,
  telegramBot,
  verifyTelegramWebhookSecret,
  generateTelegramWebhookSecret,
} from "../../src/core/channels/adapters/telegram";
import {
  clearChannelSubagentSpawnHandler,
  setChannelSubagentSpawnHandler,
} from "../../src/core/channels/commands";
import {
  configureChannelChatRuntime,
  resetChannelChatRuntime,
} from "../../src/core/channels/chat-runtime";
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

let runtimeSessionsState: Array<{ id: string; messageCount: number; createdAt: string }> = [];
let runtimeInjectedMessages: Array<{ sessionId: string; content: string }> = [];

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
    runtimeSessionsState = [];
    runtimeInjectedMessages = [];

    tables.channels.create({
      id: channelId,
      type: "telegram",
      name: "Telegram Test",
      enabled: true,
      config: { bot_token: "test-bot-token" },
    });

    configureChannelChatRuntime({
      listSessions: async () => runtimeSessionsState,
      sendToSession: (sessionId, message) => {
        runtimeInjectedMessages.push({ sessionId, content: message.content });
        return true;
      },
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
    clearChannelSubagentSpawnHandler();
    resetTelegramSessionTrackingForTests();
    (
      telegramBot as unknown as {
        typingRefreshMs: number;
      }
    ).typingRefreshMs = 4000;
    (
      telegramBot as unknown as {
        bots: Map<string, unknown>;
      }
    ).bots.clear();
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

  test("keeps Telegram typing indicator alive while handler is still running", async () => {
    (
      telegramBot as unknown as {
        typingRefreshMs: number;
      }
    ).typingRefreshMs = 10;

    telegramBot.setMessageHandler(async () => {
      await new Promise((resolve) => setTimeout(resolve, 35));
      return "slow pong";
    });
    securityManager.setConfig(channelId, { dm_policy: "open" });

    const ok = await processTelegramWebhook(channelId, makeTelegramUpdate("ping"));

    expect(ok).toBe(true);
    const typingCalls = fetchCalls.filter((call) => call.url.includes("/sendChatAction")).length;
    expect(typingCalls).toBeGreaterThanOrEqual(2);

    const sendMessageCall = fetchCalls.find((call) => call.url.includes("/sendMessage"));
    const payload = sendMessageCall?.body as { text?: string };
    expect(payload.text).toBe("slow pong");
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

  test("handles /status command without invoking chat handler", async () => {
    let handlerCalls = 0;
    telegramBot.setMessageHandler(async () => {
      handlerCalls += 1;
      return "should not run";
    });
    securityManager.setConfig(channelId, { dm_policy: "open" });

    const ok = await processTelegramWebhook(channelId, makeTelegramUpdate("/status"));

    expect(ok).toBe(true);
    expect(handlerCalls).toBe(0);

    const sendMessageCall = fetchCalls.find((call) => call.url.includes("/sendMessage"));
    expect(sendMessageCall).toBeDefined();
    const payload = sendMessageCall?.body as { text?: string };
    expect(payload.text).toContain("*Status*");
    expect(payload.text).toContain("*Agents:*");
  });

  test("handles /agents command without invoking chat handler", async () => {
    const providerId = makeChannelId("telegram-agents-provider");
    const agentId = makeChannelId("telegram-agents-target");

    tables.providers.create({
      id: providerId,
      provider: "openai",
      name: "Telegram Agents Provider",
      base_url: "https://api.openai.com/v1",
      api_key: "test-key",
      is_default: false,
    });
    tables.agents.create({
      id: agentId,
      name: "Telegram Agents Target",
      type: "main",
      model: "model-one",
      provider_id: providerId,
      status: "stopped",
      memory_enabled: false,
    });

    let handlerCalls = 0;
    telegramBot.setMessageHandler(async () => {
      handlerCalls += 1;
      return "should not run";
    });
    securityManager.setConfig(channelId, { dm_policy: "open" });

    try {
      const ok = await processTelegramWebhook(channelId, makeTelegramUpdate("/agents"));

      expect(ok).toBe(true);
      expect(handlerCalls).toBe(0);

      const sendMessageCall = fetchCalls.find((call) => call.url.includes("/sendMessage"));
      expect(sendMessageCall).toBeDefined();
      const payload = sendMessageCall?.body as { text?: string };
      expect(payload.text).toContain("Available Agents");
      expect(payload.text).toContain("Telegram Agents Target");
    } finally {
      tables.agents.delete(agentId);
      tables.providers.delete(providerId);
    }
  });

  test("handles /providers command without invoking chat handler", async () => {
    const providerId = makeChannelId("telegram-providers-target");
    const agentId = makeChannelId("telegram-providers-agent");

    tables.providers.create({
      id: providerId,
      provider: "openai",
      name: "Telegram Providers Target",
      base_url: "https://api.openai.com/v1",
      api_key: "test-key",
      is_default: false,
    });
    tables.agents.create({
      id: agentId,
      name: "Telegram Providers Agent",
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
      const ok = await processTelegramWebhook(channelId, makeTelegramUpdate("/providers"));

      expect(ok).toBe(true);
      expect(handlerCalls).toBe(0);

      const sendMessageCall = fetchCalls.find((call) => call.url.includes("/sendMessage"));
      expect(sendMessageCall).toBeDefined();
      const payload = sendMessageCall?.body as { text?: string };
      expect(payload.text).toContain("Providers");
      expect(payload.text).toContain("Telegram Providers Target");
    } finally {
      config.set("default_agent_id", "");
      tables.agents.delete(agentId);
      tables.providers.delete(providerId);
    }
  });

  test("handles /new command and rotates telegram chat session id", async () => {
    let handlerCalls = 0;
    telegramBot.setMessageHandler(async () => {
      handlerCalls += 1;
      return "should not run";
    });
    securityManager.setConfig(channelId, { dm_policy: "open" });

    const chatKey = "880011";
    const initialSessionId = "session-telegram-initial";
    telegramSessions.set(chatKey, initialSessionId);

    const ok = await processTelegramWebhook(channelId, makeTelegramUpdate("/new"));

    expect(ok).toBe(true);
    expect(handlerCalls).toBe(0);
    const rotatedSessionId = telegramSessions.get(chatKey);
    expect(rotatedSessionId).toBeDefined();
    expect(rotatedSessionId).not.toBe(initialSessionId);

    const sendMessageCall = fetchCalls.find((call) => call.url.includes("/sendMessage"));
    expect(sendMessageCall).toBeDefined();
    const payload = sendMessageCall?.body as { text?: string };
    expect(payload.text).toContain("New Session Started");
  });

  test("handles /switch command and restores previous telegram session", async () => {
    let handlerCalls = 0;
    telegramBot.setMessageHandler(async () => {
      handlerCalls += 1;
      return "should not run";
    });
    securityManager.setConfig(channelId, { dm_policy: "open" });

    const firstNewOk = await processTelegramWebhook(channelId, makeTelegramUpdate("/new"));
    expect(firstNewOk).toBe(true);
    const firstSessionId = telegramSessions.get("880011");
    expect(firstSessionId).toBeDefined();

    fetchCalls = [];

    const secondNewOk = await processTelegramWebhook(channelId, makeTelegramUpdate("/new"));
    expect(secondNewOk).toBe(true);
    const secondSessionId = telegramSessions.get("880011");
    expect(secondSessionId).toBeDefined();
    expect(secondSessionId).not.toBe(firstSessionId);

    fetchCalls = [];

    const switchOk = await processTelegramWebhook(channelId, makeTelegramUpdate("/switch 2"));
    expect(switchOk).toBe(true);
    expect(handlerCalls).toBe(0);
    expect(telegramSessions.get("880011")).toBe(firstSessionId);

    const sendMessageCalls = fetchCalls.filter((call) => call.url.includes("/sendMessage"));
    expect(sendMessageCalls.length).toBeGreaterThan(0);
    const switchPayload = sendMessageCalls.at(-1)?.body as { text?: string } | undefined;
    expect(switchPayload?.text).toContain("Switched to Session 2");
  });

  test("handles /agent command and updates default agent selection", async () => {
    const providerId = makeChannelId("telegram-agent-provider");
    const firstAgentId = makeChannelId("telegram-agent-one");
    const secondAgentId = makeChannelId("telegram-agent-two");

    tables.providers.create({
      id: providerId,
      provider: "openai",
      name: "Telegram Agent Provider",
      base_url: "https://api.openai.com/v1",
      api_key: "test-key",
      is_default: false,
    });
    tables.agents.create({
      id: firstAgentId,
      name: "Telegram Agent One",
      type: "main",
      model: "model-one",
      provider_id: providerId,
      status: "stopped",
      memory_enabled: false,
    });
    tables.agents.create({
      id: secondAgentId,
      name: "Telegram Agent Two",
      type: "main",
      model: "model-two",
      provider_id: providerId,
      status: "stopped",
      memory_enabled: false,
    });
    config.set("default_agent_id", firstAgentId);

    let handlerCalls = 0;
    telegramBot.setMessageHandler(async () => {
      handlerCalls += 1;
      return "should not run";
    });
    securityManager.setConfig(channelId, { dm_policy: "open" });

    try {
      const ok = await processTelegramWebhook(
        channelId,
        makeTelegramUpdate(`/agent ${secondAgentId}`)
      );

      expect(ok).toBe(true);
      expect(handlerCalls).toBe(0);
      expect(config.get<string>("default_agent_id")).toBe(secondAgentId);

      const sendMessageCall = fetchCalls.find((call) => call.url.includes("/sendMessage"));
      expect(sendMessageCall).toBeDefined();
      const payload = sendMessageCall?.body as { text?: string };
      expect(payload.text).toContain("Telegram Agent Two");
    } finally {
      config.set("default_agent_id", "");
      tables.agents.delete(firstAgentId);
      tables.agents.delete(secondAgentId);
      tables.providers.delete(providerId);
    }
  });

  test("handles /provider command and updates default agent provider/model", async () => {
    const providerA = makeChannelId("telegram-provider-a");
    const providerB = makeChannelId("telegram-provider-b");
    const agentId = makeChannelId("telegram-provider-agent");

    tables.providers.create({
      id: providerA,
      provider: "openai",
      name: "Telegram Provider A",
      base_url: "https://api.openai.com/v1",
      api_key: "test-key",
      is_default: false,
    });
    tables.providers.create({
      id: providerB,
      provider: "openai",
      name: "Telegram Provider B",
      base_url: "https://api.openai.com/v1",
      api_key: "test-key",
      is_default: false,
    });
    tables.providerModels.upsert({
      id: makeChannelId("telegram-provider-a-model"),
      provider_id: providerA,
      model_id: "a-model",
      model_name: "a-model",
    });
    tables.providerModels.upsert({
      id: makeChannelId("telegram-provider-b-model"),
      provider_id: providerB,
      model_id: "b-model",
      model_name: "b-model",
    });
    tables.agents.create({
      id: agentId,
      name: "Telegram Provider Agent",
      type: "main",
      model: "a-model",
      provider_id: providerA,
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
      const ok = await processTelegramWebhook(
        channelId,
        makeTelegramUpdate(`/provider ${providerB}`)
      );

      expect(ok).toBe(true);
      expect(handlerCalls).toBe(0);

      const updatedAgent = tables.agents.get(agentId) as
        | { provider_id?: string; model?: string }
        | undefined;
      expect(updatedAgent?.provider_id).toBe(providerB);
      expect(updatedAgent?.model).toBe("b-model");

      const sendMessageCall = fetchCalls.find((call) => call.url.includes("/sendMessage"));
      expect(sendMessageCall).toBeDefined();
      const payload = sendMessageCall?.body as { text?: string };
      expect(payload.text).toContain("Telegram Provider B");
    } finally {
      config.set("default_agent_id", "");
      tables.agents.delete(agentId);
      tables.providers.delete(providerA);
      tables.providers.delete(providerB);
    }
  });

  test("routes /subagents spawn command through webhook command handling", async () => {
    const spawnArgs: Array<Record<string, unknown>> = [];
    let handlerCalls = 0;

    setChannelSubagentSpawnHandler(async (args) => {
      spawnArgs.push(args);
      return {
        status: "accepted",
        childSessionKey: "agent:default:subagent:telegram",
        runId: "run-telegram-subagents",
        task: String(args.task || ""),
      };
    });

    telegramBot.setMessageHandler(async () => {
      handlerCalls += 1;
      return "should not run";
    });
    securityManager.setConfig(channelId, { dm_policy: "open" });

    const ok = await processTelegramWebhook(
      channelId,
      makeTelegramUpdate("/subagents spawn summarize deployment status")
    );

    expect(ok).toBe(true);
    expect(handlerCalls).toBe(0);
    expect(spawnArgs).toHaveLength(1);
    expect(spawnArgs[0]?.task).toBe("summarize deployment status");
    expect(spawnArgs[0]?.label).toBe("channel:telegram");
    expect(spawnArgs[0]?._requesterSessionKey).toBe("telegram:880011");

    const sendMessageCall = fetchCalls.find((call) => call.url.includes("/sendMessage"));
    expect(sendMessageCall).toBeDefined();
    const payload = sendMessageCall?.body as { text?: string };
    expect(payload.text).toContain("Subagent spawned successfully.");
    expect(payload.text).toContain("run-telegram-subagents");
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

  test("lists only sessions tracked for this telegram user", async () => {
    telegramBot.setMessageHandler(async () => "should not run");
    securityManager.setConfig(channelId, { dm_policy: "open" });

    runtimeSessionsState = [
      {
        id: "telegram:880011",
        messageCount: 5,
        createdAt: "2026-02-18T10:00:00.000Z",
      },
      {
        id: "foreign-session-12345678",
        messageCount: 9,
        createdAt: "2026-02-18T11:00:00.000Z",
      },
    ];

    const ok = await processTelegramWebhook(channelId, makeTelegramUpdate("/sessions"));
    expect(ok).toBe(true);

    const sendMessageCall = fetchCalls.find((call) => call.url.includes("/sendMessage"));
    expect(sendMessageCall).toBeDefined();
    const payload = sendMessageCall?.body as { text?: string };
    expect(payload.text).toContain("Your Sessions");
    expect(payload.text).toContain("telegram");
    expect(payload.text).not.toContain("foreign-session");
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
    expect(runtimeInjectedMessages).toHaveLength(1);
    expect(runtimeInjectedMessages[0].sessionId).toBe("telegram:880011");
    expect(runtimeInjectedMessages[0].content).toContain("Telegram reaction by alice");
  });

  test("does not inject runtime reactions when reaction notifications are off", async () => {
    telegramBot.setMessageHandler(async () => "should not run");
    securityManager.setConfig(channelId, { dm_policy: "open" });
    tables.channels.update(channelId, {
      config: {
        bot_token: "test-bot-token",
        reaction_notifications: "off",
      },
    });

    const ok = await processTelegramWebhook(channelId, makeTelegramReactionUpdate());

    expect(ok).toBe(true);
    expect(runtimeInjectedMessages).toHaveLength(0);
  });

  test("sendReaction calls Telegram setMessageReaction with emoji payload", async () => {
    (
      telegramBot as unknown as {
        bots: Map<
          string,
          {
            token: string;
            channelId: string;
            mode: "webhook" | "polling";
          }
        >;
      }
    ).bots.set(channelId, {
      token: "test-bot-token",
      channelId,
      mode: "webhook",
    });

    fetchCalls = [];
    const ok = await telegramBot.sendReaction(channelId, 880011, "101", "🔥");
    expect(ok).toBe(true);

    const reactionCall = fetchCalls.find((call) => call.url.includes("/setMessageReaction"));
    expect(reactionCall).toBeDefined();
    const payload = reactionCall?.body as {
      chat_id?: number | string;
      message_id?: number;
      reaction?: Array<{ type?: string; emoji?: string }>;
    };
    expect(payload.chat_id).toBe(880011);
    expect(payload.message_id).toBe(101);
    expect(payload.reaction).toEqual([{ type: "emoji", emoji: "🔥" }]);
  });

  test("SECURITY: rejects a forged update when the secret token does not match", async () => {
    let handlerCalls = 0;
    telegramBot.setMessageHandler(async () => {
      handlerCalls += 1;
      return "should not run";
    });
    securityManager.setConfig(channelId, { dm_policy: "open" });
    // Channel registered with a webhook secret (as start() now does).
    tables.channels.update(channelId, {
      config: { bot_token: "test-bot-token", webhook_secret: "s3cr3t-token" },
    });

    // Missing token → rejected, handler never runs, no Telegram calls made.
    const missing = await processTelegramWebhook(channelId, makeTelegramUpdate("ping"));
    expect(missing).toBe(false);
    // Wrong token → rejected.
    const wrong = await processTelegramWebhook(channelId, makeTelegramUpdate("ping"), "wrong");
    expect(wrong).toBe(false);
    expect(handlerCalls).toBe(0);
    expect(fetchCalls).toHaveLength(0);

    // Correct token → accepted and processed.
    const ok = await processTelegramWebhook(channelId, makeTelegramUpdate("ping"), "s3cr3t-token");
    expect(ok).toBe(true);
    expect(handlerCalls).toBe(1);
  });

  test("removeReaction calls Telegram setMessageReaction with empty reaction list", async () => {
    (
      telegramBot as unknown as {
        bots: Map<
          string,
          {
            token: string;
            channelId: string;
            mode: "webhook" | "polling";
          }
        >;
      }
    ).bots.set(channelId, {
      token: "test-bot-token",
      channelId,
      mode: "webhook",
    });

    fetchCalls = [];
    const ok = await telegramBot.removeReaction(channelId, 880011, "101", "🔥");
    expect(ok).toBe(true);

    const reactionCall = fetchCalls.find((call) => call.url.includes("/setMessageReaction"));
    expect(reactionCall).toBeDefined();
    const payload = reactionCall?.body as {
      chat_id?: number | string;
      message_id?: number;
      reaction?: unknown[];
    };
    expect(payload.chat_id).toBe(880011);
    expect(payload.message_id).toBe(101);
    expect(payload.reaction).toEqual([]);
  });
});

describe("Telegram webhook secret verification helpers", () => {
  test("verifyTelegramWebhookSecret enforces a configured secret", () => {
    expect(verifyTelegramWebhookSecret("abc", "abc")).toBe(true);
    expect(verifyTelegramWebhookSecret("abc", "xyz")).toBe(false);
    expect(verifyTelegramWebhookSecret("abc", undefined)).toBe(false);
    expect(verifyTelegramWebhookSecret("abc", "ab")).toBe(false); // length mismatch
  });

  test("verifyTelegramWebhookSecret allows when no secret is configured (legacy)", () => {
    expect(verifyTelegramWebhookSecret(undefined, undefined)).toBe(true);
    expect(verifyTelegramWebhookSecret(undefined, "anything")).toBe(true);
    expect(verifyTelegramWebhookSecret("", "anything")).toBe(true);
  });

  test("generateTelegramWebhookSecret returns a Telegram-valid token", () => {
    const secret = generateTelegramWebhookSecret();
    // 1–256 chars, only A-Z a-z 0-9 _ - per Telegram's setWebhook contract.
    expect(secret.length).toBeGreaterThanOrEqual(16);
    expect(secret.length).toBeLessThanOrEqual(256);
    expect(secret).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(generateTelegramWebhookSecret()).not.toBe(secret);
  });
});
