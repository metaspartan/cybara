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
import {
  parseFeishuMessage,
  extractFeishuChallenge,
  verifyFeishuSignature,
  decryptFeishuEvent,
} from "../feishu-events";

export const feishuSessions = new Map<string, string>();

interface FeishuConfig {
  appId: string;
  appSecret: string;
  verificationToken: string;
  encryptKey: string;
  domain: string;
}

interface CachedToken {
  token: string;
  expiresAt: number;
}

export class FeishuAdapter implements ChannelAdapter {
  type = "feishu" as const;
  name = "Feishu / Lark";

  private configs = new Map<string, FeishuConfig>();
  private tokens = new Map<string, CachedToken>();
  private running = new Set<string>();
  private processedSignatures = new Map<string, number>();
  private messageHandler: MessageHandler = async () => "No handler configured";

  setMessageHandler(handler: MessageHandler) {
    this.messageHandler = handler;
  }

  getMessageHandler(): MessageHandler {
    return this.messageHandler;
  }

  async start(channelId: string, config: Record<string, unknown>): Promise<void> {
    securityManager.setConfig(channelId, buildChannelSecurityConfig(config));
    const appId = typeof config.app_id === "string" ? config.app_id.trim() : "";
    const appSecret = typeof config.app_secret === "string" ? config.app_secret.trim() : "";
    const verificationToken =
      typeof config.verification_token === "string" ? config.verification_token.trim() : "";
    const encryptKey = typeof config.encrypt_key === "string" ? config.encrypt_key.trim() : "";
    if (!appId || !appSecret) throw new Error("Feishu: app_id and app_secret are required");
    if (!verificationToken) throw new Error("Feishu: verification_token is required");
    if (!encryptKey) throw new Error("Feishu: encrypt_key is required");
    const domain =
      typeof config.domain === "string" && config.domain.trim()
        ? config.domain.trim().replace(/\/+$/, "")
        : "https://open.feishu.cn";
    this.configs.set(channelId, {
      appId,
      appSecret,
      verificationToken,
      encryptKey,
      domain,
    });
    this.running.add(channelId);
    console.log(`[Feishu] ready for channel ${channelId}`);
  }

  async stop(channelId: string): Promise<void> {
    this.running.delete(channelId);
    this.configs.delete(channelId);
    this.tokens.delete(channelId);
    for (const signature of this.processedSignatures.keys()) {
      if (signature.startsWith(`${channelId}:`)) this.processedSignatures.delete(signature);
    }
  }

  isRunning(channelId: string): boolean {
    return this.running.has(channelId);
  }

  private async getTenantToken(channelId: string): Promise<string | null> {
    const cfg = this.configs.get(channelId);
    if (!cfg) return null;
    const cached = this.tokens.get(channelId);
    if (cached && cached.expiresAt > Date.now() + 30_000) return cached.token;
    const res = await fetch(`${cfg.domain}/open-apis/auth/v3/tenant_access_token/internal`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ app_id: cfg.appId, app_secret: cfg.appSecret }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { tenant_access_token?: string; expire?: number };
    if (!data.tenant_access_token) return null;
    this.tokens.set(channelId, {
      token: data.tenant_access_token,
      expiresAt: Date.now() + (data.expire ? data.expire * 1000 : 7200_000),
    });
    return data.tenant_access_token;
  }

  async sendMessage(channelId: string, chatId: string | number, text: string): Promise<boolean> {
    const cfg = this.configs.get(channelId);
    if (!cfg) return false;
    const token = await this.getTenantToken(channelId);
    if (!token) return false;
    const res = await fetch(`${cfg.domain}/open-apis/im/v1/messages?receive_id_type=chat_id`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        receive_id: String(chatId),
        msg_type: "text",
        content: JSON.stringify({ text }),
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

    const timestamp = payload.headers["x-lark-request-timestamp"] || "";
    const nonce = payload.headers["x-lark-request-nonce"] || "";
    const signature = payload.headers["x-lark-signature"] || "";
    const timestampMs = Number(timestamp) * 1000;
    if (!Number.isFinite(timestampMs) || Math.abs(Date.now() - timestampMs) > 5 * 60_000) {
      return { status: 401, body: { error: "stale request" } };
    }
    if (!verifyFeishuSignature(timestamp, nonce, cfg.encryptKey, payload.rawBody, signature)) {
      return { status: 401, body: { error: "invalid signature" } };
    }
    const replayKey = `${channelId}:${signature}`;
    const replayCutoff = Date.now() - 5 * 60_000;
    for (const [key, seenAt] of this.processedSignatures) {
      if (seenAt < replayCutoff) this.processedSignatures.delete(key);
    }
    if (this.processedSignatures.has(replayKey)) {
      return { status: 409, body: { error: "replayed request" } };
    }
    this.processedSignatures.set(replayKey, Date.now());

    let body: unknown = payload.body;
    const encrypted = (payload.body as { encrypt?: string })?.encrypt;
    if (typeof encrypted === "string") {
      try {
        body = decryptFeishuEvent(encrypted, cfg.encryptKey);
      } catch {
        return { status: 400, body: { error: "decrypt failed" } };
      }
    }

    const challenge = extractFeishuChallenge(body);
    if (challenge) return { status: 200, body: { challenge } };

    const token =
      (body as { token?: string; header?: { token?: string } })?.token ||
      (body as { header?: { token?: string } })?.header?.token ||
      "";
    if (!token || !constantTimeEqual(token, cfg.verificationToken)) {
      return { status: 401, body: { error: "invalid token" } };
    }

    const message = parseFeishuMessage(body);
    if (!message) return { status: 200, body: {} };

    void this.dispatch(channelId, message.chatId, message.senderId, message.text, message.isGroup);
    return { status: 200, body: {} };
  }

  private async dispatch(
    channelId: string,
    chatId: string,
    sender: string,
    text: string,
    isGroup: boolean
  ): Promise<void> {
    const sessionKey = `${channelId}:${chatId}`;
    let sessionId = feishuSessions.get(sessionKey);
    if (!sessionId) {
      sessionId = crypto.randomUUID();
      feishuSessions.set(sessionKey, sessionId);
    }

    await logChannelMessage("feishu", "incoming", text, { channelId, senderId: sender });

    const access = evaluateChannelAccess(channelId, String(sender), "feishu", { isGroup });
    if (!access.permitted) {
      if (access.reply) await this.sendMessage(channelId, chatId, access.reply);
      return;
    }

    let response: string;
    try {
      response = await this.messageHandler(text, chatId, sessionId, {
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
      await this.sendMessage(channelId, chatId, response);
      await logChannelMessage("feishu", "outgoing", response, { channelId, senderId: sender });
    }
  }
}

export const feishuAdapter = new FeishuAdapter();
