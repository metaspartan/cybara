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
import { parseHomeAssistantWebhook, notifyTarget } from "../homeassistant-events";

export const homeAssistantSessions = new Map<string, string>();

interface HaChannelConfig {
  haUrl?: string;
  haToken?: string;
  notifyService?: string;
  verifyToken: string;
}

export class HomeAssistantAdapter implements ChannelAdapter {
  type = "homeassistant" as const;
  name = "Home Assistant";

  private configs = new Map<string, HaChannelConfig>();
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
    const verifyToken = typeof config.verify_token === "string" ? config.verify_token.trim() : "";
    if (!verifyToken) throw new Error("Home Assistant: verify_token is required");
    this.configs.set(channelId, {
      haUrl:
        typeof config.ha_url === "string" && config.ha_url.trim()
          ? config.ha_url.trim().replace(/\/+$/, "")
          : undefined,
      haToken: typeof config.ha_token === "string" ? config.ha_token.trim() : undefined,
      notifyService:
        typeof config.notify_service === "string" ? config.notify_service.trim() : undefined,
      verifyToken,
    });
    this.running.add(channelId);
    console.log(`[HomeAssistant] ready for channel ${channelId}`);
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
    if (!cfg?.haUrl || !cfg.haToken || !cfg.notifyService) return false;
    const { domain, service } = notifyTarget(cfg.notifyService);
    const res = await fetch(
      `${cfg.haUrl}/api/services/${encodeURIComponent(domain)}/${encodeURIComponent(service)}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${cfg.haToken}`,
        },
        body: JSON.stringify({ message: text }),
      }
    );
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

    const provided =
      payload.query.token || (payload.headers.authorization || "").replace(/^Bearer\s+/i, "") || "";
    if (!constantTimeEqual(provided, cfg.verifyToken))
      return { status: 401, body: { error: "invalid token" } };

    const event = parseHomeAssistantWebhook(payload.body, payload.query);
    if (!event) return { status: 200, body: {} };

    const reply = await this.dispatch(channelId, event.conversationId, event.senderId, event.text);
    return { status: 200, body: reply ? { response: reply } : {} };
  }

  private async dispatch(
    channelId: string,
    conversationId: string,
    sender: string,
    text: string
  ): Promise<string | null> {
    const sessionKey = `${channelId}:${conversationId}`;
    let sessionId = homeAssistantSessions.get(sessionKey);
    if (!sessionId) {
      sessionId = crypto.randomUUID();
      homeAssistantSessions.set(sessionKey, sessionId);
    }

    await logChannelMessage("homeassistant", "incoming", text, { channelId, senderId: sender });

    const access = evaluateChannelAccess(channelId, "homeassistant", "homeassistant", {
      isGroup: false,
    });
    if (!access.permitted) return access.reply ?? null;

    let response: string;
    try {
      response = await this.messageHandler(text, conversationId, sessionId, {
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
      await this.sendMessage(channelId, conversationId, response);
      await logChannelMessage("homeassistant", "outgoing", response, {
        channelId,
        senderId: sender,
      });
    }
    return response || null;
  }
}

export const homeAssistantAdapter = new HomeAssistantAdapter();
