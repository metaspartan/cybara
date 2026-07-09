import { connect as tlsConnect, type TLSSocket } from "tls";
import { evaluateChannelAccess } from "../access-gate";
import { buildChannelSecurityConfig, securityManager } from "../security";
import { createConnection, type Socket } from "net";
import type { ChannelAdapter, ToolCallInfo, MessageHandler } from "../types";
import { formatToolCallsPlain } from "../formatting";
import { logChannelMessage } from "../../logging";
import { parseIrcLine, parsePrivmsg, isPing } from "../irc-protocol";

export const ircSessions = new Map<string, string>();

interface IrcConfig {
  server: string;
  port: number;
  tls: boolean;
  nick: string;
  channels: string[];
  password?: string;
  nickservPassword?: string;
}

interface IrcRuntime {
  config: IrcConfig;
  socket: Socket | TLSSocket;
  buffer: string;
  registered: boolean;
}

export class IrcAdapter implements ChannelAdapter {
  type = "irc" as const;
  name = "IRC";

  private runtimes = new Map<string, IrcRuntime>();
  private messageHandler: MessageHandler = async () => "No handler configured";

  setMessageHandler(handler: MessageHandler) {
    this.messageHandler = handler;
  }

  getMessageHandler(): MessageHandler {
    return this.messageHandler;
  }

  async start(channelId: string, config: Record<string, unknown>): Promise<void> {
    securityManager.setConfig(channelId, buildChannelSecurityConfig(config));
    const server = typeof config.server === "string" ? config.server.trim() : "";
    const nick = typeof config.nick === "string" ? config.nick.trim() : "";
    if (!server || !nick) throw new Error("IRC: server and nick are required");

    const tls = config.tls !== false;
    const port = typeof config.port === "number" ? config.port : tls ? 6697 : 6667;
    const channels = String(config.channels || "")
      .split(",")
      .map((c) => c.trim())
      .filter(Boolean)
      .map((c) => (c.startsWith("#") ? c : `#${c}`));

    const cfg: IrcConfig = {
      server,
      port,
      tls,
      nick,
      channels,
      password: typeof config.password === "string" ? config.password : undefined,
      nickservPassword:
        typeof config.nickserv_password === "string" ? config.nickserv_password : undefined,
    };

    const socket = tls
      ? tlsConnect({ host: server, port, servername: server })
      : createConnection({ host: server, port });

    const runtime: IrcRuntime = { config: cfg, socket, buffer: "", registered: false };
    this.runtimes.set(channelId, runtime);

    socket.setEncoding("utf8");
    socket.on("connect", () => this.onConnect(channelId));
    socket.on("secureConnect", () => this.onConnect(channelId));
    socket.on("data", (chunk: string) => this.onData(channelId, chunk));
    socket.on("error", (err: Error) => console.warn(`[IRC] socket error: ${err.message}`));
    socket.on("close", () => {
      if (this.runtimes.has(channelId)) console.log(`[IRC] disconnected (${server})`);
    });
  }

  async stop(channelId: string): Promise<void> {
    const runtime = this.runtimes.get(channelId);
    if (runtime) {
      try {
        runtime.socket.write("QUIT :bye\r\n");
        runtime.socket.end();
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
    const target = String(chatId);
    for (const line of text.split(/\r?\n/)) {
      if (!line) continue;
      runtime.socket.write(`PRIVMSG ${target} :${line}\r\n`);
    }
    return true;
  }

  formatResponse(content: string, toolCalls?: ToolCallInfo[]): string {
    if (toolCalls && toolCalls.length > 0) {
      return formatToolCallsPlain(toolCalls) + "\n\n" + content;
    }
    return content;
  }

  private onConnect(channelId: string): void {
    const runtime = this.runtimes.get(channelId);
    if (!runtime) return;
    const { config } = runtime;
    if (config.password) runtime.socket.write(`PASS ${config.password}\r\n`);
    runtime.socket.write(`NICK ${config.nick}\r\n`);
    runtime.socket.write(`USER ${config.nick} 0 * :${config.nick}\r\n`);
  }

  private onData(channelId: string, chunk: string): void {
    const runtime = this.runtimes.get(channelId);
    if (!runtime) return;
    runtime.buffer += chunk;
    const lines = runtime.buffer.split("\r\n");
    runtime.buffer = lines.pop() || "";

    for (const raw of lines) {
      const line = parseIrcLine(raw);
      if (!line) continue;

      const ping = isPing(line);
      if (ping !== null) {
        runtime.socket.write(`PONG :${ping}\r\n`);
        continue;
      }

      if (!runtime.registered && (line.command === "001" || line.command === "376")) {
        runtime.registered = true;
        if (runtime.config.nickservPassword) {
          runtime.socket.write(`PRIVMSG NickServ :IDENTIFY ${runtime.config.nickservPassword}\r\n`);
        }
        for (const channel of runtime.config.channels) {
          runtime.socket.write(`JOIN ${channel}\r\n`);
        }
        continue;
      }

      const msg = parsePrivmsg(line);
      if (msg && msg.senderNick !== runtime.config.nick) {
        void this.dispatch(channelId, runtime, msg.target, msg.senderNick, msg.text);
      }
    }
  }

  private async dispatch(
    channelId: string,
    runtime: IrcRuntime,
    target: string,
    senderNick: string,
    text: string
  ): Promise<void> {
    const replyTarget = target.startsWith("#") ? target : senderNick;
    const sessionKey = `${channelId}:${replyTarget}:${senderNick}`;
    let sessionId = ircSessions.get(sessionKey);
    if (!sessionId) {
      sessionId = crypto.randomUUID();
      ircSessions.set(sessionKey, sessionId);
    }

    await logChannelMessage("irc", "incoming", text, { channelId, senderId: senderNick });

    const access = evaluateChannelAccess(channelId, String(senderNick), "irc");
    if (!access.permitted) {
      if (access.reply) await this.sendMessage(channelId, replyTarget, access.reply);
      return;
    }

    let response: string;
    try {
      response = await this.messageHandler(text, replyTarget, sessionId, {
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
      await this.sendMessage(channelId, replyTarget, response);
      await logChannelMessage("irc", "outgoing", response, { channelId, senderId: senderNick });
    }
  }
}

export const ircAdapter = new IrcAdapter();
