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
import { parseZulipMessage } from "../zulip-events";

export const zulipSessions = new Map<string, string>();

interface ZulipConfig {
  token: string;
  site?: string;
  botEmail?: string;
  apiKey?: string;
}

export class ZulipAdapter implements ChannelAdapter {
  type = "zulip" as const;
  name = "Zulip";

  private configs = new Map<string, ZulipConfig>();
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
    const token = typeof config.token === "string" ? config.token.trim() : "";
    if (!token) throw new Error("Zulip: token is required");
    this.configs.set(channelId, {
      token,
      site:
        typeof config.site === "string" && config.site.trim()
          ? config.site.trim().replace(/\/+$/, "")
          : undefined,
      botEmail: typeof config.bot_email === "string" ? config.bot_email.trim() : undefined,
      apiKey: typeof config.api_key === "string" ? config.api_key.trim() : undefined,
    });
    this.running.add(channelId);
    console.log(`[Zulip] ready for channel ${channelId}`);
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
    if (!cfg?.site || !cfg.botEmail || !cfg.apiKey) return false;
    const params = new URLSearchParams({
      type: "private",
      to: String(chatId),
      content: text,
    });
    const res = await fetch(`${cfg.site}/api/v1/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${Buffer.from(`${cfg.botEmail}:${cfg.apiKey}`).toString("base64")}`,
      },
      body: params.toString(),
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

    const message = parseZulipMessage(payload.body);
    if (!message) return { status: 200, body: {} };

    if (cfg.token && message.token && !constantTimeEqual(message.token, cfg.token)) {
      return { status: 401, body: { error: "invalid token" } };
    }

    const reply = await this.dispatch(
      channelId,
      message.senderEmail,
      message.recipient,
      message.text
    );
    return { status: 200, body: reply ? { content: reply } : {} };
  }

  private async dispatch(
    channelId: string,
    sender: string,
    recipient: string,
    text: string
  ): Promise<string | null> {
    const sessionKey = `${channelId}:${recipient || sender}`;
    let sessionId = zulipSessions.get(sessionKey);
    if (!sessionId) {
      sessionId = crypto.randomUUID();
      zulipSessions.set(sessionKey, sessionId);
    }

    await logChannelMessage("zulip", "incoming", text, { channelId, senderId: sender });

    const access = evaluateChannelAccess(channelId, String(sender), "zulip");
    if (!access.permitted) return access.reply ?? null;

    let response: string;
    try {
      response = await this.messageHandler(text, recipient || sender, sessionId, {
        hasFile: false,
        filePath: "",
        fileType: "",
        placeholder: "",
      });
    } catch (error) {
      response = `Error: ${error instanceof Error ? error.message : "failed"}`;
    }

    if (response) {
      await logChannelMessage("zulip", "outgoing", response, { channelId, senderId: sender });
    }
    return response || null;
  }
}

export const zulipAdapter = new ZulipAdapter();
