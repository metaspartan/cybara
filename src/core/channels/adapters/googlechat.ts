import type { ChannelAdapter, ToolCallInfo, MessageHandler, WebhookPayload, WebhookResult } from "../types";
import { formatToolCallsPlain } from "../formatting";
import { logChannelMessage } from "../../logging";
import { parseGoogleChatEvent } from "../googlechat-events";

export const googleChatSessions = new Map<string, string>();

interface GoogleChatConfig {
  webhookUrl: string;
  verifyToken?: string;
}

export class GoogleChatAdapter implements ChannelAdapter {
  type = "googlechat" as const;
  name = "Google Chat";

  private configs = new Map<string, GoogleChatConfig>();
  private running = new Set<string>();
  private messageHandler: MessageHandler = async () => "No handler configured";

  setMessageHandler(handler: MessageHandler) {
    this.messageHandler = handler;
  }

  getMessageHandler(): MessageHandler {
    return this.messageHandler;
  }

  async start(channelId: string, config: Record<string, unknown>): Promise<void> {
    const webhookUrl = typeof config.webhook_url === "string" ? config.webhook_url.trim() : "";
    if (!webhookUrl) throw new Error("Google Chat: webhook_url is required");
    this.configs.set(channelId, {
      webhookUrl,
      verifyToken: typeof config.verify_token === "string" ? config.verify_token.trim() : undefined,
    });
    this.running.add(channelId);
    console.log(`[GoogleChat] ready for channel ${channelId}`);
  }

  async stop(channelId: string): Promise<void> {
    this.running.delete(channelId);
    this.configs.delete(channelId);
  }

  isRunning(channelId: string): boolean {
    return this.running.has(channelId);
  }

  async sendMessage(channelId: string, _chatId: string | number, text: string): Promise<boolean> {
    const cfg = this.configs.get(channelId);
    if (!cfg) return false;
    const res = await fetch(cfg.webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
    return res.ok;
  }

  formatResponse(content: string, toolCalls?: ToolCallInfo[]): string {
    if (toolCalls && toolCalls.length > 0) {
      return formatToolCallsPlain(toolCalls) + "\n\n" + content;
    }
    return content;
  }

  async handleWebhook(channelId: string, payload: WebhookPayload): Promise<WebhookResult> {
    const cfg = this.configs.get(channelId);
    if (!cfg) return { status: 404 };

    if (cfg.verifyToken) {
      const provided =
        payload.query.token ||
        (payload.headers.authorization || "").replace(/^Bearer\s+/i, "") ||
        "";
      if (provided !== cfg.verifyToken) return { status: 401, body: { error: "invalid token" } };
    }

    const event = parseGoogleChatEvent(payload.body);
    if (!event) return { status: 200, body: {} };

    const reply = await this.dispatch(channelId, event.space, event.sender, event.text);
    return { status: 200, body: reply ? { text: reply } : {} };
  }

  private async dispatch(
    channelId: string,
    space: string,
    sender: string,
    text: string
  ): Promise<string | null> {
    const sessionKey = `${channelId}:${space}`;
    let sessionId = googleChatSessions.get(sessionKey);
    if (!sessionId) {
      sessionId = crypto.randomUUID();
      googleChatSessions.set(sessionKey, sessionId);
    }

    await logChannelMessage("googlechat", "incoming", text, { channelId, senderId: sender });

    let response: string;
    try {
      response = await this.messageHandler(text, space, sessionId, {
        hasFile: false,
        filePath: "",
        fileType: "",
        placeholder: "",
      });
    } catch (error) {
      response = `Error: ${error instanceof Error ? error.message : "failed"}`;
    }

    if (response) {
      await logChannelMessage("googlechat", "outgoing", response, { channelId, senderId: sender });
    }
    return response || null;
  }
}

export const googleChatAdapter = new GoogleChatAdapter();
