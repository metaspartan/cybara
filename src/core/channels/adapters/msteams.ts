import type {
  ChannelAdapter,
  ToolCallInfo,
  MessageHandler,
  WebhookPayload,
  WebhookResult,
} from "../types";
import { formatToolCallsPlain } from "../formatting";
import { logChannelMessage } from "../../logging";
import { parseMsTeamsActivity, verifyMsTeamsSignature } from "../msteams-events";

export const msTeamsSessions = new Map<string, string>();

interface MsTeamsConfig {
  securityToken: string;
  incomingWebhookUrl?: string;
}

export class MsTeamsAdapter implements ChannelAdapter {
  type = "msteams" as const;
  name = "Microsoft Teams";

  private configs = new Map<string, MsTeamsConfig>();
  private running = new Set<string>();
  private messageHandler: MessageHandler = async () => "No handler configured";

  setMessageHandler(handler: MessageHandler) {
    this.messageHandler = handler;
  }

  getMessageHandler(): MessageHandler {
    return this.messageHandler;
  }

  async start(channelId: string, config: Record<string, unknown>): Promise<void> {
    const securityToken =
      typeof config.security_token === "string" ? config.security_token.trim() : "";
    if (!securityToken) throw new Error("Microsoft Teams: security_token is required");
    this.configs.set(channelId, {
      securityToken,
      incomingWebhookUrl:
        typeof config.incoming_webhook_url === "string"
          ? config.incoming_webhook_url.trim()
          : undefined,
    });
    this.running.add(channelId);
    console.log(`[MsTeams] ready for channel ${channelId}`);
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
    if (!cfg?.incomingWebhookUrl) return false;
    const res = await fetch(cfg.incomingWebhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
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

    const auth = payload.headers.authorization || payload.headers.Authorization || "";
    if (!verifyMsTeamsSignature(payload.rawBody, auth, cfg.securityToken)) {
      return { status: 401, body: { type: "message", text: "Invalid signature" } };
    }

    const activity = parseMsTeamsActivity(payload.body);
    if (!activity) return { status: 200, body: {} };

    const reply = await this.dispatch(
      channelId,
      activity.conversationId,
      activity.sender,
      activity.text
    );
    return { status: 200, body: { type: "message", text: reply || "" } };
  }

  private async dispatch(
    channelId: string,
    conversationId: string,
    sender: string,
    text: string
  ): Promise<string | null> {
    const sessionKey = `${channelId}:${conversationId}`;
    let sessionId = msTeamsSessions.get(sessionKey);
    if (!sessionId) {
      sessionId = crypto.randomUUID();
      msTeamsSessions.set(sessionKey, sessionId);
    }

    await logChannelMessage("msteams", "incoming", text, { channelId, senderId: sender });

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
      await logChannelMessage("msteams", "outgoing", response, { channelId, senderId: sender });
    }
    return response || null;
  }
}

export const msTeamsAdapter = new MsTeamsAdapter();
