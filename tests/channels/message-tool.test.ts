import { afterEach, describe, expect, test } from "bun:test";
import { channelManager, discordSessions, type ChannelAdapter } from "../../src/core/channels";
import { tables } from "../../src/core/database";
import { handleMessage } from "../../src/core/tools/handlers/channel";

const createdChannels: string[] = [];
const restorers: Array<() => void> = [];

function id(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function createChannel(type: "web" | "discord" | "slack" | "telegram", name: string): string {
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
});

describe("message tool routing", () => {
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
