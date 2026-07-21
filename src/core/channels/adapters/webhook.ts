import { createHmac } from "crypto";
import type {
  ChannelAdapter,
  MessageHandler,
  ToolCallInfo,
  WebhookPayload,
  WebhookResult,
} from "../types";
import { formatToolCallsPlain } from "../formatting";
import { constantTimeEqual } from "../constant-time";
import { buildChannelSecurityConfig, securityManager } from "../security";
import { evaluateChannelAccess } from "../access-gate";
import { logChannelMessage } from "../../logging";

interface WebhookConfig {
  secret: string;
  principalId: string;
}

interface WebhookInput {
  message: string;
  senderId: string;
  conversationId: string;
}

const webhookSessions = new Map<string, string>();

function headerValue(headers: Record<string, string>, name: string): string {
  const match = Object.entries(headers).find(([key]) => key.toLowerCase() === name.toLowerCase());
  return match?.[1] || "";
}

function parseWebhookInput(payload: WebhookPayload, principalId: string): WebhookInput | null {
  const body =
    payload.body && typeof payload.body === "object"
      ? (payload.body as Record<string, unknown>)
      : {};
  const messageValue = body.message ?? body.text ?? body.content;
  if (typeof messageValue !== "string" || !messageValue.trim()) return null;
  const conversationValue =
    body.conversation_id ??
    body.conversationId ??
    payload.query.conversation_id ??
    payload.query.conversation;
  return {
    message: messageValue.trim(),
    senderId: principalId,
    conversationId:
      typeof conversationValue === "string" && conversationValue.trim()
        ? conversationValue.trim()
        : "default",
  };
}

export class WebhookAdapter implements ChannelAdapter {
  type = "webhook" as const;
  name = "Webhook";

  private running = new Set<string>();
  private configs = new Map<string, WebhookConfig>();
  private messageHandler: MessageHandler = async () => "No handler configured";

  setMessageHandler(handler: MessageHandler): void {
    this.messageHandler = handler;
  }

  getMessageHandler(): MessageHandler {
    return this.messageHandler;
  }

  async start(channelId: string, config: Record<string, unknown>): Promise<void> {
    const secret = typeof config.secret === "string" ? config.secret.trim() : "";
    if (!secret) throw new Error("Webhook: secret is required");
    const principalId =
      typeof config.principal_id === "string" && config.principal_id.trim()
        ? config.principal_id.trim()
        : "webhook";
    securityManager.setConfig(channelId, buildChannelSecurityConfig(config));
    this.configs.set(channelId, { secret, principalId });
    this.running.add(channelId);
    console.log(`[Webhook] Adapter ready for channel ${channelId}`);
  }

  async stop(channelId: string): Promise<void> {
    this.running.delete(channelId);
    this.configs.delete(channelId);
  }

  isRunning(channelId: string): boolean {
    return this.running.has(channelId);
  }

  async sendMessage(): Promise<boolean> {
    return true;
  }

  async handleWebhook(channelId: string, payload: WebhookPayload): Promise<WebhookResult> {
    const config = this.configs.get(channelId);
    if (!config) return { status: 404, body: { error: "channel is not running" } };
    const signature = headerValue(payload.headers, "x-cybara-signature");
    if (!verifyWebhookSignature(payload.rawBody, signature, config.secret)) {
      return { status: 401, body: { error: "invalid signature" } };
    }
    const input = parseWebhookInput(payload, config.principalId);
    if (!input) return { status: 400, body: { error: "message is required" } };
    const access = evaluateChannelAccess(channelId, input.senderId, "webhook", { isGroup: false });
    if (!access.permitted) {
      return {
        status: access.reply ? 403 : 204,
        body: access.reply ? { error: access.reply } : {},
      };
    }
    const sessionKey = `${channelId}:${input.conversationId}`;
    let sessionId = webhookSessions.get(sessionKey);
    if (!sessionId) {
      sessionId = crypto.randomUUID();
      webhookSessions.set(sessionKey, sessionId);
    }
    await logChannelMessage("webhook", "incoming", input.message, {
      channelId,
      senderId: input.senderId,
    });
    const response = await this.messageHandler(input.message, input.conversationId, sessionId, {
      channelId,
      hasFile: false,
      filePath: "",
      fileType: "",
      placeholder: "",
    });
    await logChannelMessage("webhook", "outgoing", response, {
      channelId,
      senderId: input.senderId,
    });
    return { status: 200, body: { response, session_id: sessionId } };
  }

  formatResponse(content: string, toolCalls?: ToolCallInfo[], thinking?: string): string {
    let text = content;
    if (toolCalls && toolCalls.length > 0) {
      text = formatToolCallsPlain(toolCalls) + "\n\n" + text;
    }
    if (thinking) {
      text += `\n\n💭 Thinking: ${thinking}`;
    }
    return text;
  }
}

export function verifyWebhookSignature(
  rawBody: string,
  signature: string | undefined,
  secret: string
): boolean {
  if (!secret) return false;
  if (!signature) return false;
  try {
    const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
    const sig = signature.startsWith("sha256=") ? signature.slice(7) : signature;
    return constantTimeEqual(expected, sig);
  } catch {
    return false;
  }
}

export const webhookAdapter = new WebhookAdapter();
