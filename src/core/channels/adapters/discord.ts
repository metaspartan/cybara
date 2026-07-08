import { existsSync } from "fs";
import { resolve, sep } from "path";
import { homedir } from "os";
import {
  Client,
  GatewayIntentBits,
  Events,
  Partials,
  AttachmentBuilder,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  type Interaction,
  type Message,
  type MessageReaction,
  type PartialMessageReaction,
  type User,
  type PartialUser,
} from "discord.js";
import type { ChannelAdapter, ToolCallInfo, MessageHandler, ChannelEmbed } from "../types";
import { formatToolCallsForDiscord } from "../formatting";
import { logChannelMessage } from "../../logging";
import { tables } from "../../database";
import { buildChannelSecurityConfig, securityManager } from "../security";
import { handleChannelManagementCommand } from "../commands";
import { sendChannelRuntimeMessage } from "../chat-runtime";
import { saveInboundMediaFromUrl } from "../media";

export const discordSessions = new Map<string, string>();

export const DISCORD_REQUIRED_INTENTS = [
  GatewayIntentBits.Guilds,
  GatewayIntentBits.GuildMessages,
  GatewayIntentBits.MessageContent,
  GatewayIntentBits.DirectMessages,
  GatewayIntentBits.GuildMessageReactions,
  GatewayIntentBits.DirectMessageReactions,
] as const;

export function buildDiscordSlashCommands(): ReturnType<SlashCommandBuilder["toJSON"]>[] {
  return [
    new SlashCommandBuilder()
      .setName("help")
      .setDescription("Show available management commands")
      .toJSON(),
    new SlashCommandBuilder()
      .setName("status")
      .setDescription("Show agent and channel status")
      .toJSON(),
    new SlashCommandBuilder()
      .setName("new")
      .setDescription("Start a fresh conversation session")
      .toJSON(),
    new SlashCommandBuilder()
      .setName("sessions")
      .setDescription("List recent conversation sessions")
      .toJSON(),
    new SlashCommandBuilder()
      .setName("switch")
      .setDescription("Switch to a previous session")
      .addStringOption((option) =>
        option
          .setName("target")
          .setDescription("Session number from /sessions or session id/prefix")
          .setRequired(true)
      )
      .toJSON(),
    new SlashCommandBuilder().setName("agents").setDescription("List available agents").toJSON(),
    new SlashCommandBuilder()
      .setName("agent")
      .setDescription("Show or set default agent")
      .addStringOption((option) =>
        option.setName("target").setDescription("Agent id, name, or list index").setRequired(false)
      )
      .toJSON(),
    new SlashCommandBuilder()
      .setName("providers")
      .setDescription("List configured providers")
      .toJSON(),
    new SlashCommandBuilder()
      .setName("provider")
      .setDescription("Show or set the default provider")
      .addStringOption((option) =>
        option
          .setName("target")
          .setDescription("Provider id, name, or list index")
          .setRequired(false)
      )
      .toJSON(),
    new SlashCommandBuilder()
      .setName("models")
      .setDescription("List models for current provider")
      .toJSON(),
    new SlashCommandBuilder()
      .setName("model")
      .setDescription("Show or set the default model")
      .addStringOption((option) =>
        option
          .setName("target")
          .setDescription("Model id or provider model list index")
          .setRequired(false)
      )
      .toJSON(),
    new SlashCommandBuilder()
      .setName("permissions")
      .setDescription("Show or set dangerous tool approvals")
      .addStringOption((option) =>
        option
          .setName("mode")
          .setDescription("Approval mode")
          .addChoices(
            { name: "Always Allow", value: "allow" },
            { name: "Ask Me First", value: "ask" }
          )
          .setRequired(false)
      )
      .toJSON(),
    new SlashCommandBuilder()
      .setName("subagents")
      .setDescription("Spawn a one-off deterministic subagent run")
      .addStringOption((option) =>
        option.setName("task").setDescription("Task for the subagent").setRequired(true)
      )
      .toJSON(),
    new SlashCommandBuilder()
      .setName("workspace")
      .setDescription("Show or set the session workspace directory")
      .addStringOption((option) =>
        option.setName("path").setDescription("Directory path (supports ~/)").setRequired(false)
      )
      .toJSON(),
  ];
}

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
  private typingRefreshMs = 7000;

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
      void this.syncSlashCommands(channelId, readyClient, config);
    });

    client.on(Events.MessageCreate, async (message: Message) => {
      await this.handleMessage(channelId, message);
    });
    client.on(Events.InteractionCreate, async (interaction) => {
      await this.handleInteraction(channelId, interaction);
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
      message.author.username,
      { isGroup: !isDM }
    );

    if (!accessCheck.permitted) {
      if (accessCheck.silent) return;
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
      hasFile = true;
      fileType = attachment.contentType || "application/octet-stream";
      const attachmentName = attachment.name || "attachment";
      placeholder = `<attachment:${attachmentName}>`;
      const token = (message.client as { token?: string }).token;
      const authHeader =
        typeof token === "string" && token.trim()
          ? token.startsWith("Bot ")
            ? token
            : `Bot ${token}`
          : undefined;

      try {
        const saved = await saveInboundMediaFromUrl({
          channel: "discord",
          url: attachment.url,
          fileName: attachmentName,
          contentType: attachment.contentType || undefined,
          headers: authHeader ? { Authorization: authHeader } : undefined,
        });
        filePath = saved.path;
      } catch (error) {
        console.warn(
          "[Discord] Failed to cache attachment locally; falling back to remote URL:",
          error
        );
        filePath = attachment.url || "";
      }

      const fileDescriptor = filePath || attachment.url || attachmentName;
      const attachmentSection = [`${placeholder}`, `[Attachment: ${fileDescriptor}]`].join("\n");
      content = content ? `${content}\n\n${attachmentSection}` : attachmentSection;
      fileType = attachment.contentType || "application/octet-stream";
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

    const stopTyping = this.startTypingKeepAlive(message.channel);

    const sessionKey = `${channelId}:${chatId}`;
    let sessionId = discordSessions.get(sessionKey);
    if (!sessionId) {
      sessionId = crypto.randomUUID();
      discordSessions.set(sessionKey, sessionId);
    }

    try {
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
    } finally {
      stopTyping();
    }
  }

  private parseSlashGuildIds(config: Record<string, unknown>): string[] {
    const values: string[] = [];
    const pushCandidate = (candidate: unknown) => {
      if (typeof candidate !== "string") return;
      const trimmed = candidate.trim();
      if (!trimmed) return;
      for (const part of trimmed.split(/[,\s]+/)) {
        const token = part.trim();
        if (token) values.push(token);
      }
    };

    pushCandidate(config.guild_id);
    pushCandidate(config.guild_ids);

    const unique = [...new Set(values)];
    return unique.filter((entry) => /^\d{6,}$/.test(entry));
  }

  private async syncSlashCommands(
    channelId: string,
    client: Client,
    config: Record<string, unknown>
  ): Promise<void> {
    const nativeCommandsEnabled =
      config.slash_commands !== false && config.native_commands !== false;
    if (!nativeCommandsEnabled) {
      console.log(`[Discord] Native slash commands disabled for channel ${channelId}`);
      return;
    }

    if (!client.application) {
      console.warn(`[Discord] Cannot sync slash commands for ${channelId}: app not ready`);
      return;
    }

    const slashCommands = buildDiscordSlashCommands();
    const configuredGuildIds = this.parseSlashGuildIds(config);
    const guildIds =
      configuredGuildIds.length > 0
        ? configuredGuildIds
        : Array.from(client.guilds.cache.keys()).filter((id) => /^\d{6,}$/.test(id));

    if (guildIds.length > 0) {
      let successCount = 0;
      for (const guildId of guildIds) {
        try {
          await client.application.commands.set(slashCommands, guildId);
          successCount += 1;
        } catch (error) {
          const errorCode =
            error && typeof error === "object" && "code" in error
              ? String((error as { code?: string | number }).code)
              : "";
          if (errorCode === "50001") {
            console.warn(
              `[Discord] Skipped slash command sync for guild ${guildId}: Missing Access (50001). Check bot invite permissions and guild-level app authorization.`
            );
            continue;
          }
          console.warn(
            `[Discord] Failed slash command sync for guild ${guildId}:`,
            error instanceof Error ? error.message : error
          );
        }
      }
      if (successCount > 0) {
        console.log(
          `[Discord] Synced ${slashCommands.length} slash commands for ${successCount} guild(s)`
        );
        return;
      }
      console.warn("[Discord] Guild slash command sync failed for all guilds; trying global sync");
    }

    try {
      await client.application.commands.set(slashCommands);
      console.log(`[Discord] Synced ${slashCommands.length} global slash commands`);
    } catch (error) {
      console.warn(
        "[Discord] Failed to sync global slash commands:",
        error instanceof Error ? error.message : error
      );
    }
  }

  private buildSlashCommandInput(interaction: ChatInputCommandInteraction): string {
    const command = interaction.commandName.toLowerCase();

    if (command === "subagents") {
      const task = interaction.options.getString("task", false)?.trim();
      return task ? `/subagents spawn ${task}` : "/subagents";
    }

    if (command === "permissions") {
      const mode = interaction.options.getString("mode", false)?.trim();
      return mode ? `/permissions ${mode}` : "/permissions";
    }

    if (command === "workspace") {
      const path = interaction.options.getString("path", false)?.trim();
      return path ? `/workspace ${path}` : "/workspace";
    }

    const target = interaction.options.getString("target", false)?.trim();
    return target ? `/${command} ${target}` : `/${command}`;
  }

  private splitLongResponse(response: string): string[] {
    const maxLength = 2000;
    if (!response) return [""];
    if (response.length <= maxLength) return [response];

    const chunks: string[] = [];
    let remaining = response;

    while (remaining.length > 0) {
      if (remaining.length <= maxLength) {
        chunks.push(remaining);
        break;
      }

      let splitIndex = remaining.lastIndexOf("\n", maxLength);
      if (splitIndex < maxLength / 2) {
        splitIndex = remaining.lastIndexOf(" ", maxLength);
      }
      if (splitIndex < maxLength / 2) {
        splitIndex = maxLength;
      }

      chunks.push(remaining.slice(0, splitIndex));
      remaining = remaining.slice(splitIndex).trim();
    }

    return chunks;
  }

  private async replyToInteraction(
    interaction: ChatInputCommandInteraction,
    response: string,
    ephemeral = false
  ): Promise<void> {
    const chunks = this.splitLongResponse(response);
    const firstChunk = chunks[0] || "Done.";

    if (interaction.replied || interaction.deferred) {
      await interaction.followUp({ content: firstChunk, ephemeral });
    } else {
      await interaction.reply({ content: firstChunk, ephemeral });
    }

    for (let i = 1; i < chunks.length; i += 1) {
      await interaction.followUp({ content: chunks[i] });
    }
  }

  private async handleInteraction(channelId: string, interaction: Interaction): Promise<void> {
    if (!interaction.isChatInputCommand()) return;

    const userId = interaction.user.id;
    const chatId = interaction.channelId;
    if (!chatId) {
      await interaction.reply({
        content: "Channel is not available for this command.",
        ephemeral: true,
      });
      return;
    }

    const accessCheck = securityManager.checkAccess(
      channelId,
      userId,
      "discord",
      interaction.user.username,
      { isGroup: !!interaction.guildId }
    );
    if (!accessCheck.permitted) {
      if (accessCheck.silent) return;
      if (accessCheck.reason === "new_pairing" || accessCheck.reason === "blocked") {
        await this.replyToInteraction(
          interaction,
          accessCheck.message || `🔐 Pairing code: ${accessCheck.code}`,
          true
        );
      }
      return;
    }

    const commandInput = this.buildSlashCommandInput(interaction);
    const sessionKey = `${channelId}:${chatId}`;
    let sessionId = discordSessions.get(sessionKey);
    if (!sessionId) {
      sessionId = crypto.randomUUID();
      discordSessions.set(sessionKey, sessionId);
    }

    await logChannelMessage("discord", "incoming", commandInput, {
      channelId: chatId,
      senderId: userId,
      metadata: {
        interactionId: interaction.id,
        commandName: interaction.commandName,
        username: interaction.user.username,
      },
    });

    let response = "Command was not recognized.";
    try {
      const commandResponse = await handleChannelManagementCommand(commandInput, {
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
        response = await this.messageHandler(commandInput, chatId, sessionId, {
          hasFile: false,
          filePath: "",
          fileType: "",
          placeholder: "",
        });
      }
    } catch (error) {
      console.error("[Discord] Error handling slash command:", error);
      response = "❌ Sorry, I encountered an error processing your command.";
    }

    await logChannelMessage("discord", "outgoing", response, {
      channelId: chatId,
      metadata: { interactionId: interaction.id, commandName: interaction.commandName },
    });

    await this.replyToInteraction(interaction, response);
  }

  private startTypingKeepAlive(channel: Message["channel"]): () => void {
    let stopped = false;
    const sendTyping = async () => {
      if (stopped) return;
      try {
        if ("sendTyping" in channel) {
          await channel.sendTyping();
        }
      } catch {
        void 0;
      }
    };

    void sendTyping();
    const timer = setInterval(() => {
      void sendTyping();
    }, this.typingRefreshMs);

    return () => {
      stopped = true;
      clearInterval(timer);
    };
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

  /**
   * Extract local image files referenced via file:// (e.g. screenshots produced
   * by computer_use/browser tools), returning the attachments plus the response
   * text with those markers stripped so Discord shows the image, not a raw path.
   */
  private extractFileAttachments(response: string): {
    text: string;
    files: AttachmentBuilder[];
  } {
    const files: AttachmentBuilder[] = [];
    const seen = new Set<string>();
    const screenshotsBase = resolve(
      process.env.HOME || process.env.USERPROFILE || homedir(),
      ".cybara",
      "screenshots"
    );
    const pattern = /(?:!\[[^\]]*\]\()?file:\/\/(\/[^\s)]+)\)?/g;
    const text = response
      .replace(pattern, (_match, rawPath: string) => {
        const path = resolve(decodeURI(rawPath));
        const contained = path === screenshotsBase || path.startsWith(screenshotsBase + sep);
        if (
          contained &&
          !seen.has(path) &&
          existsSync(path) &&
          /\.(png|jpe?g|gif|webp)$/i.test(path)
        ) {
          seen.add(path);
          files.push(new AttachmentBuilder(path));
        }
        return "";
      })
      .replace(/\n{3,}/g, "\n\n")
      .trim();
    return { text, files };
  }

  private async sendLongMessage(message: Message, response: string): Promise<void> {
    const { text, files } = this.extractFileAttachments(response);
    const chunks = this.splitLongResponse(text);

    if (chunks.length === 0) {
      // No text left, but we may still have an image to deliver.
      if (files.length > 0) {
        await message.reply({ content: "📸 Screenshot:", files });
      } else {
        await message.reply("Done.");
      }
      return;
    }

    // Attach files to the first message so the image shows inline with the reply.
    await message.reply(files.length > 0 ? { content: chunks[0], files } : chunks[0]);

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

  async editMessage(
    channelId: string,
    chatId: string | number,
    messageId: string,
    text: string,
    _options?: Record<string, unknown>
  ): Promise<boolean> {
    const client = this.clients.get(channelId);
    if (!client?.isReady()) return false;
    try {
      const channel = await client.channels.fetch(String(chatId));
      if (channel?.isTextBased() && "messages" in channel) {
        const message = await channel.messages.fetch(String(messageId));
        await message.edit(text);
        return true;
      }
      return false;
    } catch (error) {
      console.error("[Discord] Failed to edit message:", error);
      return false;
    }
  }

  async sendAttachment(
    channelId: string,
    chatId: string | number,
    file: string | Buffer,
    filename: string,
    caption?: string
  ): Promise<boolean> {
    const client = this.clients.get(channelId);
    if (!client?.isReady()) return false;
    try {
      const channel = await client.channels.fetch(String(chatId));
      if (channel?.isTextBased() && "send" in channel) {
        const attachment =
          typeof file === "string"
            ? { attachment: file, name: filename }
            : { attachment: Buffer.from(file), name: filename };
        await channel.send({ content: caption || "", files: [attachment] });
        return true;
      }
      return false;
    } catch (error) {
      console.error("[Discord] Failed to send attachment:", error);
      return false;
    }
  }

  async sendEmbed(
    channelId: string,
    chatId: string | number,
    embed: ChannelEmbed
  ): Promise<boolean> {
    const client = this.clients.get(channelId);
    if (!client?.isReady()) return false;
    try {
      const channel = await client.channels.fetch(String(chatId));
      if (channel?.isTextBased() && "send" in channel) {
        await channel.send({
          embeds: [
            {
              title: embed.title,
              description: embed.description,
              color: embed.color,
              url: embed.url,
              thumbnail: embed.thumbnail ? { url: embed.thumbnail } : undefined,
              image: embed.imageUrl ? { url: embed.imageUrl } : undefined,
              fields: embed.fields?.map((f) => ({
                name: f.name,
                value: f.value,
                inline: f.inline,
              })),
              footer: embed.footer ? { text: embed.footer } : undefined,
              timestamp: embed.timestamp ? new Date(embed.timestamp).toISOString() : undefined,
            },
          ],
        });
        return true;
      }
      return false;
    } catch (error) {
      console.error("[Discord] Failed to send embed:", error);
      return false;
    }
  }

  async createThread(
    channelId: string,
    chatId: string | number,
    messageId: string,
    name: string,
    message?: string
  ): Promise<string | null> {
    const client = this.clients.get(channelId);
    if (!client?.isReady()) return null;
    try {
      const channel = await client.channels.fetch(String(chatId));
      if (channel?.isTextBased() && "messages" in channel) {
        const msg = await channel.messages.fetch(String(messageId));
        const thread = await msg.startThread({ name, reason: "Agent-created thread" });
        if (message) {
          await thread.send(message);
        }
        return thread.id;
      }
      return null;
    } catch (error) {
      console.error("[Discord] Failed to create thread:", error);
      return null;
    }
  }

  private normalizeReactionEmoji(emoji: string): string {
    const trimmed = emoji.trim();
    if (!trimmed) return trimmed;

    const customEmojiMatch = trimmed.match(/^<a?:([^:>]+):(\d+)>$/);
    if (customEmojiMatch) {
      return `${customEmojiMatch[1]}:${customEmojiMatch[2]}`;
    }

    return trimmed;
  }

  private getCustomEmojiId(emoji: string): string | undefined {
    const customEmojiMatch = emoji.match(/^<a?:[^:>]+:(\d+)>$/);
    if (customEmojiMatch) {
      return customEmojiMatch[1];
    }
    const emojiParts = emoji.split(":");
    if (emojiParts.length >= 2) {
      const maybeId = emojiParts[emojiParts.length - 1];
      if (/^\d+$/.test(maybeId)) {
        return maybeId;
      }
    }
    return undefined;
  }

  private async fetchReactionMessage(
    channelId: string,
    chatId: string | number,
    messageId: string
  ): Promise<Message | null> {
    const client = this.clients.get(channelId);
    if (!client?.isReady()) {
      console.error("[Discord] fetchReactionMessage: No ready client for channel", channelId);
      return null;
    }

    try {
      const channel = await client.channels.fetch(String(chatId));
      if (!channel?.isTextBased() || !("messages" in channel)) {
        console.error("[Discord] Reaction target is not a text channel:", chatId);
        return null;
      }

      const message = await channel.messages.fetch(String(messageId));
      return message;
    } catch (error) {
      console.error("[Discord] Failed to fetch reaction message:", error);
      return null;
    }
  }

  async sendReaction(
    channelId: string,
    chatId: string | number,
    messageId: string,
    emoji: string,
    _options?: Record<string, unknown>
  ): Promise<boolean> {
    const normalizedEmoji = this.normalizeReactionEmoji(emoji);
    if (!normalizedEmoji) {
      console.error("[Discord] sendReaction: emoji is required");
      return false;
    }

    const message = await this.fetchReactionMessage(channelId, chatId, messageId);
    if (!message) return false;

    try {
      await message.react(normalizedEmoji);
      return true;
    } catch (error) {
      console.error("[Discord] Failed to send reaction:", error);
      return false;
    }
  }

  async removeReaction(
    channelId: string,
    chatId: string | number,
    messageId: string,
    emoji: string,
    options?: Record<string, unknown>
  ): Promise<boolean> {
    const client = this.clients.get(channelId);
    if (!client?.isReady()) {
      console.error("[Discord] removeReaction: No ready client for channel", channelId);
      return false;
    }

    const message = await this.fetchReactionMessage(channelId, chatId, messageId);
    if (!message) return false;

    const normalizedEmoji = this.normalizeReactionEmoji(emoji);
    const customEmojiId = this.getCustomEmojiId(emoji);
    const botUserId = client.user?.id;
    const explicitUserId =
      typeof options?.userId === "string" && options.userId.trim()
        ? options.userId.trim()
        : undefined;
    const removeUserId = explicitUserId || botUserId;

    if (!removeUserId) {
      console.error("[Discord] removeReaction: Unable to resolve user id for removal");
      return false;
    }

    const reaction =
      message.reactions.resolve(normalizedEmoji) ||
      message.reactions.cache.find((entry) => {
        if (customEmojiId && entry.emoji.id) {
          return entry.emoji.id === customEmojiId;
        }
        if (entry.emoji.name && entry.emoji.name === normalizedEmoji) {
          return true;
        }
        if (entry.emoji.id && entry.emoji.name) {
          return `${entry.emoji.name}:${entry.emoji.id}` === normalizedEmoji;
        }
        return false;
      });

    if (!reaction) {
      console.warn(
        `[Discord] removeReaction: Reaction not found for message ${messageId} (${normalizedEmoji})`
      );
      return false;
    }

    try {
      await reaction.users.remove(removeUserId);
      return true;
    } catch (error) {
      console.error("[Discord] Failed to remove reaction:", error);
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
