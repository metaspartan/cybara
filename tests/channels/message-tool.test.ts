import { afterEach, describe, expect, test } from "bun:test";
import {
  channels as channelDefinitions,
  channelManager,
  discordSessions,
  type ChannelAdapter,
  type ChannelType,
} from "../../src/core/channels";
import { config } from "../../src/core/config";
import { tables, type Channel } from "../../src/core/database";
import { executeTool } from "../../src/core/tools/handlers";
import { handleMessage } from "../../src/core/tools/handlers/channel";

const createdChannels: string[] = [];
const restorers: Array<() => void> = [];

function id(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function createChannel(type: Channel["type"], name: string): string {
  const channelId = id(type);
  tables.channels.create({
    id: channelId,
    type,
    name,
    config: {},
    enabled: true,
  });
  createdChannels.push(channelId);
  return channelId;
}

afterEach(() => {
  while (restorers.length > 0) {
    const restore = restorers.pop();
    restore?.();
  }

  while (createdChannels.length > 0) {
    const channelId = createdChannels.pop();
    if (channelId) {
      tables.channels.delete(channelId);
    }
  }
  discordSessions.clear();
  config.set("tool_approval_mode", "always_allow");
});

describe("message tool routing", () => {
  test("lists enabled connections and safe friendly destinations", async () => {
    const webChannelId = createChannel("web", "Web Discovery Test");
    const adapter = channelManager.getAdapter("web");
    expect(adapter).toBeDefined();
    if (!adapter) {
      throw new Error("web adapter not available");
    }

    const originalIsRunning = adapter.isRunning.bind(adapter);
    const originalListTargets = adapter.listTargets;
    adapter.isRunning = () => true;
    adapter.listTargets = async () => [
      { id: "chat-safe-1", name: "cybara", label: "#cybara", group: "Cybara" },
    ];
    restorers.push(() => {
      adapter.isRunning = originalIsRunning;
      adapter.listTargets = originalListTargets;
    });

    const result = await handleMessage({ action: "list", channelId: webChannelId });

    expect(result.success).toBe(true);
    expect(result.channels).toEqual([
      {
        id: webChannelId,
        name: "Web Discovery Test",
        type: "web",
        running: true,
        targets: [{ id: "chat-safe-1", name: "cybara", label: "#cybara", group: "Cybara" }],
      },
    ]);
  });

  test("filters discovery across every registered channel type", async () => {
    const channelId = createChannel("ntfy", "Ntfy Discovery Test");

    const result = await handleMessage({ action: "list", channel: "ntfy" });

    expect(result.channels?.map((channel) => channel.id)).toEqual([channelId]);
    expect(result.channels?.[0]?.type).toBe("ntfy");
  });

  test("rejects unknown channel types instead of silently listing everything", async () => {
    createChannel("web", "Web Invalid Filter Test");

    await expect(handleMessage({ action: "list", channel: "not-a-channel" })).rejects.toThrow(
      "Unknown channel type"
    );
  });

  test("lists destinations without requiring outbound-message approval", async () => {
    const webChannelId = createChannel("web", "Web Read Only Discovery Test");
    config.set("tool_approval_mode", "ask");

    const result = await executeTool("message", {
      action: "list",
      channelId: webChannelId,
    });

    expect(result.success).toBe(true);
    expect(result.channels).toHaveLength(1);
  });

  test("keeps outbound sends behind tool approval", async () => {
    const webChannelId = createChannel("web", "Web Approval Test");
    config.set("tool_approval_mode", "ask");

    await expect(
      executeTool("message", {
        action: "send",
        channelId: webChannelId,
        target: "chat-approval",
        message: "hello",
      })
    ).rejects.toThrow("requires approval");
  });

  test("resolves a friendly destination before sending", async () => {
    const webChannelId = createChannel("web", "Web Friendly Send Test");
    const adapter = channelManager.getAdapter("web");
    expect(adapter).toBeDefined();
    if (!adapter) {
      throw new Error("web adapter not available");
    }

    const originalSendMessage = adapter.sendMessage.bind(adapter);
    const originalResolveTarget = adapter.resolveTarget;
    let sentTarget: string | undefined;
    adapter.resolveTarget = async (_channelId, target) =>
      target === "#cybara" ? "chat-resolved-1" : target;
    adapter.sendMessage = async (_channelId, chatId) => {
      sentTarget = String(chatId);
      return true;
    };
    restorers.push(() => {
      adapter.resolveTarget = originalResolveTarget;
      adapter.sendMessage = originalSendMessage;
    });

    const result = await handleMessage({
      action: "send",
      channelId: webChannelId,
      target: "#cybara",
      message: "hi to buzz, luigi, and haz",
    });

    expect(result.success).toBe(true);
    expect(result.target).toBe("#cybara");
    expect(result.resolvedTarget).toBe("chat-resolved-1");
    expect(sentTarget).toBe("chat-resolved-1");
  });

  test("send routes via selected channel and supports aliases", async () => {
    const webChannelId = createChannel("web", "Web Send Test");
    const adapter = channelManager.getAdapter("web");
    expect(adapter).toBeDefined();
    if (!adapter) {
      throw new Error("web adapter not available");
    }

    const originalSendMessage = adapter.sendMessage.bind(adapter);
    let calledWith: { channelId: string; target: string; text: string } | undefined;
    adapter.sendMessage = async (channelId, chatId, text) => {
      calledWith = {
        channelId,
        target: String(chatId),
        text,
      };
      return true;
    };
    restorers.push(() => {
      adapter.sendMessage = originalSendMessage;
    });

    const result = await handleMessage({
      action: "send",
      channelId: webChannelId,
      to: "chat-web-1",
      text: "hello from message tool",
    });

    expect(result.success).toBe(true);
    expect(result.channel).toBe("web");
    expect(result.channelId).toBe(webChannelId);
    expect(calledWith).toEqual({
      channelId: webChannelId,
      target: "chat-web-1",
      text: "hello from message tool",
    });
  });

  test("send reaches every registered channel adapter", async () => {
    const channelTypes = Object.keys(channelDefinitions) as ChannelType[];
    const routedTypes: ChannelType[] = [];

    for (const type of channelTypes) {
      const channelId = createChannel(type, `${channelDefinitions[type].name} Routing Test`);
      const adapter = channelManager.getAdapter(type);
      expect(adapter).toBeDefined();
      if (!adapter) throw new Error(`${type} adapter not available`);

      const originalSendMessage = adapter.sendMessage.bind(adapter);
      adapter.sendMessage = async (selectedChannelId, target, text) => {
        expect(selectedChannelId).toBe(channelId);
        expect(String(target)).toBe("destination-1");
        expect(text).toBe("hello from Cybara");
        routedTypes.push(type);
        return true;
      };

      try {
        const result = await handleMessage({
          action: "send",
          channelId,
          target: "destination-1",
          message: "hello from Cybara",
        });
        expect(result.success).toBe(true);
        expect(result.channel).toBe(type);
      } finally {
        adapter.sendMessage = originalSendMessage;
      }
    }

    expect(routedTypes).toEqual(channelTypes);
  });

  test("react routes to discord adapter", async () => {
    const discordChannelId = createChannel("discord", "Discord React Test");
    const adapter = channelManager.getAdapter("discord") as
      | (ChannelAdapter & {
          sendReaction?: (
            channelId: string,
            chatId: string | number,
            messageId: string,
            emoji: string,
            options?: Record<string, unknown>
          ) => Promise<boolean>;
        })
      | null;
    expect(adapter).toBeDefined();
    if (!adapter) {
      throw new Error("discord adapter not available");
    }

    const originalSendReaction = adapter.sendReaction;
    let calledWith:
      | { channelId: string; target: string; messageId: string; emoji: string }
      | undefined;
    adapter.sendReaction = async (channelId, chatId, messageId, emoji) => {
      calledWith = {
        channelId,
        target: String(chatId),
        messageId,
        emoji,
      };
      return true;
    };
    restorers.push(() => {
      adapter.sendReaction = originalSendReaction;
    });

    const result = await handleMessage({
      action: "react",
      channelId: discordChannelId,
      target: "discord-chat-1",
      messageId: "discord-msg-1",
      emoji: "🔥",
    });

    expect(result.success).toBe(true);
    expect(result.channel).toBe("discord");
    expect(result.channelId).toBe(discordChannelId);
    expect(calledWith).toEqual({
      channelId: discordChannelId,
      target: "discord-chat-1",
      messageId: "discord-msg-1",
      emoji: "🔥",
    });
  });

  test("react routes to slack adapter", async () => {
    const slackChannelId = createChannel("slack", "Slack React Test");
    const adapter = channelManager.getAdapter("slack") as
      | (ChannelAdapter & {
          sendReaction?: (
            channelId: string,
            chatId: string | number,
            messageId: string,
            emoji: string,
            options?: Record<string, unknown>
          ) => Promise<boolean>;
        })
      | null;
    expect(adapter).toBeDefined();
    if (!adapter) {
      throw new Error("slack adapter not available");
    }

    const originalSendReaction = adapter.sendReaction;
    let calledWith:
      | { channelId: string; target: string; messageId: string; emoji: string }
      | undefined;
    adapter.sendReaction = async (channelId, chatId, messageId, emoji) => {
      calledWith = {
        channelId,
        target: String(chatId),
        messageId,
        emoji,
      };
      return true;
    };
    restorers.push(() => {
      adapter.sendReaction = originalSendReaction;
    });

    const result = await handleMessage({
      action: "react",
      channelId: slackChannelId,
      target: "slack-chat-1",
      messageId: "1710000000.001",
      emoji: ":eyes:",
    });

    expect(result.success).toBe(true);
    expect(result.channel).toBe("slack");
    expect(result.channelId).toBe(slackChannelId);
    expect(calledWith).toEqual({
      channelId: slackChannelId,
      target: "slack-chat-1",
      messageId: "1710000000.001",
      emoji: ":eyes:",
    });
  });

  test("react routes to telegram adapter", async () => {
    const telegramChannelId = createChannel("telegram", "Telegram React Test");
    const adapter = channelManager.getAdapter("telegram") as
      | (ChannelAdapter & {
          sendReaction?: (
            channelId: string,
            chatId: string | number,
            messageId: string,
            emoji: string,
            options?: Record<string, unknown>
          ) => Promise<boolean>;
        })
      | null;
    expect(adapter).toBeDefined();
    if (!adapter) {
      throw new Error("telegram adapter not available");
    }

    const originalSendReaction = adapter.sendReaction;
    let calledWith:
      | { channelId: string; target: string; messageId: string; emoji: string }
      | undefined;
    adapter.sendReaction = async (channelId, chatId, messageId, emoji) => {
      calledWith = {
        channelId,
        target: String(chatId),
        messageId,
        emoji,
      };
      return true;
    };
    restorers.push(() => {
      adapter.sendReaction = originalSendReaction;
    });

    const result = await handleMessage({
      action: "react",
      channelId: telegramChannelId,
      target: "880011",
      messageId: "101",
      emoji: "🔥",
    });

    expect(result.success).toBe(true);
    expect(result.channel).toBe("telegram");
    expect(result.channelId).toBe(telegramChannelId);
    expect(calledWith).toEqual({
      channelId: telegramChannelId,
      target: "880011",
      messageId: "101",
      emoji: "🔥",
    });
  });

  test("unreact passes userId through to discord adapter", async () => {
    const discordChannelId = createChannel("discord", "Discord Unreact Test");
    const adapter = channelManager.getAdapter("discord") as
      | (ChannelAdapter & {
          removeReaction?: (
            channelId: string,
            chatId: string | number,
            messageId: string,
            emoji: string,
            options?: Record<string, unknown>
          ) => Promise<boolean>;
        })
      | null;
    expect(adapter).toBeDefined();
    if (!adapter) {
      throw new Error("discord adapter not available");
    }

    const originalRemoveReaction = adapter.removeReaction;
    let calledWith:
      | {
          channelId: string;
          target: string;
          messageId: string;
          emoji: string;
          userId: string | undefined;
        }
      | undefined;
    adapter.removeReaction = async (channelId, chatId, messageId, emoji, options) => {
      calledWith = {
        channelId,
        target: String(chatId),
        messageId,
        emoji,
        userId: typeof options?.userId === "string" ? options.userId : undefined,
      };
      return true;
    };
    restorers.push(() => {
      adapter.removeReaction = originalRemoveReaction;
    });

    const result = await handleMessage({
      action: "unreact",
      channelId: discordChannelId,
      target: "discord-chat-2",
      messageId: "discord-msg-2",
      emoji: "✅",
      userId: "user-123",
    });

    expect(result.success).toBe(true);
    expect(result.channel).toBe("discord");
    expect(result.channelId).toBe(discordChannelId);
    expect(calledWith).toEqual({
      channelId: discordChannelId,
      target: "discord-chat-2",
      messageId: "discord-msg-2",
      emoji: "✅",
      userId: "user-123",
    });
  });

  test("send requires disambiguation when multiple channels are active", async () => {
    createChannel("web", "Web One");
    createChannel("web", "Web Two");

    await expect(
      handleMessage({
        action: "send",
        target: "chat-ambiguous",
        message: "hello",
      })
    ).rejects.toThrow("Provide channel or channelId");
  });

  test("react resolves discord channel from current session context", async () => {
    const firstDiscordChannelId = createChannel("discord", "Discord One");
    createChannel("discord", "Discord Two");

    discordSessions.set(`${firstDiscordChannelId}:chat-context`, "session-context");

    const adapter = channelManager.getAdapter("discord") as
      | (ChannelAdapter & {
          sendReaction?: (
            channelId: string,
            chatId: string | number,
            messageId: string,
            emoji: string,
            options?: Record<string, unknown>
          ) => Promise<boolean>;
        })
      | null;
    expect(adapter).toBeDefined();
    if (!adapter) {
      throw new Error("discord adapter not available");
    }

    const originalSendReaction = adapter.sendReaction;
    let resolvedChannelId: string | undefined;
    adapter.sendReaction = async (channelId) => {
      resolvedChannelId = channelId;
      return true;
    };
    restorers.push(() => {
      adapter.sendReaction = originalSendReaction;
    });

    const result = await handleMessage(
      {
        action: "react",
        target: "chat-context",
        messageId: "msg-context",
        emoji: "🔥",
      },
      {
        channel: "discord",
        userId: "chat-context",
        sessionId: "session-context",
      }
    );

    expect(result.success).toBe(true);
    expect(result.channelId).toBe(firstDiscordChannelId);
    expect(resolvedChannelId).toBe(firstDiscordChannelId);
  });
});
