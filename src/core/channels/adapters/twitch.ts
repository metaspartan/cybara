import type { ChannelAdapter, ToolCallInfo, MessageHandler } from "../types";
import { evaluateChannelAccess } from "../access-gate";
import { buildChannelSecurityConfig, securityManager } from "../security";
import { formatToolCallsPlain } from "../formatting";
import { logChannelMessage } from "../../logging";
import { parseIrcLine, parsePrivmsg, isPing } from "../irc-protocol";

export const twitchSessions = new Map<string, string>();

const TWITCH_WS = "wss://irc-ws.chat.twitch.tv:443";

interface TwitchConfig {
  username: string;
  token: string;
  channels: string[];
}

interface TwitchRuntime {
  config: TwitchConfig;
  ws?: WebSocket;
  closed: boolean;
}

export class TwitchAdapter implements ChannelAdapter {
  type = "twitch" as const;
  name = "Twitch";

  private runtimes = new Map<string, TwitchRuntime>();
  private messageHandler: MessageHandler = async () => "No handler configured";

  setMessageHandler(handler: MessageHandler) {
    this.messageHandler = handler;
  }

  getMessageHandler(): MessageHandler {
    return this.messageHandler;
  }

  async start(channelId: string, config: Record<string, unknown>): Promise<void> {
    securityManager.setConfig(channelId, buildChannelSecurityConfig(config));
    const username = (typeof config.username === "string" ? config.username : "")
      .trim()
      .toLowerCase();
    const tokenRaw = typeof config.oauth_token === "string" ? config.oauth_token.trim() : "";
    if (!username || !tokenRaw) throw new Error("Twitch: username and oauth_token are required");

    const channels = String(config.channels || username)
      .split(",")
      .map((c) => c.trim().toLowerCase().replace(/^#/, ""))
      .filter(Boolean)
      .map((c) => `#${c}`);

    const runtime: TwitchRuntime = {
      config: {
        username,
        token: tokenRaw.startsWith("oauth:") ? tokenRaw : `oauth:${tokenRaw}`,
        channels,
      },
      closed: false,
    };
    this.runtimes.set(channelId, runtime);
    this.connect(channelId);
    console.log(`[Twitch] connecting as ${username} to ${channels.join(", ")}`);
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
    if (!runtime?.ws || runtime.ws.readyState !== WebSocket.OPEN) return false;
    const target = String(chatId).startsWith("#") ? String(chatId) : `#${chatId}`;
    for (const line of text.split(/\r?\n/)) {
      if (!line) continue;
      runtime.ws.send(`PRIVMSG ${target} :${line}`);
    }
    return true;
  }

  formatResponse(content: string, toolCalls?: ToolCallInfo[]): string {
    if (toolCalls && toolCalls.length > 0) {
      return formatToolCallsPlain(toolCalls) + "\n\n" + content;
    }
    return content;
  }

  private connect(channelId: string): void {
    const runtime = this.runtimes.get(channelId);
    if (!runtime || runtime.closed) return;

    const ws = new WebSocket(TWITCH_WS);
    runtime.ws = ws;

    ws.addEventListener("open", () => {
      ws.send(`PASS ${runtime.config.token}`);
      ws.send(`NICK ${runtime.config.username}`);
      for (const channel of runtime.config.channels) ws.send(`JOIN ${channel}`);
    });

    ws.addEventListener("message", (ev) => {
      const data = typeof ev.data === "string" ? ev.data : "";
      for (const raw of data.split("\r\n")) {
        const line = parseIrcLine(raw);
        if (!line) continue;
        const ping = isPing(line);
        if (ping !== null) {
          ws.send(`PONG :${ping}`);
          continue;
        }
        const msg = parsePrivmsg(line);
        if (msg && msg.senderNick !== runtime.config.username) {
          void this.dispatch(channelId, msg.target, msg.senderNick, msg.text);
        }
      }
    });

    ws.addEventListener("close", () => {
      if (runtime.closed) return;
      setTimeout(() => this.connect(channelId), 3000);
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
    target: string,
    senderNick: string,
    text: string
  ): Promise<void> {
    const sessionKey = `${channelId}:${target}:${senderNick}`;
    let sessionId = twitchSessions.get(sessionKey);
    if (!sessionId) {
      sessionId = crypto.randomUUID();
      twitchSessions.set(sessionKey, sessionId);
    }

    await logChannelMessage("twitch", "incoming", text, { channelId, senderId: senderNick });

    const access = evaluateChannelAccess(channelId, String(senderNick), "twitch");
    if (!access.permitted) {
      if (access.reply) await this.sendMessage(channelId, target, access.reply);
      return;
    }

    let response: string;
    try {
      response = await this.messageHandler(text, target, sessionId, {
        hasFile: false,
        filePath: "",
        fileType: "",
        placeholder: "",
      });
    } catch (error) {
      response = `Error: ${error instanceof Error ? error.message : "failed"}`;
    }

    if (response) {
      await this.sendMessage(channelId, target, response);
      await logChannelMessage("twitch", "outgoing", response, { channelId, senderId: senderNick });
    }
  }
}

export const twitchAdapter = new TwitchAdapter();
