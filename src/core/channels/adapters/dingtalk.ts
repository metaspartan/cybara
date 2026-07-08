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
import { parseDingTalkMessage, verifyDingTalkSignature } from "../dingtalk-events";
import { ReplayGuard, parseTimestampSeconds } from "../replay-guard";

export const dingtalkSessions = new Map<string, string>();

const dingtalkReplayGuard = new ReplayGuard();

function isTrustedDingTalkWebhook(raw: string): boolean {
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:") return false;
    const host = url.hostname.toLowerCase();
    return host === "oapi.dingtalk.com" || host.endsWith(".dingtalk.com");
  } catch {
    return false;
  }
}

interface DingTalkConfig {
  appSecret: string;
}

export class DingTalkAdapter implements ChannelAdapter {
  type = "dingtalk" as const;
  name = "DingTalk";

  private configs = new Map<string, DingTalkConfig>();
  private webhooks = new Map<string, string>();
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
    const appSecret = typeof config.app_secret === "string" ? config.app_secret.trim() : "";
    if (!appSecret) throw new Error("DingTalk: app_secret is required");
    this.configs.set(channelId, { appSecret });
    this.running.add(channelId);
    console.log(`[DingTalk] ready for channel ${channelId}`);
  }

  async stop(channelId: string): Promise<void> {
    this.running.delete(channelId);
    this.configs.delete(channelId);
  }

  isRunning(channelId: string): boolean {
    return this.running.has(channelId);
  }

  async sendMessage(channelId: string, chatId: string | number, text: string): Promise<boolean> {
    const webhook = this.webhooks.get(`${channelId}:${chatId}`);
    if (!webhook) return false;
    const res = await fetch(webhook, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ msgtype: "text", text: { content: text } }),
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

    const timestamp = payload.headers.timestamp || payload.headers.Timestamp || "";
    const sign = payload.headers.sign || payload.headers.Sign || "";
    if (!verifyDingTalkSignature(timestamp, sign, cfg.appSecret)) {
      return { status: 401, body: { error: "invalid signature" } };
    }

    const fresh = dingtalkReplayGuard.check(sign, parseTimestampSeconds(timestamp));
    if (!fresh.ok) {
      return { status: 401, body: { error: `request rejected: ${fresh.reason}` } };
    }

    const message = parseDingTalkMessage(payload.body);
    if (!message) return { status: 200, body: {} };

    if (message.sessionWebhook && isTrustedDingTalkWebhook(message.sessionWebhook)) {
      this.webhooks.set(`${channelId}:${message.conversationId}`, message.sessionWebhook);
    }

    void this.dispatch(channelId, message.conversationId, message.senderId, message.text);
    return { status: 200, body: {} };
  }

  private async dispatch(
    channelId: string,
    conversationId: string,
    sender: string,
    text: string
  ): Promise<void> {
    const sessionKey = `${channelId}:${conversationId}`;
    let sessionId = dingtalkSessions.get(sessionKey);
    if (!sessionId) {
      sessionId = crypto.randomUUID();
      dingtalkSessions.set(sessionKey, sessionId);
    }

    await logChannelMessage("dingtalk", "incoming", text, { channelId, senderId: sender });

    const access = evaluateChannelAccess(channelId, String(sender), "dingtalk");
    if (!access.permitted) {
      if (access.reply) await this.sendMessage(channelId, conversationId, access.reply);
      return;
    }

    let response: string;
    try {
      response = await this.messageHandler(text, conversationId, sessionId, {
        hasFile: false,
        filePath: "",
        fileType: "",
        placeholder: "",
      });
    } catch (error) {
      response = `Error: ${error instanceof Error ? error.message : "failed"}`;
    }

    if (response) {
      await this.sendMessage(channelId, conversationId, response);
      await logChannelMessage("dingtalk", "outgoing", response, { channelId, senderId: sender });
    }
  }
}

export const dingtalkAdapter = new DingTalkAdapter();
