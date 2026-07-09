import type { ChannelAdapter, ToolCallInfo, MessageHandler } from "../types";
import { evaluateChannelAccess } from "../access-gate";
import { buildChannelSecurityConfig, securityManager } from "../security";
import { formatToolCallsPlain } from "../formatting";
import { logChannelMessage } from "../../logging";
import {
  parseSyncMessages,
  buildLoginBody,
  sendEventPath,
  normalizeHomeserverUrl,
} from "../matrix-sync";

export const matrixSessions = new Map<string, string>();

interface MatrixConfig {
  homeserver: string;
  accessToken?: string;
  userId?: string;
  password?: string;
}

interface MatrixRuntime {
  config: MatrixConfig;
  accessToken: string;
  selfUserId: string;
  abort: AbortController;
  txn: number;
}

export class MatrixAdapter implements ChannelAdapter {
  type = "matrix" as const;
  name = "Matrix";

  private runtimes = new Map<string, MatrixRuntime>();
  private messageHandler: MessageHandler = async () => "No handler configured";

  setMessageHandler(handler: MessageHandler) {
    this.messageHandler = handler;
  }

  getMessageHandler(): MessageHandler {
    return this.messageHandler;
  }

  async start(channelId: string, config: Record<string, unknown>): Promise<void> {
    securityManager.setConfig(channelId, buildChannelSecurityConfig(config));
    const homeserver = normalizeHomeserverUrl(
      typeof config.homeserver === "string" ? config.homeserver : ""
    );
    if (!homeserver) throw new Error("Matrix: homeserver is required");

    const cfg: MatrixConfig = {
      homeserver,
      accessToken: typeof config.access_token === "string" ? config.access_token : undefined,
      userId: typeof config.user_id === "string" ? config.user_id : undefined,
      password: typeof config.password === "string" ? config.password : undefined,
    };

    let accessToken = cfg.accessToken || "";
    let selfUserId = cfg.userId || "";

    if (!accessToken) {
      if (!cfg.userId || !cfg.password) {
        throw new Error("Matrix: provide access_token, or user_id + password");
      }
      const login = await this.request(homeserver, "", "POST", "/_matrix/client/v3/login", {
        body: buildLoginBody(cfg.userId, cfg.password),
      });
      accessToken = String((login as { access_token?: string }).access_token || "");
      selfUserId = String((login as { user_id?: string }).user_id || cfg.userId);
      if (!accessToken) throw new Error("Matrix: login did not return an access token");
    }

    if (!selfUserId) {
      const who = await this.request(
        homeserver,
        accessToken,
        "GET",
        "/_matrix/client/v3/account/whoami"
      );
      selfUserId = String((who as { user_id?: string }).user_id || "");
    }

    const runtime: MatrixRuntime = {
      config: cfg,
      accessToken,
      selfUserId,
      abort: new AbortController(),
      txn: Date.now(),
    };
    this.runtimes.set(channelId, runtime);

    const initial = await this.request(
      homeserver,
      accessToken,
      "GET",
      "/_matrix/client/v3/sync?timeout=0"
    );
    const { nextBatch } = parseSyncMessages(initial, selfUserId, { ignoreInitial: true });
    void this.syncLoop(channelId, nextBatch);
    console.log(`[Matrix] Connected as ${selfUserId} on ${homeserver}`);
  }

  async stop(channelId: string): Promise<void> {
    const runtime = this.runtimes.get(channelId);
    if (runtime) runtime.abort.abort();
    this.runtimes.delete(channelId);
  }

  isRunning(channelId: string): boolean {
    return this.runtimes.has(channelId);
  }

  async sendMessage(channelId: string, chatId: string | number, text: string): Promise<boolean> {
    const runtime = this.runtimes.get(channelId);
    if (!runtime) return false;
    const txnId = `cybara-${runtime.txn++}`;
    try {
      await this.request(
        runtime.config.homeserver,
        runtime.accessToken,
        "PUT",
        sendEventPath(String(chatId), txnId),
        { body: { msgtype: "m.text", body: text } }
      );
      return true;
    } catch (error) {
      console.warn(`[Matrix] send failed: ${error instanceof Error ? error.message : error}`);
      return false;
    }
  }

  formatResponse(content: string, toolCalls?: ToolCallInfo[]): string {
    if (toolCalls && toolCalls.length > 0) {
      return formatToolCallsPlain(toolCalls) + "\n\n" + content;
    }
    return content;
  }

  private async syncLoop(channelId: string, since: string | null): Promise<void> {
    const runtime = this.runtimes.get(channelId);
    if (!runtime) return;
    let cursor = since;

    while (!runtime.abort.signal.aborted) {
      try {
        const query = `timeout=30000${cursor ? `&since=${encodeURIComponent(cursor)}` : ""}`;
        const sync = await this.request(
          runtime.config.homeserver,
          runtime.accessToken,
          "GET",
          `/_matrix/client/v3/sync?${query}`,
          { signal: runtime.abort.signal }
        );
        const { nextBatch, messages } = parseSyncMessages(sync, runtime.selfUserId);
        cursor = nextBatch ?? cursor;

        for (const msg of messages) {
          await this.dispatch(channelId, msg.roomId, msg.sender, msg.body);
        }
      } catch (error) {
        if (runtime.abort.signal.aborted) break;
        console.warn(`[Matrix] sync error: ${error instanceof Error ? error.message : error}`);
        await new Promise((r) => setTimeout(r, 3000));
      }
    }
  }

  private async dispatch(
    channelId: string,
    roomId: string,
    sender: string,
    body: string
  ): Promise<void> {
    const sessionKey = `${channelId}:${roomId}`;
    let sessionId = matrixSessions.get(sessionKey);
    if (!sessionId) {
      sessionId = crypto.randomUUID();
      matrixSessions.set(sessionKey, sessionId);
    }

    await logChannelMessage("matrix", "incoming", body, { channelId, senderId: sender });

    const access = evaluateChannelAccess(channelId, String(sender), "matrix");
    if (!access.permitted) {
      if (access.reply) await this.sendMessage(channelId, roomId, access.reply);
      return;
    }

    let response: string;
    try {
      response = await this.messageHandler(body, roomId, sessionId, {
        channelId,
        hasFile: false,
        filePath: "",
        fileType: "",
        placeholder: "",
      });
    } catch (error) {
      response = `Error: ${error instanceof Error ? error.message : "failed to process"}`;
    }

    if (response) {
      await this.sendMessage(channelId, roomId, response);
      await logChannelMessage("matrix", "outgoing", response, { channelId, senderId: sender });
    }
  }

  private async request(
    homeserver: string,
    accessToken: string,
    method: string,
    path: string,
    options: { body?: unknown; signal?: AbortSignal } = {}
  ): Promise<unknown> {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
    const response = await fetch(`${homeserver}${path}`, {
      method,
      headers,
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
      signal: options.signal,
    });
    if (!response.ok) {
      const text = (await response.text().catch(() => "")).slice(0, 200);
      throw new Error(`Matrix ${method} ${path} -> ${response.status}${text ? ` ${text}` : ""}`);
    }
    return response.json();
  }
}

export const matrixAdapter = new MatrixAdapter();
