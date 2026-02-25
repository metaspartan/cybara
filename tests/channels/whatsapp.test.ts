import { afterEach, describe, expect, test } from "bun:test";
import { WhatsAppAdapter, whatsappSessions } from "../../src/core/channels/adapters/whatsapp";
import {
  clearChannelSubagentSpawnHandler,
  setChannelSubagentSpawnHandler,
} from "../../src/core/channels/commands";
import { securityManager } from "../../src/core/channels/security";
import { config } from "../../src/core/config";
import { tables } from "../../src/core/database";

type FakeWhatsAppMessage = {
  fromMe: boolean;
  from: string;
  to: string;
  author?: string;
  body: string;
  hasMedia: boolean;
  type: string;
  id: {
    _serialized: string;
    fromMe?: boolean;
  };
  reply: (text: string) => Promise<Message | void>;
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
    to: "15550001111@c.us",
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
  message: FakeWhatsAppMessage,
  eventType: "message" | "message_create" = "message"
): Promise<void> {
  await (
    adapter as unknown as {
      handleMessage: (id: string, msg: FakeWhatsAppMessage, eventType?: "message" | "message_create") => Promise<void>;
    }
  ).handleMessage(channelId, message, eventType);
}

afterEach(() => {
  config.set("default_agent_id", "");
  clearChannelSubagentSpawnHandler();
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
        to: "15550001111@c.us",
      },
      replies,
      chatSends
    );

    await invokeWhatsAppMessage(adapter, channelId, message);

    expect(handlerCalls).toBe(0);
    expect(replies).toHaveLength(0);
    expect(chatSends).toHaveLength(0);
  });

  test("allows self messages when allow_self_messages is enabled", async () => {
    const adapter = new WhatsAppAdapter();
    const channelId = makeChannelId("wa-self");
    const replies: string[] = [];
    const chatSends: string[] = [];
    let handlerCalls = 0;

    adapter.setMessageHandler(async () => {
      handlerCalls += 1;
      return "self ok";
    });
    securityManager.setConfig(channelId, { dm_policy: "open" });
    (adapter as unknown as { channelConfigs: Map<string, { allow_self_messages?: boolean }> }).channelConfigs.set(
      channelId,
      { allow_self_messages: true }
    );

    const message = createFakeWhatsAppMessage(
      {
        fromMe: true,
        from: "15550001111@c.us",
        to: "15550001111@c.us",
        id: { _serialized: "wamid-self-1", fromMe: true },
      },
      replies,
      chatSends
    );

    await invokeWhatsAppMessage(adapter, channelId, message);

    expect(handlerCalls).toBe(1);
    expect(replies).toHaveLength(1);
    expect(replies[0]).toBe("self ok");
    expect(chatSends).toHaveLength(0);
  });

  test("suppresses self-message echo using outbound message id tracking", async () => {
    const adapter = new WhatsAppAdapter();
    const channelId = makeChannelId("wa-self-loop-id");
    const chatId = "15550001111@c.us";
    const replies: string[] = [];
    const chatSends: string[] = [];
    let handlerCalls = 0;

    adapter.setMessageHandler(async () => {
      handlerCalls += 1;
      return "self echo";
    });
    securityManager.setConfig(channelId, { dm_policy: "open" });
    (adapter as unknown as { channelConfigs: Map<string, { allow_self_messages?: boolean }> }).channelConfigs.set(
      channelId,
      { allow_self_messages: true }
    );
    (adapter as unknown as { accountIds: Map<string, string> }).accountIds.set(channelId, `${chatId}@s.whatsapp.net`);

    const sourceMessage = createFakeWhatsAppMessage(
      {
        fromMe: true,
        from: chatId,
        to: chatId,
        body: "ping",
        reply: async (text: string) => {
          replies.push(`reply:${text}`);
          return {
            id: { _serialized: "wamid-self-reply-id" },
            to: chatId,
            from: chatId,
            fromMe: true,
            hasMedia: false,
            body: text,
            type: "chat",
            author: undefined,
            downloadMedia: async () => null,
            getChat: async () => ({
              sendMessage: async () => { },
            }),
          } as Message;
        },
      },
      replies,
      chatSends
    );

    const echoedResponse = createFakeWhatsAppMessage(
      {
        fromMe: true,
        from: chatId,
        to: chatId,
        body: "self echo",
        id: { _serialized: "wamid-self-reply-id" },
      },
      replies,
      chatSends
    );

    await invokeWhatsAppMessage(adapter, channelId, sourceMessage, "message_create");
    await invokeWhatsAppMessage(adapter, channelId, echoedResponse, "message_create");

    expect(handlerCalls).toBe(1);
    expect(replies).toHaveLength(1);
    expect(replies[0]).toBe("reply:self echo");
    expect(chatSends).toHaveLength(0);
  });

  test("processes self-chat message_create events with id.fromMe when not an outbound echo", async () => {
    const adapter = new WhatsAppAdapter();
    const channelId = makeChannelId("wa-self-create-id-fromme");
    const chatId = "15550001111@c.us";
    const replies: string[] = [];
    const chatSends: string[] = [];
    let handlerCalls = 0;

    adapter.setMessageHandler(async () => {
      handlerCalls += 1;
      return "self create ok";
    });
    securityManager.setConfig(channelId, { dm_policy: "open" });
    (adapter as unknown as { channelConfigs: Map<string, { allow_self_messages?: boolean }> }).channelConfigs.set(
      channelId,
      { allow_self_messages: true }
    );
    (adapter as unknown as { accountIds: Map<string, string> }).accountIds.set(channelId, `${chatId}@s.whatsapp.net`);

    const message = createFakeWhatsAppMessage(
      {
        fromMe: true,
        from: chatId,
        to: chatId,
        body: "hello from self",
        id: { _serialized: "wamid-self-create-id-fromme", fromMe: true },
      },
      replies,
      chatSends
    );

    await invokeWhatsAppMessage(adapter, channelId, message, "message_create");

    expect(handlerCalls).toBe(1);
    expect(replies).toHaveLength(1);
    expect(replies[0]).toBe("self create ok");
  });

  test("suppresses self-message echo using outbound signature fallback", async () => {
    const adapter = new WhatsAppAdapter();
    const channelId = makeChannelId("wa-self-loop-signature");
    const chatId = "15550001111@c.us";
    const replies: string[] = [];
    const chatSends: string[] = [];
    let handlerCalls = 0;

    adapter.setMessageHandler(async () => {
      handlerCalls += 1;
      return "fallback signature";
    });
    securityManager.setConfig(channelId, { dm_policy: "open" });
    (adapter as unknown as { channelConfigs: Map<string, { allow_self_messages?: boolean }> }).channelConfigs.set(
      channelId,
      { allow_self_messages: true }
    );
    (adapter as unknown as { accountIds: Map<string, string> }).accountIds.set(channelId, `${chatId}@s.whatsapp.net`);

    const sourceMessage = createFakeWhatsAppMessage(
      {
        fromMe: true,
        from: chatId,
        to: chatId,
        body: "ping",
        reply: async (text: string) => {
          replies.push(`reply:${text}`);
          return {
            id: { _serialized: "" },
            to: chatId,
            from: chatId,
            fromMe: true,
            hasMedia: false,
            body: text,
            type: "chat",
            author: undefined,
            downloadMedia: async () => null,
            getChat: async () => ({
              sendMessage: async () => { },
            }),
          } as Message;
        },
      },
      replies,
      chatSends
    );

    const echoedResponse = createFakeWhatsAppMessage(
      {
        fromMe: true,
        from: chatId,
        to: chatId,
        body: "fallback signature",
        id: { _serialized: "wamid-self-reply-signature-2" },
      },
      replies,
      chatSends
    );

    await invokeWhatsAppMessage(adapter, channelId, sourceMessage, "message_create");
    await invokeWhatsAppMessage(adapter, channelId, echoedResponse, "message_create");

    expect(handlerCalls).toBe(1);
    expect(replies).toHaveLength(1);
    expect(replies[0]).toBe("reply:fallback signature");
    expect(chatSends).toHaveLength(0);
  });

  test("suppresses self-message echo when message_create payload is reported as outbound without fromMe", async () => {
    const adapter = new WhatsAppAdapter();
    const channelId = makeChannelId("wa-self-loop-id-flagged");
    const replies: string[] = [];
    const chatSends: string[] = [];
    let handlerCalls = 0;

    adapter.setMessageHandler(async () => {
      handlerCalls += 1;
      return "self flagged";
    });
    securityManager.setConfig(channelId, { dm_policy: "open" });
    (adapter as unknown as { channelConfigs: Map<string, { allow_self_messages?: boolean }> }).channelConfigs.set(
      channelId,
      { allow_self_messages: true }
    );
    (adapter as unknown as { accountIds: Map<string, string> }).accountIds.set(channelId, "15550001111@s.whatsapp.net");

    const message = createFakeWhatsAppMessage(
      {
        fromMe: true,
        from: "15550001111@c.us",
        to: "15550001111@c.us",
        body: "ping",
        reply: async (text: string) => {
          replies.push(`reply:${text}`);
          return {
            id: { _serialized: "wamid-self-flagged-reply" },
            to: "15550001111@c.us",
            from: "15550001111@c.us",
            fromMe: true,
            hasMedia: false,
            body: text,
            type: "chat",
            author: undefined,
            downloadMedia: async () => null,
            getChat: async () => ({
              sendMessage: async () => { },
            }),
          } as Message;
        },
      },
      replies,
      chatSends
    );

    const echoedResponse = createFakeWhatsAppMessage(
      {
        fromMe: false,
        from: "15550001111@c.us",
        to: "15550001111@c.us",
        id: { _serialized: "", fromMe: true },
        body: "self flagged",
      },
      replies,
      chatSends
    );

    await invokeWhatsAppMessage(adapter, channelId, message);
    await invokeWhatsAppMessage(adapter, channelId, echoedResponse);

    expect(handlerCalls).toBe(1);
    expect(replies).toHaveLength(1);
    expect(replies[0]).toBe("reply:self flagged");
    expect(chatSends).toHaveLength(0);
  });

  test("processes self-chat message_create payload when fromMe=false but id.fromMe=true and no outbound echo signature", async () => {
    const adapter = new WhatsAppAdapter();
    const channelId = makeChannelId("wa-self-create-flagged-no-echo");
    const chatId = "15550001111@c.us";
    const replies: string[] = [];
    const chatSends: string[] = [];
    let handlerCalls = 0;

    adapter.setMessageHandler(async () => {
      handlerCalls += 1;
      return "self flagged no echo";
    });
    securityManager.setConfig(channelId, { dm_policy: "open" });
    (adapter as unknown as { channelConfigs: Map<string, { allow_self_messages?: boolean }> }).channelConfigs.set(
      channelId,
      { allow_self_messages: true }
    );
    (adapter as unknown as { accountIds: Map<string, string> }).accountIds.set(channelId, `${chatId}@s.whatsapp.net`);

    const message = createFakeWhatsAppMessage(
      {
        fromMe: false,
        from: chatId,
        to: chatId,
        body: "hello from self flagged",
        id: { _serialized: "wamid-self-create-flagged-no-echo", fromMe: true },
      },
      replies,
      chatSends
    );

    await invokeWhatsAppMessage(adapter, channelId, message, "message_create");

    expect(handlerCalls).toBe(1);
    expect(replies).toHaveLength(1);
    expect(replies[0]).toBe("self flagged no echo");
    expect(chatSends).toHaveLength(0);
  });

  test("processes inbound self-chat when allow_self_messages is enabled", async () => {
    const adapter = new WhatsAppAdapter();
    const channelId = makeChannelId("wa-self-inbound");
    const replies: string[] = [];
    const chatSends: string[] = [];
    let handlerCalls = 0;

    adapter.setMessageHandler(async () => {
      handlerCalls += 1;
      return "self inbound";
    });
    securityManager.setConfig(channelId, { dm_policy: "pairing" });
    (adapter as unknown as { channelConfigs: Map<string, { allow_self_messages?: boolean }> }).channelConfigs.set(
      channelId,
      { allow_self_messages: true }
    );

    const message = createFakeWhatsAppMessage(
      {
        fromMe: false,
        from: "15550001111@c.us",
        to: "15550001111@c.us",
        id: { _serialized: "wamid-self-inbound-1" },
      },
      replies,
      chatSends
    );

    await invokeWhatsAppMessage(adapter, channelId, message);

    expect(handlerCalls).toBe(1);
    expect(replies).toHaveLength(1);
    expect(replies[0]).toBe("self inbound");
    expect(chatSends).toHaveLength(0);
  });

  test("does not bypass security for inbound self-chat when allow_self_messages is disabled", async () => {
    const adapter = new WhatsAppAdapter();
    const channelId = makeChannelId("wa-self-inbound-block");
    const replies: string[] = [];
    const chatSends: string[] = [];
    let handlerCalls = 0;

    adapter.setMessageHandler(async () => {
      handlerCalls += 1;
      return "should-not-run";
    });
    securityManager.setConfig(channelId, { dm_policy: "pairing" });

    const message = createFakeWhatsAppMessage(
      {
        fromMe: false,
        from: "15550001111@c.us",
        to: "15550001111@c.us",
        id: { _serialized: "wamid-self-inbound-2" },
      },
      replies,
      chatSends
    );

    await invokeWhatsAppMessage(adapter, channelId, message);

    expect(handlerCalls).toBe(0);
    expect(replies).toHaveLength(1);
    expect(replies[0]).toContain("Pairing code");
    expect(chatSends).toHaveLength(0);
  });

  test("allows self messages when account JID domains differ", async () => {
    const adapter = new WhatsAppAdapter();
    const channelId = makeChannelId("wa-self-domain");
    const replies: string[] = [];
    const chatSends: string[] = [];
    let handlerCalls = 0;

    adapter.setMessageHandler(async () => {
      handlerCalls += 1;
      return "domain ok";
    });
    securityManager.setConfig(channelId, { dm_policy: "open" });
    (adapter as unknown as { channelConfigs: Map<string, { allow_self_messages?: boolean }> }).channelConfigs.set(
      channelId,
      { allow_self_messages: true }
    );
    (adapter as unknown as { accountIds: Map<string, string> }).accountIds.set(
      channelId,
      "15550001111@s.whatsapp.net"
    );

    const message = createFakeWhatsAppMessage(
      {
        fromMe: true,
        from: "15550001111@c.us",
        to: "15550001111@c.us",
        id: { _serialized: "wamid-domain-1" },
      },
      replies,
      chatSends
    );

    await invokeWhatsAppMessage(adapter, channelId, message);

    expect(handlerCalls).toBe(1);
    expect(replies).toHaveLength(1);
    expect(replies[0]).toBe("domain ok");
    expect(chatSends).toHaveLength(0);
  });

  test("ignores non-self outgoing messages even when self messages enabled", async () => {
    const adapter = new WhatsAppAdapter();
    const channelId = makeChannelId("wa-self-outbound");
    const replies: string[] = [];
    const chatSends: string[] = [];
    let handlerCalls = 0;

    adapter.setMessageHandler(async () => {
      handlerCalls += 1;
      return "should-not-run";
    });
    securityManager.setConfig(channelId, { dm_policy: "open" });
    (adapter as unknown as { channelConfigs: Map<string, { allow_self_messages?: boolean }> }).channelConfigs.set(
      channelId,
      { allow_self_messages: true }
    );

    const message = createFakeWhatsAppMessage(
      {
        fromMe: true,
        from: "15550001111@c.us",
        to: "19990002222@c.us",
        id: { _serialized: "wamid-self-2" },
      },
      replies,
      chatSends
    );

    await invokeWhatsAppMessage(adapter, channelId, message);

    expect(handlerCalls).toBe(0);
    expect(replies).toHaveLength(0);
    expect(chatSends).toHaveLength(0);
  });

  test("ignores outbound messages from self to other chats when account id is known", async () => {
    const adapter = new WhatsAppAdapter();
    const channelId = makeChannelId("wa-self-outbound-known");
    const replies: string[] = [];
    const chatSends: string[] = [];
    let handlerCalls = 0;

    adapter.setMessageHandler(async () => {
      handlerCalls += 1;
      return "should-not-run";
    });
    securityManager.setConfig(channelId, { dm_policy: "open" });
    (adapter as unknown as { channelConfigs: Map<string, { allow_self_messages?: boolean }> }).channelConfigs.set(
      channelId,
      { allow_self_messages: true }
    );
    (adapter as unknown as { accountIds: Map<string, string> }).accountIds.set(
      channelId,
      "15550001111@s.whatsapp.net"
    );

    const message = createFakeWhatsAppMessage(
      {
        fromMe: true,
        from: "15550001111@c.us",
        to: "19990002222@c.us",
        id: { _serialized: "wamid-self-known-2" },
      },
      replies,
      chatSends
    );

    await invokeWhatsAppMessage(adapter, channelId, message);

    expect(handlerCalls).toBe(0);
    expect(replies).toHaveLength(0);
    expect(chatSends).toHaveLength(0);
  });

  test("skips duplicate message events using same message id", async () => {
    const adapter = new WhatsAppAdapter();
    const channelId = makeChannelId("wa-duplicate");
    const replies: string[] = [];
    const chatSends: string[] = [];
    let handlerCalls = 0;

    adapter.setMessageHandler(async () => {
      handlerCalls += 1;
      return "once";
    });
    securityManager.setConfig(channelId, { dm_policy: "open" });
    (adapter as unknown as { channelConfigs: Map<string, { allow_self_messages?: boolean }> }).channelConfigs.set(
      channelId,
      { allow_self_messages: true }
    );

    const message = createFakeWhatsAppMessage(
      {
        id: { _serialized: "wamid-duplicate-1" },
        fromMe: true,
        from: "19990002222@c.us",
        to: "19990002222@c.us",
      },
      replies,
      chatSends
    );

    await invokeWhatsAppMessage(adapter, channelId, message);
    await invokeWhatsAppMessage(adapter, channelId, message);

    expect(handlerCalls).toBe(1);
    expect(replies).toHaveLength(1);
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
    expect(replies[0]).toContain("Cybara Commands");
    expect(chatSends).toHaveLength(0);
  });

  test("routes /status command and avoids chat handler", async () => {
    const adapter = new WhatsAppAdapter();
    const channelId = makeChannelId("wa-status-command");
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
        body: "/status",
      },
      replies,
      chatSends
    );

    await invokeWhatsAppMessage(adapter, channelId, message);

    expect(handlerCalls).toBe(0);
    expect(replies).toHaveLength(1);
    expect(replies[0]).toContain("Status:");
    expect(replies[0]).toContain("Agents:");
    expect(chatSends).toHaveLength(0);
  });

  test("routes /agents command and avoids chat handler", async () => {
    const adapter = new WhatsAppAdapter();
    const channelId = makeChannelId("wa-agents-command");
    const replies: string[] = [];
    const chatSends: string[] = [];
    let handlerCalls = 0;

    const providerId = createProvider("WhatsApp Agents Provider");
    createAgent("WhatsApp Agents Target", providerId, "model-one");

    securityManager.setConfig(channelId, { dm_policy: "open" });
    adapter.setMessageHandler(async () => {
      handlerCalls += 1;
      return "should-not-run";
    });

    const message = createFakeWhatsAppMessage(
      {
        body: "/agents",
      },
      replies,
      chatSends
    );

    await invokeWhatsAppMessage(adapter, channelId, message);

    expect(handlerCalls).toBe(0);
    expect(replies).toHaveLength(1);
    expect(replies[0]).toContain("Agents:");
    expect(replies[0]).toContain("WhatsApp Agents Target");
    expect(chatSends).toHaveLength(0);
  });

  test("routes /providers command and avoids chat handler", async () => {
    const adapter = new WhatsAppAdapter();
    const channelId = makeChannelId("wa-providers-command");
    const replies: string[] = [];
    const chatSends: string[] = [];
    let handlerCalls = 0;

    const providerId = createProvider("WhatsApp Providers Target");
    const agentId = createAgent("WhatsApp Providers Agent", providerId, "model-one");
    config.set("default_agent_id", agentId);

    securityManager.setConfig(channelId, { dm_policy: "open" });
    adapter.setMessageHandler(async () => {
      handlerCalls += 1;
      return "should-not-run";
    });

    const message = createFakeWhatsAppMessage(
      {
        body: "/providers",
      },
      replies,
      chatSends
    );

    await invokeWhatsAppMessage(adapter, channelId, message);

    expect(handlerCalls).toBe(0);
    expect(replies).toHaveLength(1);
    expect(replies[0]).toContain("Providers");
    expect(replies[0]).toContain("WhatsApp Providers Target");
    expect(chatSends).toHaveLength(0);
  });

  test("routes /new command and rotates whatsapp session id", async () => {
    const adapter = new WhatsAppAdapter();
    const channelId = makeChannelId("wa-new-command");
    const chatId = "15550001234@c.us";
    const initialSessionId = "session-wa-initial";
    const replies: string[] = [];
    const chatSends: string[] = [];
    let handlerCalls = 0;

    whatsappSessions.set(chatId, initialSessionId);
    securityManager.setConfig(channelId, { dm_policy: "open" });
    adapter.setMessageHandler(async () => {
      handlerCalls += 1;
      return "should-not-run";
    });

    const message = createFakeWhatsAppMessage(
      {
        from: chatId,
        body: "/new",
      },
      replies,
      chatSends
    );

    await invokeWhatsAppMessage(adapter, channelId, message);

    const rotatedSessionId = whatsappSessions.get(chatId);
    expect(handlerCalls).toBe(0);
    expect(rotatedSessionId).toBeDefined();
    expect(rotatedSessionId).not.toBe(initialSessionId);
    expect(replies).toHaveLength(1);
    expect(replies[0]).toContain("Started a new session");
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

  test("routes /agent command and updates default agent selection", async () => {
    const adapter = new WhatsAppAdapter();
    const channelId = makeChannelId("wa-agent-command");
    const replies: string[] = [];
    const chatSends: string[] = [];
    let handlerCalls = 0;

    const providerId = createProvider("WhatsApp Agent Provider");
    const firstAgentId = createAgent("WA Agent One", providerId, "model-one");
    const secondAgentId = createAgent("WA Agent Two", providerId, "model-two");
    config.set("default_agent_id", firstAgentId);

    securityManager.setConfig(channelId, { dm_policy: "open" });
    adapter.setMessageHandler(async () => {
      handlerCalls += 1;
      return "should-not-run";
    });

    const message = createFakeWhatsAppMessage(
      {
        body: `/agent ${secondAgentId}`,
      },
      replies,
      chatSends
    );

    await invokeWhatsAppMessage(adapter, channelId, message);

    expect(handlerCalls).toBe(0);
    expect(config.get<string>("default_agent_id")).toBe(secondAgentId);
    expect(replies).toHaveLength(1);
    expect(replies[0]).toContain("WA Agent Two");
    expect(chatSends).toHaveLength(0);
  });

  test("routes /provider command and updates default agent provider/model", async () => {
    const adapter = new WhatsAppAdapter();
    const channelId = makeChannelId("wa-provider-command");
    const replies: string[] = [];
    const chatSends: string[] = [];
    let handlerCalls = 0;

    const providerA = createProvider("WhatsApp Provider A");
    addProviderModel(providerA, "a-model");
    const providerB = createProvider("WhatsApp Provider B");
    addProviderModel(providerB, "b-model");
    const agentId = createAgent("WA Provider Agent", providerA, "a-model");
    config.set("default_agent_id", agentId);

    securityManager.setConfig(channelId, { dm_policy: "open" });
    adapter.setMessageHandler(async () => {
      handlerCalls += 1;
      return "should-not-run";
    });

    const message = createFakeWhatsAppMessage(
      {
        body: `/provider ${providerB}`,
      },
      replies,
      chatSends
    );

    await invokeWhatsAppMessage(adapter, channelId, message);

    const updatedAgent = tables.agents.get(agentId) as
      | { provider_id?: string; model?: string }
      | undefined;
    expect(handlerCalls).toBe(0);
    expect(updatedAgent?.provider_id).toBe(providerB);
    expect(updatedAgent?.model).toBe("b-model");
    expect(replies).toHaveLength(1);
    expect(replies[0]).toContain("WhatsApp Provider B");
    expect(chatSends).toHaveLength(0);
  });

  test("routes /subagents spawn command through adapter without invoking chat handler", async () => {
    const adapter = new WhatsAppAdapter();
    const channelId = makeChannelId("wa-subagents-command");
    const replies: string[] = [];
    const chatSends: string[] = [];
    let handlerCalls = 0;
    const spawnArgs: Array<Record<string, unknown>> = [];

    setChannelSubagentSpawnHandler(async (args) => {
      spawnArgs.push(args);
      return {
        status: "accepted",
        childSessionKey: "agent:default:subagent:whatsapp",
        runId: "run-wa-subagents",
        task: String(args.task || ""),
      };
    });

    securityManager.setConfig(channelId, { dm_policy: "open" });
    adapter.setMessageHandler(async () => {
      handlerCalls += 1;
      return "should-not-run";
    });

    const message = createFakeWhatsAppMessage(
      {
        body: "/subagents spawn summarize backlog",
      },
      replies,
      chatSends
    );

    await invokeWhatsAppMessage(adapter, channelId, message);

    expect(handlerCalls).toBe(0);
    expect(spawnArgs).toHaveLength(1);
    expect(spawnArgs[0]?.task).toBe("summarize backlog");
    expect(spawnArgs[0]?.label).toBe("channel:whatsapp");
    const requesterSessionKey = whatsappSessions.get(message.from);
    expect(requesterSessionKey).toBeDefined();
    expect(spawnArgs[0]?._requesterSessionKey).toBe(requesterSessionKey);
    expect(replies).toHaveLength(1);
    expect(replies[0]).toContain("Subagent spawned successfully.");
    expect(replies[0]).toContain("run-wa-subagents");
    expect(chatSends).toHaveLength(0);
  });
});
