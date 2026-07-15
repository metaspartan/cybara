import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, rmSync } from "fs";
import path from "path";
import {
  SlackAdapter,
  resolveSlackTargetId,
  slackSessions,
} from "../../src/core/channels/adapters/slack";
import {
  clearChannelSubagentSpawnHandler,
  setChannelSubagentSpawnHandler,
} from "../../src/core/channels/commands";
import {
  configureChannelChatRuntime,
  resetChannelChatRuntime,
} from "../../src/core/channels/chat-runtime";
import { securityManager } from "../../src/core/channels/security";
import { configuredChannelAgentId } from "../../src/core/channels/agent-selection";
import { config } from "../../src/core/config";
import { tables } from "../../src/core/database";
import { cybaraDir } from "../../src/core/paths";

type SlackEvent = {
  type: string;
  subtype?: string;
  text?: string;
  user: string;
  channel: string;
  ts: string;
  thread_ts?: string;
  bot_id?: string;
  files?: Array<{
    name?: string;
    mimetype?: string;
    url_private?: string;
    url_private_download?: string;
  }>;
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
  clearChannelSubagentSpawnHandler();
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
  test("lists and resolves connected Slack channels across pages", async () => {
    const adapter = new SlackAdapter();
    const channelId = makeChannelId("slack-targets");
    const cursors: Array<string | undefined> = [];
    const fakeApp = {
      client: {
        conversations: {
          list: async ({ cursor }: { cursor?: string }) => {
            cursors.push(cursor);
            return cursor
              ? {
                  channels: [{ id: "C2", name: "general" }],
                  response_metadata: { next_cursor: "" },
                }
              : {
                  channels: [
                    { id: "C1", name: "cybara" },
                    { id: undefined, name: "invalid" },
                  ],
                  response_metadata: { next_cursor: "next-page" },
                };
          },
        },
      },
    };

    (
      adapter as unknown as {
        apps: Map<string, unknown>;
      }
    ).apps.set(channelId, fakeApp);

    expect(await adapter.listTargets(channelId)).toEqual([
      { id: "C1", name: "cybara", label: "#cybara" },
      { id: "C2", name: "general", label: "#general" },
    ]);
    expect(cursors).toEqual([undefined, "next-page"]);
    expect(await adapter.resolveTarget(channelId, "#cybara")).toBe("C1");
    expect(
      resolveSlackTargetId([{ id: "C2", name: "general", label: "#general" }], "#general")
    ).toBe("C2");
    expect(() => resolveSlackTargetId([], "#missing")).toThrow("action=list");
  });

  test("ignores bot messages", async () => {
    const adapter = new SlackAdapter();
    const channelId = makeChannelId("slack-ignore");
    let sayCalls = 0;
    let handlerCalls = 0;

    adapter.setMessageHandler(async () => {
      handlerCalls += 1;
      return "should-not-run";
    });
    securityManager.setConfig(channelId, { dm_policy: "open", group_policy: "open" });

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
        // DM (Slack DM ids start with "D") so the dm_policy:"pairing" path runs.
        channel: "D1",
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

  test("caches inbound files and forwards file metadata to handler", async () => {
    const adapter = new SlackAdapter();
    const channelId = makeChannelId("slack-file");
    const sayMessages: string[] = [];
    let captured:
      | {
          message: string;
          hasFile: boolean;
          filePath: string;
          fileType: string;
          placeholder: string;
        }
      | undefined;
    const originalFetch = globalThis.fetch;

    try {
      globalThis.fetch = (async () => {
        return new Response(new Uint8Array([0xde, 0xad, 0xbe, 0xef]), {
          status: 200,
          headers: { "content-type": "image/png" },
        });
      }) as typeof fetch;

      securityManager.setConfig(channelId, { dm_policy: "open", group_policy: "open" });
      adapter.setMessageHandler(async (message, _chatId, _sessionId, fileInfo) => {
        captured = {
          message,
          hasFile: fileInfo.hasFile,
          filePath: fileInfo.filePath,
          fileType: fileInfo.fileType,
          placeholder: fileInfo.placeholder,
        };
        return "file-ok";
      });

      await invokeSlackMessage(
        adapter,
        channelId,
        {
          type: "message",
          text: "",
          user: "U-ALLOWED",
          channel: "C-FILE",
          ts: "9.001",
          files: [
            {
              name: "diagram.png",
              mimetype: "image/png",
              url_private_download: "https://slack-files.example.com/diagram.png",
            },
          ],
        },
        async (text: string) => {
          sayMessages.push(text);
        }
      );

      expect(captured).toBeDefined();
      expect(captured?.hasFile).toBe(true);
      expect(captured?.fileType).toBe("image/png");
      expect(captured?.placeholder).toBe("<attachment:diagram.png>");
      expect(captured?.message).toContain("<attachment:diagram.png>");
      expect(captured?.filePath.startsWith(path.join(cybaraDir, "media", "inbound", "slack"))).toBe(
        true
      );
      expect(existsSync(captured?.filePath || "")).toBe(true);
      expect(sayMessages).toEqual(["file-ok"]);
    } finally {
      globalThis.fetch = originalFetch;
      if (captured?.filePath && existsSync(captured.filePath)) {
        rmSync(captured.filePath, { force: true });
      }
    }
  });

  test("mention with empty text returns greeting", async () => {
    const adapter = new SlackAdapter();
    const channelId = makeChannelId("slack-mention-empty");
    const sayMessages: string[] = [];
    let handlerCalls = 0;

    securityManager.setConfig(channelId, { dm_policy: "open", group_policy: "open" });
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

    securityManager.setConfig(channelId, { dm_policy: "open", group_policy: "open" });
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
    // App mentions occur in channels (groups). Under the owner-only group
    // default, an unknown (non-owner) sender must be blocked before any greeting
    // or handler invocation — the security-enforcement invariant this test guards.
    securityManager.setConfig(channelId, { group_policy: "owner_only" });
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

    // Unknown sender is blocked: chat handler never runs.
    expect(handlerCalls).toBe(0);
  });

  test("handles slash management commands without invoking chat handler", async () => {
    const adapter = new SlackAdapter();
    const channelId = makeChannelId("slack-command");
    const sayMessages: string[] = [];
    let handlerCalls = 0;

    securityManager.setConfig(channelId, { dm_policy: "open", group_policy: "open" });
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

  test("routes /status command through adapter without invoking chat handler", async () => {
    const adapter = new SlackAdapter();
    const channelId = makeChannelId("slack-status-command");
    const sayMessages: string[] = [];
    let handlerCalls = 0;

    securityManager.setConfig(channelId, { dm_policy: "open", group_policy: "open" });
    adapter.setMessageHandler(async () => {
      handlerCalls += 1;
      return "should-not-run";
    });

    await invokeSlackMessage(
      adapter,
      channelId,
      {
        type: "message",
        text: "/status",
        user: "U-COMMAND",
        channel: "C6",
        ts: "6.001",
      },
      async (text: string) => {
        sayMessages.push(text);
      }
    );

    expect(handlerCalls).toBe(0);
    expect(sayMessages).toHaveLength(1);
    expect(sayMessages[0]).toContain("Status:");
    expect(sayMessages[0]).toContain("Agents:");
  });

  test("routes /agents command through adapter without invoking chat handler", async () => {
    const adapter = new SlackAdapter();
    const channelId = makeChannelId("slack-agents-command");
    const sayMessages: string[] = [];
    let handlerCalls = 0;

    const providerId = createProvider("Slack Agents Provider");
    createAgent("Slack Agents Target", providerId, "model-one");

    securityManager.setConfig(channelId, { dm_policy: "open", group_policy: "open" });
    adapter.setMessageHandler(async () => {
      handlerCalls += 1;
      return "should-not-run";
    });

    await invokeSlackMessage(
      adapter,
      channelId,
      {
        type: "message",
        text: "/agents",
        user: "U-COMMAND",
        channel: "C6A",
        ts: "6.051",
      },
      async (text: string) => {
        sayMessages.push(text);
      }
    );

    expect(handlerCalls).toBe(0);
    expect(sayMessages).toHaveLength(1);
    expect(sayMessages[0]).toContain("Agents:");
    expect(sayMessages[0]).toContain("Slack Agents Target");
  });

  test("routes /providers command through adapter without invoking chat handler", async () => {
    const adapter = new SlackAdapter();
    const channelId = makeChannelId("slack-providers-command");
    const sayMessages: string[] = [];
    let handlerCalls = 0;

    const providerId = createProvider("Slack Providers Target");
    const agentId = createAgent("Slack Providers Agent", providerId, "model-one");
    config.set("default_agent_id", agentId);

    securityManager.setConfig(channelId, { dm_policy: "open", group_policy: "open" });
    adapter.setMessageHandler(async () => {
      handlerCalls += 1;
      return "should-not-run";
    });

    await invokeSlackMessage(
      adapter,
      channelId,
      {
        type: "message",
        text: "/providers",
        user: "U-COMMAND",
        channel: "C6B",
        ts: "6.061",
      },
      async (text: string) => {
        sayMessages.push(text);
      }
    );

    expect(handlerCalls).toBe(0);
    expect(sayMessages).toHaveLength(1);
    expect(sayMessages[0]).toContain("Providers");
    expect(sayMessages[0]).toContain("Slack Providers Target");
  });

  test("routes /new command through adapter and rotates session id", async () => {
    const adapter = new SlackAdapter();
    const channelId = makeChannelId("slack-new-command");
    const chatId = "C-NEW";
    const sessionKey = `${channelId}:${chatId}`;
    const initialSessionId = "session-slack-initial";
    const sayMessages: string[] = [];
    let handlerCalls = 0;

    slackSessions.set(sessionKey, initialSessionId);
    securityManager.setConfig(channelId, { dm_policy: "open", group_policy: "open" });
    adapter.setMessageHandler(async () => {
      handlerCalls += 1;
      return "should-not-run";
    });

    await invokeSlackMessage(
      adapter,
      channelId,
      {
        type: "message",
        text: "/new",
        user: "U-COMMAND",
        channel: chatId,
        ts: "6.101",
      },
      async (text: string) => {
        sayMessages.push(text);
      }
    );

    const rotatedSessionId = slackSessions.get(sessionKey);
    expect(handlerCalls).toBe(0);
    expect(rotatedSessionId).toBeDefined();
    expect(rotatedSessionId).not.toBe(initialSessionId);
    expect(sayMessages).toHaveLength(1);
    expect(sayMessages[0]).toContain("Started a new session");
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

    securityManager.setConfig(channelId, { dm_policy: "open", group_policy: "open" });
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

  test("routes /agent command through adapter and updates default agent selection", async () => {
    const adapter = new SlackAdapter();
    const channelId = makeChannelId("slack-agent-command");
    const sayMessages: string[] = [];
    let handlerCalls = 0;

    const providerId = createProvider("Slack Agent Provider");
    const firstAgentId = createAgent("Slack Agent One", providerId, "model-one");
    const secondAgentId = createAgent("Slack Agent Two", providerId, "model-two");
    config.set("default_agent_id", firstAgentId);
    tables.channels.create({
      id: channelId,
      type: "slack",
      name: "Slack Agent Command",
      config: {},
      enabled: true,
    });
    createdChannels.push(channelId);

    securityManager.setConfig(channelId, { dm_policy: "open", group_policy: "open" });
    adapter.setMessageHandler(async () => {
      handlerCalls += 1;
      return "should-not-run";
    });

    await invokeSlackMessage(
      adapter,
      channelId,
      {
        type: "message",
        text: `/agent ${secondAgentId}`,
        user: "U-COMMAND",
        channel: "C8",
        ts: "8.001",
      },
      async (text: string) => {
        sayMessages.push(text);
      }
    );

    expect(handlerCalls).toBe(0);
    expect(configuredChannelAgentId(channelId)).toBe(secondAgentId);
    expect(sayMessages).toHaveLength(1);
    expect(sayMessages[0]).toContain("Slack Agent Two");
  });

  test("routes /provider command through adapter and updates default agent provider/model", async () => {
    const adapter = new SlackAdapter();
    const channelId = makeChannelId("slack-provider-command");
    const sayMessages: string[] = [];
    let handlerCalls = 0;

    const providerA = createProvider("Slack Provider A");
    addProviderModel(providerA, "a-model");
    const providerB = createProvider("Slack Provider B");
    addProviderModel(providerB, "b-model");
    const agentId = createAgent("Slack Provider Agent", providerA, "a-model");
    config.set("default_agent_id", agentId);

    securityManager.setConfig(channelId, { dm_policy: "open", group_policy: "open" });
    adapter.setMessageHandler(async () => {
      handlerCalls += 1;
      return "should-not-run";
    });

    await invokeSlackMessage(
      adapter,
      channelId,
      {
        type: "message",
        text: `/provider ${providerB}`,
        user: "U-COMMAND",
        channel: "C9",
        ts: "9.001",
      },
      async (text: string) => {
        sayMessages.push(text);
      }
    );

    const updatedAgent = tables.agents.get(agentId) as
      | { provider_id?: string; model?: string }
      | undefined;
    expect(handlerCalls).toBe(0);
    expect(updatedAgent?.provider_id).toBe(providerB);
    expect(updatedAgent?.model).toBe("b-model");
    expect(sayMessages).toHaveLength(1);
    expect(sayMessages[0]).toContain("Slack Provider B");
  });

  test("routes /subagents spawn command through adapter without invoking chat handler", async () => {
    const adapter = new SlackAdapter();
    const channelId = makeChannelId("slack-subagents-command");
    const sayMessages: string[] = [];
    let handlerCalls = 0;
    const spawnArgs: Array<Record<string, unknown>> = [];

    setChannelSubagentSpawnHandler(async (args) => {
      spawnArgs.push(args);
      return {
        status: "accepted",
        childSessionKey: "agent:default:subagent:slack",
        runId: "run-slack-subagents",
        task: String(args.task || ""),
      };
    });

    securityManager.setConfig(channelId, { dm_policy: "open", group_policy: "open" });
    adapter.setMessageHandler(async () => {
      handlerCalls += 1;
      return "should-not-run";
    });

    await invokeSlackMessage(
      adapter,
      channelId,
      {
        type: "message",
        text: "/subagents spawn summarize backlog",
        user: "U-COMMAND",
        channel: "C-SUBAGENT",
        ts: "9.101",
      },
      async (text: string) => {
        sayMessages.push(text);
      }
    );

    expect(handlerCalls).toBe(0);
    expect(spawnArgs).toHaveLength(1);
    expect(spawnArgs[0]?.task).toBe("summarize backlog");
    expect(spawnArgs[0]?.label).toBe("channel:slack");
    const requesterSessionKey = slackSessions.get(`${channelId}:C-SUBAGENT`);
    expect(requesterSessionKey).toBeDefined();
    expect(spawnArgs[0]?._requesterSessionKey).toBe(requesterSessionKey);
    expect(sayMessages).toHaveLength(1);
    expect(sayMessages[0]).toContain("Subagent spawned successfully.");
    expect(sayMessages[0]).toContain("run-slack-subagents");
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

  test("sendReaction normalizes colon-wrapped emoji names", async () => {
    const adapter = new SlackAdapter();
    const channelId = makeChannelId("slack-send-reaction");
    const calls: Array<{ channel: string; timestamp: string; name: string }> = [];

    (
      adapter as unknown as {
        apps: Map<
          string,
          { client: { reactions: { add: (args: Record<string, string>) => Promise<void> } } }
        >;
      }
    ).apps.set(channelId, {
      client: {
        reactions: {
          add: async (args: Record<string, string>) => {
            calls.push({
              channel: args.channel,
              timestamp: args.timestamp,
              name: args.name,
            });
          },
        },
      },
    });

    const ok = await adapter.sendReaction(channelId, "C-REACTION", "1710000300.300", ":eyes:");

    expect(ok).toBe(true);
    expect(calls).toEqual([
      {
        channel: "C-REACTION",
        timestamp: "1710000300.300",
        name: "eyes",
      },
    ]);
  });

  test("removeReaction normalizes colon-wrapped emoji names", async () => {
    const adapter = new SlackAdapter();
    const channelId = makeChannelId("slack-remove-reaction");
    const calls: Array<{ channel: string; timestamp: string; name: string }> = [];

    (
      adapter as unknown as {
        apps: Map<
          string,
          { client: { reactions: { remove: (args: Record<string, string>) => Promise<void> } } }
        >;
      }
    ).apps.set(channelId, {
      client: {
        reactions: {
          remove: async (args: Record<string, string>) => {
            calls.push({
              channel: args.channel,
              timestamp: args.timestamp,
              name: args.name,
            });
          },
        },
      },
    });

    const ok = await adapter.removeReaction(channelId, "C-REACTION", "1710000301.301", ":eyes:");

    expect(ok).toBe(true);
    expect(calls).toEqual([
      {
        channel: "C-REACTION",
        timestamp: "1710000301.301",
        name: "eyes",
      },
    ]);
  });
});
