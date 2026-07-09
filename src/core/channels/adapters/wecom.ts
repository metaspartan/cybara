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
import {
  parseWecomMessage,
  verifyWecomSignature,
  decryptWecom,
  extractXmlField,
} from "../wecom-crypto";
import { ReplayGuard, parseTimestampSeconds } from "../replay-guard";

export const wecomSessions = new Map<string, string>();

const wecomReplayGuard = new ReplayGuard();

interface WecomConfig {
  token: string;
  encodingAesKey: string;
  corpId: string;
  corpSecret: string;
  agentId: string;
}

interface CachedToken {
  token: string;
  expiresAt: number;
}

export class WeComAdapter implements ChannelAdapter {
  type = "wecom" as const;
  name = "WeCom (Work Weixin)";

  private configs = new Map<string, WecomConfig>();
  private tokens = new Map<string, CachedToken>();
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
    const encodingAesKey =
      typeof config.encoding_aes_key === "string" ? config.encoding_aes_key.trim() : "";
    const corpId = typeof config.corp_id === "string" ? config.corp_id.trim() : "";
    const corpSecret = typeof config.corp_secret === "string" ? config.corp_secret.trim() : "";
    const agentId = typeof config.agent_id === "string" ? config.agent_id.trim() : "";
    if (!token || !encodingAesKey || !corpId || !corpSecret || !agentId) {
      throw new Error("WeCom requires token, encoding_aes_key, corp_id, corp_secret, and agent_id");
    }
    this.configs.set(channelId, { token, encodingAesKey, corpId, corpSecret, agentId });
    this.running.add(channelId);
    console.log(`[WeCom] ready for channel ${channelId}`);
  }

  async stop(channelId: string): Promise<void> {
    this.running.delete(channelId);
    this.configs.delete(channelId);
    this.tokens.delete(channelId);
  }

  isRunning(channelId: string): boolean {
    return this.running.has(channelId);
  }

  private async getAccessToken(channelId: string): Promise<string | null> {
    const cfg = this.configs.get(channelId);
    if (!cfg) return null;
    const cached = this.tokens.get(channelId);
    if (cached && cached.expiresAt > Date.now() + 30_000) return cached.token;
    const res = await fetch(
      `https://qyapi.weixin.qq.com/cgi-bin/gettoken?corpid=${encodeURIComponent(cfg.corpId)}&corpsecret=${encodeURIComponent(cfg.corpSecret)}`
    );
    if (!res.ok) return null;
    const data = (await res.json()) as { access_token?: string; expires_in?: number };
    if (!data.access_token) return null;
    this.tokens.set(channelId, {
      token: data.access_token,
      expiresAt: Date.now() + (data.expires_in ? data.expires_in * 1000 : 7200_000),
    });
    return data.access_token;
  }

  async sendMessage(channelId: string, chatId: string | number, text: string): Promise<boolean> {
    const cfg = this.configs.get(channelId);
    if (!cfg) return false;
    const token = await this.getAccessToken(channelId);
    if (!token) return false;
    const res = await fetch(
      `https://qyapi.weixin.qq.com/cgi-bin/message/send?access_token=${encodeURIComponent(token)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          touser: String(chatId),
          msgtype: "text",
          agentid: Number(cfg.agentId) || cfg.agentId,
          text: { content: text },
        }),
      }
    );
    if (!res.ok) return false;
    const data = (await res.json()) as { errcode?: number };
    return data.errcode === 0;
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

    const { msg_signature = "", timestamp = "", nonce = "", echostr } = payload.query;

    if (echostr) {
      if (!verifyWecomSignature(cfg.token, timestamp, nonce, echostr, msg_signature)) {
        return { status: 401, rawBody: "invalid signature", contentType: "text/plain" };
      }
      try {
        const { message } = decryptWecom(echostr, cfg.encodingAesKey);
        return { status: 200, rawBody: message, contentType: "text/plain" };
      } catch {
        return { status: 400, rawBody: "decrypt failed", contentType: "text/plain" };
      }
    }

    const encrypt = extractXmlField(payload.rawBody, "Encrypt");
    if (!encrypt) return { status: 400, body: { error: "missing Encrypt" } };
    if (!verifyWecomSignature(cfg.token, timestamp, nonce, encrypt, msg_signature)) {
      return { status: 401, body: { error: "invalid signature" } };
    }

    const fresh = wecomReplayGuard.check(
      `${nonce}:${msg_signature}`,
      parseTimestampSeconds(timestamp)
    );
    if (!fresh.ok) {
      return { status: 401, body: { error: `request rejected: ${fresh.reason}` } };
    }

    let innerXml: string;
    try {
      innerXml = decryptWecom(encrypt, cfg.encodingAesKey).message;
    } catch {
      return { status: 400, body: { error: "decrypt failed" } };
    }

    const message = parseWecomMessage(innerXml);
    if (!message) return { status: 200, rawBody: "", contentType: "text/plain" };

    void this.dispatch(channelId, message.from, message.content);
    return { status: 200, rawBody: "", contentType: "text/plain" };
  }

  private async dispatch(channelId: string, userId: string, text: string): Promise<void> {
    const sessionKey = `${channelId}:${userId}`;
    let sessionId = wecomSessions.get(sessionKey);
    if (!sessionId) {
      sessionId = crypto.randomUUID();
      wecomSessions.set(sessionKey, sessionId);
    }

    await logChannelMessage("wecom", "incoming", text, { channelId, senderId: userId });

    const access = evaluateChannelAccess(channelId, String(userId), "wecom");
    if (!access.permitted) {
      if (access.reply) await this.sendMessage(channelId, userId, access.reply);
      return;
    }

    let response: string;
    try {
      response = await this.messageHandler(text, userId, sessionId, {
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
      await this.sendMessage(channelId, userId, response);
      await logChannelMessage("wecom", "outgoing", response, { channelId, senderId: userId });
    }
  }
}

export const wecomAdapter = new WeComAdapter();
