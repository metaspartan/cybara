import { afterEach, describe, expect, test } from "bun:test";
import { GatewayIntentBits } from "discord.js";
import {
  DiscordAdapter,
  DISCORD_REQUIRED_INTENTS,
  discordSessions,
} from "../../src/core/channels/adapters/discord";
import {
  clearChannelSubagentSpawnHandler,
  setChannelSubagentSpawnHandler,
} from "../../src/core/channels/commands";
import { configureChannelChatRuntime, resetChannelChatRuntime } from "../../src/core/channels/chat-runtime";
import { securityManager } from "../../src/core/channels/security";
import { config } from "../../src/core/config";
import { tables } from "../../src/core/database";

const createdAgents: string[] = [];
const createdProviders: string[] = [];
const createdChannels: string[] = [];

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
  clearChannelSubagentSpawnHandler();
  discordSessions.clear();
  for (const channelId of createdChannels.splice(0)) {
    tables.channels.delete(channelId);
  }
  for (const agentId of createdAgents.splice(0)) {
    tables.agents.delete(agentId);
  }
  for (const providerId of createdProviders.splice(0)) {
    tables.providers.delete(providerId);
  }
  resetChannelChatRuntime();
});

describe("Discord adapter intent configuration", () => {
  test("includes intents required for guild and DM message handling", () => {
    expect(DISCORD_REQUIRED_INTENTS).toContain(GatewayIntentBits.Guilds);
    expect(DISCORD_REQUIRED_INTENTS).toContain(GatewayIntentBits.GuildMessages);
    expect(DISCORD_REQUIRED_INTENTS).toContain(GatewayIntentBits.MessageContent);
    expect(DISCORD_REQUIRED_INTENTS).toContain(GatewayIntentBits.DirectMessages);
    expect(DISCORD_REQUIRED_INTENTS).toContain(GatewayIntentBits.GuildMessageReactions);
    expect(DISCORD_REQUIRED_INTENTS).toContain(GatewayIntentBits.DirectMessageReactions);
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

async function handleDiscordReaction(
  adapter: DiscordAdapter,
  channelId: string,
  reaction: unknown,
  user: unknown,
  action: "added" | "removed"
): Promise<void> {
  await (
    adapter as unknown as {
      handleReactionEvent: (
        id: string,
        reactionEvent: unknown,
        reactionUser: unknown,
        reactionAction: "added" | "removed"
      ) => Promise<void>;
    }
  ).handleReactionEvent(channelId, reaction, user, action);
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

  test("routes /status command through adapter without invoking chat handler", async () => {
    const adapter = new DiscordAdapter();
    const channelId = makeChannelId("discord-status-command");
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
        content: "/status",
      },
      replies,
      followUps
    );

    await handleDiscordMessage(adapter, channelId, message);

    expect(handlerCalls).toBe(0);
    expect(replies).toHaveLength(1);
    expect(replies[0]).toContain("Status:");
    expect(replies[0]).toContain("Agents:");
    expect(followUps).toHaveLength(0);
  });

  test("routes /agents command through adapter without invoking chat handler", async () => {
    const adapter = new DiscordAdapter();
    const channelId = makeChannelId("discord-agents-command");
    const replies: string[] = [];
    const followUps: string[] = [];
    let handlerCalls = 0;

    const providerId = createProvider("Discord Agents Provider");
    createAgent("Discord Agents Target", providerId, "model-one");

    securityManager.setConfig(channelId, { dm_policy: "open" });
    adapter.setMessageHandler(async () => {
      handlerCalls += 1;
      return "should-not-run";
    });

    const message = createFakeDiscordMessage(
      {
        guild: null,
        content: "/agents",
      },
      replies,
      followUps
    );

    await handleDiscordMessage(adapter, channelId, message);

    expect(handlerCalls).toBe(0);
    expect(replies).toHaveLength(1);
    expect(replies[0]).toContain("Agents:");
    expect(replies[0]).toContain("Discord Agents Target");
  });

  test("routes /providers command through adapter without invoking chat handler", async () => {
    const adapter = new DiscordAdapter();
    const channelId = makeChannelId("discord-providers-command");
    const replies: string[] = [];
    const followUps: string[] = [];
    let handlerCalls = 0;

    const providerId = createProvider("Discord Providers Target");
    const agentId = createAgent("Discord Providers Agent", providerId, "model-one");
    config.set("default_agent_id", agentId);

    securityManager.setConfig(channelId, { dm_policy: "open" });
    adapter.setMessageHandler(async () => {
      handlerCalls += 1;
      return "should-not-run";
    });

    const message = createFakeDiscordMessage(
      {
        guild: null,
        content: "/providers",
      },
      replies,
      followUps
    );

    await handleDiscordMessage(adapter, channelId, message);

    expect(handlerCalls).toBe(0);
    expect(replies).toHaveLength(1);
    expect(replies[0]).toContain("Providers");
    expect(replies[0]).toContain("Discord Providers Target");
  });

  test("routes /new command through adapter and rotates session id", async () => {
    const adapter = new DiscordAdapter();
    const channelId = makeChannelId("discord-new-command");
    const replies: string[] = [];
    const followUps: string[] = [];
    let handlerCalls = 0;
    const sessionKey = `${channelId}:chat-1`;
    const initialSessionId = "session-discord-initial";

    discordSessions.set(sessionKey, initialSessionId);
    securityManager.setConfig(channelId, { dm_policy: "open" });
    adapter.setMessageHandler(async () => {
      handlerCalls += 1;
      return "should-not-run";
    });

    const message = createFakeDiscordMessage(
      {
        guild: null,
        content: "/new",
      },
      replies,
      followUps
    );

    await handleDiscordMessage(adapter, channelId, message);

    const rotatedSessionId = discordSessions.get(sessionKey);
    expect(handlerCalls).toBe(0);
    expect(rotatedSessionId).toBeDefined();
    expect(rotatedSessionId).not.toBe(initialSessionId);
    expect(replies).toHaveLength(1);
    expect(replies[0]).toContain("Started a new session");
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

  test("routes /agent command through adapter and updates default agent selection", async () => {
    const adapter = new DiscordAdapter();
    const channelId = makeChannelId("discord-agent-command");
    const replies: string[] = [];
    const followUps: string[] = [];
    let handlerCalls = 0;

    const providerId = createProvider("Discord Agent Provider");
    const firstAgentId = createAgent("Discord Agent One", providerId, "model-one");
    const secondAgentId = createAgent("Discord Agent Two", providerId, "model-two");
    config.set("default_agent_id", firstAgentId);

    securityManager.setConfig(channelId, { dm_policy: "open" });
    adapter.setMessageHandler(async () => {
      handlerCalls += 1;
      return "should-not-run";
    });

    const message = createFakeDiscordMessage(
      {
        guild: null,
        content: `/agent ${secondAgentId}`,
      },
      replies,
      followUps
    );

    await handleDiscordMessage(adapter, channelId, message);

    expect(handlerCalls).toBe(0);
    expect(config.get<string>("default_agent_id")).toBe(secondAgentId);
    expect(replies).toHaveLength(1);
    expect(replies[0]).toContain("Discord Agent Two");
    expect(followUps).toHaveLength(0);
  });

  test("routes /provider command through adapter and updates default agent provider/model", async () => {
    const adapter = new DiscordAdapter();
    const channelId = makeChannelId("discord-provider-command");
    const replies: string[] = [];
    const followUps: string[] = [];
    let handlerCalls = 0;

    const providerA = createProvider("Discord Provider A");
    addProviderModel(providerA, "a-model");
    const providerB = createProvider("Discord Provider B");
    addProviderModel(providerB, "b-model");
    const agentId = createAgent("Discord Provider Agent", providerA, "a-model");
    config.set("default_agent_id", agentId);

    securityManager.setConfig(channelId, { dm_policy: "open" });
    adapter.setMessageHandler(async () => {
      handlerCalls += 1;
      return "should-not-run";
    });

    const message = createFakeDiscordMessage(
      {
        guild: null,
        content: `/provider ${providerB}`,
      },
      replies,
      followUps
    );

    await handleDiscordMessage(adapter, channelId, message);

    const updatedAgent = tables.agents.get(agentId) as
      | { provider_id?: string; model?: string }
      | undefined;
    expect(handlerCalls).toBe(0);
    expect(updatedAgent?.provider_id).toBe(providerB);
    expect(updatedAgent?.model).toBe("b-model");
    expect(replies).toHaveLength(1);
    expect(replies[0]).toContain("Discord Provider B");
    expect(followUps).toHaveLength(0);
  });

  test("routes /subagents spawn command through adapter without invoking chat handler", async () => {
    const adapter = new DiscordAdapter();
    const channelId = makeChannelId("discord-subagents-command");
    const replies: string[] = [];
    const followUps: string[] = [];
    let handlerCalls = 0;
    const spawnArgs: Array<Record<string, unknown>> = [];

    setChannelSubagentSpawnHandler(async (args) => {
      spawnArgs.push(args);
      return {
        status: "accepted",
        childSessionKey: "agent:default:subagent:test",
        runId: "run-discord-subagents",
        task: String(args.task || ""),
      };
    });

    securityManager.setConfig(channelId, { dm_policy: "open" });
    adapter.setMessageHandler(async () => {
      handlerCalls += 1;
      return "should-not-run";
    });

    const message = createFakeDiscordMessage(
      {
        guild: null,
        content: "/subagents spawn summarize release notes",
      },
      replies,
      followUps
    );

    await handleDiscordMessage(adapter, channelId, message);

    expect(handlerCalls).toBe(0);
    expect(spawnArgs).toHaveLength(1);
    expect(spawnArgs[0]?.task).toBe("summarize release notes");
    expect(spawnArgs[0]?.label).toBe("channel:discord");
    const requesterSessionKey = discordSessions.get(`${channelId}:${message.channel.id}`);
    expect(requesterSessionKey).toBeDefined();
    expect(spawnArgs[0]?._requesterSessionKey).toBe(requesterSessionKey);
    expect(replies).toHaveLength(1);
    expect(replies[0]).toContain("Subagent spawned successfully.");
    expect(replies[0]).toContain("run-discord-subagents");
    expect(followUps).toHaveLength(0);
  });

  test("logs reaction events for configured channels", async () => {
    const adapter = new DiscordAdapter();
    const channelId = makeChannelId("discord-reaction");
    const chatId = makeChannelId("discord-chat");
    const messageId = makeChannelId("discord-msg");

    tables.channels.create({
      id: channelId,
      type: "discord",
      name: "Discord Reaction Test",
      enabled: true,
      config: {
        bot_token: "test-token",
        reaction_notifications: "all",
      },
    });
    createdChannels.push(channelId);

    const reaction = {
      partial: false,
      message: {
        partial: false,
        id: messageId,
        channel: { id: chatId },
        guild: { id: "guild-1" },
      },
      emoji: {
        name: "🔥",
        id: null,
      },
    };
    const user = {
      bot: false,
      id: "user-1",
      username: "alice",
    };

    await handleDiscordReaction(adapter, channelId, reaction, user, "added");

    const logs = tables.channelLogs.getByChannel("discord", chatId) as Array<{
      content: string;
      metadata?: string;
    }>;
    const reactionLog = logs.find((entry) =>
      entry.content.includes("Discord reaction added by alice")
    );

    expect(reactionLog).toBeDefined();
    const metadata = reactionLog?.metadata ? JSON.parse(reactionLog.metadata) : {};
    expect(metadata.event).toBe("reaction");
    expect(metadata.action).toBe("added");
    expect(metadata.emoji).toBe("🔥");
    expect(metadata.messageId).toBe(messageId);
    expect(metadata.isDM).toBe(false);
  });

  test("injects reaction events into active runtime sessions when enabled", async () => {
    const adapter = new DiscordAdapter();
    const channelId = makeChannelId("discord-reaction-runtime");
    const chatId = makeChannelId("discord-chat-runtime");
    const injected: Array<{ sessionId: string; content: string }> = [];

    tables.channels.create({
      id: channelId,
      type: "discord",
      name: "Discord Reaction Runtime",
      enabled: true,
      config: {
        bot_token: "test-token",
        reaction_notifications: "all",
      },
    });
    createdChannels.push(channelId);

    configureChannelChatRuntime({
      sendToSession: (sessionId, message) => {
        injected.push({ sessionId, content: message.content });
        return true;
      },
    });

    discordSessions.set(`${channelId}:${chatId}`, "session-discord-reaction");

    await handleDiscordReaction(
      adapter,
      channelId,
      {
        partial: false,
        message: {
          partial: false,
          id: makeChannelId("discord-msg-runtime"),
          channel: { id: chatId },
          guild: { id: "guild-runtime" },
        },
        emoji: { name: "✅", id: null },
      },
      {
        bot: false,
        id: "user-runtime",
        username: "bob",
      },
      "added"
    );

    expect(injected).toHaveLength(1);
    expect(injected[0].sessionId).toBe("session-discord-reaction");
    expect(injected[0].content).toContain("Discord reaction added by bob");
  });

  test("does not inject guild reactions when scope is dm-only", async () => {
    const adapter = new DiscordAdapter();
    const channelId = makeChannelId("discord-reaction-dm-only");
    const chatId = makeChannelId("discord-chat-dm-only");
    const injected: string[] = [];

    tables.channels.create({
      id: channelId,
      type: "discord",
      name: "Discord DM Scope",
      enabled: true,
      config: {
        bot_token: "test-token",
        reaction_notifications: "dm",
      },
    });
    createdChannels.push(channelId);

    configureChannelChatRuntime({
      sendToSession: (sessionId) => {
        injected.push(sessionId);
        return true;
      },
    });

    discordSessions.set(`${channelId}:${chatId}`, "session-discord-dm-only");

    await handleDiscordReaction(
      adapter,
      channelId,
      {
        partial: false,
        message: {
          partial: false,
          id: makeChannelId("discord-msg-dm-only"),
          channel: { id: chatId },
          guild: { id: "guild-dm-only" },
        },
        emoji: { name: "👀", id: null },
      },
      {
        bot: false,
        id: "user-dm-only",
        username: "eve",
      },
      "added"
    );

    expect(injected).toHaveLength(0);
  });

  test("injects DM reactions when scope is dm-only", async () => {
    const adapter = new DiscordAdapter();
    const channelId = makeChannelId("discord-reaction-dm-allow");
    const chatId = makeChannelId("discord-chat-dm-allow");
    const injected: string[] = [];

    tables.channels.create({
      id: channelId,
      type: "discord",
      name: "Discord DM Scope Allow",
      enabled: true,
      config: {
        bot_token: "test-token",
        reaction_notifications: "dm",
      },
    });
    createdChannels.push(channelId);

    configureChannelChatRuntime({
      sendToSession: (sessionId) => {
        injected.push(sessionId);
        return true;
      },
    });

    discordSessions.set(`${channelId}:${chatId}`, "session-discord-dm-allow");

    await handleDiscordReaction(
      adapter,
      channelId,
      {
        partial: false,
        message: {
          partial: false,
          id: makeChannelId("discord-msg-dm-allow"),
          channel: { id: chatId },
          guild: null,
        },
        emoji: { name: "👍", id: null },
      },
      {
        bot: false,
        id: "user-dm-allow",
        username: "sam",
      },
      "added"
    );

    expect(injected).toEqual(["session-discord-dm-allow"]);
  });

  test("does not inject reactions when discord reaction notifications are off", async () => {
    const adapter = new DiscordAdapter();
    const channelId = makeChannelId("discord-reaction-off");
    const chatId = makeChannelId("discord-chat-off");
    const injected: string[] = [];

    tables.channels.create({
      id: channelId,
      type: "discord",
      name: "Discord Reaction Off",
      enabled: true,
      config: {
        bot_token: "test-token",
        reaction_notifications: "off",
      },
    });
    createdChannels.push(channelId);

    configureChannelChatRuntime({
      sendToSession: (sessionId) => {
        injected.push(sessionId);
        return true;
      },
    });

    discordSessions.set(`${channelId}:${chatId}`, "session-discord-off");

    await handleDiscordReaction(
      adapter,
      channelId,
      {
        partial: false,
        message: {
          partial: false,
          id: makeChannelId("discord-msg-off"),
          channel: { id: chatId },
          guild: null,
        },
        emoji: { name: "❌", id: null },
      },
      {
        bot: false,
        id: "user-off",
        username: "alex",
      },
      "added"
    );

    expect(injected).toHaveLength(0);
  });
});
