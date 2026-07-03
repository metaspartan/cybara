import { existsSync, mkdirSync, writeFileSync, readFileSync } from "fs";
import path from "path";
import { tables } from "../../database";
import { logChannelMessage } from "../../logging";
import type {
  ChannelAdapter,
  MessageHandlerFileInfo,
  ToolCallInfo,
  ChannelEmbed,
  InlineKeyboardButton,
} from "../types";
import { formatToolCallsForTelegram, escapeMarkdown } from "../formatting";
import { buildChannelSecurityConfig, securityManager } from "../security";
import { getTelegramInboundMediaDir } from "../paths";

import { handleChannelManagementCommand } from "../commands";
import {
  getChannelRuntimeMemoryContext,
  listChannelRuntimeMemoryFiles,
  listChannelRuntimeSessions,
  listChannelRuntimeTools,
  searchChannelRuntimeMemory,
  sendChannelRuntimeMessage,
} from "../chat-runtime";

/** Escape text for Telegram HTML parse mode. */
function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export const telegramSessions = new Map<string, string>();
const telegramUserSessionHistory = new Map<string, string[]>();
const telegramSessionLastActive = new Map<string, string>();
const MAX_TRACKED_TELEGRAM_SESSIONS_PER_USER = 25;

function resolveTelegramUserKey(chatId: number | string, fromUserId?: number | string): string {
  return String(fromUserId ?? chatId);
}

function rememberTelegramUserSession(
  userKey: string,
  sessionId: string,
  lastActive = new Date().toISOString()
): void {
  telegramSessionLastActive.set(sessionId, lastActive);
  const current = telegramUserSessionHistory.get(userKey) || [];
  const next = [sessionId, ...current.filter((existingId) => existingId !== sessionId)].slice(
    0,
    MAX_TRACKED_TELEGRAM_SESSIONS_PER_USER
  );
  telegramUserSessionHistory.set(userKey, next);
}

function setTelegramChatSession(
  chatId: number | string,
  sessionId: string,
  userKey?: string,
  lastActive?: string
): void {
  telegramSessions.set(String(chatId), sessionId);
  if (userKey) {
    rememberTelegramUserSession(userKey, sessionId, lastActive);
  }
}

async function getUserSessions(
  userId: string
): Promise<Array<{ id: string; messageCount: number; lastActive: string }>> {
  const allSessions = await listChannelRuntimeSessions();
  const runtimeById = new Map(allSessions.map((session) => [session.id, session]));
  const trackedSessionIds = telegramUserSessionHistory.get(userId) || [];

  const sessions = trackedSessionIds.map((sessionId) => {
    const runtime = runtimeById.get(sessionId);
    if (runtime) {
      return {
        id: runtime.id,
        messageCount: runtime.messageCount,
        lastActive: runtime.createdAt,
      };
    }

    return {
      id: sessionId,
      messageCount: 0,
      lastActive: telegramSessionLastActive.get(sessionId) || new Date(0).toISOString(),
    };
  });

  sessions.sort((a, b) => new Date(b.lastActive).getTime() - new Date(a.lastActive).getTime());
  return sessions.slice(0, 10);
}

export function resetTelegramSessionTrackingForTests(): void {
  telegramSessions.clear();
  telegramUserSessionHistory.clear();
  telegramSessionLastActive.clear();
}

interface TelegramBotCommand {
  command: string;
  description: string;
}

type TelegramReactionNotificationScope = "off" | "all" | "private" | "groups";

type TelegramReactionType = {
  type?: string;
  emoji?: string;
  custom_emoji_id?: string;
};

type TelegramOutboundReaction = {
  type: "emoji" | "custom_emoji";
  emoji?: string;
  custom_emoji_id?: string;
};

const TELEGRAM_COMMANDS: TelegramBotCommand[] = [
  { command: "start", description: "Start interacting with the bot" },
  { command: "help", description: "Show available commands and usage" },
  { command: "new", description: "Start a new conversation session" },
  { command: "workspace", description: "Show or set workspace - /workspace <path>" },
  { command: "agents", description: "List available agents" },
  { command: "agent", description: "Show or switch default agent - /agent <id|name|number>" },
  { command: "status", description: "Check bot and agent status" },
  { command: "metrics", description: "Show token usage and statistics" },
  { command: "providers", description: "List configured providers" },
  { command: "provider", description: "Show or switch provider - /provider <id|name|number>" },
  { command: "models", description: "List models for the current provider" },
  { command: "model", description: "Show or switch model - /model <id|number>" },
  { command: "permissions", description: "Show or set tool approvals - /permissions <ask|allow>" },
  { command: "switch", description: "Switch to a previous session - /switch <number>" },
  { command: "sessions", description: "List and manage chat sessions" },
  { command: "memory", description: "Show recent memories/context" },
  { command: "tools", description: "List available tools" },
  { command: "cancel", description: "Cancel current operation" },
];

async function telegramApi(
  botToken: string,
  method: string,
  body?: Record<string, unknown>,
  retryCount = 0
): Promise<{ ok: boolean; result?: unknown }> {
  const url = `https://api.telegram.org/bot${botToken}/${method}`;
  const response = await fetch(url, {
    method: body ? "POST" : "GET",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = (await response.json()) as {
    ok: boolean;
    result?: unknown;
    error_code?: number;
    parameters?: { retry_after?: number };
    description?: string;
  };

  // Rate-limit handling: on 429, wait retry_after and retry (up to 3 times).
  if (
    !data.ok &&
    data.error_code === 429 &&
    typeof data.parameters?.retry_after === "number" &&
    retryCount < 3
  ) {
    const retryAfterMs = Math.ceil(data.parameters.retry_after) * 1000;
    console.warn(
      `[Telegram] Rate limited on ${method}, retrying after ${retryAfterMs}ms (attempt ${retryCount + 1}/3)`
    );
    await new Promise((resolve) => setTimeout(resolve, retryAfterMs));
    return telegramApi(botToken, method, body, retryCount + 1);
  }

  return data as { ok: boolean; result?: unknown };
}

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

async function getTelegramBotInfo(
  botToken: string
): Promise<{ id: number; username: string; first_name: string } | null> {
  try {
    const result = await telegramApi(botToken, "getMe");
    if (result.ok && result.result) {
      return result.result as { id: number; username: string; first_name: string };
    }
    return null;
  } catch (error) {
    console.error("[Telegram] Failed to get bot info:", error);
    return null;
  }
}

async function setupTelegramWebhook(botToken: string, webhookUrl: string): Promise<boolean> {
  try {
    const result = await telegramApi(botToken, "setWebhook", {
      url: webhookUrl,
      allowed_updates: ["message", "callback_query", "message_reaction"],
    });
    console.log("[Telegram] Webhook set:", result);
    return result.ok === true;
  } catch (error) {
    console.error("[Telegram] Failed to set webhook:", error);
    return false;
  }
}

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
  message_reaction?: {
    chat: {
      id: number;
      type: "private" | "group" | "supergroup" | "channel";
      title?: string;
      username?: string;
    };
    message_id: number;
    date: number;
    old_reaction?: TelegramReactionType[];
    new_reaction?: TelegramReactionType[];
    user?: {
      id: number;
      is_bot: boolean;
      first_name: string;
      username?: string;
    };
    actor_chat?: {
      id: number;
      type: "private" | "group" | "supergroup" | "channel";
      title?: string;
      username?: string;
    };
  };
}

interface InternalMessageHandler {
  (
    message: string,
    chatId: number | string,
    userId: number,
    channelId: string,
    fileInfo?: MessageHandlerFileInfo
  ): Promise<string>;
}

async function handleTelegramCommand(
  command: string,
  args: string[],
  update: TelegramUpdate,
  channelId: string,
  messageHandler: InternalMessageHandler,
  chatId: number,
  fromUserId?: number
): Promise<string> {
  const userKey = resolveTelegramUserKey(chatId, fromUserId);

  switch (command) {
    case "start":
      return `👋 *Welcome to Cybara!*

I'm your AI assistant powered by the Cybara Agent Platform.

• 💬 Chat naturally — just send me a message
• 🤖 Switch agents and models on the fly
• 📂 Set a workspace for file-aware conversations
• 🔧 Run tools, spawn subagents, and more

Type /help to see all commands.`;

    case "help":
      return `⚡ *Cybara Commands*

📋 *Sessions:*
/new — Start a fresh conversation
/workspace [path] — Set session workspace (~/path supported)
/workspace clear — Reset workspace to default
/sessions — List your recent sessions
/switch <number> — Switch to a previous session
/permissions [ask|allow] — Tool approval mode

🤖 *Agents & Models:*
/status — Agent, provider, and channel status
/agents — List all agents
/agent [id|name|#] — Show or switch default agent
/providers — List all providers
/provider [id|name|#] — Show or switch provider
/models — List models for current provider
/model [id|#] — Show or switch model

📊 *Info & Tools:*
/metrics — Token usage and statistics
/memory [query] — Search or view recent context
/tools — List available tools

🔧 *Advanced:*
/subagents spawn <task> — Run a one-off subagent
/cancel — Cancel current operation
/help — Show this help`;

    case "agents": {
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
      const newSessionId = crypto.randomUUID();
      setTelegramChatSession(chatId, newSessionId, userKey);
      return `🆕 *New Session Started*

Session ID: \`${newSessionId.slice(0, 8)}...\`

I'm ready for a fresh conversation. What would you like to talk about?`;
    }

    case "sessions": {
      const activeSessionId = telegramSessions.get(String(chatId)) || `telegram:${chatId}`;
      rememberTelegramUserSession(userKey, activeSessionId);

      const userSessions = await getUserSessions(userKey);
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
      const activeSessionId = telegramSessions.get(String(chatId)) || `telegram:${chatId}`;
      rememberTelegramUserSession(userKey, activeSessionId);

      const sessions = await getUserSessions(userKey);
      if (sessionNum > sessions.length) {
        return `❌ Session ${sessionNum} not found.\n\nUse /sessions to see your available sessions.`;
      }
      const targetSession = sessions[sessionNum - 1];
      setTelegramChatSession(chatId, targetSession.id, userKey);
      return `🔄 *Switched to Session ${sessionNum}*

Session ID: \`${targetSession.id.slice(0, 8)}...\`
Message count: ${targetSession.messageCount}

Continuing previous conversation...`;
    }

    case "metrics": {
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
      try {
        const query = args.join(" ").trim();

        if (query) {
          const search = await searchChannelRuntimeMemory({ query, maxResults: 5 });
          if (!search.results.length) {
            return `🧠 *Memory Search*

No matches found for: \`${query}\`

Try another query or use /memory without arguments for recent context.`;
          }

          const matches = search.results
            .slice(0, 5)
            .map((entry, index) => {
              const preview = entry.content.replace(/\s+/g, " ").trim().slice(0, 140);
              return `${index + 1}. *${entry.file}* (${Math.round(entry.score * 100)}%)\n${preview}`;
            })
            .join("\n\n");

          return `🧠 *Memory Search* (\`${search.searchMethod}\`)

Query: \`${query}\`

${matches}`;
        }

        const [context, files] = await Promise.all([
          getChannelRuntimeMemoryContext({ maxLines: 20 }),
          listChannelRuntimeMemoryFiles(),
        ]);
        const preview = context.context.trim();
        const fileList = files.files
          .slice(0, 5)
          .map((file) => `• \`${file.name}\``)
          .join("\n");

        return `🧠 *Recent Memory Context*

${preview || "_No memory context available yet._"}

*Memory files:* ${files.files.length}
${fileList || "• _none yet_"}

Use \`/memory <query>\` to search memories.`;
      } catch (error) {
        console.error("[Telegram] Memory command failed:", error);
        return `🧠 *Memory*

Memory is currently unavailable. Please try again shortly.`;
      }
    }

    case "tools": {
      const allTools = listChannelRuntimeTools();
      const toolList = allTools.slice(0, 10);

      if (toolList.length === 0) {
        return `🛠️ *Tools*

No tools available.`;
      }

      const toolsDisplay = toolList.map((t) => `• /\`${t}\``).join("\n");

      return `🛠️ *Available Tools* (${allTools.length} total)

${toolsDisplay}

Use tools in conversation by describing what you need.`;
    }

    case "cancel":
      return `❌ *Operation Cancelled*

Your request has been cancelled. I'm ready for a new command.

Use /help to see available commands.`;

    default: {
      const sharedCommandResponse = await handleChannelManagementCommand(
        `/${command}${args.length > 0 ? ` ${args.join(" ")}` : ""}`,
        {
          channelId,
          chatId,
          platform: "telegram",
          sessionId: telegramSessions.get(chatId.toString()) || `telegram:${chatId}`,
          createSessionId: () => crypto.randomUUID(),
          setSessionId: (sessionId: string) => {
            setTelegramChatSession(chatId, sessionId, userKey);
          },
        }
      );
      if (sharedCommandResponse) {
        return sharedCommandResponse;
      }
      return `❓ Unknown command: /${command}\n\nUse /help to see available commands.`;
    }
  }
}

async function downloadTelegramMedia(
  botToken: string,
  fileId: string,
  type: string,
  _originalFileName?: string
): Promise<{ path: string; contentType?: string; placeholder: string } | null> {
  try {
    const fileInfo = await telegramApi(botToken, "getFile", { file_id: fileId });
    const fileResult = fileInfo.result as { file_path?: string } | undefined;
    if (!fileResult?.file_path) {
      console.error(`[Telegram] Failed to get file path for ${type}`);
      return null;
    }

    const telegramFilePath = fileResult.file_path;
    const fileUrl = `https://api.telegram.org/file/bot${botToken}/${telegramFilePath}`;
    const response = await fetch(fileUrl);

    if (!response.ok || !response.body) {
      console.error(`[Telegram] Failed to download ${type}: ${response.statusText}`);
      return null;
    }

    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    let contentType = response.headers.get("content-type") || undefined;
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

    const mediaDir = getTelegramInboundMediaDir();
    if (!existsSync(mediaDir)) {
      mkdirSync(mediaDir, { recursive: true, mode: 0o700 });
    }

    const timestamp = Date.now();
    const ext = path.extname(telegramFilePath) || getExtensionForMime(contentType) || ".bin";
    const fileName = `${type}-${timestamp}${ext}`;
    const localPath = path.join(mediaDir, fileName);

    writeFileSync(localPath, buffer, { mode: 0o600 });
    console.log(`[Telegram] Downloaded ${type} to: ${localPath}`);

    return { path: localPath, contentType, placeholder };
  } catch (error) {
    console.error(`[Telegram] Error downloading ${type}:`, error);
    return null;
  }
}

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

function escapeTelegramMarkdown(text: string): string {
  const hasIntentionalMarkdown = /(\*[^*]+\*|_[^_]+_|`[^`]+`)/.test(text);
  if (hasIntentionalMarkdown) {
    return text;
  }
  return text.replace(/\[/g, "\\[").replace(/\]/g, "\\]");
}

function parseStoredTelegramConfig(config: unknown, channelId?: string): Record<string, unknown> {
  if (typeof config === "string") {
    try {
      const parsed = JSON.parse(config);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
      return {};
    } catch {
      console.warn(
        `[Telegram Webhook] Invalid channel config JSON${channelId ? ` for ${channelId}` : ""}; using empty config`
      );
      return {};
    }
  }

  if (config && typeof config === "object" && !Array.isArray(config)) {
    return config as Record<string, unknown>;
  }

  return {};
}

function normalizeTelegramReactionScope(value: unknown): TelegramReactionNotificationScope {
  if (value === "all" || value === "private" || value === "groups") {
    return value;
  }
  return "off";
}

function shouldNotifyTelegramReactions(
  scope: TelegramReactionNotificationScope,
  chatType: "private" | "group" | "supergroup" | "channel"
): boolean {
  if (scope === "off") return false;
  if (scope === "all") return true;
  if (scope === "private") return chatType === "private";
  if (scope === "groups") return chatType === "group" || chatType === "supergroup";
  return false;
}

function formatTelegramReactionList(reactions: TelegramReactionType[] | undefined): string {
  if (!Array.isArray(reactions) || reactions.length === 0) return "none";
  return reactions
    .map((reaction) => {
      if (typeof reaction.emoji === "string" && reaction.emoji.trim()) return reaction.emoji;
      if (typeof reaction.custom_emoji_id === "string" && reaction.custom_emoji_id.trim()) {
        return `custom:${reaction.custom_emoji_id}`;
      }
      return reaction.type || "unknown";
    })
    .join(", ");
}

export class TelegramBotManager implements ChannelAdapter {
  type = "telegram" as const;
  name = "Telegram";

  private bots: Map<
    string,
    {
      token: string;
      channelId: string;
      mode: "webhook" | "polling";
      pollingTimer?: ReturnType<typeof setTimeout>;
    }
  > = new Map();
  private reactionScopes: Map<string, TelegramReactionNotificationScope> = new Map();
  private messageHandler: InternalMessageHandler = async () => "No handler configured";
  private typingRefreshMs = 4000;

  setMessageHandler(handler: InternalMessageHandler) {
    this.messageHandler = handler;
  }

  getMessageHandler(): InternalMessageHandler {
    return this.messageHandler;
  }

  async start(channelId: string, config: Record<string, unknown>): Promise<void> {
    const botToken = config.bot_token as string;
    const webhookUrl = config.webhook_url as string | undefined;
    const reactionScope = normalizeTelegramReactionScope(config.reaction_notifications);

    if (!botToken) {
      throw new Error("bot_token is required");
    }

    const botInfo = await getTelegramBotInfo(botToken);
    if (!botInfo) {
      throw new Error("Invalid bot token");
    }

    console.log(`[Telegram] Starting bot @${botInfo.username}`);
    await registerTelegramCommands(botToken);

    securityManager.setConfig(channelId, buildChannelSecurityConfig(config));
    this.reactionScopes.set(channelId, reactionScope);

    const isLocalhost =
      !webhookUrl || webhookUrl.includes("localhost") || webhookUrl.includes("127.0.0.1");

    if (isLocalhost) {
      console.log("[Telegram] Localhost detected - using polling mode");
      await deleteTelegramWebhook(botToken);
      this.bots.set(channelId, { token: botToken, channelId, mode: "polling" });
      this.startPolling(channelId, botToken);
    } else {
      console.log(`[Telegram] Setting up webhook: ${webhookUrl}`);
      await deleteTelegramWebhook(botToken);
      const success = await setupTelegramWebhook(botToken, webhookUrl);
      if (success) {
        console.log(`[Telegram] Webhook configured: ${webhookUrl}`);
        this.bots.set(channelId, { token: botToken, channelId, mode: "webhook" });
      } else {
        throw new Error("Webhook setup failed");
      }
    }
  }

  private startPolling(channelId: string, botToken: string) {
    let offset = 0;

    const poll = async () => {
      const bot = this.bots.get(channelId);
      if (!bot || bot.mode !== "polling") return;

      try {
        const result = await telegramApi(botToken, "getUpdates", {
          offset,
          timeout: 30,
          allowed_updates: ["message", "callback_query", "message_reaction"],
        });

        if (result.ok && result.result) {
          for (const update of result.result as TelegramUpdate[]) {
            offset = update.update_id + 1;
            await this.processTelegramUpdate(update, channelId, botToken);
          }
        }
      } catch (error) {
        console.error("[Telegram] Polling error:", error);
      }

      const currentBot = this.bots.get(channelId);
      if (currentBot && currentBot.mode === "polling") {
        currentBot.pollingTimer = setTimeout(poll, 1000);
      }
    };

    console.log("[Telegram] Starting long polling...");
    poll();
  }

  async stop(channelId: string): Promise<void> {
    const bot = this.bots.get(channelId);
    if (!bot) return;

    if (bot.mode === "polling" && bot.pollingTimer) {
      clearTimeout(bot.pollingTimer);
    }
    if (bot.mode === "webhook") {
      await deleteTelegramWebhook(bot.token).catch(() => {});
    }

    this.bots.delete(channelId);
    this.reactionScopes.delete(channelId);
  }

  isRunning(channelId: string): boolean {
    return this.bots.has(channelId);
  }

  async sendMessage(
    channelId: string,
    chatId: string | number,
    text: string,
    options?: Record<string, unknown>
  ): Promise<boolean> {
    const bot = this.bots.get(channelId);
    if (!bot) return false;

    return sendTelegramMessage(
      bot.token,
      chatId,
      text,
      options as {
        parse_mode?: "HTML" | "Markdown" | "MarkdownV2";
        reply_to_message_id?: number;
        reply_markup?: Record<string, unknown>;
      }
    );
  }

  async editMessage(
    channelId: string,
    chatId: string | number,
    messageId: string,
    text: string,
    options?: Record<string, unknown>
  ): Promise<boolean> {
    const bot = this.bots.get(channelId);
    if (!bot) return false;
    const result = await telegramApi(bot.token, "editMessageText", {
      chat_id: chatId,
      message_id: Number(messageId),
      text,
      parse_mode: (options?.parse_mode as string) || "Markdown",
    });
    return result.ok === true;
  }

  async sendVoice(
    channelId: string,
    chatId: string | number,
    voice: string | Buffer,
    caption?: string
  ): Promise<boolean> {
    const bot = this.bots.get(channelId);
    if (!bot) return false;
    const formData = new FormData();
    formData.append("chat_id", String(chatId));
    const blob =
      typeof voice === "string"
        ? new Blob([await Bun.file(voice).arrayBuffer()])
        : new Blob([voice]);
    formData.append("voice", blob, "voice.ogg");
    if (caption) formData.append("caption", caption);
    const res = await fetch(`https://api.telegram.org/bot${bot.token}/sendVoice`, {
      method: "POST",
      body: formData,
    });
    const data = (await res.json()) as { ok: boolean };
    return data.ok === true;
  }

  async sendAudio(
    channelId: string,
    chatId: string | number,
    audio: string | Buffer,
    caption?: string
  ): Promise<boolean> {
    const bot = this.bots.get(channelId);
    if (!bot) return false;
    const formData = new FormData();
    formData.append("chat_id", String(chatId));
    const blob =
      typeof audio === "string"
        ? new Blob([await Bun.file(audio).arrayBuffer()])
        : new Blob([audio]);
    formData.append("audio", blob, "audio.mp3");
    if (caption) formData.append("caption", caption);
    const res = await fetch(`https://api.telegram.org/bot${bot.token}/sendAudio`, {
      method: "POST",
      body: formData,
    });
    const data = (await res.json()) as { ok: boolean };
    return data.ok === true;
  }

  async sendVideoNote(
    channelId: string,
    chatId: string | number,
    videoNote: string | Buffer
  ): Promise<boolean> {
    const bot = this.bots.get(channelId);
    if (!bot) return false;
    const formData = new FormData();
    formData.append("chat_id", String(chatId));
    const blob =
      typeof videoNote === "string"
        ? new Blob([await Bun.file(videoNote).arrayBuffer()])
        : new Blob([videoNote]);
    formData.append("video_note", blob, "video_note.mp4");
    const res = await fetch(`https://api.telegram.org/bot${bot.token}/sendVideoNote`, {
      method: "POST",
      body: formData,
    });
    const data = (await res.json()) as { ok: boolean };
    return data.ok === true;
  }

  async sendInlineKeyboard(
    channelId: string,
    chatId: string | number,
    text: string,
    buttons: InlineKeyboardButton[][]
  ): Promise<boolean> {
    const bot = this.bots.get(channelId);
    if (!bot) return false;
    const replyMarkup = {
      inline_keyboard: buttons.map((row) =>
        row.map((b) => ({ text: b.text, callback_data: b.callbackData, url: b.url }))
      ),
    };
    return sendTelegramMessage(bot.token, chatId, text, { reply_markup: replyMarkup });
  }

  async sendEmbed(
    channelId: string,
    chatId: string | number,
    embed: ChannelEmbed
  ): Promise<boolean> {
    const bot = this.bots.get(channelId);
    if (!bot) return false;
    // Telegram doesn't have native embeds; render as HTML-formatted text.
    const parts: string[] = [];
    if (embed.title) parts.push(`<b>${escapeHtml(embed.title)}</b>`);
    if (embed.description) parts.push(escapeHtml(embed.description));
    if (embed.fields) {
      for (const f of embed.fields) {
        parts.push(`\n<b>${escapeHtml(f.name)}</b>\n${escapeHtml(f.value)}`);
      }
    }
    if (embed.footer) parts.push(`\n<i>${escapeHtml(embed.footer)}</i>`);
    return sendTelegramMessage(bot.token, chatId, parts.join("\n"), { parse_mode: "HTML" });
  }

  private parseTelegramMessageId(messageId: string): number | null {
    const parsed = Number.parseInt(String(messageId), 10);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      return null;
    }
    return parsed;
  }

  private buildTelegramReaction(emoji: string): TelegramOutboundReaction | null {
    const trimmed = emoji.trim();
    if (!trimmed) return null;

    const customMatch = trimmed.match(/^custom:([A-Za-z0-9_-]+)$/i);
    if (customMatch) {
      return {
        type: "custom_emoji",
        custom_emoji_id: customMatch[1],
      };
    }

    return {
      type: "emoji",
      emoji: trimmed,
    };
  }

  async sendReaction(
    channelId: string,
    chatId: string | number,
    messageId: string,
    emoji: string,
    _options?: Record<string, unknown>
  ): Promise<boolean> {
    const bot = this.bots.get(channelId);
    if (!bot) {
      console.error("[Telegram] sendReaction: No bot found for channel", channelId);
      return false;
    }

    const parsedMessageId = this.parseTelegramMessageId(messageId);
    if (!parsedMessageId) {
      console.error("[Telegram] sendReaction: Invalid messageId", messageId);
      return false;
    }

    const reaction = this.buildTelegramReaction(emoji);
    if (!reaction) {
      console.error("[Telegram] sendReaction: emoji is required");
      return false;
    }

    try {
      const result = await telegramApi(bot.token, "setMessageReaction", {
        chat_id: chatId,
        message_id: parsedMessageId,
        reaction: [reaction],
      });
      return result.ok === true;
    } catch (error) {
      console.error("[Telegram] Failed to send reaction:", error);
      return false;
    }
  }

  async removeReaction(
    channelId: string,
    chatId: string | number,
    messageId: string,
    _emoji: string,
    _options?: Record<string, unknown>
  ): Promise<boolean> {
    const bot = this.bots.get(channelId);
    if (!bot) {
      console.error("[Telegram] removeReaction: No bot found for channel", channelId);
      return false;
    }

    const parsedMessageId = this.parseTelegramMessageId(messageId);
    if (!parsedMessageId) {
      console.error("[Telegram] removeReaction: Invalid messageId", messageId);
      return false;
    }

    try {
      const result = await telegramApi(bot.token, "setMessageReaction", {
        chat_id: chatId,
        message_id: parsedMessageId,
        reaction: [],
      });
      return result.ok === true;
    } catch (error) {
      console.error("[Telegram] Failed to remove reaction:", error);
      return false;
    }
  }

  formatResponse(content: string, toolCalls?: ToolCallInfo[], thinking?: string): string {
    let text = content;

    if (toolCalls && toolCalls.length > 0) {
      const toolSection = formatToolCallsForTelegram(toolCalls);
      text = toolSection + "\n\n" + text;
    }

    if (thinking) {
      const thinkingPreview = thinking.length > 100 ? thinking.substring(0, 100) + "..." : thinking;
      text += `\n\n💭 _${escapeMarkdown(thinkingPreview)}_`;
    }

    return text;
  }

  private async processTelegramUpdate(
    update: TelegramUpdate,
    channelId: string,
    botToken: string
  ): Promise<void> {
    if (update.message_reaction) {
      await this.handleMessageReactionUpdate(channelId, update.message_reaction);
      return;
    }

    if (update.callback_query) {
      await this.handleCallbackQuery(update.callback_query, channelId, botToken);
      return;
    }

    const message = update.message;
    if (!message) return;

    const chatId = message.chat.id;
    const userId = message.from.id;

    let content = "";
    let hasFile = false;
    let filePath = "";
    let fileType = "";
    let placeholder = "";

    if (message.text) {
      content = message.text.trim();
    }

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

    if (message.video?.file_id) {
      const saved = await downloadTelegramMedia(botToken, message.video.file_id, "video");
      if (saved) {
        content = saved.placeholder;
        filePath = saved.path;
        fileType = saved.contentType || "video";
        hasFile = true;
        placeholder = saved.placeholder;
      }
    }

    if (message.document?.file_id) {
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

    if (message.audio?.file_id) {
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

    if (message.voice?.file_id) {
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

    if (
      message.sticker &&
      !message.sticker.is_animated &&
      !message.sticker.is_video &&
      message.sticker.file_id
    ) {
      const saved = await downloadTelegramMedia(botToken, message.sticker.file_id, "sticker");
      if (saved) {
        if (!content) content = saved.placeholder;
        filePath = saved.path;
        fileType = "image/webp";
        hasFile = true;
        placeholder = saved.placeholder;
      }
    }

    if (!content && !hasFile) return;

    const accessCheck = securityManager.checkAccess(
      channelId,
      userId.toString(),
      "telegram",
      message.from.username || message.from.first_name,
      { isGroup: message.chat.type !== "private" }
    );

    if (!accessCheck.permitted) {
      if (accessCheck.silent) return;
      if (accessCheck.reason === "new_pairing") {
        await sendTelegramMessage(
          botToken,
          chatId,
          `🔐 *Pairing Required*\n\nYour pairing code: \`${accessCheck.code}\`\n\nPlease provide this code to the admin for approval.\nThis code expires in 1 hour.`,
          { parse_mode: "Markdown" }
        );
      } else if (accessCheck.reason === "pending_pairing") {
        await sendTelegramMessage(
          botToken,
          chatId,
          `⏳ *Pairing Pending*\n\nYour pairing request is awaiting approval.\nPlease try again after an admin approves your access.`,
          { parse_mode: "Markdown" }
        );
      } else if (accessCheck.reason === "blocked") {
        await sendTelegramMessage(
          botToken,
          chatId,
          accessCheck.message || "🚫 You are not authorized to use this bot.",
          { parse_mode: "Markdown" }
        );
      }
      // For "disabled" policy, silently ignore
      return;
    }

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

    const stopTyping = this.startTypingKeepAlive(botToken, chatId);
    let response: string;
    try {
      if (content.startsWith("/")) {
        const [commandWithBot, ...args] = content.slice(1).split(/\s+/);
        const command = commandWithBot.split("@")[0];

        response = await handleTelegramCommand(
          command,
          args,
          update,
          channelId,
          this.messageHandler,
          chatId,
          userId
        );
      } else {
        try {
          const userKey = resolveTelegramUserKey(chatId, userId);
          const activeSessionId = telegramSessions.get(String(chatId)) || `telegram:${chatId}`;
          setTelegramChatSession(chatId, activeSessionId, userKey);

          const messageWithFile = hasFile ? `${content}\n\n[File: ${filePath}]` : content;
          response = await this.messageHandler(messageWithFile, chatId, userId, channelId, {
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
    } finally {
      stopTyping();
    }

    await logChannelMessage("telegram", "outgoing", response, {
      channelId: chatId.toString(),
      metadata: { replyToMessageId: message.message_id },
    });

    const screenshotMatch = response.match(/Screenshot saved: ([^\n]+)/);
    if (screenshotMatch?.[1]) {
      const screenshotPath = screenshotMatch[1].trim();
      try {
        if (existsSync(screenshotPath)) {
          const photoBuffer = readFileSync(screenshotPath);
          const sent = await this.sendPhoto(
            channelId,
            chatId,
            photoBuffer,
            "📸 Here's the screenshot!"
          );
          if (sent) {
            console.log(`[Telegram] Screenshot sent as photo: ${screenshotPath}`);
            return;
          }
        }
      } catch (photoError) {
        console.error("[Telegram] Failed to send screenshot as photo:", photoError);
      }
    }

    const escapedResponse = escapeTelegramMarkdown(response);
    await sendTelegramMessage(botToken, chatId, escapedResponse, {
      parse_mode: "Markdown",
      reply_to_message_id: message.message_id,
    });
  }

  private startTypingKeepAlive(botToken: string, chatId: number | string): () => void {
    let stopped = false;
    const sendTyping = async () => {
      if (stopped) return;
      try {
        await telegramApi(botToken, "sendChatAction", {
          chat_id: chatId,
          action: "typing",
        });
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

  private async handleCallbackQuery(
    callbackQuery: TelegramUpdate["callback_query"],
    channelId: string,
    botToken: string
  ): Promise<void> {
    if (!callbackQuery) return;

    const chatId = callbackQuery.message?.chat.id;
    if (!chatId) return;

    await telegramApi(botToken, "answerCallbackQuery", {
      callback_query_id: callbackQuery.id,
    });

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

  private resolveReactionScope(channelId: string): TelegramReactionNotificationScope {
    const cachedScope = this.reactionScopes.get(channelId);
    if (cachedScope) return cachedScope;

    const channel = tables.channels.get(channelId) as { config?: unknown } | null;
    const parsedConfig = parseStoredTelegramConfig(channel?.config, channelId);
    const scope = normalizeTelegramReactionScope(parsedConfig.reaction_notifications);
    this.reactionScopes.set(channelId, scope);
    return scope;
  }

  private async handleMessageReactionUpdate(
    channelId: string,
    reactionUpdate: NonNullable<TelegramUpdate["message_reaction"]>
  ): Promise<void> {
    const chatId = reactionUpdate.chat.id;
    const chatType = reactionUpdate.chat.type;
    const scope = this.resolveReactionScope(channelId);

    const actorId =
      typeof reactionUpdate.user?.id === "number"
        ? String(reactionUpdate.user.id)
        : typeof reactionUpdate.actor_chat?.id === "number"
          ? String(reactionUpdate.actor_chat.id)
          : "unknown";
    const actorName =
      reactionUpdate.user?.username ||
      reactionUpdate.user?.first_name ||
      reactionUpdate.actor_chat?.title ||
      reactionUpdate.actor_chat?.username ||
      actorId;

    const oldReactions = formatTelegramReactionList(reactionUpdate.old_reaction);
    const newReactions = formatTelegramReactionList(reactionUpdate.new_reaction);
    const eventMessage = `[System Event] Telegram reaction by ${actorName} on message ${reactionUpdate.message_id}: old=[${oldReactions}] new=[${newReactions}]`;

    await logChannelMessage("telegram", "incoming", eventMessage, {
      channelId: String(chatId),
      senderId: actorId,
      metadata: {
        event: "reaction",
        chatType,
        messageId: reactionUpdate.message_id,
        oldReaction: reactionUpdate.old_reaction || [],
        newReaction: reactionUpdate.new_reaction || [],
      },
    });

    if (!shouldNotifyTelegramReactions(scope, chatType)) {
      return;
    }

    const sessionKey = telegramSessions.get(String(chatId)) || `telegram:${chatId}`;
    sendChannelRuntimeMessage(sessionKey, {
      role: "system",
      content: eventMessage,
      timestamp: new Date().toISOString(),
    });
  }

  async sendPhoto(
    channelId: string,
    chatId: string | number,
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
      if (typeof photo === "string" && existsSync(photo)) {
        const photoBuffer = readFileSync(photo);
        const formData = new FormData();
        formData.append("chat_id", String(chatId));
        formData.append("photo", new Blob([photoBuffer]), path.basename(photo));
        if (caption) {
          formData.append("caption", caption);
          if (parseMode) formData.append("parse_mode", parseMode);
        }

        const response = await fetch(`https://api.telegram.org/bot${bot.token}/sendPhoto`, {
          method: "POST",
          body: formData,
          duplex: "half",
        } as RequestInit);
        const result = (await response.json()) as { ok: boolean; description?: string };
        if (!result.ok) console.error("[Telegram] sendPhoto failed:", result.description);
        return result.ok === true;
      } else if (typeof photo === "string") {
        const result = await telegramApi(bot.token, "sendPhoto", {
          chat_id: chatId,
          photo,
          caption,
          parse_mode: parseMode,
        });
        return result.ok === true;
      } else {
        const formData = new FormData();
        formData.append("chat_id", String(chatId));
        formData.append("photo", new Blob([photo]), "image.png");
        if (caption) {
          formData.append("caption", caption);
          if (parseMode) formData.append("parse_mode", parseMode);
        }

        const response = await fetch(`https://api.telegram.org/bot${bot.token}/sendPhoto`, {
          method: "POST",
          body: formData,
          duplex: "half",
        } as RequestInit);
        const result = (await response.json()) as { ok: boolean; description?: string };
        if (!result.ok) console.error("[Telegram] sendPhoto failed:", result.description);
        return result.ok === true;
      }
    } catch (error) {
      console.error("[Telegram] Failed to send photo:", error);
      return false;
    }
  }

  async sendDocument(
    channelId: string,
    chatId: string | number,
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

        const response = await fetch(`https://api.telegram.org/bot${bot.token}/sendDocument`, {
          method: "POST",
          body: formData,
          duplex: "half",
        } as RequestInit);
        const result = (await response.json()) as { ok: boolean; description?: string };
        if (!result.ok) console.error("[Telegram] sendDocument failed:", result.description);
        return result.ok === true;
      } else if (typeof document === "string") {
        const result = await telegramApi(bot.token, "sendDocument", {
          chat_id: chatId,
          document,
          caption,
          parse_mode: parseMode,
        });
        return result.ok === true;
      } else {
        const formData = new FormData();
        formData.append("chat_id", String(chatId));
        formData.append("document", new Blob([document]), filename || "file");
        if (caption) {
          formData.append("caption", caption);
          if (parseMode) formData.append("parse_mode", parseMode);
        }

        const response = await fetch(`https://api.telegram.org/bot${bot.token}/sendDocument`, {
          method: "POST",
          body: formData,
          duplex: "half",
        } as RequestInit);
        const result = (await response.json()) as { ok: boolean; description?: string };
        if (!result.ok) console.error("[Telegram] sendDocument failed:", result.description);
        return result.ok === true;
      }
    } catch (error) {
      console.error("[Telegram] Failed to send document:", error);
      return false;
    }
  }

  async sendVideo(
    channelId: string,
    chatId: string | number,
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

        const response = await fetch(`https://api.telegram.org/bot${bot.token}/sendVideo`, {
          method: "POST",
          body: formData,
          duplex: "half",
        } as RequestInit);
        const result = (await response.json()) as { ok: boolean; description?: string };
        if (!result.ok) console.error("[Telegram] sendVideo failed:", result.description);
        return result.ok === true;
      } else if (typeof video === "string") {
        const result = await telegramApi(bot.token, "sendVideo", {
          chat_id: chatId,
          video,
          caption,
          parse_mode: parseMode,
        });
        return result.ok === true;
      } else {
        const formData = new FormData();
        formData.append("chat_id", String(chatId));
        formData.append("video", new Blob([video]), "video.mp4");
        if (caption) {
          formData.append("caption", caption);
          if (parseMode) formData.append("parse_mode", parseMode);
        }

        const response = await fetch(`https://api.telegram.org/bot${bot.token}/sendVideo`, {
          method: "POST",
          body: formData,
          duplex: "half",
        } as RequestInit);
        const result = (await response.json()) as { ok: boolean; description?: string };
        if (!result.ok) console.error("[Telegram] sendVideo failed:", result.description);
        return result.ok === true;
      }
    } catch (error) {
      console.error("[Telegram] Failed to send video:", error);
      return false;
    }
  }

  async processWebhook(channelId: string, update: Record<string, unknown>): Promise<boolean> {
    try {
      const channel = tables.channels.get(channelId) as { type?: string; config?: unknown } | null;
      if (!channel || channel.type !== "telegram") {
        console.error(`[Telegram Webhook] Channel ${channelId} not found or not telegram type`);
        return false;
      }

      const config = parseStoredTelegramConfig(channel.config, channelId);
      const botToken = typeof config.bot_token === "string" ? config.bot_token : "";
      if (!botToken) {
        console.error(`[Telegram Webhook] No bot token for channel ${channelId}`);
        return false;
      }

      await this.processTelegramUpdate(update as unknown as TelegramUpdate, channelId, botToken);
      return true;
    } catch (error) {
      console.error("[Telegram Webhook] Error processing update:", error);
      return false;
    }
  }
}

export const telegramBot = new TelegramBotManager();

export async function processTelegramWebhook(
  channelId: string,
  update: Record<string, unknown>
): Promise<boolean> {
  return telegramBot.processWebhook(channelId, update);
}
