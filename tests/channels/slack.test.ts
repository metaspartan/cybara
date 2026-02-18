import { afterEach, describe, expect, test } from "bun:test";
import { SlackAdapter, slackSessions } from "../../src/core/channels/adapters/slack";
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
});
