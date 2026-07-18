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
import { verifyLineSignature, parseLineEvents } from "../line-events";

export const lineSessions = new Map<string, string>();

const LINE_REPLY_URL = "https://api.line.me/v2/bot/message/reply";
const LINE_PUSH_URL = "https://api.line.me/v2/bot/message/push";

interface LineConfig {
  channelAccessToken: string;
  channelSecret: string;
}

export class LineAdapter implements ChannelAdapter {
  type = "line" as const;
  name = "LINE";

  private configs = new Map<string, LineConfig>();
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
    const channelAccessToken =
      typeof config.channel_access_token === "string" ? config.channel_access_token.trim() : "";
    const channelSecret =
      typeof config.channel_secret === "string" ? config.channel_secret.trim() : "";
    if (!channelAccessToken || !channelSecret) {
      throw new Error("LINE: channel_access_token and channel_secret are required");
    }
    this.configs.set(channelId, { channelAccessToken, channelSecret });
    this.running.add(channelId);
    console.log(`[LINE] ready for channel ${channelId}`);
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
    const res = await fetch(LINE_PUSH_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${cfg.channelAccessToken}`,
      },
      body: JSON.stringify({
        to: String(chatId),
        messages: [{ type: "text", text: text.slice(0, 5000) }],
      }),
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

    const signature =
      payload.headers["x-line-signature"] || payload.headers["X-Line-Signature"] || "";
    if (!verifyLineSignature(payload.rawBody, signature, cfg.channelSecret)) {
      return { status: 401, body: { error: "invalid signature" } };
    }

    for (const event of parseLineEvents(payload.body)) {
      await this.dispatch(
        channelId,
        cfg,
        event.sourceId,
        event.replyToken,
        event.text,
        event.isGroup
      );
    }
    return { status: 200, body: { ok: true } };
  }

  private async reply(cfg: LineConfig, replyToken: string, text: string): Promise<void> {
    await fetch(LINE_REPLY_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${cfg.channelAccessToken}`,
      },
      body: JSON.stringify({ replyToken, messages: [{ type: "text", text: text.slice(0, 5000) }] }),
    });
  }

  private async dispatch(
    channelId: string,
    cfg: LineConfig,
    sourceId: string,
    replyToken: string,
    text: string,
    isGroup: boolean
  ): Promise<void> {
    const sessionKey = `${channelId}:${sourceId}`;
    let sessionId = lineSessions.get(sessionKey);
    if (!sessionId) {
      sessionId = crypto.randomUUID();
      lineSessions.set(sessionKey, sessionId);
    }

    await logChannelMessage("line", "incoming", text, { channelId, senderId: sourceId });

    const access = evaluateChannelAccess(channelId, String(sourceId), "line", { isGroup });
    if (!access.permitted) {
      if (access.reply) await this.sendMessage(channelId, sourceId, access.reply);
      return;
    }

    let response: string;
    try {
      response = await this.messageHandler(text, sourceId, sessionId, {
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
      if (replyToken) await this.reply(cfg, replyToken, response);
      else await this.sendMessage(channelId, sourceId, response);
      await logChannelMessage("line", "outgoing", response, { channelId, senderId: sourceId });
    }
  }
}

export const lineAdapter = new LineAdapter();
