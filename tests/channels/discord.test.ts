import { afterEach, describe, expect, test } from "bun:test";
import { GatewayIntentBits } from "discord.js";
import {
  DiscordAdapter,
  DISCORD_REQUIRED_INTENTS,
  discordSessions,
} from "../../src/core/channels/adapters/discord";
import { securityManager } from "../../src/core/channels/security";
import { config } from "../../src/core/config";
import { tables } from "../../src/core/database";

const createdAgents: string[] = [];
const createdProviders: string[] = [];

function id(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function createProvider(name: string): string {
  const providerId = id("provider");
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
  const agentId = id("agent");
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
    id: id("provider-model"),
    provider_id: providerId,
    model_id: modelId,
    model_name: modelId,
  });
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

describe("Discord adapter intent configuration", () => {
  test("includes intents required for guild and DM message handling", () => {
    expect(DISCORD_REQUIRED_INTENTS).toContain(GatewayIntentBits.Guilds);
    expect(DISCORD_REQUIRED_INTENTS).toContain(GatewayIntentBits.GuildMessages);
    expect(DISCORD_REQUIRED_INTENTS).toContain(GatewayIntentBits.MessageContent);
    expect(DISCORD_REQUIRED_INTENTS).toContain(GatewayIntentBits.DirectMessages);
  });

  test("does not request GuildMembers intent", () => {
    expect(DISCORD_REQUIRED_INTENTS).not.toContain(GatewayIntentBits.GuildMembers);
  });
});

interface FakeDiscordMessage {
  author: { bot: boolean; id: string; username: string };
  content: string;
  attachments: {
    size: number;
    first: () =>
      | {
          url: string;
          contentType?: string;
          name?: string;
        }
      | undefined;
  };
  channel: {
    id: string;
    sendTyping?: () => Promise<void>;
    send?: (message: string) => Promise<void>;
  };
  guild: { id: string } | null;
  mentions: { has: (user: { id: string }) => boolean };
  client: { user: { id: string } };
  id: string;
  reply: (message: string) => Promise<void>;
}

function makeChannelId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function createFakeDiscordMessage(
  overrides: Partial<FakeDiscordMessage>,
  replies: string[],
  followUps: string[]
): FakeDiscordMessage {
  return {
    author: { bot: false, id: "user-1", username: "alice" },
    content: "hello",
    attachments: {
      size: 0,
      first: () => undefined,
    },
    channel: {
      id: "chat-1",
      sendTyping: async () => {},
      send: async (message: string) => {
        followUps.push(message);
      },
    },
    guild: { id: "guild-1" },
    mentions: { has: () => true },
    client: { user: { id: "bot-1" } },
    id: "msg-1",
    reply: async (message: string) => {
      replies.push(message);
    },
    ...overrides,
  };
}

async function handleDiscordMessage(
  adapter: DiscordAdapter,
  channelId: string,
  message: FakeDiscordMessage
): Promise<void> {
  await (
    adapter as unknown as {
      handleMessage: (id: string, msg: FakeDiscordMessage) => Promise<void>;
    }
  ).handleMessage(channelId, message);
}

describe("Discord adapter mocked message flows", () => {
  test("ignores guild messages when bot is not mentioned", async () => {
    const adapter = new DiscordAdapter();
    const channelId = makeChannelId("discord-ignore");
    const replies: string[] = [];
    const followUps: string[] = [];
    let handlerCalls = 0;

    adapter.setMessageHandler(async () => {
      handlerCalls += 1;
      return "should not run";
    });
    securityManager.setConfig(channelId, { dm_policy: "open" });

    const message = createFakeDiscordMessage(
      {
        mentions: { has: () => false },
      },
      replies,
      followUps
    );

    await handleDiscordMessage(adapter, channelId, message);

    expect(handlerCalls).toBe(0);
    expect(replies).toHaveLength(0);
    expect(followUps).toHaveLength(0);
  });

  test("creates pairing code for new DM sender and blocks handler", async () => {
    const adapter = new DiscordAdapter();
    const channelId = makeChannelId("discord-pairing");
    const replies: string[] = [];
    const followUps: string[] = [];
    let handlerCalls = 0;

    discordSessions.clear();
    adapter.setMessageHandler(async () => {
      handlerCalls += 1;
      return "should not run";
    });
    securityManager.setConfig(channelId, { dm_policy: "pairing", allowed_senders: [] });

    const message = createFakeDiscordMessage(
      {
        guild: null,
        content: "hello from dm",
      },
      replies,
      followUps
    );

    await handleDiscordMessage(adapter, channelId, message);

    expect(handlerCalls).toBe(0);
    expect(replies).toHaveLength(1);
    expect(replies[0]).toContain("Pairing code");
    expect(securityManager.getPendingPairings(channelId).length).toBe(1);
  });

  test("processes allowed sender messages and reuses session id for same chat", async () => {
    const adapter = new DiscordAdapter();
    const channelId = makeChannelId("discord-session");
    const replies: string[] = [];
    const followUps: string[] = [];
    const handlerInputs: Array<{ content: string; chatId: string; sessionId: string }> = [];

    discordSessions.clear();
    securityManager.setConfig(channelId, { dm_policy: "pairing" });
    securityManager.addAllowedSender(channelId, "allowed-user");

    adapter.setMessageHandler(async (content, chatId, sessionId) => {
      handlerInputs.push({ content, chatId, sessionId });
      return `echo:${content}`;
    });

    const firstMessage = createFakeDiscordMessage(
      {
        author: { bot: false, id: "allowed-user", username: "alice" },
        content: "<@!bot-1> hello one",
        id: "msg-1",
      },
      replies,
      followUps
    );
    const secondMessage = createFakeDiscordMessage(
      {
        author: { bot: false, id: "allowed-user", username: "alice" },
        content: "<@!bot-1> hello two",
        id: "msg-2",
      },
      replies,
      followUps
    );

    await handleDiscordMessage(adapter, channelId, firstMessage);
    await handleDiscordMessage(adapter, channelId, secondMessage);

    expect(handlerInputs).toHaveLength(2);
    expect(handlerInputs[0].content).toBe("hello one");
    expect(handlerInputs[1].content).toBe("hello two");
    expect(handlerInputs[0].chatId).toBe("chat-1");
    expect(handlerInputs[1].chatId).toBe("chat-1");
    expect(handlerInputs[0].sessionId).toBe(handlerInputs[1].sessionId);
    expect(replies).toContain("echo:hello one");
    expect(replies).toContain("echo:hello two");
  });

  test("splits long responses into reply + follow-up chunks under Discord limits", async () => {
    const adapter = new DiscordAdapter();
    const channelId = makeChannelId("discord-long");
    const replies: string[] = [];
    const followUps: string[] = [];

    securityManager.setConfig(channelId, { dm_policy: "open" });
    adapter.setMessageHandler(async () => "A".repeat(4500));

    const message = createFakeDiscordMessage(
      {
        guild: null,
      },
      replies,
      followUps
    );

    await handleDiscordMessage(adapter, channelId, message);

    expect(replies.length).toBe(1);
    expect(followUps.length).toBeGreaterThan(0);
    expect(replies[0].length).toBeLessThanOrEqual(2000);
    for (const chunk of followUps) {
      expect(chunk.length).toBeLessThanOrEqual(2000);
    }
  });

  test("routes slash management commands without invoking chat handler", async () => {
    const adapter = new DiscordAdapter();
    const channelId = makeChannelId("discord-command");
    const replies: string[] = [];
    const followUps: string[] = [];
    let handlerCalls = 0;

    securityManager.setConfig(channelId, { dm_policy: "open" });
    adapter.setMessageHandler(async () => {
      handlerCalls += 1;
      return "should-not-run";
    });

    const message = createFakeDiscordMessage(
      {
        guild: null,
        content: "/help",
      },
      replies,
      followUps
    );

    await handleDiscordMessage(adapter, channelId, message);

    expect(handlerCalls).toBe(0);
    expect(replies).toHaveLength(1);
    expect(replies[0]).toContain("Available management commands");
    expect(followUps).toHaveLength(0);
  });

  test("routes /model command through adapter and updates default agent model", async () => {
    const adapter = new DiscordAdapter();
    const channelId = makeChannelId("discord-model-command");
    const replies: string[] = [];
    const followUps: string[] = [];
    let handlerCalls = 0;

    const providerId = createProvider("Discord Model Provider");
    addProviderModel(providerId, "model-one");
    addProviderModel(providerId, "model-two");
    const agentId = createAgent("Discord Model Agent", providerId, "model-one");
    config.set("default_agent_id", agentId);

    securityManager.setConfig(channelId, { dm_policy: "open" });
    adapter.setMessageHandler(async () => {
      handlerCalls += 1;
      return "should-not-run";
    });

    const message = createFakeDiscordMessage(
      {
        guild: null,
        content: "/model 2",
      },
      replies,
      followUps
    );

    await handleDiscordMessage(adapter, channelId, message);

    const updatedAgent = tables.agents.get(agentId) as { model?: string } | undefined;
    expect(handlerCalls).toBe(0);
    expect(updatedAgent?.model).toBe("model-two");
    expect(replies).toHaveLength(1);
    expect(replies[0]).toContain("model-two");
    expect(followUps).toHaveLength(0);
  });
});
