import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "fs";
import path from "path";
import { GatewayIntentBits } from "discord.js";
import {
  DiscordAdapter,
  DISCORD_REQUIRED_INTENTS,
  buildDiscordSlashCommands,
  discordSessions,
  resolveDiscordTargetId,
} from "../../src/core/channels/adapters/discord";
import {
  clearChannelSubagentSpawnHandler,
  setChannelSubagentSpawnHandler,
} from "../../src/core/channels/commands";
import { configuredChannelAgentId } from "../../src/core/channels/agent-selection";
import {
  configureChannelChatRuntime,
  resetChannelChatRuntime,
} from "../../src/core/channels/chat-runtime";
import { securityManager } from "../../src/core/channels/security";
import { config } from "../../src/core/config";
import { tables } from "../../src/core/database";
import { cybaraDir } from "../../src/core/paths";

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
  test("resolves friendly channel names and rejects ambiguous names", () => {
    const targets = [
      { id: "111111", name: "cybara", label: "Alpha/#cybara", group: "Alpha" },
      { id: "222222", name: "cybara", label: "Beta/#cybara", group: "Beta" },
      { id: "333333", name: "general", label: "Alpha/#general", group: "Alpha" },
    ];

    expect(resolveDiscordTargetId(targets, "#general")).toBe("333333");
    expect(resolveDiscordTargetId(targets, "Beta/#cybara")).toBe("222222");
    expect(() => resolveDiscordTargetId(targets, "#cybara")).toThrow("Multiple Discord channels");
    expect(() => resolveDiscordTargetId(targets, "#missing")).toThrow("action=list");
  });

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

  test("defines native slash commands including session management", () => {
    const commands = buildDiscordSlashCommands();
    const names = commands.map((command) => command.name);

    expect(names).toContain("new");
    expect(names).toContain("sessions");
    expect(names).toContain("switch");
    expect(names).toContain("permissions");
    expect(names).toContain("subagents");

    const subagents = commands.find((command) => command.name === "subagents");
    const subagentOptions = Array.isArray(subagents?.options) ? subagents.options : [];
    const taskOption = subagentOptions.find((option) => option.name === "task");
    expect(taskOption).toBeDefined();
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
  client: { user: { id: string }; token?: string };
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

async function sendLongDiscordMessage(
  adapter: DiscordAdapter,
  response: string,
  replies: unknown[],
  followUps: unknown[]
): Promise<void> {
  const message = {
    reply: async (messageResponse: unknown) => {
      replies.push(messageResponse);
    },
    channel: {
      send: async (messageResponse: unknown) => {
        followUps.push(messageResponse);
      },
    },
  };
  await (
    adapter as unknown as {
      sendLongMessage: (msg: typeof message, text: string) => Promise<void>;
    }
  ).sendLongMessage(message, response);
}

describe("Discord adapter mocked message flows", () => {
  test("lists connected text destinations without exposing credentials", async () => {
    const adapter = new DiscordAdapter();
    const channelId = makeChannelId("discord-target-list");
    const fakeClient = {
      isReady: () => true,
      channels: {
        cache: new Map([
          [
            "111111",
            {
              id: "111111",
              name: "cybara",
              isTextBased: () => true,
              guild: { name: "Cybara" },
            },
          ],
          [
            "222222",
            {
              id: "222222",
              name: "voice",
              isTextBased: () => false,
              guild: { name: "Cybara" },
            },
          ],
        ]),
      },
      guilds: { cache: new Map() },
    };

    (
      adapter as unknown as {
        clients: Map<string, unknown>;
      }
    ).clients.set(channelId, fakeClient);

    expect(await adapter.listTargets(channelId)).toEqual([
      { id: "111111", name: "cybara", label: "Cybara/#cybara", group: "Cybara" },
    ]);
    expect(await adapter.resolveTarget(channelId, "#cybara")).toBe("111111");
  });

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

  test("caches inbound attachments and forwards local file metadata", async () => {
    const adapter = new DiscordAdapter();
    const channelId = makeChannelId("discord-attachment");
    const replies: string[] = [];
    const followUps: string[] = [];
    let captured:
      | {
          content: string;
          hasFile: boolean;
          filePath: string;
          fileType: string;
          placeholder: string;
        }
      | undefined;
    const originalFetch = globalThis.fetch;

    try {
      globalThis.fetch = (async () => {
        return new Response(new Uint8Array([1, 2, 3]), {
          status: 200,
          headers: { "content-type": "image/png" },
        });
      }) as typeof fetch;

      securityManager.setConfig(channelId, { dm_policy: "open" });
      adapter.setMessageHandler(async (content, _chatId, _sessionId, fileInfo) => {
        captured = {
          content,
          hasFile: fileInfo.hasFile,
          filePath: fileInfo.filePath,
          fileType: fileInfo.fileType,
          placeholder: fileInfo.placeholder,
        };
        return "attachment-ok";
      });

      const message = createFakeDiscordMessage(
        {
          guild: null,
          content: "",
          attachments: {
            size: 1,
            first: () => ({
              url: "https://cdn.example.com/image.png",
              contentType: "image/png",
              name: "image.png",
            }),
          },
          client: { user: { id: "bot-1" }, token: "discord-test-token" },
        },
        replies,
        followUps
      );

      await handleDiscordMessage(adapter, channelId, message);

      expect(captured).toBeDefined();
      expect(captured?.hasFile).toBe(true);
      expect(captured?.fileType).toBe("image/png");
      expect(captured?.placeholder).toBe("<attachment:image.png>");
      expect(captured?.content).toContain("<attachment:image.png>");
      expect(
        captured?.filePath.startsWith(path.join(cybaraDir, "media", "inbound", "discord"))
      ).toBe(true);
      expect(existsSync(captured?.filePath || "")).toBe(true);
      expect(replies).toContain("attachment-ok");
    } finally {
      globalThis.fetch = originalFetch;
      if (captured?.filePath && existsSync(captured.filePath)) {
        rmSync(captured.filePath, { force: true });
      }
    }
  });

  test("attaches trusted generated image file references to outbound replies", async () => {
    const adapter = new DiscordAdapter();
    const replies: unknown[] = [];
    const followUps: unknown[] = [];
    const mediaDir = path.join(cybaraDir, "media", "discord-outbound-test");
    const imagePath = path.join(mediaDir, "render.png");

    try {
      mkdirSync(mediaDir, { recursive: true });
      writeFileSync(imagePath, Buffer.from([0x89, 0x50, 0x4e, 0x47]));

      await sendLongDiscordMessage(
        adapter,
        `Here is the render.\n\n![render](file://${imagePath})`,
        replies,
        followUps
      );

      expect(replies).toHaveLength(1);
      expect(followUps).toHaveLength(0);
      const reply = replies[0] as { content?: string; files?: unknown[] };
      expect(reply.content).toBe("Here is the render.");
      expect(Array.isArray(reply.files)).toBe(true);
      expect(reply.files).toHaveLength(1);
    } finally {
      rmSync(mediaDir, { recursive: true, force: true });
    }
  });

  test("does not attach arbitrary local file references to outbound replies", async () => {
    const adapter = new DiscordAdapter();
    const replies: unknown[] = [];
    const followUps: unknown[] = [];
    const imagePath = path.join(process.cwd(), "discord-untrusted.png");

    try {
      writeFileSync(imagePath, Buffer.from([0x89, 0x50, 0x4e, 0x47]));

      await sendLongDiscordMessage(
        adapter,
        `Here is an image.\n\n![render](file://${imagePath})`,
        replies,
        followUps
      );

      expect(replies).toHaveLength(1);
      const reply = replies[0] as string;
      expect(reply).toBe("Here is an image.");
      expect(followUps).toHaveLength(0);
    } finally {
      rmSync(imagePath, { force: true });
    }
  });

  test("ignores malformed outbound file URI references without failing the reply", async () => {
    const adapter = new DiscordAdapter();
    const replies: unknown[] = [];
    const followUps: unknown[] = [];

    await sendLongDiscordMessage(
      adapter,
      "Here is an image.\n\n![render](file:///Users/carsen/%E0%A4%A.png)",
      replies,
      followUps
    );

    expect(replies).toHaveLength(1);
    const reply = replies[0] as string;
    expect(reply).toBe("Here is an image.");
    expect(followUps).toHaveLength(0);
  });

  test("keeps typing indicator alive while long handler work is running", async () => {
    const adapter = new DiscordAdapter();
    const channelId = makeChannelId("discord-typing-loop");
    const replies: string[] = [];
    const followUps: string[] = [];
    let typingCalls = 0;

    (
      adapter as unknown as {
        typingRefreshMs: number;
      }
    ).typingRefreshMs = 10;

    securityManager.setConfig(channelId, { dm_policy: "open" });
    adapter.setMessageHandler(async () => {
      await new Promise((resolve) => setTimeout(resolve, 35));
      return "done";
    });

    const message = createFakeDiscordMessage(
      {
        guild: null,
        channel: {
          id: "chat-typing",
          sendTyping: async () => {
            typingCalls += 1;
          },
          send: async (chunk: string) => {
            followUps.push(chunk);
          },
        },
      },
      replies,
      followUps
    );

    await handleDiscordMessage(adapter, channelId, message);

    expect(typingCalls).toBeGreaterThanOrEqual(2);
    expect(replies).toContain("done");
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
    tables.channels.create({
      id: channelId,
      type: "discord",
      name: "Discord Agent Command",
      config: {},
      enabled: true,
    });
    createdChannels.push(channelId);

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
    expect(configuredChannelAgentId(channelId)).toBe(secondAgentId);
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

  test("sendReaction normalizes custom emoji syntax and reacts to message", async () => {
    const adapter = new DiscordAdapter();
    const channelId = makeChannelId("discord-send-reaction");
    const reacted: string[] = [];

    const fakeMessage = {
      react: async (emoji: string) => {
        reacted.push(emoji);
      },
    };
    const fakeChannel = {
      isTextBased: () => true,
      messages: {
        fetch: async (_messageId: string) => fakeMessage,
      },
    };
    const fakeClient = {
      isReady: () => true,
      channels: {
        fetch: async (_chatId: string) => fakeChannel,
      },
      user: {
        id: "discord-bot-user",
      },
    };

    (
      adapter as unknown as {
        clients: Map<string, unknown>;
      }
    ).clients.set(channelId, fakeClient);

    const success = await adapter.sendReaction(
      channelId,
      "chat-reaction",
      "message-1",
      "<:fire:123>"
    );

    expect(success).toBe(true);
    expect(reacted).toEqual(["fire:123"]);
  });

  test("removeReaction defaults to bot user when no explicit userId is provided", async () => {
    const adapter = new DiscordAdapter();
    const channelId = makeChannelId("discord-remove-reaction");
    const removedUsers: string[] = [];

    const fakeReaction = {
      users: {
        remove: async (userId: string) => {
          removedUsers.push(userId);
        },
      },
    };
    const fakeMessage = {
      reactions: {
        resolve: (_emoji: string) => fakeReaction,
        cache: {
          find: (_predicate: (entry: unknown) => boolean) => undefined,
        },
      },
    };
    const fakeChannel = {
      isTextBased: () => true,
      messages: {
        fetch: async (_messageId: string) => fakeMessage,
      },
    };
    const fakeClient = {
      isReady: () => true,
      channels: {
        fetch: async (_chatId: string) => fakeChannel,
      },
      user: {
        id: "discord-bot-user",
      },
    };

    (
      adapter as unknown as {
        clients: Map<string, unknown>;
      }
    ).clients.set(channelId, fakeClient);

    const success = await adapter.removeReaction(channelId, "chat-reaction", "message-2", "✅");

    expect(success).toBe(true);
    expect(removedUsers).toEqual(["discord-bot-user"]);
  });
});
