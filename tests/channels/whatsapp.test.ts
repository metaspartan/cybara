import { afterEach, describe, expect, test } from "bun:test";
import { WhatsAppAdapter, whatsappSessions } from "../../src/core/channels/adapters/whatsapp";
import { securityManager } from "../../src/core/channels/security";
import { config } from "../../src/core/config";
import { tables } from "../../src/core/database";

type FakeWhatsAppMessage = {
  fromMe: boolean;
  from: string;
  author?: string;
  body: string;
  hasMedia: boolean;
  type: string;
  id: { _serialized: string };
  reply: (text: string) => Promise<void>;
  downloadMedia: () => Promise<{ mimetype: string } | null>;
  getChat: () => Promise<{ sendMessage: (text: string) => Promise<void> }>;
};

function makeChannelId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

const createdAgents: string[] = [];
const createdProviders: string[] = [];

function createProvider(name: string): string {
  const providerId = makeChannelId("wa-provider");
  tables.providers.create({
    id: providerId,
    provider: "openai",
    name,
    base_url: "https://api.openai.com/v1",
    api_key: "test-key",
    is_default: false,
  });
  createdProviders.push(providerId);
  return providerId;
}

function createAgent(name: string, providerId: string, model: string): string {
  const agentId = makeChannelId("wa-agent");
  tables.agents.create({
    id: agentId,
    name,
    type: "main",
    model,
    provider_id: providerId,
    status: "stopped",
    memory_enabled: false,
  });
  createdAgents.push(agentId);
  return agentId;
}

function addProviderModel(providerId: string, modelId: string): void {
  tables.providerModels.upsert({
    id: makeChannelId("wa-provider-model"),
    provider_id: providerId,
    model_id: modelId,
    model_name: modelId,
  });
}

function createFakeWhatsAppMessage(
  overrides: Partial<FakeWhatsAppMessage>,
  replies: string[],
  chatSends: string[]
): FakeWhatsAppMessage {
  return {
    fromMe: false,
    from: "15550001111@c.us",
    author: undefined,
    body: "hello",
    hasMedia: false,
    type: "chat",
    id: { _serialized: `wamid-${Date.now()}` },
    reply: async (text: string) => {
      replies.push(text);
    },
    downloadMedia: async () => null,
    getChat: async () => ({
      sendMessage: async (text: string) => {
        chatSends.push(text);
      },
    }),
    ...overrides,
  };
}

async function invokeWhatsAppMessage(
  adapter: WhatsAppAdapter,
  channelId: string,
  message: FakeWhatsAppMessage
): Promise<void> {
  await (
    adapter as unknown as {
      handleMessage: (id: string, msg: FakeWhatsAppMessage) => Promise<void>;
    }
  ).handleMessage(channelId, message);
}

afterEach(() => {
  config.set("default_agent_id", "");
  for (const agentId of createdAgents.splice(0)) {
    tables.agents.delete(agentId);
  }
  for (const providerId of createdProviders.splice(0)) {
    tables.providers.delete(providerId);
  }
});

describe("WhatsApp adapter mocked flows", () => {
  test("ignores own messages", async () => {
    const adapter = new WhatsAppAdapter();
    const channelId = makeChannelId("wa-ignore");
    const replies: string[] = [];
    const chatSends: string[] = [];
    let handlerCalls = 0;

    adapter.setMessageHandler(async () => {
      handlerCalls += 1;
      return "should-not-run";
    });
    securityManager.setConfig(channelId, { dm_policy: "open" });

    const message = createFakeWhatsAppMessage(
      {
        fromMe: true,
      },
      replies,
      chatSends
    );

    await invokeWhatsAppMessage(adapter, channelId, message);

    expect(handlerCalls).toBe(0);
    expect(replies).toHaveLength(0);
    expect(chatSends).toHaveLength(0);
  });

  test("creates pairing for new sender and replies with security message", async () => {
    const adapter = new WhatsAppAdapter();
    const channelId = makeChannelId("wa-pairing");
    const replies: string[] = [];
    const chatSends: string[] = [];
    let handlerCalls = 0;

    whatsappSessions.clear();
    adapter.setMessageHandler(async () => {
      handlerCalls += 1;
      return "should-not-run";
    });
    securityManager.setConfig(channelId, { dm_policy: "pairing", allowed_senders: [] });

    const message = createFakeWhatsAppMessage({}, replies, chatSends);

    await invokeWhatsAppMessage(adapter, channelId, message);

    expect(handlerCalls).toBe(0);
    expect(replies.length).toBe(1);
    expect(replies[0]).toContain("Pairing code");
    expect(securityManager.getPendingPairings(channelId).length).toBe(1);
  });

  test("routes allowed sender messages and reuses session id per chat", async () => {
    const adapter = new WhatsAppAdapter();
    const channelId = makeChannelId("wa-session");
    const replies: string[] = [];
    const chatSends: string[] = [];
    const handlerInputs: Array<{ content: string; chatId: string; sessionId: string }> = [];

    whatsappSessions.clear();
    securityManager.setConfig(channelId, { dm_policy: "pairing" });
    securityManager.addAllowedSender(channelId, "15550001111@c.us");

    adapter.setMessageHandler(async (content, chatId, sessionId) => {
      handlerInputs.push({ content, chatId, sessionId });
      return `echo:${content}`;
    });

    const first = createFakeWhatsAppMessage(
      {
        body: "first",
        id: { _serialized: "wamid-1" },
      },
      replies,
      chatSends
    );
    const second = createFakeWhatsAppMessage(
      {
        body: "second",
        id: { _serialized: "wamid-2" },
      },
      replies,
      chatSends
    );

    await invokeWhatsAppMessage(adapter, channelId, first);
    await invokeWhatsAppMessage(adapter, channelId, second);

    expect(handlerInputs).toHaveLength(2);
    expect(handlerInputs[0].content).toBe("first");
    expect(handlerInputs[1].content).toBe("second");
    expect(handlerInputs[0].chatId).toBe("15550001111@c.us");
    expect(handlerInputs[1].chatId).toBe("15550001111@c.us");
    expect(handlerInputs[0].sessionId).toBe(handlerInputs[1].sessionId);
    expect(replies).toContain("echo:first");
    expect(replies).toContain("echo:second");
  });

  test("media-only message forwards placeholder and file metadata", async () => {
    const adapter = new WhatsAppAdapter();
    const channelId = makeChannelId("wa-media");
    const replies: string[] = [];
    const chatSends: string[] = [];
    const handlerInputs: Array<{
      content: string;
      fileInfo: { hasFile: boolean; fileType: string; placeholder: string };
    }> = [];

    securityManager.setConfig(channelId, { dm_policy: "open" });
    adapter.setMessageHandler(async (content, _chatId, _sessionId, fileInfo) => {
      handlerInputs.push({
        content,
        fileInfo: {
          hasFile: fileInfo.hasFile,
          fileType: fileInfo.fileType,
          placeholder: fileInfo.placeholder,
        },
      });
      return "media-ok";
    });

    const message = createFakeWhatsAppMessage(
      {
        body: "",
        hasMedia: true,
        type: "image",
        downloadMedia: async () => ({ mimetype: "image/png" }),
      },
      replies,
      chatSends
    );

    await invokeWhatsAppMessage(adapter, channelId, message);

    expect(handlerInputs).toHaveLength(1);
    expect(handlerInputs[0].content).toBe("<media:image>");
    expect(handlerInputs[0].fileInfo.hasFile).toBe(true);
    expect(handlerInputs[0].fileInfo.fileType).toBe("image/png");
    expect(handlerInputs[0].fileInfo.placeholder).toBe("<media:image>");
    expect(replies).toContain("media-ok");
  });

  test("falls back to chat.sendMessage when reply fails", async () => {
    const adapter = new WhatsAppAdapter();
    const channelId = makeChannelId("wa-fallback");
    const replies: string[] = [];
    const chatSends: string[] = [];

    securityManager.setConfig(channelId, { dm_policy: "open" });
    adapter.setMessageHandler(async () => "fallback-response");

    const message = createFakeWhatsAppMessage(
      {
        reply: async () => {
          throw new Error("reply failed");
        },
      },
      replies,
      chatSends
    );

    await invokeWhatsAppMessage(adapter, channelId, message);

    expect(replies).toHaveLength(0);
    expect(chatSends).toEqual(["fallback-response"]);
  });

  test("handles slash management commands without invoking chat handler", async () => {
    const adapter = new WhatsAppAdapter();
    const channelId = makeChannelId("wa-command");
    const replies: string[] = [];
    const chatSends: string[] = [];
    let handlerCalls = 0;

    securityManager.setConfig(channelId, { dm_policy: "open" });
    adapter.setMessageHandler(async () => {
      handlerCalls += 1;
      return "should-not-run";
    });

    const message = createFakeWhatsAppMessage(
      {
        body: "/help",
        id: { _serialized: "wamid-command" },
      },
      replies,
      chatSends
    );

    await invokeWhatsAppMessage(adapter, channelId, message);

    expect(handlerCalls).toBe(0);
    expect(replies).toHaveLength(1);
    expect(replies[0]).toContain("Available management commands");
    expect(chatSends).toHaveLength(0);
  });

  test("routes /model command and updates default agent model", async () => {
    const adapter = new WhatsAppAdapter();
    const channelId = makeChannelId("wa-model-command");
    const replies: string[] = [];
    const chatSends: string[] = [];
    let handlerCalls = 0;

    const providerId = createProvider("WhatsApp Model Provider");
    addProviderModel(providerId, "model-one");
    addProviderModel(providerId, "model-two");
    const agentId = createAgent("WhatsApp Model Agent", providerId, "model-one");
    config.set("default_agent_id", agentId);

    securityManager.setConfig(channelId, { dm_policy: "open" });
    adapter.setMessageHandler(async () => {
      handlerCalls += 1;
      return "should-not-run";
    });

    const message = createFakeWhatsAppMessage(
      {
        body: "/model 2",
      },
      replies,
      chatSends
    );

    await invokeWhatsAppMessage(adapter, channelId, message);

    const updatedAgent = tables.agents.get(agentId) as { model?: string } | undefined;
    expect(handlerCalls).toBe(0);
    expect(updatedAgent?.model).toBe("model-two");
    expect(replies).toHaveLength(1);
    expect(replies[0]).toContain("model-two");
    expect(chatSends).toHaveLength(0);
  });
});
