// Telegram Bot Adapter - Full implementation
// Extracted from channels.ts for modular architecture

import { existsSync, mkdirSync, writeFileSync, readFileSync } from "fs";
import path from "path";
import { tables } from "../../database";
import { logChannelMessage } from "../../logging";
import { toolSchemas } from "../../tools/index";
import { listSessions } from "../../../api/chat";
import type { ChannelAdapter, MessageHandler, MessageHandlerFileInfo, ToolCallInfo } from "../types";
import { formatToolCallsForTelegram, escapeMarkdown } from "../formatting";
import { securityManager } from "../security";

// Telegram session storage
export const telegramSessions = new Map<string, string>();

// Get user's sessions from in-memory store
async function getUserSessions(
    userId: string
): Promise<Array<{ id: string; messageCount: number; lastActive: string }>> {
    const allSessions = await listSessions();
    return allSessions
        .map((s) => ({
            id: s.id,
            messageCount: s.messageCount,
            lastActive: s.createdAt,
        }))
        .slice(0, 10);
}

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
            return result.result as { id: number; username: string; first_name: string };
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

// Telegram Update interface
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
}

// Internal message handler type
interface InternalMessageHandler {
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
    messageHandler: InternalMessageHandler,
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
            telegramSessions.set(chatId.toString(), newSessionId);
            return `🆕 *New Session Started*

Session ID: \`${newSessionId.slice(0, 8)}...\`

I'm ready for a fresh conversation. What would you like to talk about?`;
        }

        case "sessions": {
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
            return `🧠 *Memory*

Memory feature coming soon.

Memories will be automatically created when you share important context with the agent.`;
        }

        case "tools": {
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

// Download file from Telegram and save to media store
async function downloadTelegramMedia(
    botToken: string,
    fileId: string,
    type: string,
    originalFileName?: string
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

        const mediaDir = path.join(process.cwd(), "media", "inbound");
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

// Escape special Markdown characters for Telegram
function escapeTelegramMarkdown(text: string): string {
    const hasIntentionalMarkdown = /(\*[^*]+\*|_[^_]+_|`[^`]+`)/.test(text);
    if (hasIntentionalMarkdown) {
        return text;
    }
    return text.replace(/\[/g, "\\[").replace(/\]/g, "\\]");
}

// Telegram Bot Manager class
export class TelegramBotManager implements ChannelAdapter {
    type = "telegram" as const;
    name = "Telegram";

    private bots: Map<
        string,
        { token: string; channelId: string; mode: "webhook" | "polling"; pollingTimer?: ReturnType<typeof setTimeout> }
    > = new Map();
    private messageHandler: InternalMessageHandler = async () => "No handler configured";

    setMessageHandler(handler: InternalMessageHandler) {
        this.messageHandler = handler;
    }

    getMessageHandler(): InternalMessageHandler {
        return this.messageHandler;
    }

    async start(channelId: string, config: Record<string, unknown>): Promise<void> {
        const botToken = config.bot_token as string;
        const webhookUrl = config.webhook_url as string | undefined;

        if (!botToken) {
            throw new Error("bot_token is required");
        }

        const botInfo = await getTelegramBotInfo(botToken);
        if (!botInfo) {
            throw new Error("Invalid bot token");
        }

        console.log(`[Telegram] Starting bot @${botInfo.username}`);
        await registerTelegramCommands(botToken);

        // Configure security based on channel config
        securityManager.setConfig(channelId, {
            dm_policy: (config.dm_policy as "pairing" | "allowlist" | "open" | "disabled") || "pairing",
            allowed_senders: (config.allowed_senders as string[]) || [],
        });

        const isLocalhost = !webhookUrl || webhookUrl.includes("localhost") || webhookUrl.includes("127.0.0.1");

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
                    allowed_updates: ["message", "callback_query"],
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
            await deleteTelegramWebhook(bot.token).catch(() => { });
        }

        this.bots.delete(channelId);
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

        return sendTelegramMessage(bot.token, chatId, text, options as {
            parse_mode?: "HTML" | "Markdown" | "MarkdownV2";
            reply_to_message_id?: number;
            reply_markup?: Record<string, unknown>;
        });
    }

    formatResponse(content: string, toolCalls?: ToolCallInfo[], thinking?: string): string {
        let text = content;

        if (toolCalls && toolCalls.length > 0) {
            const toolSection = formatToolCallsForTelegram(toolCalls);
            text = toolSection + "\n\n" + text;
        }

        if (thinking) {
            const thinkingPreview =
                thinking.length > 100 ? thinking.substring(0, 100) + "..." : thinking;
            text += `\n\n💭 _${escapeMarkdown(thinkingPreview)}_`;
        }

        return text;
    }

    // Process incoming Telegram message
    private async processTelegramUpdate(
        update: TelegramUpdate,
        channelId: string,
        botToken: string
    ): Promise<void> {
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

        // Handle media
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
            const saved = await downloadTelegramMedia(botToken, message.document.file_id, "document", fileName);
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
            const saved = await downloadTelegramMedia(botToken, message.voice.file_id, "audio", "voice.ogg");
            if (saved) {
                content = saved.placeholder;
                filePath = saved.path;
                fileType = "audio/ogg";
                hasFile = true;
                placeholder = saved.placeholder;
            }
        }

        if (message.sticker && !message.sticker.is_animated && !message.sticker.is_video && message.sticker.file_id) {
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

        // 🔐 SECURITY CHECK: Verify sender is allowed
        const accessCheck = securityManager.checkAccess(
            channelId,
            userId.toString(),
            "telegram",
            message.from.username || message.from.first_name
        );

        if (!accessCheck.permitted) {
            if (accessCheck.reason === "new_pairing") {
                // Send pairing code
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

        let response: string;

        // Show typing indicator
        try {
            await telegramApi(botToken, "sendChatAction", {
                chat_id: chatId,
                action: "typing",
            });
        } catch {
            // Typing indicator may fail, continue anyway
        }

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

        await logChannelMessage("telegram", "outgoing", response, {
            channelId: chatId.toString(),
            metadata: { replyToMessageId: message.message_id },
        });

        // Check for screenshot
        const screenshotMatch = response.match(/Screenshot saved: ([^\n]+)/);
        if (screenshotMatch?.[1]) {
            const screenshotPath = screenshotMatch[1].trim();
            try {
                if (existsSync(screenshotPath)) {
                    const photoBuffer = readFileSync(screenshotPath);
                    const sent = await this.sendPhoto(channelId, chatId, photoBuffer, "📸 Here's the screenshot!");
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
                response = await handleTelegramCommand("status", [], { update_id: 0 } as TelegramUpdate, channelId, async () => "", chatId);
                break;
            case "agents":
                response = await handleTelegramCommand("agents", [], { update_id: 0 } as TelegramUpdate, channelId, async () => "", chatId);
                break;
            case "help":
                response = await handleTelegramCommand("help", [], { update_id: 0 } as TelegramUpdate, channelId, async () => "", chatId);
                break;
            default:
                response = `You clicked: ${data}`;
        }

        await sendTelegramMessage(botToken, chatId, escapeTelegramMarkdown(response), {
            parse_mode: "Markdown",
        });
    }

    // Media sending methods
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

                const response = await fetch(
                    `https://api.telegram.org/bot${bot.token}/sendPhoto`,
                    { method: "POST", body: formData, duplex: "half" } as RequestInit
                );
                const result = await response.json() as { ok: boolean; description?: string };
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

                const response = await fetch(
                    `https://api.telegram.org/bot${bot.token}/sendPhoto`,
                    { method: "POST", body: formData, duplex: "half" } as RequestInit
                );
                const result = await response.json() as { ok: boolean; description?: string };
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

                const response = await fetch(
                    `https://api.telegram.org/bot${bot.token}/sendDocument`,
                    { method: "POST", body: formData, duplex: "half" } as RequestInit
                );
                const result = await response.json() as { ok: boolean; description?: string };
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

                const response = await fetch(
                    `https://api.telegram.org/bot${bot.token}/sendVideo`,
                    { method: "POST", body: formData, duplex: "half" } as RequestInit
                );
                const result = await response.json() as { ok: boolean; description?: string };
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

    // Process webhook updates from Telegram
    async processWebhook(channelId: string, update: Record<string, unknown>): Promise<boolean> {
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

            await this.processTelegramUpdate(update as unknown as TelegramUpdate, channelId, botToken);
            return true;
        } catch (error) {
            console.error("[Telegram Webhook] Error processing update:", error);
            return false;
        }
    }
}

// Export singleton instance
export const telegramBot = new TelegramBotManager();

// Export webhook processor for backwards compatibility
export async function processTelegramWebhook(
    channelId: string,
    update: Record<string, unknown>
): Promise<boolean> {
    return telegramBot.processWebhook(channelId, update);
}
