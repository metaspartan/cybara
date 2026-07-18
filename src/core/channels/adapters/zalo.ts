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
import { parseZaloEvent, verifyZaloMac } from "../zalo-events";

export const zaloSessions = new Map<string, string>();

const ZALO_SEND_URL = "https://openapi.zalo.me/v3.0/oa/message/cs";

interface ZaloConfig {
  accessToken: string;
  appId: string;
  appSecret: string;
}

export class ZaloAdapter implements ChannelAdapter {
  type = "zalo" as const;
  name = "Zalo";

  private configs = new Map<string, ZaloConfig>();
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
    const accessToken = typeof config.access_token === "string" ? config.access_token.trim() : "";
    const appId = typeof config.app_id === "string" ? config.app_id.trim() : "";
    const appSecret = typeof config.app_secret === "string" ? config.app_secret.trim() : "";
    if (!accessToken) throw new Error("Zalo: access_token is required");
    if (!appId || !appSecret) throw new Error("Zalo: app_id and app_secret are required");
    this.configs.set(channelId, {
      accessToken,
      appId,
      appSecret,
    });
    this.running.add(channelId);
    console.log(`[Zalo] ready for channel ${channelId}`);
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
    const res = await fetch(ZALO_SEND_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", access_token: cfg.accessToken },
      body: JSON.stringify({ recipient: { user_id: String(chatId) }, message: { text } }),
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

    const macBody = payload.body as { mac?: string; timestamp?: string };
    const ok = verifyZaloMac(
      cfg.appId,
      payload.rawBody,
      macBody.timestamp || "",
      cfg.appSecret,
      macBody.mac || ""
    );
    if (!ok) return { status: 401, body: { error: "invalid mac" } };

    const inbound = parseZaloEvent(payload.body);
    if (inbound) await this.dispatch(channelId, inbound.senderId, inbound.text);
    return { status: 200, body: { ok: true } };
  }

  private async dispatch(channelId: string, senderId: string, text: string): Promise<void> {
    const sessionKey = `${channelId}:${senderId}`;
    let sessionId = zaloSessions.get(sessionKey);
    if (!sessionId) {
      sessionId = crypto.randomUUID();
      zaloSessions.set(sessionKey, sessionId);
    }

    await logChannelMessage("zalo", "incoming", text, { channelId, senderId });

    const access = evaluateChannelAccess(channelId, String(senderId), "zalo", { isGroup: false });
    if (!access.permitted) {
      if (access.reply) await this.sendMessage(channelId, senderId, access.reply);
      return;
    }

    let response: string;
    try {
      response = await this.messageHandler(text, senderId, sessionId, {
        channelId,
        hasFile: false,
        filePath: "",
        fileType: "",
        placeholder: "",
      });
    } catch (error) {
      response = `Error: ${error instanceof Error ? error.message : "failed"}`;
    }

    if (response) {
      await this.sendMessage(channelId, senderId, response);
      await logChannelMessage("zalo", "outgoing", response, { channelId, senderId });
    }
  }
}

export const zaloAdapter = new ZaloAdapter();
