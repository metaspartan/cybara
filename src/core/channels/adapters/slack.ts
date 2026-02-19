import { App } from "@slack/bolt";
import type { ChannelAdapter, ToolCallInfo, MessageHandler } from "../types";
import { formatToolCallsPlain } from "../formatting";
import { logChannelMessage } from "../../logging";
import { tables } from "../../database";
import { buildChannelSecurityConfig, securityManager } from "../security";
import { handleChannelManagementCommand } from "../commands";
import { sendChannelRuntimeMessage } from "../chat-runtime";

interface SlackMessageEvent {
  type: string;
  subtype?: string;
  text?: string;
  user: string;
  channel: string;
  ts: string;
  thread_ts?: string;
  bot_id?: string;
}

export const slackSessions = new Map<string, string>();

type SlackReactionNotificationScope = "off" | "all" | "dm" | "channel";

interface SlackReactionEvent {
  user?: string;
  reaction?: string;
  item?: {
    type?: string;
    channel?: string;
    ts?: string;
  };
  item_user?: string;
  event_ts?: string;
}

function normalizeSlackReactionScope(value: unknown): SlackReactionNotificationScope {
  if (value === "all" || value === "dm" || value === "channel") {
    return value;
  }
  return "off";
}

function shouldNotifySlackReactions(scope: SlackReactionNotificationScope, isDM: boolean): boolean {
  if (scope === "off") return false;
  if (scope === "all") return true;
  if (scope === "dm") return isDM;
  if (scope === "channel") return !isDM;
  return false;
}

export class SlackAdapter implements ChannelAdapter {
  type = "slack" as const;
  name = "Slack";

  private apps = new Map<string, App>();
  private reactionScopes = new Map<string, SlackReactionNotificationScope>();
  private messageHandler: MessageHandler = async () => "No handler configured";

  setMessageHandler(handler: MessageHandler) {
    this.messageHandler = handler;
  }

  getMessageHandler(): MessageHandler {
    return this.messageHandler;
  }

  async start(channelId: string, config: Record<string, unknown>): Promise<void> {
    const botToken = config.bot_token as string;
    const appToken = config.app_token as string;
    const signingSecret = config.signing_secret as string;
    const reactionScope = normalizeSlackReactionScope(config.reaction_notifications);

    if (!botToken) {
      throw new Error("bot_token (xoxb-...) is required for Slack adapter");
    }

    if (!appToken) {
      throw new Error("app_token (xapp-...) is required for Socket Mode");
    }

    securityManager.setConfig(channelId, buildChannelSecurityConfig(config));

    if (this.apps.has(channelId)) {
      console.log(`[Slack] App already running for channel ${channelId}`);
      return;
    }

    console.log(`[Slack] Starting app for channel ${channelId}...`);

    const app = new App({
      token: botToken,
      appToken: appToken,
      signingSecret: signingSecret,
      socketMode: true, // Use Socket Mode instead of HTTP endpoints
    });

    app.message(async ({ message, say, client }) => {
      await this.handleMessage(channelId, message as SlackMessageEvent, say, client);
    });

    app.event("app_mention", async ({ event, say, client }) => {
      await this.handleMention(channelId, event as SlackMessageEvent, say, client);
    });
    app.event("reaction_added", async ({ event }) => {
      await this.handleReactionEvent(channelId, event as SlackReactionEvent, "added");
    });
    app.event("reaction_removed", async ({ event }) => {
      await this.handleReactionEvent(channelId, event as SlackReactionEvent, "removed");
    });

    app.event("app_home_opened", async ({ event, client: _client }) => {
      console.log(`[Slack] App home opened by user ${event.user}`);
    });

    app.error(async (error) => {
      console.error(`[Slack] App error:`, error);
    });

    try {
      await app.start();
      this.apps.set(channelId, app);
      this.reactionScopes.set(channelId, reactionScope);
      console.log(`[Slack] Successfully started for channel ${channelId}`);
    } catch (error) {
      console.error(`[Slack] Failed to start:`, error);
      throw error;
    }
  }

  private async handleMessage(
    channelId: string,
    message: SlackMessageEvent,
    say: (text: string) => Promise<unknown>,
    _client: unknown
  ): Promise<void> {
    // Ignore bot messages
    if (message.subtype === "bot_message" || message.bot_id) return;

    // Ignore message edits
    if (message.subtype === "message_changed") return;

    const text = message.text || "";
    if (!text.trim()) return;

    const userId = message.user;
    const chatId = message.channel;

    const accessCheck = securityManager.checkAccess(channelId, userId, "slack");

    if (!accessCheck.permitted) {
      if (accessCheck.reason === "new_pairing" || accessCheck.reason === "blocked") {
        try {
          await say(accessCheck.message || `🔐 Pairing code: ${accessCheck.code}`);
        } catch (e) {
          console.error("[Slack] Failed to send security message:", e);
        }
      }
      return;
    }

    await logChannelMessage("slack", "incoming", text, {
      channelId: chatId,
      senderId: userId,
      metadata: {
        messageTs: message.ts,
        threadTs: message.thread_ts,
      },
    });

    const sessionKey = `${channelId}:${chatId}`;
    let sessionId = slackSessions.get(sessionKey);
    if (!sessionId) {
      sessionId = crypto.randomUUID();
      slackSessions.set(sessionKey, sessionId);
    }

    let response: string;
    try {
      const commandResponse = await handleChannelManagementCommand(text, {
        channelId,
        chatId,
        platform: "slack",
        sessionId,
        createSessionId: () => crypto.randomUUID(),
        setSessionId: (nextSessionId: string) => {
          sessionId = nextSessionId;
          slackSessions.set(sessionKey, nextSessionId);
        },
      });

      if (commandResponse !== null) {
        response = commandResponse;
      } else {
        response = await this.messageHandler(text, chatId, sessionId, {
          hasFile: false,
          filePath: "",
          fileType: "",
          placeholder: "",
        });
      }
    } catch (error) {
      console.error("[Slack] Error handling message:", error);
      response = "❌ Sorry, I encountered an error processing your message. Please try again.";
    }

    await logChannelMessage("slack", "outgoing", response, {
      channelId: chatId,
      metadata: { replyToTs: message.ts },
    });

    try {
      await say(response);
    } catch (error) {
      console.error("[Slack] Failed to send message:", error);
    }
  }

  private async handleMention(
    channelId: string,
    event: { user: string; channel: string; text?: string; ts: string; thread_ts?: string },
    say: (text: string) => Promise<unknown>,
    _client: unknown
  ): Promise<void> {
    const text = event.text || "";
    const userId = event.user;
    const chatId = event.channel;

    const accessCheck = securityManager.checkAccess(channelId, userId, "slack");
    if (!accessCheck.permitted) {
      if (accessCheck.reason === "new_pairing" || accessCheck.reason === "blocked") {
        try {
          await say(accessCheck.message || `🔐 Pairing code: ${accessCheck.code}`);
        } catch (e) {
          console.error("[Slack] Failed to send security message:", e);
        }
      }
      return;
    }

    const cleanText = text.replace(/<@[A-Z0-9]+>/g, "").trim();

    if (!cleanText) {
      await say("👋 Hi! How can I help you today?");
      return;
    }

    await logChannelMessage("slack", "incoming", cleanText, {
      channelId: chatId,
      senderId: userId,
      metadata: {
        messageTs: event.ts,
        threadTs: event.thread_ts,
        isMention: true,
      },
    });

    const sessionKey = `${channelId}:${chatId}`;
    let sessionId = slackSessions.get(sessionKey);
    if (!sessionId) {
      sessionId = crypto.randomUUID();
      slackSessions.set(sessionKey, sessionId);
    }

    let response: string;
    try {
      const commandResponse = await handleChannelManagementCommand(cleanText, {
        channelId,
        chatId,
        platform: "slack",
        sessionId,
        createSessionId: () => crypto.randomUUID(),
        setSessionId: (nextSessionId: string) => {
          sessionId = nextSessionId;
          slackSessions.set(sessionKey, nextSessionId);
        },
      });

      if (commandResponse !== null) {
        response = commandResponse;
      } else {
        response = await this.messageHandler(cleanText, chatId, sessionId, {
          hasFile: false,
          filePath: "",
          fileType: "",
          placeholder: "",
        });
      }
    } catch (error) {
      console.error("[Slack] Error handling mention:", error);
      response = "❌ Sorry, I encountered an error processing your message. Please try again.";
    }

    await logChannelMessage("slack", "outgoing", response, {
      channelId: chatId,
      metadata: { replyToTs: event.ts },
    });

    try {
      await say(response);
    } catch (error) {
      console.error("[Slack] Failed to send message:", error);
    }
  }

  private resolveReactionScope(channelId: string): SlackReactionNotificationScope {
    const cachedScope = this.reactionScopes.get(channelId);
    if (cachedScope) return cachedScope;

    const channel = tables.channels.get(channelId) as { config?: unknown } | null;
    let parsedConfig: Record<string, unknown> = {};
    if (typeof channel?.config === "string") {
      try {
        const parsed = JSON.parse(channel.config);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          parsedConfig = parsed as Record<string, unknown>;
        }
      } catch {
        parsedConfig = {};
      }
    } else if (
      channel?.config &&
      typeof channel.config === "object" &&
      !Array.isArray(channel.config)
    ) {
      parsedConfig = channel.config as Record<string, unknown>;
    }

    const scope = normalizeSlackReactionScope(parsedConfig.reaction_notifications);
    this.reactionScopes.set(channelId, scope);
    return scope;
  }

  private async handleReactionEvent(
    channelId: string,
    event: SlackReactionEvent,
    action: "added" | "removed"
  ): Promise<void> {
    const chatId = event.item?.channel;
    const messageTs = event.item?.ts;
    const actorId = event.user;
    if (!chatId || !messageTs || !actorId) {
      return;
    }

    const reaction = event.reaction || "unknown";
    const isDM = chatId.startsWith("D");
    const scope = this.resolveReactionScope(channelId);

    const eventMessage = `[System Event] Slack reaction ${action} by ${actorId} on message ${messageTs}: :${reaction}:`;
    await logChannelMessage("slack", "incoming", eventMessage, {
      channelId: chatId,
      senderId: actorId,
      metadata: {
        event: "reaction",
        action,
        reaction,
        messageTs,
        isDM,
        itemUser: event.item_user || null,
        eventTs: event.event_ts || null,
      },
    });

    if (!shouldNotifySlackReactions(scope, isDM)) {
      return;
    }

    const sessionId = slackSessions.get(`${channelId}:${chatId}`);
    if (!sessionId) {
      return;
    }

    sendChannelRuntimeMessage(sessionId, {
      role: "system",
      content: eventMessage,
      timestamp: new Date().toISOString(),
    });
  }

  async stop(channelId: string): Promise<void> {
    const app = this.apps.get(channelId);
    if (!app) {
      console.log(`[Slack] No app found for channel ${channelId}`);
      return;
    }

    console.log(`[Slack] Stopping app for channel ${channelId}...`);
    await app.stop();
    this.apps.delete(channelId);
    this.reactionScopes.delete(channelId);
    console.log(`[Slack] Stopped for channel ${channelId}`);
  }

  isRunning(channelId: string): boolean {
    return this.apps.has(channelId);
  }

  async sendMessage(
    channelId: string,
    chatId: string | number,
    text: string,
    _options?: Record<string, unknown>
  ): Promise<boolean> {
    const app = this.apps.get(channelId);
    if (!app) {
      console.error("[Slack] sendMessage: No app for channel", channelId);
      return false;
    }

    try {
      await app.client.chat.postMessage({
        channel: String(chatId),
        text: text,
      });
      return true;
    } catch (error) {
      console.error("[Slack] Failed to send message:", error);
      return false;
    }
  }

  private normalizeReactionName(emoji: string): string {
    const trimmed = emoji.trim();
    if (!trimmed) return "";
    return trimmed.replace(/^:+|:+$/g, "");
  }

  async sendReaction(
    channelId: string,
    chatId: string | number,
    messageId: string,
    emoji: string,
    _options?: Record<string, unknown>
  ): Promise<boolean> {
    const app = this.apps.get(channelId);
    if (!app) {
      console.error("[Slack] sendReaction: No app for channel", channelId);
      return false;
    }

    const reactionName = this.normalizeReactionName(emoji);
    if (!reactionName) {
      console.error("[Slack] sendReaction: emoji is required");
      return false;
    }

    try {
      await app.client.reactions.add({
        channel: String(chatId),
        timestamp: String(messageId),
        name: reactionName,
      });
      return true;
    } catch (error) {
      console.error("[Slack] Failed to send reaction:", error);
      return false;
    }
  }

  async removeReaction(
    channelId: string,
    chatId: string | number,
    messageId: string,
    emoji: string,
    _options?: Record<string, unknown>
  ): Promise<boolean> {
    const app = this.apps.get(channelId);
    if (!app) {
      console.error("[Slack] removeReaction: No app for channel", channelId);
      return false;
    }

    const reactionName = this.normalizeReactionName(emoji);
    if (!reactionName) {
      console.error("[Slack] removeReaction: emoji is required");
      return false;
    }

    try {
      await app.client.reactions.remove({
        channel: String(chatId),
        timestamp: String(messageId),
        name: reactionName,
      });
      return true;
    } catch (error) {
      console.error("[Slack] Failed to remove reaction:", error);
      return false;
    }
  }

  formatResponse(content: string, toolCalls?: ToolCallInfo[], thinking?: string): string {
    let text = content;

    if (toolCalls && toolCalls.length > 0) {
      text = formatToolCallsPlain(toolCalls) + "\n\n" + text;
    }

    if (thinking) {
      text += `\n\n💭 _${thinking}_`;
    }

    return text;
  }
}

export const slackAdapter = new SlackAdapter();
