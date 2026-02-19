import { afterEach, describe, expect, test } from "bun:test";
import { SlackAdapter, slackSessions } from "../../src/core/channels/adapters/slack";
import { configureChannelChatRuntime, resetChannelChatRuntime } from "../../src/core/channels/chat-runtime";
import { securityManager } from "../../src/core/channels/security";
import { config } from "../../src/core/config";
import { tables } from "../../src/core/database";

type SlackEvent = {
  type: string;
  subtype?: string;
  text?: string;
  user: string;
  channel: string;
  ts: string;
  thread_ts?: string;
  bot_id?: string;
};

function makeChannelId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

const createdAgents: string[] = [];
const createdProviders: string[] = [];
const createdChannels: string[] = [];

function createProvider(name: string): string {
  const providerId = makeChannelId("slack-provider");
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
  const agentId = makeChannelId("slack-agent");
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
    id: makeChannelId("slack-provider-model"),
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
  for (const channelId of createdChannels.splice(0)) {
    tables.channels.delete(channelId);
  }
  resetChannelChatRuntime();
});

async function invokeSlackMessage(
  adapter: SlackAdapter,
  channelId: string,
  event: SlackEvent,
  say: (text: string) => Promise<unknown>
): Promise<void> {
  await (
    adapter as unknown as {
      handleMessage: (
        id: string,
        message: SlackEvent,
        sayFn: (text: string) => Promise<unknown>,
        client: unknown
      ) => Promise<void>;
    }
  ).handleMessage(channelId, event, say, {});
}

async function invokeSlackMention(
  adapter: SlackAdapter,
  channelId: string,
  event: SlackEvent,
  say: (text: string) => Promise<unknown>
): Promise<void> {
  await (
    adapter as unknown as {
      handleMention: (
        id: string,
        event: SlackEvent,
        sayFn: (text: string) => Promise<unknown>,
        client: unknown
      ) => Promise<void>;
    }
  ).handleMention(channelId, event, say, {});
}

async function invokeSlackReaction(
  adapter: SlackAdapter,
  channelId: string,
  event: unknown,
  action: "added" | "removed"
): Promise<void> {
  await (
    adapter as unknown as {
      handleReactionEvent: (
        id: string,
        event: unknown,
        reactionAction: "added" | "removed"
      ) => Promise<void>;
    }
  ).handleReactionEvent(channelId, event, action);
}

describe("Slack adapter mocked flows", () => {
  test("ignores bot messages", async () => {
    const adapter = new SlackAdapter();
    const channelId = makeChannelId("slack-ignore");
    let sayCalls = 0;
    let handlerCalls = 0;

    adapter.setMessageHandler(async () => {
      handlerCalls += 1;
      return "should-not-run";
    });
    securityManager.setConfig(channelId, { dm_policy: "open" });

    await invokeSlackMessage(
      adapter,
      channelId,
      {
        type: "message",
        subtype: "bot_message",
        text: "ignored",
        user: "U-BOT",
        channel: "C1",
        ts: "1.001",
      },
      async () => {
        sayCalls += 1;
      }
    );

    expect(handlerCalls).toBe(0);
    expect(sayCalls).toBe(0);
  });

  test("creates pairing for new sender and sends security message", async () => {
    const adapter = new SlackAdapter();
    const channelId = makeChannelId("slack-pairing");
    const sayMessages: string[] = [];
    let handlerCalls = 0;

    slackSessions.clear();
    adapter.setMessageHandler(async () => {
      handlerCalls += 1;
      return "should-not-run";
    });
    securityManager.setConfig(channelId, { dm_policy: "pairing", allowed_senders: [] });

    await invokeSlackMessage(
      adapter,
      channelId,
      {
        type: "message",
        text: "hello",
        user: "U-NEW",
        channel: "C1",
        ts: "1.100",
      },
      async (text: string) => {
        sayMessages.push(text);
      }
    );

    expect(handlerCalls).toBe(0);
    expect(sayMessages.length).toBe(1);
    expect(sayMessages[0]).toContain("Pairing code");
    expect(securityManager.getPendingPairings(channelId).length).toBe(1);
  });

  test("routes allowed sender messages and reuses session id per channel", async () => {
    const adapter = new SlackAdapter();
    const channelId = makeChannelId("slack-session");
    const sayMessages: string[] = [];
    const handlerInputs: Array<{ message: string; chatId: string; sessionId: string }> = [];

    slackSessions.clear();
    securityManager.setConfig(channelId, { dm_policy: "pairing" });
    securityManager.addAllowedSender(channelId, "U-ALLOWED");

    adapter.setMessageHandler(async (message, chatId, sessionId) => {
      handlerInputs.push({ message, chatId, sessionId });
      return `echo:${message}`;
    });

    await invokeSlackMessage(
      adapter,
      channelId,
      {
        type: "message",
        text: "first",
        user: "U-ALLOWED",
        channel: "C2",
        ts: "2.001",
      },
      async (text: string) => {
        sayMessages.push(text);
      }
    );
    await invokeSlackMessage(
      adapter,
      channelId,
      {
        type: "message",
        text: "second",
        user: "U-ALLOWED",
        channel: "C2",
        ts: "2.002",
      },
      async (text: string) => {
        sayMessages.push(text);
      }
    );

    expect(handlerInputs).toHaveLength(2);
    expect(handlerInputs[0].message).toBe("first");
    expect(handlerInputs[1].message).toBe("second");
    expect(handlerInputs[0].chatId).toBe("C2");
    expect(handlerInputs[1].chatId).toBe("C2");
    expect(handlerInputs[0].sessionId).toBe(handlerInputs[1].sessionId);
    expect(sayMessages).toContain("echo:first");
    expect(sayMessages).toContain("echo:second");
  });

  test("mention with empty text returns greeting", async () => {
    const adapter = new SlackAdapter();
    const channelId = makeChannelId("slack-mention-empty");
    const sayMessages: string[] = [];
    let handlerCalls = 0;

    securityManager.setConfig(channelId, { dm_policy: "open" });
    adapter.setMessageHandler(async () => {
      handlerCalls += 1;
      return "should-not-run";
    });

    await invokeSlackMention(
      adapter,
      channelId,
      {
        type: "app_mention",
        text: "<@U123ABC>",
        user: "U-ALLOWED",
        channel: "C3",
        ts: "3.001",
      },
      async (text: string) => {
        sayMessages.push(text);
      }
    );

    expect(handlerCalls).toBe(0);
    expect(sayMessages).toEqual(["👋 Hi! How can I help you today?"]);
  });

  test("mention strips bot token and forwards cleaned text to handler", async () => {
    const adapter = new SlackAdapter();
    const channelId = makeChannelId("slack-mention");
    const sayMessages: string[] = [];
    const handlerInputs: string[] = [];

    securityManager.setConfig(channelId, { dm_policy: "open" });
    adapter.setMessageHandler(async (message) => {
      handlerInputs.push(message);
      return "handled";
    });

    await invokeSlackMention(
      adapter,
      channelId,
      {
        type: "app_mention",
        text: "<@U123ABC> deploy status",
        user: "U-ALLOWED",
        channel: "C4",
        ts: "4.001",
      },
      async (text: string) => {
        sayMessages.push(text);
      }
    );

    expect(handlerInputs).toEqual(["deploy status"]);
    expect(sayMessages).toEqual(["handled"]);
  });

  test("mention enforces pairing security before greeting or handler", async () => {
    const adapter = new SlackAdapter();
    const channelId = makeChannelId("slack-mention-pairing");
    const sayMessages: string[] = [];
    let handlerCalls = 0;

    slackSessions.clear();
    securityManager.setConfig(channelId, { dm_policy: "pairing", allowed_senders: [] });
    adapter.setMessageHandler(async () => {
      handlerCalls += 1;
      return "should-not-run";
    });

    await invokeSlackMention(
      adapter,
      channelId,
      {
        type: "app_mention",
        text: "<@U123ABC>",
        user: "U-NEW",
        channel: "C6",
        ts: "6.001",
      },
      async (text: string) => {
        sayMessages.push(text);
      }
    );

    expect(handlerCalls).toBe(0);
    expect(sayMessages).toHaveLength(1);
    expect(sayMessages[0]).toContain("Pairing code");
    expect(securityManager.getPendingPairings(channelId).length).toBe(1);
  });

  test("handles slash management commands without invoking chat handler", async () => {
    const adapter = new SlackAdapter();
    const channelId = makeChannelId("slack-command");
    const sayMessages: string[] = [];
    let handlerCalls = 0;

    securityManager.setConfig(channelId, { dm_policy: "open" });
    adapter.setMessageHandler(async () => {
      handlerCalls += 1;
      return "should-not-run";
    });

    await invokeSlackMessage(
      adapter,
      channelId,
      {
        type: "message",
        text: "/help",
        user: "U-COMMAND",
        channel: "C5",
        ts: "5.001",
      },
      async (text: string) => {
        sayMessages.push(text);
      }
    );

    expect(handlerCalls).toBe(0);
    expect(sayMessages).toHaveLength(1);
    expect(sayMessages[0]).toContain("Available management commands");
  });

  test("routes /model command through adapter and updates default agent model", async () => {
    const adapter = new SlackAdapter();
    const channelId = makeChannelId("slack-model-command");
    const sayMessages: string[] = [];
    let handlerCalls = 0;

    const providerId = createProvider("Slack Model Provider");
    addProviderModel(providerId, "model-one");
    addProviderModel(providerId, "model-two");
    const agentId = createAgent("Slack Model Agent", providerId, "model-one");
    config.set("default_agent_id", agentId);

    securityManager.setConfig(channelId, { dm_policy: "open" });
    adapter.setMessageHandler(async () => {
      handlerCalls += 1;
      return "should-not-run";
    });

    await invokeSlackMessage(
      adapter,
      channelId,
      {
        type: "message",
        text: "/model 2",
        user: "U-COMMAND",
        channel: "C7",
        ts: "7.001",
      },
      async (text: string) => {
        sayMessages.push(text);
      }
    );

    const updatedAgent = tables.agents.get(agentId) as { model?: string } | undefined;
    expect(handlerCalls).toBe(0);
    expect(updatedAgent?.model).toBe("model-two");
    expect(sayMessages).toHaveLength(1);
    expect(sayMessages[0]).toContain("model-two");
  });

  test("logs reaction events and injects system reaction updates into active session", async () => {
    const adapter = new SlackAdapter();
    const channelId = makeChannelId("slack-reaction");
    const injected: Array<{ sessionId: string; content: string }> = [];

    tables.channels.create({
      id: channelId,
      type: "slack",
      name: "Slack Reaction Test",
      enabled: true,
      config: {
        bot_token: "xoxb-test",
        app_token: "xapp-test",
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

    slackSessions.set(`${channelId}:C-REACTION`, "session-slack-reaction");

    await invokeSlackReaction(
      adapter,
      channelId,
      {
        user: "U-REACTOR",
        reaction: "eyes",
        item: {
          type: "message",
          channel: "C-REACTION",
          ts: "1710000000.100",
        },
        item_user: "U-TARGET",
        event_ts: "1710000001.100",
      },
      "added"
    );

    const logs = tables.channelLogs.getByChannel("slack", "C-REACTION") as Array<{
      content: string;
      metadata?: string;
    }>;
    const reactionLog = logs.find((entry) =>
      entry.content.includes("Slack reaction added by U-REACTOR")
    );
    expect(reactionLog).toBeDefined();
    const metadata = reactionLog?.metadata ? JSON.parse(reactionLog.metadata) : {};
    expect(metadata.event).toBe("reaction");
    expect(metadata.action).toBe("added");
    expect(metadata.reaction).toBe("eyes");
    expect(metadata.messageTs).toBe("1710000000.100");

    expect(injected).toHaveLength(1);
    expect(injected[0].sessionId).toBe("session-slack-reaction");
    expect(injected[0].content).toContain(":eyes:");
  });

  test("does not inject reaction events when slack reaction notifications are off", async () => {
    const adapter = new SlackAdapter();
    const channelId = makeChannelId("slack-reaction-off");
    const injected: string[] = [];

    tables.channels.create({
      id: channelId,
      type: "slack",
      name: "Slack Reaction Off",
      enabled: true,
      config: {
        bot_token: "xoxb-test",
        app_token: "xapp-test",
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

    slackSessions.set(`${channelId}:D-REACTION`, "session-slack-dm");

    await invokeSlackReaction(
      adapter,
      channelId,
      {
        user: "U-REACTOR",
        reaction: "thumbsup",
        item: {
          type: "message",
          channel: "D-REACTION",
          ts: "1710000020.200",
        },
      },
      "added"
    );

    expect(injected).toHaveLength(0);
  });

  test("injects DM reactions only when scope is dm", async () => {
    const adapter = new SlackAdapter();
    const channelId = makeChannelId("slack-reaction-dm-scope");
    const injected: string[] = [];

    tables.channels.create({
      id: channelId,
      type: "slack",
      name: "Slack DM Reaction Scope",
      enabled: true,
      config: {
        bot_token: "xoxb-test",
        app_token: "xapp-test",
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

    slackSessions.set(`${channelId}:D-REACTION-SCOPE`, "session-slack-dm-scope");

    await invokeSlackReaction(
      adapter,
      channelId,
      {
        user: "U-REACTOR",
        reaction: "eyes",
        item: {
          type: "message",
          channel: "D-REACTION-SCOPE",
          ts: "1710000100.100",
        },
      },
      "added"
    );

    expect(injected).toEqual(["session-slack-dm-scope"]);
  });

  test("does not inject channel reactions when scope is dm", async () => {
    const adapter = new SlackAdapter();
    const channelId = makeChannelId("slack-reaction-dm-scope-block");
    const injected: string[] = [];

    tables.channels.create({
      id: channelId,
      type: "slack",
      name: "Slack DM Scope Block",
      enabled: true,
      config: {
        bot_token: "xoxb-test",
        app_token: "xapp-test",
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

    slackSessions.set(`${channelId}:C-REACTION-DM-BLOCK`, "session-slack-dm-block");

    await invokeSlackReaction(
      adapter,
      channelId,
      {
        user: "U-REACTOR",
        reaction: "eyes",
        item: {
          type: "message",
          channel: "C-REACTION-DM-BLOCK",
          ts: "1710000150.150",
        },
      },
      "added"
    );

    expect(injected).toHaveLength(0);
  });

  test("injects channel reactions only when scope is channel", async () => {
    const adapter = new SlackAdapter();
    const channelId = makeChannelId("slack-reaction-channel-scope");
    const injected: string[] = [];

    tables.channels.create({
      id: channelId,
      type: "slack",
      name: "Slack Channel Reaction Scope",
      enabled: true,
      config: {
        bot_token: "xoxb-test",
        app_token: "xapp-test",
        reaction_notifications: "channel",
      },
    });
    createdChannels.push(channelId);

    configureChannelChatRuntime({
      sendToSession: (sessionId) => {
        injected.push(sessionId);
        return true;
      },
    });

    slackSessions.set(`${channelId}:C-REACTION-SCOPE`, "session-slack-channel-scope");

    await invokeSlackReaction(
      adapter,
      channelId,
      {
        user: "U-REACTOR",
        reaction: "eyes",
        item: {
          type: "message",
          channel: "C-REACTION-SCOPE",
          ts: "1710000200.200",
        },
      },
      "added"
    );

    expect(injected).toEqual(["session-slack-channel-scope"]);
  });
});
