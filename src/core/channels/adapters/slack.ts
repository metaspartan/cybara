// Slack Adapter - Production implementation using @slack/bolt with Socket Mode
// Requires: @slack/bolt package, bot token (xoxb-), app token (xapp-), Socket Mode enabled

import { App } from "@slack/bolt";
import type { ChannelAdapter, ToolCallInfo, MessageHandler } from "../types";
import { formatToolCallsPlain } from "../formatting";
import { logChannelMessage } from "../../logging";
import { buildChannelSecurityConfig, securityManager } from "../security";
import { handleChannelManagementCommand } from "../commands";

// Slack message event type (inline since @slack/bolt doesn't export it directly)
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

// Slack session storage (channelId:chatId -> sessionId)
export const slackSessions = new Map<string, string>();

export class SlackAdapter implements ChannelAdapter {
  type = "slack" as const;
  name = "Slack";

  private apps = new Map<string, App>();
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

    if (!botToken) {
      throw new Error("bot_token (xoxb-...) is required for Slack adapter");
    }

    if (!appToken) {
      throw new Error("app_token (xapp-...) is required for Socket Mode");
    }

    // Configure security based on channel config
    securityManager.setConfig(channelId, buildChannelSecurityConfig(config));

    // Check if already running
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

    // Handle direct messages
    app.message(async ({ message, say, client }) => {
      await this.handleMessage(channelId, message as SlackMessageEvent, say, client);
    });

    // Handle app mentions in channels
    app.event("app_mention", async ({ event, say, client }) => {
      await this.handleMention(channelId, event as SlackMessageEvent, say, client);
    });

    // Handle DM opened
    app.event("app_home_opened", async ({ event, client: _client }) => {
      console.log(`[Slack] App home opened by user ${event.user}`);
    });

    // Global error handler
    app.error(async (error) => {
      console.error(`[Slack] App error:`, error);
    });

    try {
      await app.start();
      this.apps.set(channelId, app);
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

    // 🔐 SECURITY CHECK: Verify sender is allowed
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

    // Log incoming message
    await logChannelMessage("slack", "incoming", text, {
      channelId: chatId,
      senderId: userId,
      metadata: {
        messageTs: message.ts,
        threadTs: message.thread_ts,
      },
    });

    // Get or create session
    const sessionKey = `${channelId}:${chatId}`;
    let sessionId = slackSessions.get(sessionKey);
    if (!sessionId) {
      sessionId = crypto.randomUUID();
      slackSessions.set(sessionKey, sessionId);
    }

    // Process message
    let response: string;
    try {
      const commandResponse = await handleChannelManagementCommand(text, {
        channelId,
        chatId,
        platform: "slack",
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

    // Log outgoing message
    await logChannelMessage("slack", "outgoing", response, {
      channelId: chatId,
      metadata: { replyToTs: message.ts },
    });

    // Reply in thread if this is a threaded message, otherwise as new message
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

    // 🔐 SECURITY CHECK: Verify sender is allowed
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

    // Remove bot mention from text
    const cleanText = text.replace(/<@[A-Z0-9]+>/g, "").trim();

    if (!cleanText) {
      await say("👋 Hi! How can I help you today?");
      return;
    }

    // Log incoming message
    await logChannelMessage("slack", "incoming", cleanText, {
      channelId: chatId,
      senderId: userId,
      metadata: {
        messageTs: event.ts,
        threadTs: event.thread_ts,
        isMention: true,
      },
    });

    // Get or create session
    const sessionKey = `${channelId}:${chatId}`;
    let sessionId = slackSessions.get(sessionKey);
    if (!sessionId) {
      sessionId = crypto.randomUUID();
      slackSessions.set(sessionKey, sessionId);
    }

    // Process message
    let response: string;
    try {
      const commandResponse = await handleChannelManagementCommand(cleanText, {
        channelId,
        chatId,
        platform: "slack",
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

    // Log outgoing message
    await logChannelMessage("slack", "outgoing", response, {
      channelId: chatId,
      metadata: { replyToTs: event.ts },
    });

    // Send response
    try {
      await say(response);
    } catch (error) {
      console.error("[Slack] Failed to send message:", error);
    }
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

  formatResponse(content: string, toolCalls?: ToolCallInfo[], thinking?: string): string {
    let text = content;

    if (toolCalls && toolCalls.length > 0) {
      // Slack doesn't have special formatting, use plain
      text = formatToolCallsPlain(toolCalls) + "\n\n" + text;
    }

    if (thinking) {
      // Use Slack's expandable section
      text += `\n\n💭 _${thinking}_`;
    }

    return text;
  }
}

export const slackAdapter = new SlackAdapter();
