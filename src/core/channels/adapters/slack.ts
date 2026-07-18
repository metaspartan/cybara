import { App } from "@slack/bolt";
import type { ChannelAdapter, ChannelTarget, ToolCallInfo, MessageHandler } from "../types";
import { formatToolCallsPlain } from "../formatting";
import { logChannelMessage } from "../../logging";
import { tables } from "../../database";
import { buildChannelSecurityConfig, securityManager } from "../security";
import { handleChannelManagementCommand } from "../commands";
import { sendChannelRuntimeMessage } from "../chat-runtime";
import { saveInboundMediaFromUrl } from "../media";

interface SlackMessageEvent {
  type: string;
  subtype?: string;
  text?: string;
  user: string;
  channel: string;
  ts: string;
  thread_ts?: string;
  bot_id?: string;
  files?: Array<{
    id?: string;
    name?: string;
    mimetype?: string;
    url_private?: string;
    url_private_download?: string;
  }>;
}

export const slackSessions = new Map<string, string>();

function normalizeSlackTarget(value: string): string {
  return value.trim().replace(/^#/, "").toLocaleLowerCase();
}

export function resolveSlackTargetId(targets: ChannelTarget[], requested: string): string {
  const normalized = normalizeSlackTarget(requested);
  const match = targets.find((target) => normalizeSlackTarget(target.name) === normalized);
  if (match) return match.id;
  throw new Error(`No Slack channel matches '${requested}'. Use action=list to discover targets.`);
}

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
  private botTokens = new Map<string, string>();
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

    if (!signingSecret) {
      throw new Error("signing_secret is required for Slack adapter");
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
      this.botTokens.set(channelId, botToken);
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
    if (message.subtype === "bot_message" || message.bot_id) return;
    if (message.subtype === "message_changed") return;

    const chatId = message.channel;
    if (!chatId.startsWith("D")) return;

    const text = message.text || "";
    const trimmedText = text.trim();
    const inboundFile = await this.resolveInboundFile(channelId, message.files);
    if (!trimmedText && !inboundFile.hasFile) return;

    const content = this.composeContentWithFileContext(trimmedText, inboundFile);

    const userId = message.user;

    const accessCheck = securityManager.checkAccess(channelId, userId, "slack", undefined, {
      isGroup: false,
    });

    if (!accessCheck.permitted) {
      if (accessCheck.silent) return;
      if (accessCheck.reason === "new_pairing" || accessCheck.reason === "blocked") {
        try {
          await say(accessCheck.message || `🔐 Pairing code: ${accessCheck.code}`);
        } catch (e) {
          console.error("[Slack] Failed to send security message:", e);
        }
      }
      return;
    }

    await logChannelMessage("slack", "incoming", content, {
      channelId: chatId,
      senderId: userId,
      metadata: {
        messageTs: message.ts,
        threadTs: message.thread_ts,
        hasFile: inboundFile.hasFile,
        fileType: inboundFile.fileType,
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
      const commandResponse = await handleChannelManagementCommand(content, {
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
        response = await this.messageHandler(content, chatId, sessionId, {
          channelId,
          hasFile: inboundFile.hasFile,
          filePath: inboundFile.filePath,
          fileType: inboundFile.fileType,
          placeholder: inboundFile.placeholder,
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
    event: {
      user: string;
      channel: string;
      text?: string;
      ts: string;
      thread_ts?: string;
      files?: SlackMessageEvent["files"];
    },
    say: (text: string) => Promise<unknown>,
    _client: unknown
  ): Promise<void> {
    const text = event.text || "";
    const userId = event.user;
    const chatId = event.channel;
    const isGroupChannel = !chatId.startsWith("D");

    const accessCheck = securityManager.checkAccess(channelId, userId, "slack", undefined, {
      isGroup: isGroupChannel,
    });
    if (!accessCheck.permitted) {
      if (accessCheck.silent) return;
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
    const inboundFile = await this.resolveInboundFile(channelId, event.files);
    const content = this.composeContentWithFileContext(cleanText, inboundFile);

    if (!cleanText && !inboundFile.hasFile) {
      await say("👋 Hi! How can I help you today?");
      return;
    }

    await logChannelMessage("slack", "incoming", content, {
      channelId: chatId,
      senderId: userId,
      metadata: {
        messageTs: event.ts,
        threadTs: event.thread_ts,
        isMention: true,
        hasFile: inboundFile.hasFile,
        fileType: inboundFile.fileType,
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
      const commandResponse = await handleChannelManagementCommand(content, {
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
        response = await this.messageHandler(content, chatId, sessionId, {
          channelId,
          hasFile: inboundFile.hasFile,
          filePath: inboundFile.filePath,
          fileType: inboundFile.fileType,
          placeholder: inboundFile.placeholder,
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

  private composeContentWithFileContext(
    text: string,
    file: { hasFile: boolean; filePath: string; fileType: string; placeholder: string }
  ): string {
    if (!file.hasFile) {
      return text;
    }

    const descriptor = file.filePath || file.placeholder || "attachment";
    const attachmentLines = [
      file.placeholder || "<attachment:file>",
      `[Attachment: ${descriptor}]`,
    ];
    return text ? `${text}\n\n${attachmentLines.join("\n")}` : attachmentLines.join("\n");
  }

  private async resolveInboundFile(
    channelId: string,
    files: SlackMessageEvent["files"]
  ): Promise<{ hasFile: boolean; filePath: string; fileType: string; placeholder: string }> {
    if (!Array.isArray(files) || files.length === 0) {
      return {
        hasFile: false,
        filePath: "",
        fileType: "",
        placeholder: "",
      };
    }

    const file = files.find((entry) => entry && (entry.url_private_download || entry.url_private));
    if (!file) {
      return {
        hasFile: false,
        filePath: "",
        fileType: "",
        placeholder: "",
      };
    }

    const fileName = file.name || "slack-file";
    const fileType = file.mimetype || "application/octet-stream";
    const placeholder = `<attachment:${fileName}>`;
    const downloadUrl = file.url_private_download || file.url_private;
    if (!downloadUrl) {
      return {
        hasFile: true,
        filePath: "",
        fileType,
        placeholder,
      };
    }

    const botToken = this.botTokens.get(channelId);
    try {
      const saved = await saveInboundMediaFromUrl({
        channel: "slack",
        url: downloadUrl,
        fileName,
        contentType: fileType,
        headers: botToken ? { Authorization: `Bearer ${botToken}` } : undefined,
      });
      return {
        hasFile: true,
        filePath: saved.path,
        fileType,
        placeholder,
      };
    } catch (error) {
      console.warn("[Slack] Failed to cache file locally; using URL reference:", error);
      return {
        hasFile: true,
        filePath: downloadUrl,
        fileType,
        placeholder,
      };
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
    this.botTokens.delete(channelId);
    console.log(`[Slack] Stopped for channel ${channelId}`);
  }

  isRunning(channelId: string): boolean {
    return this.apps.has(channelId);
  }

  async listTargets(channelId: string): Promise<ChannelTarget[]> {
    const app = this.apps.get(channelId);
    if (!app) {
      throw new Error("Slack channel is not connected");
    }

    const targets = new Map<string, ChannelTarget>();
    let cursor: string | undefined;
    do {
      const response = await app.client.conversations.list({
        cursor,
        exclude_archived: true,
        limit: 200,
        types: "public_channel,private_channel",
      });
      for (const channel of response.channels ?? []) {
        if (typeof channel.id !== "string" || typeof channel.name !== "string") continue;
        targets.set(channel.id, {
          id: channel.id,
          name: channel.name,
          label: `#${channel.name}`,
        });
      }
      const nextCursor = response.response_metadata?.next_cursor?.trim();
      cursor = nextCursor || undefined;
    } while (cursor);

    return [...targets.values()].sort((a, b) => a.label.localeCompare(b.label));
  }

  async resolveTarget(channelId: string, target: string): Promise<string> {
    const trimmed = target.trim();
    if (!trimmed.startsWith("#")) return trimmed;
    return resolveSlackTargetId(await this.listTargets(channelId), trimmed);
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
