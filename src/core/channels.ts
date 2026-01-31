import { tables, type Channel } from "./database";
import { logChannelMessage } from "./logging";
import { randomUUID } from "crypto";
import { existsSync, mkdirSync, writeFileSync, readFileSync } from "fs";
import path, { join } from "path";

export const telegramSessions = new Map<string, string>();

// Get user's sessions from in-memory store
async function getUserSessions(
  userId: string
): Promise<Array<{ id: string; messageCount: number; lastActive: string }>> {
  const { listSessions } = await import("../api/chat");
  const allSessions = await listSessions();
  // Filter sessions that might belong to this user (based on message activity)
  return allSessions
    .map((s) => ({
      id: s.id,
      messageCount: s.messageCount,
      lastActive: s.createdAt,
    }))
    .slice(0, 10); // Return last 10 sessions
}

export const channels = {
  telegram: {
    name: "Telegram",
    icon: "📱",
    description: "Connect to Telegram for messaging",
    color: "#229ED9",
    fields: [
      { key: "bot_token", label: "Bot Token", type: "password", required: true },
      { key: "webhook_url", label: "Webhook URL", type: "string", required: false },
    ],
  },
  whatsapp: {
    name: "WhatsApp",
    icon: "💬",
    description: "Connect via Meta Business API",
    color: "#25D366",
    fields: [
      { key: "phone_number_id", label: "Phone Number ID", type: "string", required: true },
      { key: "access_token", label: "Access Token", type: "password", required: true },
      {
        key: "webhook_verify_token",
        label: "Webhook Verify Token",
        type: "string",
        required: true,
      },
    ],
  },
  discord: {
    name: "Discord",
    icon: "🎮",
    description: "Connect to Discord server",
    color: "#5865F2",
    fields: [
      { key: "bot_token", label: "Bot Token", type: "password", required: true },
      { key: "guild_id", label: "Guild ID", type: "string", required: false },
    ],
  },
  slack: {
    name: "Slack",
    icon: "💼",
    description: "Connect to Slack workspace",
    color: "#4A154B",
    fields: [
      { key: "bot_token", label: "Bot Token", type: "password", required: true },
      { key: "signing_secret", label: "Signing Secret", type: "password", required: true },
    ],
  },
  signal: {
    name: "Signal",
    icon: "🔔",
    description: "Connect via signal-cli",
    color: "#3A76F0",
    fields: [
      { key: "signal_cli_path", label: "Signal CLI Path", type: "string", required: true },
      { key: "phone_number", label: "Phone Number", type: "string", required: true },
    ],
  },
  imessage: {
    name: "iMessage",
    icon: "🍎",
    description: "Connect via BlueBubbles",
    color: "#FF3B30",
    fields: [
      { key: "server_url", label: "BlueBubbles Server URL", type: "string", required: true },
      { key: "password", label: "Password", type: "password", required: true },
    ],
  },
  web: {
    name: "Web UI",
    icon: "🌐",
    description: "Built-in web interface",
    color: "#6366f1",
    fields: [],
  },
} as const;

export type ChannelType = keyof typeof channels;

// Telegram Bot Commands
interface TelegramBotCommand {
  command: string;
  description: string;
}

const TELEGRAM_COMMANDS: TelegramBotCommand[] = [
  { command: "start", description: "Start interacting with the bot" },
  { command: "help", description: "Show available commands and usage" },
  { command: "new", description: "Start a new conversation session" },
  { command: "agents", description: "List available agents" },
  { command: "status", description: "Check bot and agent status" },
  { command: "metrics", description: "Show token usage and statistics" },
  { command: "switch", description: "Switch between agents - /switch <agent_name>" },
  { command: "session", description: "Manage chat sessions - /session list|new|clear" },
  { command: "memory", description: "Show recent memories/context" },
  { command: "tools", description: "List available tools" },
  { command: "cancel", description: "Cancel current operation" },
];

// Telegram API helper
async function telegramApi(
  botToken: string,
  method: string,
  body?: Record<string, unknown>
): Promise<{ ok: boolean; result?: unknown }> {
  const url = `https://api.telegram.org/bot${botToken}/${method}`;
  const response = await fetch(url, {
    method: body ? "POST" : "GET",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  return response.json() as Promise<{ ok: boolean; result?: unknown }>;
}

// Register bot commands with BotFather
async function registerTelegramCommands(botToken: string): Promise<boolean> {
  try {
    const result = await telegramApi(botToken, "setMyCommands", {
      commands: TELEGRAM_COMMANDS,
    });
    console.log("[Telegram] Registered commands:", result);
    return result.ok === true;
  } catch (error) {
    console.error("[Telegram] Failed to register commands:", error);
    return false;
  }
}

// Get bot info
async function getTelegramBotInfo(
  botToken: string
): Promise<{ id: number; username: string; first_name: string } | null> {
  try {
    const result = await telegramApi(botToken, "getMe");
    if (result.ok && result.result) {
      const r = result.result as { id: number; username: string; first_name: string };
      return r;
    }
    return null;
  } catch (error) {
    console.error("[Telegram] Failed to get bot info:", error);
    return null;
  }
}

// Set up webhook for receiving messages
async function setupTelegramWebhook(botToken: string, webhookUrl: string): Promise<boolean> {
  try {
    const result = await telegramApi(botToken, "setWebhook", {
      url: webhookUrl,
      allowed_updates: ["message", "callback_query"],
    });
    console.log("[Telegram] Webhook set:", result);
    return result.ok === true;
  } catch (error) {
    console.error("[Telegram] Failed to set webhook:", error);
    return false;
  }
}

// Delete webhook (switch to polling)
async function deleteTelegramWebhook(botToken: string): Promise<boolean> {
  try {
    const result = await telegramApi(botToken, "deleteWebhook");
    console.log("[Telegram] Webhook deleted:", result);
    return result.ok === true;
  } catch (error) {
    console.error("[Telegram] Failed to delete webhook:", error);
    return false;
  }
}

// Send message to Telegram chat
async function sendTelegramMessage(
  botToken: string,
  chatId: number | string,
  text: string,
  options?: {
    parse_mode?: "HTML" | "Markdown" | "MarkdownV2";
    reply_to_message_id?: number;
    reply_markup?: Record<string, unknown>;
  }
): Promise<boolean> {
  try {
    const result = await telegramApi(botToken, "sendMessage", {
      chat_id: chatId,
      text,
      ...options,
    });
    return result.ok === true;
  } catch (error) {
    console.error("[Telegram] Failed to send message:", error);
    return false;
  }
}

// Handle incoming Telegram update
export interface TelegramUpdate {
  update_id: number;
  message?: {
    message_id: number;
    from: {
      id: number;
      is_bot: boolean;
      first_name: string;
      last_name?: string;
      username?: string;
    };
    chat: {
      id: number;
      type: "private" | "group" | "supergroup" | "channel";
      title?: string;
      username?: string;
    };
    date: number;
    text?: string;
    entities?: Array<{
      type: string;
      offset: number;
      length: number;
    }>;
    // Media types
    photo?: Array<{
      file_id: string;
      file_unique_id: string;
      width: number;
      height: number;
      file_size?: number;
    }>;
    video?: {
      file_id: string;
      file_unique_id: string;
      width: number;
      height: number;
      duration: number;
      file_name?: string;
      mime_type?: string;
      file_size?: number;
    };
    document?: {
      file_id: string;
      file_unique_id: string;
      file_name?: string;
      mime_type?: string;
      file_size?: number;
    };
    audio?: {
      file_id: string;
      file_unique_id: string;
      duration: number;
      performer?: string;
      title?: string;
      file_name?: string;
      mime_type?: string;
      file_size?: number;
    };
    voice?: {
      file_id: string;
      file_unique_id: string;
      duration: number;
      mime_type?: string;
      file_size?: number;
    };
    sticker?: {
      file_id: string;
      file_unique_id: string;
      type: string;
      width: number;
      height: number;
      is_animated: boolean;
      is_video: boolean;
      emoji?: string;
    };
  };
  callback_query?: {
    id: string;
    from: {
      id: number;
      is_bot: boolean;
      first_name: string;
      username?: string;
    };
    message?: {
      message_id: number;
      chat: { id: number };
    };
    data: string;
  };
}

interface MessageHandlerFileInfo {
  hasFile: boolean;
  filePath: string;
  fileType: string;
  placeholder: string;
}

interface MessageHandler {
  (
    message: string,
    chatId: number | string,
    userId: number,
    channelId: string,
    fileInfo?: MessageHandlerFileInfo
  ): Promise<string>;
}

// Handle Telegram command
async function handleTelegramCommand(
  command: string,
  args: string[],
  update: TelegramUpdate,
  channelId: string,
  messageHandler: MessageHandler,
  chatId: number,
  fromUserId?: number
): Promise<string> {
  switch (command) {
    case "start":
      return `👋 *Welcome to Cybara!*

I'm your AI assistant. I can help you with various tasks including:
• Writing and editing code
• Answering questions
• Running commands
• And much more!

Use /help to see available commands.
Use /agents to see available AI agents.

Just send me a message to start chatting!`;

    case "help":
      return `📖 *Available Commands*

*Core:*
/start - Start interacting with the bot
/help - Show this help message
/new - Start a fresh conversation (new session)

*Agents & Sessions:*
/agents - List available agents
/status - Check bot and agent status
/sessions - List your recent sessions
/switch <number> - Switch to a previous session

*Information:*
/metrics - Show token usage and statistics
/memory - Show recent memories/context
/tools - List available tools

*Utilities:*
/cancel - Cancel current operation

*Usage:*
Simply send a message to chat with the default agent.
Use /new anytime to start a fresh conversation.`;

    case "agents": {
      // Get agents from database
      const agents = tables.agents.all() as Array<{ name: string; type: string; status: string }>;
      if (!agents.length) {
        return "🤖 No agents configured yet. Please set up agents in the dashboard.";
      }
      const agentList = agents
        .map(
          (a) =>
            `• *${a.name}* (${a.type}) - ${a.status === "running" ? "🟢 Running" : "⚪ Stopped"}`
        )
        .join("\n");
      return `🤖 *Available Agents*\n\n${agentList}`;
    }

    case "status": {
      const allAgents = tables.agents.all() as Array<{ status: string }>;
      const running = allAgents.filter((a) => a.status === "running").length;
      const providers = tables.providers.all() as unknown[];
      const channelsList = tables.channels.all() as unknown[];

      return `📊 *Status*

*Agents:* ${allAgents.length} total, ${running} running
*Providers:* ${providers.length} configured
*Channels:* ${channelsList.length} active

*Bot:* 🟢 Online
*Platform:* Cybara v1.0`;
    }

    case "new": {
      // Start a new session - clear any existing session for this chat
      const newSessionId = crypto.randomUUID();
      telegramSessions.set(chatId.toString(), newSessionId);
      return `🆕 *New Session Started*

Session ID: \`${newSessionId.slice(0, 8)}...\`

I'm ready for a fresh conversation. What would you like to talk about?`;
    }

    case "sessions": {
      // List recent sessions for this user
      const userIdForSessions = fromUserId?.toString() || chatId.toString();
      const userSessions = await getUserSessions(userIdForSessions);
      if (userSessions.length === 0) {
        return `📋 *Your Sessions*

You don't have any active sessions yet.

Use /new to start a new conversation.`;
      }
      const sessionList = userSessions
        .map(
          (s, i) =>
            `${i + 1}. Session \`${s.id.slice(0, 8)}...\` (${s.messageCount} msgs)\n   Last active: ${new Date(s.lastActive).toLocaleString()}`
        )
        .join("\n\n");
      return `📋 *Your Sessions*

${sessionList}

Use /switch <number> to change sessions.
Use /new to start a fresh conversation.`;
    }

    case "switch": {
      const sessionNum = parseInt(args[0]);
      if (isNaN(sessionNum) || sessionNum < 1) {
        return `❌ Please provide a session number.\n\nExample: /switch 1`;
      }
      const userIdForSwitch = fromUserId?.toString() || chatId.toString();
      const sessions = await getUserSessions(userIdForSwitch);
      if (sessionNum > sessions.length) {
        return `❌ Session ${sessionNum} not found.\n\nUse /sessions to see your available sessions.`;
      }
      const targetSession = sessions[sessionNum - 1];
      telegramSessions.set(chatId.toString(), targetSession.id);
      return `🔄 *Switched to Session ${sessionNum}*

Session ID: \`${targetSession.id.slice(0, 8)}...\`
Message count: ${targetSession.messageCount}

Continuing previous conversation...`;
    }

    case "metrics": {
      // Get token usage metrics
      const tokenUsage = tables.metrics.getTotal("token_usage", "all") || 0;
      const inputTokens = tables.metrics.getTotal("token_usage", "input") || 0;
      const outputTokens = tables.metrics.getTotal("token_usage", "output") || 0;
      const apiCalls = tables.metrics.getTotal("api_call", "success") || 0;
      const toolCalls = tables.metrics.getTotal("tool_call", "all") || 0;

      return `📊 *Metrics*

*Tokens:* ${tokenUsage.toLocaleString()} total
  • Input: ${inputTokens.toLocaleString()}
  • Output: ${outputTokens.toLocaleString()}
*API Calls:* ${apiCalls.toLocaleString()}
*Tool Calls:* ${toolCalls.toLocaleString()}

Estimated cost: $${(tokenUsage * 0.00001).toFixed(2)} (varies by provider)`;
    }

    case "memory": {
      // Memory table not implemented - placeholder
      return `🧠 *Memory*

Memory feature coming soon.

Memories will be automatically created when you share important context with the agent.`;
    }

    case "tools": {
      // Get available tools
      const { toolSchemas } = await import("./tools/index");
      const toolList = Object.keys(toolSchemas).slice(0, 10);

      if (toolList.length === 0) {
        return `🛠️ *Tools*

No tools available.`;
      }

      const toolsDisplay = toolList.map((t) => `• /\`${t}\``).join("\n");

      return `🛠️ *Available Tools* (${Object.keys(toolSchemas).length} total)

${toolsDisplay}

Use tools in conversation by describing what you need.`;
    }

    case "cancel":
      return `❌ *Operation Cancelled*

Your request has been cancelled. I'm ready for a new command.

Use /help to see available commands.`;

    default:
      return `❓ Unknown command: /${command}\n\nUse /help to see available commands.`;
  }
}

// Process incoming Telegram message
async function processTelegramUpdate(
  update: TelegramUpdate,
  channelId: string,
  botToken: string,
  messageHandler: MessageHandler
): Promise<void> {
  // Handle callback queries (inline button clicks)
  if (update.callback_query) {
    await handleTelegramCallbackQuery(update.callback_query, channelId, botToken, messageHandler);
    return;
  }

  const message = update.message;
  if (!message) return;

  const chatId = message.chat.id;
  const userId = message.from.id;

  // Extract content - handle text, photos, videos, documents, audio, voice, stickers
  let content = "";
  let hasFile = false;
  let filePath = "";
  let fileType = "";
  let placeholder = "";

  // Check for text message
  if (message.text) {
    content = message.text.trim();
  }

  // Check for photo (use highest resolution)
  if (message.photo && message.photo.length > 0) {
    const photo = message.photo[message.photo.length - 1];
    if (photo.file_id) {
      const saved = await downloadTelegramMedia(botToken, photo.file_id, "photo");
      if (saved) {
        content = saved.placeholder;
        filePath = saved.path;
        fileType = saved.contentType || "image";
        hasFile = true;
        placeholder = saved.placeholder;
      }
    }
  }

  // Check for video
  if (message.video && message.video.file_id) {
    const saved = await downloadTelegramMedia(botToken, message.video.file_id, "video");
    if (saved) {
      content = saved.placeholder;
      filePath = saved.path;
      fileType = saved.contentType || "video";
      hasFile = true;
      placeholder = saved.placeholder;
    }
  }

  // Check for document (file, PDF, etc.)
  if (message.document && message.document.file_id) {
    const fileName = message.document.file_name || "file";
    const saved = await downloadTelegramMedia(
      botToken,
      message.document.file_id,
      "document",
      fileName
    );
    if (saved) {
      content = saved.placeholder;
      filePath = saved.path;
      fileType = saved.contentType || "application/octet-stream";
      hasFile = true;
      placeholder = saved.placeholder;
    }
  }

  // Check for audio
  if (message.audio && message.audio.file_id) {
    const fileName = message.audio.file_name || "audio.mp3";
    const saved = await downloadTelegramMedia(botToken, message.audio.file_id, "audio", fileName);
    if (saved) {
      content = saved.placeholder;
      filePath = saved.path;
      fileType = saved.contentType || "audio/mpeg";
      hasFile = true;
      placeholder = saved.placeholder;
    }
  }

  // Check for voice
  if (message.voice && message.voice.file_id) {
    const saved = await downloadTelegramMedia(
      botToken,
      message.voice.file_id,
      "audio",
      "voice.ogg"
    );
    if (saved) {
      content = saved.placeholder;
      filePath = saved.path;
      fileType = "audio/ogg";
      hasFile = true;
      placeholder = saved.placeholder;
    }
  }

  // Check for sticker (only static WEBP supported)
  if (
    message.sticker &&
    !message.sticker.is_animated &&
    !message.sticker.is_video &&
    message.sticker.file_id
  ) {
    const saved = await downloadTelegramMedia(botToken, message.sticker.file_id, "sticker");
    if (saved) {
      // For stickers, just add placeholder - don't replace content unless no text
      if (!content) {
        content = saved.placeholder;
      }
      filePath = saved.path;
      fileType = "image/webp";
      hasFile = true;
      placeholder = saved.placeholder;
    }
  }

  // If no text and no file, ignore the message
  if (!content && !hasFile) return;

  // Log incoming message
  await logChannelMessage("telegram", "incoming", content, {
    channelId: chatId.toString(),
    senderId: userId.toString(),
    metadata: {
      messageId: message.message_id,
      chatType: message.chat.type,
      username: message.from?.username,
      hasFile,
      fileType,
      placeholder,
    },
  });

  let response: string;

  // Check if it's a command (only for text)
  if (content.startsWith("/")) {
    const [commandWithBot, ...args] = content.slice(1).split(/\s+/);
    const command = commandWithBot.split("@")[0];

    response = await handleTelegramCommand(
      command,
      args,
      update,
      channelId,
      messageHandler,
      chatId,
      userId
    );
  } else {
    // Regular message or file - route to agent
    try {
      const messageWithFile = hasFile ? `${content}\n\n[File: ${filePath}]` : content;

      response = await messageHandler(messageWithFile, chatId, userId, channelId, {
        hasFile,
        filePath,
        fileType,
        placeholder,
      });
    } catch (error) {
      console.error("[Telegram] Error handling message:", error);
      response = "❌ Sorry, I encountered an error processing your message. Please try again.";
    }
  }

  // Log outgoing message
  await logChannelMessage("telegram", "outgoing", response, {
    channelId: chatId.toString(),
    metadata: {
      replyToMessageId: message.message_id,
    },
  });

  // Check if response contains a screenshot file path
  const screenshotMatch = response.match(/Screenshot saved: ([^\n]+)/);
  if (screenshotMatch && screenshotMatch[1]) {
    const screenshotPath = screenshotMatch[1].trim();
    // Send screenshot as photo via Telegram
    try {
      if (existsSync(screenshotPath)) {
        const photoBuffer = readFileSync(screenshotPath);
        const caption = "📸 Here's the screenshot!";

        // Use telegramBot to send photo
        const sent = await telegramBot.sendPhoto(channelId, chatId, photoBuffer, caption, "Markdown");
        if (sent) {
          console.log(`[Telegram] Screenshot sent as photo: ${screenshotPath}`);
          return; // Photo sent successfully, no need to send text
        }
      }
    } catch (photoError) {
      console.error("[Telegram] Failed to send screenshot as photo:", photoError);
    }
  }

  // Escape special characters for Telegram Markdown
  const escapedResponse = escapeTelegramMarkdown(response);

  // Send response
  await sendTelegramMessage(botToken, chatId, escapedResponse, {
    parse_mode: "Markdown",
    reply_to_message_id: message.message_id,
  });
}

// Download file from Telegram and save to media store
async function downloadTelegramMedia(
  botToken: string,
  fileId: string,
  type: string,
  originalFileName?: string
): Promise<{ path: string; contentType?: string; placeholder: string } | null> {
  try {
    // Get file path from Telegram using getFile API
    const fileInfo = await telegramApi(botToken, "getFile", { file_id: fileId });
    const fileResult = fileInfo.result as { file_path?: string } | undefined;
    if (!fileResult?.file_path) {
      console.error(`[Telegram] Failed to get file path for ${type}`);
      return null;
    }

    const telegramFilePath = fileResult.file_path;

    // Download file from Telegram
    const fileUrl = `https://api.telegram.org/file/bot${botToken}/${telegramFilePath}`;
    const response = await fetch(fileUrl);

    if (!response.ok || !response.body) {
      console.error(`[Telegram] Failed to download ${type}: ${response.statusText}`);
      return null;
    }

    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // Determine content type from response headers
    let contentType = response.headers.get("content-type") || undefined;

    // Map Telegram file type to placeholder and content type
    let placeholder = "<media:document>";
    switch (type) {
      case "photo":
        placeholder = "<media:image>";
        contentType = contentType || "image/jpeg";
        break;
      case "video":
        placeholder = "<media:video>";
        contentType = contentType || "video/mp4";
        break;
      case "audio":
        placeholder = "<media:audio>";
        contentType = contentType || "audio/mpeg";
        break;
      case "sticker":
        placeholder = "<media:sticker>";
        contentType = contentType || "image/webp";
        break;
      default:
        contentType = contentType || "application/octet-stream";
    }

    // Create media directory
    const mediaDir = path.join(process.cwd(), "media", "inbound");
    if (!existsSync(mediaDir)) {
      mkdirSync(mediaDir, { recursive: true, mode: 0o700 });
    }

    // Generate unique filename
    const timestamp = Date.now();
    const ext = path.extname(telegramFilePath) || getExtensionForMime(contentType) || ".bin";
    const fileName = `${type}-${timestamp}${ext}`;
    const localPath = path.join(mediaDir, fileName);

    // Save file
    writeFileSync(localPath, buffer, { mode: 0o600 });

    console.log(`[Telegram] Downloaded ${type} to: ${localPath}`);

    return {
      path: localPath,
      contentType,
      placeholder,
    };
  } catch (error) {
    console.error(`[Telegram] Error downloading ${type}:`, error);
    return null;
  }
}

// Get file extension from MIME type
function getExtensionForMime(mimeType?: string): string {
  if (!mimeType) return "";
  const mimeToExt: Record<string, string> = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/gif": ".gif",
    "image/webp": ".webp",
    "video/mp4": ".mp4",
    "video/webm": ".webm",
    "audio/mpeg": ".mp3",
    "audio/ogg": ".ogg",
    "audio/wav": ".wav",
    "application/pdf": ".pdf",
  };
  return mimeToExt[mimeType.split(";")[0].trim()] || "";
}

// Handle callback queries from inline keyboards
async function handleTelegramCallbackQuery(
  callbackQuery: TelegramUpdate["callback_query"],
  channelId: string,
  botToken: string,
  _messageHandler: MessageHandler
): Promise<void> {
  if (!callbackQuery) return;

  const chatId = callbackQuery.message?.chat.id;
  if (!chatId) return;

  // Answer the callback query to remove loading state
  await telegramApi(botToken, "answerCallbackQuery", {
    callback_query_id: callbackQuery.id,
  });

  // Handle specific callback data
  const data = callbackQuery.data;
  let response: string;

  switch (data) {
    case "status":
      response = await handleTelegramCommand(
        "status",
        [],
        { update_id: 0 } as TelegramUpdate,
        channelId,
        async () => "",
        chatId
      );
      break;
    case "agents":
      response = await handleTelegramCommand(
        "agents",
        [],
        { update_id: 0 } as TelegramUpdate,
        channelId,
        async () => "",
        chatId
      );
      break;
    case "help":
      response = await handleTelegramCommand(
        "help",
        [],
        { update_id: 0 } as TelegramUpdate,
        channelId,
        async () => "",
        chatId
      );
      break;
    default:
      response = `You clicked: ${data}`;
  }

  await sendTelegramMessage(botToken, chatId, escapeTelegramMarkdown(response), {
    parse_mode: "Markdown",
  });
}

// Process webhook updates from Telegram
export async function processTelegramWebhook(
  channelId: string,
  update: Record<string, unknown>
): Promise<boolean> {
  try {
    const channel = tables.channels.get(channelId) as { type?: string; config?: unknown } | null;
    if (!channel || channel.type !== "telegram") {
      console.error(`[Telegram Webhook] Channel ${channelId} not found or not telegram type`);
      return false;
    }

    const config =
      typeof channel.config === "string"
        ? JSON.parse(channel.config)
        : (channel.config as Record<string, unknown>);
    const botToken = config.bot_token;
    if (!botToken) {
      console.error(`[Telegram Webhook] No bot token for channel ${channelId}`);
      return false;
    }

    // Get the message handler from the global telegramBot instance
    const messageHandler = telegramBot.getMessageHandler();

    await processTelegramUpdate(
      update as unknown as TelegramUpdate,
      channelId,
      botToken,
      messageHandler
    );
    return true;
  } catch (error) {
    console.error("[Telegram Webhook] Error processing update:", error);
    return false;
  }
}

// Escape special Markdown characters for Telegram
function escapeTelegramMarkdown(text: string): string {
  // If text contains our intentional markdown formatting, don't escape it
  // This handles responses that already have *bold*, _italic_, `code`, etc.
  const hasIntentionalMarkdown = /(\*[^*]+\*|_[^_]+_|`[^`]+`)/.test(text);
  if (hasIntentionalMarkdown) {
    return text;
  }
  // Minimal escaping - only characters that would break Telegram Markdown
  return text.replace(/\[/g, "\\[").replace(/\]/g, "\\]");
}

// Telegram Bot Manager - Webhook for public URLs, Polling for localhost
class TelegramBotManager {
  private bots: Map<
    string,
    { token: string; channelId: string; mode: "webhook" | "polling"; pollingTimer?: ReturnType<typeof setTimeout> }
  > = new Map();
  private messageHandler: MessageHandler = async () => "No handler configured";

  setMessageHandler(handler: MessageHandler) {
    this.messageHandler = handler;
  }

  getMessageHandler(): MessageHandler {
    return this.messageHandler;
  }

  async start(channelId: string, botToken: string, webhookUrl?: string): Promise<boolean> {
    // Verify bot token
    const botInfo = await getTelegramBotInfo(botToken);
    if (!botInfo) {
      console.error("[Telegram] Invalid bot token");
      return false;
    }

    console.log(`[Telegram] Starting bot @${botInfo.username}`);

    // Register commands
    await registerTelegramCommands(botToken);

    // Determine mode: webhook for public URLs, polling for localhost
    const isLocalhost = !webhookUrl || webhookUrl.includes("localhost") || webhookUrl.includes("127.0.0.1");

    if (isLocalhost) {
      // Use polling for localhost
      console.log("[Telegram] Localhost detected - using polling mode");

      // Delete any existing webhook to ensure polling works
      await deleteTelegramWebhook(botToken);

      // Start polling
      this.bots.set(channelId, { token: botToken, channelId, mode: "polling" });
      this.startPolling(channelId, botToken);
    } else {
      // Use webhook for public URLs
      console.log(`[Telegram] Setting up webhook: ${webhookUrl}`);

      // Delete existing webhook and set new one
      await deleteTelegramWebhook(botToken);
      const success = await setupTelegramWebhook(botToken, webhookUrl);

      if (success) {
        console.log(`[Telegram] Webhook configured: ${webhookUrl}`);
        this.bots.set(channelId, { token: botToken, channelId, mode: "webhook" });
      } else {
        console.error("[Telegram] Webhook setup failed");
        return false;
      }
    }

    return true;
  }

  private startPolling(channelId: string, botToken: string) {
    let offset = 0;

    const poll = async () => {
      const bot = this.bots.get(channelId);
      // Stop if bot was removed or mode changed
      if (!bot || bot.mode !== "polling") return;

      try {
        const result = await telegramApi(botToken, "getUpdates", {
          offset,
          timeout: 30,
          allowed_updates: ["message", "callback_query"],
        });

        if (result.ok && result.result) {
          for (const update of result.result as TelegramUpdate[]) {
            offset = update.update_id + 1;
            await processTelegramUpdate(update, channelId, botToken, this.messageHandler);
          }
        }
      } catch (error) {
        console.error("[Telegram] Polling error:", error);
      }

      // Continue polling only if still in polling mode
      const currentBot = this.bots.get(channelId);
      if (currentBot && currentBot.mode === "polling") {
        currentBot.pollingTimer = setTimeout(poll, 1000);
      }
    };

    console.log("[Telegram] Starting long polling...");
    poll();
  }

  stop(channelId: string): boolean {
    const bot = this.bots.get(channelId);
    if (!bot) return false;

    // Clean up based on mode
    if (bot.mode === "polling" && bot.pollingTimer) {
      clearTimeout(bot.pollingTimer);
    }
    if (bot.mode === "webhook") {
      deleteTelegramWebhook(bot.token).catch(() => { });
    }

    this.bots.delete(channelId);
    return true;
  }

  async sendMessage(channelId: string, chatId: number | string, text: string): Promise<boolean> {
    const bot = this.bots.get(channelId);
    if (!bot) return false;

    return sendTelegramMessage(bot.token, chatId, text);
  }

  // Send photo to Telegram chat (OpenClaw-compatible with duplex for Node 22+)
  async sendPhoto(
    channelId: string,
    chatId: number | string,
    photo: string | Buffer,
    caption?: string,
    parseMode: "Markdown" | "HTML" | undefined = "Markdown"
  ): Promise<boolean> {
    const bot = this.bots.get(channelId);
    if (!bot) {
      console.error("[Telegram] sendPhoto: No bot found for channel", channelId);
      return false;
    }

    try {
      // If photo is a local file path, read it
      if (typeof photo === "string" && existsSync(photo)) {

        const photoBuffer = readFileSync(photo);
        // For file uploads, we need to use multipart/form-data
        const formData = new FormData();
        formData.append("chat_id", String(chatId));
        formData.append("photo", new Blob([photoBuffer]), path.basename(photo));
        if (caption) {
          formData.append("caption", caption);
          if (parseMode) formData.append("parse_mode", parseMode);
        }

        // duplex: 'half' required for Node 22+ / Bun (OpenClaw fix)
        const response = await fetch(
          `https://api.telegram.org/bot${bot.token}/sendPhoto`,
          { method: "POST", body: formData, duplex: "half" } as RequestInit
        );
        const result = await response.json() as { ok: boolean; description?: string };
        if (!result.ok) {
          console.error("[Telegram] sendPhoto failed:", result.description);
        }
        return result.ok === true;
      } else if (typeof photo === "string") {
        // URL or file_id
        const result = await telegramApi(bot.token, "sendPhoto", {
          chat_id: chatId,
          photo,
          caption,
          parse_mode: parseMode,
        });
        return result.ok === true;
      } else {
        // Buffer
        const formData = new FormData();
        formData.append("chat_id", String(chatId));
        formData.append("photo", new Blob([photo]), "image.png");
        if (caption) {
          formData.append("caption", caption);
          if (parseMode) formData.append("parse_mode", parseMode);
        }

        const response = await fetch(
          `https://api.telegram.org/bot${bot.token}/sendPhoto`,
          { method: "POST", body: formData, duplex: "half" } as RequestInit
        );
        const result = await response.json() as { ok: boolean; description?: string };
        if (!result.ok) {
          console.error("[Telegram] sendPhoto failed:", result.description);
        }
        return result.ok === true;
      }
    } catch (error) {
      console.error("[Telegram] Failed to send photo:", error);
      return false;
    }
  }

  // Send document/file to Telegram chat (OpenClaw-compatible)
  async sendDocument(
    channelId: string,
    chatId: number | string,
    document: string | Buffer,
    caption?: string,
    filename?: string,
    parseMode: "Markdown" | "HTML" | undefined = "Markdown"
  ): Promise<boolean> {
    const bot = this.bots.get(channelId);
    if (!bot) {
      console.error("[Telegram] sendDocument: No bot found for channel", channelId);
      return false;
    }

    try {
      if (typeof document === "string" && existsSync(document)) {

        const docBuffer = readFileSync(document);
        const formData = new FormData();
        formData.append("chat_id", String(chatId));
        formData.append("document", new Blob([docBuffer]), path.basename(document));
        if (caption) {
          formData.append("caption", caption);
          if (parseMode) formData.append("parse_mode", parseMode);
        }

        const response = await fetch(
          `https://api.telegram.org/bot${bot.token}/sendDocument`,
          { method: "POST", body: formData, duplex: "half" } as RequestInit
        );
        const result = await response.json() as { ok: boolean; description?: string };
        if (!result.ok) console.error("[Telegram] sendDocument failed:", result.description);
        return result.ok === true;
      } else if (typeof document === "string") {
        // URL or file_id
        const result = await telegramApi(bot.token, "sendDocument", {
          chat_id: chatId,
          document,
          caption,
          parse_mode: parseMode,
        });
        return result.ok === true;
      } else {
        // Buffer
        const formData = new FormData();
        formData.append("chat_id", String(chatId));
        formData.append("document", new Blob([document]), filename || "file");
        if (caption) {
          formData.append("caption", caption);
          if (parseMode) formData.append("parse_mode", parseMode);
        }

        const response = await fetch(
          `https://api.telegram.org/bot${bot.token}/sendDocument`,
          { method: "POST", body: formData, duplex: "half" } as RequestInit
        );
        const result = await response.json() as { ok: boolean; description?: string };
        if (!result.ok) console.error("[Telegram] sendDocument failed:", result.description);
        return result.ok === true;
      }
    } catch (error) {
      console.error("[Telegram] Failed to send document:", error);
      return false;
    }
  }

  // Send video to Telegram chat
  async sendVideo(
    channelId: string,
    chatId: number | string,
    video: string | Buffer,
    caption?: string,
    parseMode: "Markdown" | "HTML" | undefined = "Markdown"
  ): Promise<boolean> {
    const bot = this.bots.get(channelId);
    if (!bot) {
      console.error("[Telegram] sendVideo: No bot found for channel", channelId);
      return false;
    }

    try {
      if (typeof video === "string" && existsSync(video)) {

        const videoBuffer = readFileSync(video);
        const formData = new FormData();
        formData.append("chat_id", String(chatId));
        formData.append("video", new Blob([videoBuffer]), path.basename(video));
        if (caption) {
          formData.append("caption", caption);
          if (parseMode) formData.append("parse_mode", parseMode);
        }

        const response = await fetch(
          `https://api.telegram.org/bot${bot.token}/sendVideo`,
          { method: "POST", body: formData, duplex: "half" } as RequestInit
        );
        const result = await response.json() as { ok: boolean; description?: string };
        if (!result.ok) console.error("[Telegram] sendVideo failed:", result.description);
        return result.ok === true;
      } else if (typeof video === "string") {
        // URL
        const result = await telegramApi(bot.token, "sendVideo", {
          chat_id: chatId,
          video,
          caption,
          parse_mode: parseMode,
        });
        return result.ok === true;
      } else {
        // Buffer
        const formData = new FormData();
        formData.append("chat_id", String(chatId));
        formData.append("video", new Blob([video]), "video.mp4");
        if (caption) {
          formData.append("caption", caption);
          if (parseMode) formData.append("parse_mode", parseMode);
        }

        const response = await fetch(
          `https://api.telegram.org/bot${bot.token}/sendVideo`,
          { method: "POST", body: formData, duplex: "half" } as RequestInit
        );
        const result = await response.json() as { ok: boolean; description?: string };
        if (!result.ok) console.error("[Telegram] sendVideo failed:", result.description);
        return result.ok === true;
      }
    } catch (error) {
      console.error("[Telegram] Failed to send video:", error);
      return false;
    }
  }

  isRunning(channelId: string): boolean {
    return this.bots.has(channelId);
  }
}

export const telegramBot = new TelegramBotManager();

// Channel Manager
class ChannelManager {
  list(): (Channel & { info?: (typeof channels)[ChannelType] })[] {
    const all = tables.channels.all() as Channel[];
    return all.map((c) => ({
      ...c,
      config: {}, // Don't expose sensitive config
      info: channels[c.type as ChannelType],
    }));
  }

  get(id: string): Channel | undefined {
    return tables.channels.get(id) as Channel | undefined;
  }

  create(type: ChannelType, name: string, config: Record<string, unknown>): Channel {
    const id = crypto.randomUUID();
    tables.channels.create({ id, type, name, config, enabled: true });

    // If it's a Telegram channel, start the bot
    if (type === "telegram" && config.bot_token) {
      this.startTelegramBot(
        id,
        config.bot_token as string,
        config.webhook_url as string | undefined
      );
    }

    return { id, type, name, config, enabled: true };
  }

  private async startTelegramBot(channelId: string, botToken: string, webhookUrl?: string) {
    try {
      await telegramBot.start(channelId, botToken, webhookUrl);
      console.log(`[Channel] Started Telegram bot for channel ${channelId}`);

      // If using webhook mode, log the webhook URL
      if (webhookUrl) {
        console.log(`[Channel] Telegram webhook URL: ${webhookUrl}`);
      }
    } catch (error) {
      console.error(`[Channel] Failed to start Telegram bot:`, error);
    }
  }

  // Auto-setup Telegram with bot token
  async setupTelegram(botToken: string, baseUrl: string): Promise<Channel | null> {
    // Check if Telegram channel already exists
    const existing = (tables.channels.all() as Channel[]).find((c) => c.type === "telegram");
    if (existing) {
      console.log("[Channel] Telegram channel already exists, updating config");
      const config = {
        bot_token: botToken,
        webhook_url: `${baseUrl}/api/webhooks/telegram/${existing.id}`,
      };
      this.update(existing.id, { config });

      // Only start bot if not already running
      if (!telegramBot.isRunning(existing.id)) {
        await this.startTelegramBot(existing.id, botToken, config.webhook_url);
      } else {
        console.log("[Channel] Telegram bot already running, skipping restart");
      }
      return { ...existing, config };
    }

    // Create new Telegram channel
    const id = crypto.randomUUID();
    const webhookUrl = `${baseUrl}/api/webhooks/telegram/${id}`;
    const config = { bot_token: botToken, webhook_url: webhookUrl };

    tables.channels.create({ id, type: "telegram", name: "Telegram Bot", config, enabled: true });
    await this.startTelegramBot(id, botToken, webhookUrl);

    console.log(`[Channel] Created Telegram channel: ${id}`);
    return { id, type: "telegram", name: "Telegram Bot", config, enabled: true };
  }

  update(id: string, updates: Partial<Pick<Channel, "name" | "config" | "enabled">>): boolean {
    const existing = this.get(id);
    if (!existing) return false;
    tables.channels.update(id, updates);
    return true;
  }

  delete(id: string): boolean {
    // Stop bot if running
    telegramBot.stop(id);

    const result = tables.channels.delete(id);
    return result.changes > 0;
  }

  getStats(): { total: number; enabled: number } {
    const all = this.list();
    return {
      total: all.length,
      enabled: all.filter((c) => c.enabled).length,
    };
  }

  // Initialize all channels on startup
  async initializeAll(): Promise<void> {
    const all = tables.channels.all() as Channel[];

    for (const channel of all) {
      if (!channel.enabled) continue;

      if (channel.type === "telegram") {
        const config =
          typeof channel.config === "string" ? JSON.parse(channel.config) : channel.config;
        if (config.bot_token) {
          await this.startTelegramBot(channel.id, config.bot_token, config.webhook_url);
        }
      }
    }
  }

  // Format chat response for a specific channel
  formatChatResponse(
    response: {
      content: string;
      thinking?: string;
      tool_calls?: Array<{
        id?: string;
        name: string;
        status: string;
        result?: unknown;
        error?: string;
        duration?: number;
      }>;
    },
    channelType: ChannelType
  ): string {
    let text = response.content;

    // Add tool calls first (they happened before the response)
    if (response.tool_calls && response.tool_calls.length > 0) {
      if (channelType === "telegram") {
        const toolSection = formatToolCallsForTelegram(response.tool_calls);
        text = toolSection + "\n\n" + text;
      } else if (channelType === "discord") {
        const toolSection = formatToolCallsForDiscord(response.tool_calls);
        text = toolSection + "\n\n" + text;
      } else {
        text = formatToolCallsPlain(response.tool_calls) + "\n\n" + text;
      }
    }

    // Add thinking tags (collapsible where supported)
    if (response.thinking) {
      if (channelType === "telegram") {
        // Telegram: use spoiler or collapsed format
        const thinkingPreview =
          response.thinking.length > 100
            ? response.thinking.substring(0, 100) + "..."
            : response.thinking;
        text += `\n\n💭 _${escapeMarkdown(thinkingPreview)}_`;
      } else if (channelType === "discord") {
        // Discord: use spoiler tags
        text += `\n\n💭 ||${response.thinking}||`;
      } else {
        text += `\n\n💭 Thinking: ${response.thinking}`;
      }
    }

    return text;
  }
}

// Format tool calls for Telegram
function formatToolCallsForTelegram(
  toolCalls: Array<{
    name: string;
    status: string;
    result?: unknown;
    error?: string;
    duration?: number;
  }>
): string {
  if (toolCalls.length === 0) return "";

  let text = "🛠️ *Tool Execution:*\n";

  for (const tc of toolCalls) {
    const statusIcon = tc.status === "completed" ? "✅" : tc.status === "failed" ? "❌" : "⏳";
    const duration = tc.duration ? ` (${tc.duration}ms)` : "";
    text += `\n${statusIcon} \`${tc.name}\`${duration}`;

    if (tc.error) {
      text += `\n   ⚠️ _${escapeMarkdown(tc.error.substring(0, 100))}_`;
    } else if (tc.result) {
      const resultStr = typeof tc.result === "string" ? tc.result : JSON.stringify(tc.result);
      const preview = resultStr.length > 80 ? resultStr.substring(0, 80) + "..." : resultStr;
      text += `\n   → \`${escapeMarkdown(preview)}\``;
    }
  }

  return text;
}

// Format tool calls for Discord
function formatToolCallsForDiscord(
  toolCalls: Array<{
    name: string;
    status: string;
    result?: unknown;
    error?: string;
    duration?: number;
  }>
): string {
  if (toolCalls.length === 0) return "";

  let text = "🛠️ **Tool Execution:**\n";

  for (const tc of toolCalls) {
    const statusIcon = tc.status === "completed" ? "✅" : tc.status === "failed" ? "❌" : "⏳";
    const duration = tc.duration ? ` (${tc.duration}ms)` : "";
    text += `\n${statusIcon} \`${tc.name}\`${duration}`;

    if (tc.error) {
      text += `\n   ⚠️ *${tc.error.substring(0, 100)}*`;
    } else if (tc.result) {
      const resultStr = typeof tc.result === "string" ? tc.result : JSON.stringify(tc.result);
      const preview = resultStr.length > 100 ? resultStr.substring(0, 100) + "..." : resultStr;
      text += `\n   → \`\`\`${preview}\`\`\``;
    }
  }

  return text;
}

// Format tool calls for plain text
function formatToolCallsPlain(
  toolCalls: Array<{
    name: string;
    status: string;
    result?: unknown;
    error?: string;
    duration?: number;
  }>
): string {
  if (toolCalls.length === 0) return "";

  let text = "🛠️ Tool Execution:\n";

  for (const tc of toolCalls) {
    const statusIcon = tc.status === "completed" ? "✅" : tc.status === "failed" ? "❌" : "⏳";
    const duration = tc.duration ? ` (${tc.duration}ms)` : "";
    text += `\n${statusIcon} ${tc.name}${duration}`;

    if (tc.error) {
      text += `\n   ⚠️ Error: ${tc.error.substring(0, 100)}`;
    } else if (tc.result) {
      const resultStr = typeof tc.result === "string" ? tc.result : JSON.stringify(tc.result);
      const preview = resultStr.length > 100 ? resultStr.substring(0, 100) + "..." : resultStr;
      text += `\n   → ${preview}`;
    }
  }

  return text;
}

// Escape markdown special characters (minimal escaping to avoid breaking formatting)
function escapeMarkdown(text: string): string {
  // Only escape characters that would break Telegram Markdown
  // Don't escape if text is already short/simple
  if (text.length < 50 && !/[[\]()*_`]/.test(text)) {
    return text;
  }
  // Minimal escaping - only escape what's necessary
  return text.replace(/\[/g, "\\[").replace(/\]/g, "\\]");
}

export const channelManager = new ChannelManager();
