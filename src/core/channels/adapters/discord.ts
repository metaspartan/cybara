import { Client, GatewayIntentBits, Events, Partials, type Message } from "discord.js";
import type { ChannelAdapter, ToolCallInfo, MessageHandler } from "../types";
import { formatToolCallsForDiscord } from "../formatting";
import { logChannelMessage } from "../../logging";
import { buildChannelSecurityConfig, securityManager } from "../security";
import { handleChannelManagementCommand } from "../commands";

export const discordSessions = new Map<string, string>();

export const DISCORD_REQUIRED_INTENTS = [
  GatewayIntentBits.Guilds,
  GatewayIntentBits.GuildMessages,
  GatewayIntentBits.MessageContent,
  GatewayIntentBits.DirectMessages,
] as const;

export class DiscordAdapter implements ChannelAdapter {
  type = "discord" as const;
  name = "Discord";

  private clients = new Map<string, Client>();
  private messageHandler: MessageHandler = async () => "No handler configured";

  setMessageHandler(handler: MessageHandler) {
    this.messageHandler = handler;
  }

  getMessageHandler(): MessageHandler {
    return this.messageHandler;
  }

  async start(channelId: string, config: Record<string, unknown>): Promise<void> {
    const botToken = config.bot_token as string;
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
      partials: [Partials.Channel, Partials.Message, Partials.User],
    });

    client.once(Events.ClientReady, (readyClient) => {
      console.log(`[Discord] Bot logged in as ${readyClient.user.tag}`);
      console.log(`[Discord] Serving ${readyClient.guilds.cache.size} guilds`);
    });

    client.on(Events.MessageCreate, async (message: Message) => {
      await this.handleMessage(channelId, message);
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
