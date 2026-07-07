import type {
  ChannelAdapter,
  ToolCallInfo,
  MessageHandler,
  WebhookPayload,
  WebhookResult,
} from "../types";
import { evaluateChannelAccess } from "../access-gate";
import { buildChannelSecurityConfig, securityManager } from "../security";
import { formatToolCallsPlain } from "../formatting";
import { logChannelMessage } from "../../logging";
import { constantTimeEqual } from "../constant-time";
import { parseSynologyForm } from "../synology-events";

export const synologySessions = new Map<string, string>();

interface SynologyConfig {
  incomingUrl: string;
  token: string;
}

export class SynologyAdapter implements ChannelAdapter {
  type = "synology" as const;
  name = "Synology Chat";

  private configs = new Map<string, SynologyConfig>();
  private running = new Set<string>();
  private messageHandler: MessageHandler = async () => "No handler configured";

  setMessageHandler(handler: MessageHandler) {
    this.messageHandler = handler;
  }

  getMessageHandler(): MessageHandler {
    return this.messageHandler;
  }

  async start(channelId: string, config: Record<string, unknown>): Promise<void> {
    securityManager.setConfig(channelId, buildChannelSecurityConfig(config));
    const incomingUrl = typeof config.incoming_url === "string" ? config.incoming_url.trim() : "";
    const token = typeof config.token === "string" ? config.token.trim() : "";
    if (!incomingUrl || !token)
      throw new Error("Synology Chat: incoming_url and token are required");
    this.configs.set(channelId, { incomingUrl, token });
    this.running.add(channelId);
    console.log(`[Synology] ready for channel ${channelId}`);
  }

  async stop(channelId: string): Promise<void> {
    this.running.delete(channelId);
    this.configs.delete(channelId);
  }

  isRunning(channelId: string): boolean {
    return this.running.has(channelId);
  }

  async sendMessage(channelId: string, chatId: string | number, text: string): Promise<boolean> {
    const cfg = this.configs.get(channelId);
    if (!cfg) return false;
    const userId = Number(chatId);
    const payload: Record<string, unknown> = { text };
    if (Number.isFinite(userId) && userId > 0) payload.user_ids = [userId];
    const body = new URLSearchParams({ payload: JSON.stringify(payload) });
    const res = await fetch(cfg.incomingUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
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

    const inbound = parseSynologyForm(payload.rawBody);
    if (!inbound) return { status: 200, body: {} };
    if (!constantTimeEqual(inbound.token ?? "", cfg.token ?? ""))
      return { status: 401, body: { error: "invalid token" } };

    const reply = await this.dispatch(channelId, inbound.userId, inbound.username, inbound.text);
    return { status: 200, body: reply ? { text: reply } : {} };
  }

  private async dispatch(
    channelId: string,
    userId: string,
    username: string,
    text: string
  ): Promise<string | null> {
    const sessionKey = `${channelId}:${userId}`;
    let sessionId = synologySessions.get(sessionKey);
    if (!sessionId) {
      sessionId = crypto.randomUUID();
      synologySessions.set(sessionKey, sessionId);
    }

    await logChannelMessage("synology", "incoming", text, {
      channelId,
      senderId: username || userId,
    });

    const access = evaluateChannelAccess(channelId, String(userId), "synology", username);
    if (!access.permitted) return access.reply ?? null;

    let response: string;
    try {
      response = await this.messageHandler(text, userId, sessionId, {
        hasFile: false,
        filePath: "",
        fileType: "",
        placeholder: "",
      });
    } catch (error) {
      response = `Error: ${error instanceof Error ? error.message : "failed"}`;
    }

    if (response) {
      await logChannelMessage("synology", "outgoing", response, {
        channelId,
        senderId: username || userId,
      });
    }
    return response || null;
  }
}

export const synologyAdapter = new SynologyAdapter();
