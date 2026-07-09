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
  verifyNextcloudSignature,
  parseNextcloudMessage,
  signNextcloud,
  newRandom,
} from "../nextcloud-events";

export const nextcloudSessions = new Map<string, string>();

interface NextcloudConfig {
  baseUrl: string;
  secret: string;
}

export class NextcloudAdapter implements ChannelAdapter {
  type = "nextcloud" as const;
  name = "Nextcloud Talk";

  private configs = new Map<string, NextcloudConfig>();
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
    const baseUrl = (typeof config.base_url === "string" ? config.base_url : "")
      .trim()
      .replace(/\/+$/, "");
    const secret = typeof config.secret === "string" ? config.secret.trim() : "";
    if (!baseUrl || !secret) throw new Error("Nextcloud Talk: base_url and secret are required");
    this.configs.set(channelId, { baseUrl, secret });
    this.running.add(channelId);
    console.log(`[Nextcloud] ready for channel ${channelId}`);
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
    const roomToken = String(chatId);
    const random = newRandom();
    const signature = signNextcloud(random, text, cfg.secret);
    const res = await fetch(`${cfg.baseUrl}/ocs/v2.php/apps/talk/api/v1/bot/${roomToken}/message`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "OCS-APIRequest": "true",
        "X-Nextcloud-Talk-Random": random,
        "X-Nextcloud-Talk-Signature": signature,
      },
      body: JSON.stringify({ message: text }),
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

    const random = payload.headers["x-nextcloud-talk-random"] || "";
    const signature = payload.headers["x-nextcloud-talk-signature"] || "";
    const message = extractContent(payload.body);
    if (!verifyNextcloudSignature(random, message, signature, cfg.secret)) {
      return { status: 401, body: { error: "invalid signature" } };
    }

    const inbound = parseNextcloudMessage(payload.body);
    if (inbound) {
      await this.dispatch(channelId, inbound.roomToken, inbound.actorId, inbound.text);
    }
    return { status: 200, body: { ok: true } };
  }

  private async dispatch(
    channelId: string,
    roomToken: string,
    actorId: string,
    text: string
  ): Promise<void> {
    const sessionKey = `${channelId}:${roomToken}`;
    let sessionId = nextcloudSessions.get(sessionKey);
    if (!sessionId) {
      sessionId = crypto.randomUUID();
      nextcloudSessions.set(sessionKey, sessionId);
    }

    await logChannelMessage("nextcloud", "incoming", text, { channelId, senderId: actorId });

    const access = evaluateChannelAccess(channelId, String(actorId), "nextcloud");
    if (!access.permitted) {
      if (access.reply) await this.sendMessage(channelId, roomToken, access.reply);
      return;
    }

    let response: string;
    try {
      response = await this.messageHandler(text, roomToken, sessionId, {
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
      await this.sendMessage(channelId, roomToken, response);
      await logChannelMessage("nextcloud", "outgoing", response, { channelId, senderId: actorId });
    }
  }
}

function extractContent(body: unknown): string {
  const obj = (body as { object?: { content?: string } })?.object;
  return typeof obj?.content === "string" ? obj.content : "";
}

export const nextcloudAdapter = new NextcloudAdapter();
