import {
  Client,
  GatewayIntentBits,
  Events,
  Partials,
  type Message,
  type MessageReaction,
  type PartialMessageReaction,
  type User,
  type PartialUser,
} from "discord.js";
import type { ChannelAdapter, ToolCallInfo, MessageHandler } from "../types";
import { formatToolCallsForDiscord } from "../formatting";
import { logChannelMessage } from "../../logging";
import { tables } from "../../database";
import { buildChannelSecurityConfig, securityManager } from "../security";
import { handleChannelManagementCommand } from "../commands";
import { sendChannelRuntimeMessage } from "../chat-runtime";

export const discordSessions = new Map<string, string>();

export const DISCORD_REQUIRED_INTENTS = [
  GatewayIntentBits.Guilds,
  GatewayIntentBits.GuildMessages,
  GatewayIntentBits.MessageContent,
  GatewayIntentBits.DirectMessages,
  GatewayIntentBits.GuildMessageReactions,
  GatewayIntentBits.DirectMessageReactions,
] as const;

type DiscordReactionNotificationScope = "off" | "all" | "dm" | "guild";

function normalizeDiscordReactionScope(value: unknown): DiscordReactionNotificationScope {
  if (value === "all" || value === "dm" || value === "guild") {
    return value;
  }
  return "off";
}

function shouldNotifyDiscordReactions(
  scope: DiscordReactionNotificationScope,
  isDM: boolean
): boolean {
  if (scope === "off") return false;
  if (scope === "all") return true;
  if (scope === "dm") return isDM;
  if (scope === "guild") return !isDM;
  return false;
}

export class DiscordAdapter implements ChannelAdapter {
  type = "discord" as const;
  name = "Discord";

  private clients = new Map<string, Client>();
  private reactionScopes = new Map<string, DiscordReactionNotificationScope>();
  private messageHandler: MessageHandler = async () => "No handler configured";

  setMessageHandler(handler: MessageHandler) {
    this.messageHandler = handler;
  }

  getMessageHandler(): MessageHandler {
    return this.messageHandler;
  }

  async start(channelId: string, config: Record<string, unknown>): Promise<void> {
    const rawToken = typeof config.bot_token === "string" ? config.bot_token.trim() : "";
    const botToken = rawToken.startsWith("Bot ") ? rawToken.slice(4).trim() : rawToken;
    const reactionScope = normalizeDiscordReactionScope(config.reaction_notifications);
    if (!botToken) {
      throw new Error("bot_token is required for Discord adapter");
    }

    securityManager.setConfig(channelId, buildChannelSecurityConfig(config));

    if (this.clients.has(channelId)) {
      console.log(`[Discord] Client already running for channel ${channelId}`);
      return;
    }

    console.log(`[Discord] Starting bot for channel ${channelId}...`);

    const client = new Client({
      intents: [
        ...DISCORD_REQUIRED_INTENTS, // MessageContent must be enabled in Discord Developer Portal
      ],
      partials: [Partials.Channel, Partials.Message, Partials.User, Partials.Reaction],
    });

    client.once(Events.ClientReady, (readyClient) => {
      console.log(`[Discord] Bot logged in as ${readyClient.user.tag}`);
      console.log(`[Discord] Serving ${readyClient.guilds.cache.size} guilds`);
    });

    client.on(Events.MessageCreate, async (message: Message) => {
      await this.handleMessage(channelId, message);
    });
    client.on(Events.MessageReactionAdd, async (reaction, user) => {
      await this.handleReactionEvent(channelId, reaction, user, "added");
    });
    client.on(Events.MessageReactionRemove, async (reaction, user) => {
      await this.handleReactionEvent(channelId, reaction, user, "removed");
    });

    client.on(Events.Error, (error) => {
      console.error(`[Discord] Client error:`, error);
    });

    client.on(Events.Warn, (warning) => {
      console.warn(`[Discord] Client warning:`, warning);
    });

    try {
      await client.login(botToken);
      this.clients.set(channelId, client);
      this.reactionScopes.set(channelId, reactionScope);
      console.log(`[Discord] Successfully started for channel ${channelId}`);
    } catch (error) {
      console.error(`[Discord] Failed to login:`, error);
      throw error;
    }
  }

  private async handleMessage(channelId: string, message: Message): Promise<void> {
    // Ignore bot messages
    if (message.author.bot) return;

    // Ignore messages without content
    if (!message.content && message.attachments.size === 0) return;

    const userId = message.author.id;
    const chatId = message.channel.id;
    const guildId = message.guild?.id || "DM";

    const isMentioned = message.mentions.has(message.client.user!);
    const isDM = !message.guild;

    if (!isMentioned && !isDM) return;

    const accessCheck = securityManager.checkAccess(
      channelId,
      userId,
      "discord",
      message.author.username
    );

    if (!accessCheck.permitted) {
      if (accessCheck.reason === "new_pairing") {
        try {
          await message.reply(accessCheck.message || `🔐 Pairing code: ${accessCheck.code}`);
        } catch (e) {
          console.error("[Discord] Failed to send pairing message:", e);
        }
      } else if (accessCheck.reason === "pending_pairing") {
        // Already has pending pairing, silently ignore (or optionally remind)
        console.log(`[Discord] Ignoring message from pending user ${userId}`);
      } else if (accessCheck.reason === "blocked") {
        try {
          await message.reply(accessCheck.message || "❌ You are not authorized to use this bot.");
        } catch (e) {
          console.error("[Discord] Failed to send blocked message:", e);
        }
      }
      // For 'disabled', silently ignore
      return;
    }

    let content = message.content
      .replace(new RegExp(`<@!?${message.client.user!.id}>`, "g"), "")
      .trim();

    let hasFile = false;
    let filePath = "";
    let fileType = "";
    let placeholder = "";

    if (message.attachments.size > 0) {
      const attachment = message.attachments.first()!;
      content += `\n\n[Attachment: ${attachment.url}]`;
      hasFile = true;
      filePath = attachment.url;
      fileType = attachment.contentType || "application/octet-stream";
      placeholder = `<attachment:${attachment.name}>`;
    }

    await logChannelMessage("discord", "incoming", content, {
      channelId: chatId,
      senderId: userId,
      metadata: {
        messageId: message.id,
        guildId,
        username: message.author.username,
        hasFile,
        fileType,
      },
    });

    try {
      if ("sendTyping" in message.channel) {
        await message.channel.sendTyping();
      }
    } catch {
      void 0;
    }

    const sessionKey = `${channelId}:${chatId}`;
    let sessionId = discordSessions.get(sessionKey);
    if (!sessionId) {
      sessionId = crypto.randomUUID();
      discordSessions.set(sessionKey, sessionId);
    }

    let response: string;
    try {
      const commandResponse = await handleChannelManagementCommand(content, {
        channelId,
        chatId,
        platform: "discord",
        sessionId,
        createSessionId: () => crypto.randomUUID(),
        setSessionId: (nextSessionId: string) => {
          sessionId = nextSessionId;
          discordSessions.set(sessionKey, nextSessionId);
        },
      });

      if (commandResponse !== null) {
        response = commandResponse;
      } else {
        response = await this.messageHandler(content, chatId, sessionId, {
          hasFile,
          filePath,
          fileType,
          placeholder,
        });
      }
    } catch (error) {
      console.error("[Discord] Error handling message:", error);
      response = "❌ Sorry, I encountered an error processing your message. Please try again.";
    }

    await logChannelMessage("discord", "outgoing", response, {
      channelId: chatId,
      metadata: { replyToMessageId: message.id },
    });

    await this.sendLongMessage(message, response);
  }

  private resolveReactionScope(channelId: string): DiscordReactionNotificationScope {
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

    const scope = normalizeDiscordReactionScope(parsedConfig.reaction_notifications);
    this.reactionScopes.set(channelId, scope);
    return scope;
  }

  private async handleReactionEvent(
    channelId: string,
    reaction: MessageReaction | PartialMessageReaction,
    user: User | PartialUser,
    action: "added" | "removed"
  ): Promise<void> {
    if (user.bot) return;

    try {
      if (reaction.partial) {
        await reaction.fetch();
      }
      if (reaction.message.partial) {
        await reaction.message.fetch();
      }
    } catch (error) {
      console.error("[Discord] Failed to hydrate reaction event:", error);
      return;
    }

    const message = reaction.message;
    const chatId = message.channel.id;
    const isDM = !message.guild;
    const scope = this.resolveReactionScope(channelId);

    const emoji =
      typeof reaction.emoji.name === "string" && reaction.emoji.name.trim()
        ? reaction.emoji.id
          ? `${reaction.emoji.name}:${reaction.emoji.id}`
          : reaction.emoji.name
        : reaction.emoji.id || "unknown";
    const actorId = user.id;
    const actorName = user.username || actorId;
    const eventMessage = `[System Event] Discord reaction ${action} by ${actorName} on message ${message.id}: ${emoji}`;

    await logChannelMessage("discord", "incoming", eventMessage, {
      channelId: chatId,
      senderId: actorId,
      metadata: {
        event: "reaction",
        action,
        emoji,
        messageId: message.id,
        guildId: message.guild?.id || null,
        isDM,
      },
    });

    if (!shouldNotifyDiscordReactions(scope, isDM)) {
      return;
    }

    const sessionKey = `${channelId}:${chatId}`;
    const sessionId = discordSessions.get(sessionKey);
    if (!sessionId) {
      return;
    }

    sendChannelRuntimeMessage(sessionId, {
      role: "system",
      content: eventMessage,
      timestamp: new Date().toISOString(),
    });
  }

  private async sendLongMessage(message: Message, response: string): Promise<void> {
    const MAX_LENGTH = 2000; // Discord's message limit

    if (response.length <= MAX_LENGTH) {
      await message.reply(response);
      return;
    }

    const chunks: string[] = [];
    let remaining = response;

    while (remaining.length > 0) {
      if (remaining.length <= MAX_LENGTH) {
        chunks.push(remaining);
        break;
      }

      let splitIndex = remaining.lastIndexOf("\n", MAX_LENGTH);
      if (splitIndex < MAX_LENGTH / 2) {
        splitIndex = remaining.lastIndexOf(" ", MAX_LENGTH);
      }
      if (splitIndex < MAX_LENGTH / 2) {
        splitIndex = MAX_LENGTH;
      }

      chunks.push(remaining.slice(0, splitIndex));
      remaining = remaining.slice(splitIndex).trim();
    }

    await message.reply(chunks[0]);

    for (let i = 1; i < chunks.length; i++) {
      if ("send" in message.channel) {
        await message.channel.send(chunks[i]);
      }
    }
  }

  async stop(channelId: string): Promise<void> {
    const client = this.clients.get(channelId);
    if (!client) {
      console.log(`[Discord] No client found for channel ${channelId}`);
      return;
    }

    console.log(`[Discord] Stopping bot for channel ${channelId}...`);
    client.destroy();
    this.clients.delete(channelId);
    this.reactionScopes.delete(channelId);
    console.log(`[Discord] Stopped for channel ${channelId}`);
  }

  isRunning(channelId: string): boolean {
    const client = this.clients.get(channelId);
    return client?.isReady() ?? false;
  }

  async sendMessage(
    channelId: string,
    chatId: string | number,
    text: string,
    _options?: Record<string, unknown>
  ): Promise<boolean> {
    const client = this.clients.get(channelId);
    if (!client?.isReady()) {
      console.error("[Discord] sendMessage: No ready client for channel", channelId);
      return false;
    }

    try {
      const channel = await client.channels.fetch(String(chatId));
      if (channel?.isTextBased() && "send" in channel) {
        await channel.send(text);
        return true;
      }
      console.error("[Discord] Channel not found or not text-based:", chatId);
      return false;
    } catch (error) {
      console.error("[Discord] Failed to send message:", error);
      return false;
    }
  }

  formatResponse(content: string, toolCalls?: ToolCallInfo[], thinking?: string): string {
    let text = content;

    if (toolCalls && toolCalls.length > 0) {
      const toolSection = formatToolCallsForDiscord(toolCalls);
      text = toolSection + "\n\n" + text;
    }

    if (thinking) {
      text += `\n\n💭 ||${thinking}||`;
    }

    return text;
  }
}

export const discordAdapter = new DiscordAdapter();
