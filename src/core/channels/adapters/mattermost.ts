import type { ChannelAdapter, ToolCallInfo, MessageHandler } from "../types";
import { evaluateChannelAccess } from "../access-gate";
import { buildChannelSecurityConfig, securityManager } from "../security";
import { formatToolCallsPlain } from "../formatting";
import { logChannelMessage } from "../../logging";
import { parseMattermostEvent, websocketUrl } from "../mattermost-events";

export const mattermostSessions = new Map<string, string>();

interface MattermostConfig {
  baseUrl: string;
  token: string;
}

interface MattermostRuntime {
  config: MattermostConfig;
  selfUserId: string;
  ws?: WebSocket;
  closed: boolean;
  seq: number;
}

export class MattermostAdapter implements ChannelAdapter {
  type = "mattermost" as const;
  name = "Mattermost";

  private runtimes = new Map<string, MattermostRuntime>();
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
    const token = typeof config.token === "string" ? config.token.trim() : "";
    if (!baseUrl || !token) throw new Error("Mattermost: base_url and token are required");

    const me = await this.request(baseUrl, token, "GET", "/api/v4/users/me");
    const selfUserId = String((me as { id?: string }).id || "");

    const runtime: MattermostRuntime = {
      config: { baseUrl, token },
      selfUserId,
      closed: false,
      seq: 1,
    };
    this.runtimes.set(channelId, runtime);
    this.connectWs(channelId);
    console.log(`[Mattermost] connected as ${selfUserId} on ${baseUrl}`);
  }

  async stop(channelId: string): Promise<void> {
    const runtime = this.runtimes.get(channelId);
    if (runtime) {
      runtime.closed = true;
      try {
        runtime.ws?.close();
      } catch {
        /* ignore */
      }
    }
    this.runtimes.delete(channelId);
  }

  isRunning(channelId: string): boolean {
    return this.runtimes.has(channelId);
  }

  async sendMessage(channelId: string, chatId: string | number, text: string): Promise<boolean> {
    const runtime = this.runtimes.get(channelId);
    if (!runtime) return false;
    try {
      await this.request(runtime.config.baseUrl, runtime.config.token, "POST", "/api/v4/posts", {
        channel_id: String(chatId),
        message: text,
      });
      return true;
    } catch (error) {
      console.warn(`[Mattermost] send failed: ${error instanceof Error ? error.message : error}`);
      return false;
    }
  }

  formatResponse(content: string, toolCalls?: ToolCallInfo[]): string {
    if (toolCalls && toolCalls.length > 0) {
      return formatToolCallsPlain(toolCalls) + "\n\n" + content;
    }
    return content;
  }

  private connectWs(channelId: string): void {
    const runtime = this.runtimes.get(channelId);
    if (!runtime || runtime.closed) return;

    const ws = new WebSocket(websocketUrl(runtime.config.baseUrl));
    runtime.ws = ws;

    ws.addEventListener("open", () => {
      ws.send(
        JSON.stringify({
          seq: runtime.seq++,
          action: "authentication_challenge",
          data: { token: runtime.config.token },
        })
      );
    });

    ws.addEventListener("message", (ev) => {
      const data = typeof ev.data === "string" ? ev.data : "";
      const inbound = parseMattermostEvent(data, runtime.selfUserId);
      if (inbound)
        void this.dispatch(channelId, inbound.channelId, inbound.userId, inbound.message);
    });

    ws.addEventListener("close", () => {
      if (runtime.closed) return;
      setTimeout(() => this.connectWs(channelId), 3000);
    });

    ws.addEventListener("error", () => {
      try {
        ws.close();
      } catch {
        /* ignore */
      }
    });
  }

  private async dispatch(
    channelId: string,
    mmChannelId: string,
    userId: string,
    message: string
  ): Promise<void> {
    const sessionKey = `${channelId}:${mmChannelId}`;
    let sessionId = mattermostSessions.get(sessionKey);
    if (!sessionId) {
      sessionId = crypto.randomUUID();
      mattermostSessions.set(sessionKey, sessionId);
    }

    await logChannelMessage("mattermost", "incoming", message, { channelId, senderId: userId });

    const access = evaluateChannelAccess(channelId, String(userId), "mattermost");
    if (!access.permitted) {
      if (access.reply) await this.sendMessage(channelId, mmChannelId, access.reply);
      return;
    }

    let response: string;
    try {
      response = await this.messageHandler(message, mmChannelId, sessionId, {
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
      await this.sendMessage(channelId, mmChannelId, response);
      await logChannelMessage("mattermost", "outgoing", response, { channelId, senderId: userId });
    }
  }

  private async request(
    baseUrl: string,
    token: string,
    method: string,
    path: string,
    body?: unknown
  ): Promise<unknown> {
    const res = await fetch(`${baseUrl}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      const text = (await res.text().catch(() => "")).slice(0, 200);
      throw new Error(`Mattermost ${method} ${path} -> ${res.status}${text ? ` ${text}` : ""}`);
    }
    return res.json();
  }
}

export const mattermostAdapter = new MattermostAdapter();
