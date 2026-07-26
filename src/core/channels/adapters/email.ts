import { Socket } from "net";
import { connect as tlsConnect, TLSSocket } from "tls";
import type { ChannelAdapter, ToolCallInfo } from "../types";
import { formatToolCallsPlain } from "../formatting";

interface EmailConfig {
  smtp_host?: string;
  smtp_port?: number;
  imap_host?: string;
  imap_port?: number;
  username?: string;
  password?: string;
  from_address?: string;
  smtp_allow_insecure?: boolean;
}

export class EmailAdapter implements ChannelAdapter {
  type = "email" as const;
  name = "Email (SMTP/IMAP)";

  private running = new Set<string>();
  private configs = new Map<string, EmailConfig>();

  async start(channelId: string, config: Record<string, unknown>): Promise<void> {
    this.configs.set(channelId, {
      smtp_host: typeof config.smtp_host === "string" ? config.smtp_host : undefined,
      smtp_port: typeof config.smtp_port === "number" ? config.smtp_port : 587,
      imap_host: typeof config.imap_host === "string" ? config.imap_host : undefined,
      imap_port: typeof config.imap_port === "number" ? config.imap_port : 993,
      username: typeof config.username === "string" ? config.username : undefined,
      password: typeof config.password === "string" ? config.password : undefined,
      from_address: typeof config.from_address === "string" ? config.from_address : undefined,
      smtp_allow_insecure: config.smtp_allow_insecure === true,
    });
    this.running.add(channelId);
    console.log(`[Email] SMTP/IMAP adapter ready for channel ${channelId}`);
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
    if (!cfg?.smtp_host || !cfg?.username || !cfg?.password || !cfg?.from_address) {
      console.warn("[Email] Missing SMTP credentials; cannot send.");
      return false;
    }
    const to = String(chatId);
    const subject = "Cybara";
    return sendSmtp({
      host: cfg.smtp_host,
      port: cfg.smtp_port ?? 587,
      username: cfg.username,
      password: cfg.password,
      from: cfg.from_address,
      to,
      subject,
      body: text,
      allowInsecure: cfg.smtp_allow_insecure === true,
    });
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

export function sendSmtp(params: {
  host: string;
  port: number;
  username: string;
  password: string;
  from: string;
  to: string;
  subject: string;
  body: string;
  allowInsecure?: boolean;
}): Promise<boolean> {
  if (/[\r\n]/.test(params.to) || /[\r\n]/.test(params.from)) {
    return Promise.reject(new Error("Invalid email address: contains line breaks"));
  }
  if (
    !/^[^\s<>@]+@[^\s<>@]+$/.test(params.to.trim()) ||
    !/^[^\s<>@]+@[^\s<>@]+$/.test(params.from.trim())
  ) {
    return Promise.reject(new Error("Invalid email address"));
  }
  const subject = params.subject.replace(/[\r\n]+/g, " ");
  return new Promise((resolve) => {
    const implicitTls = params.port === 465;
    let socket: Socket | TLSSocket;
    let settled = false;
    let buffer = "";
    let pendingLines: string[] = [];
    const responses: string[] = [];
    let waiter: ((line: string) => void) | null = null;

    const finish = (ok: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      try {
        socket.write("QUIT\r\n");
      } catch {
        void 0;
      }
      try {
        socket.destroy();
      } catch {
        void 0;
      }
      resolve(ok);
    };

    const timeout = setTimeout(() => finish(false), 20_000);

    const deliver = (line: string) => {
      if (waiter) {
        const w = waiter;
        waiter = null;
        w(line);
      } else {
        responses.push(line);
      }
    };

    const onData = (chunk: string) => {
      buffer += chunk;
      let idx: number;
      while ((idx = buffer.indexOf("\r\n")) >= 0) {
        const line = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        pendingLines.push(line);
        if (/^\d{3} /.test(line)) {
          const full = pendingLines.join("\n");
          pendingLines = [];
          deliver(full);
        }
      }
    };

    const attach = (s: Socket | TLSSocket) => {
      s.setEncoding("utf8");
      s.on("data", onData);
      s.on("error", () => finish(false));
    };

    const expect = () =>
      new Promise<string>((res) => {
        const ready = responses.shift();
        if (ready !== undefined) res(ready);
        else waiter = res;
      });

    const codeOf = (line: string) => parseInt(line.slice(0, 3), 10);
    const b64 = (s: string) => Buffer.from(s).toString("base64");

    const send = (text: string) => socket.write(`${text}\r\n`);
    const command = async (text: string, ok: number) => {
      send(text);
      const line = await expect();
      if (codeOf(line) !== ok) throw new Error(`SMTP ${text.split(" ")[0]}: ${line}`);
      return line;
    };

    const run = async () => {
      const greeting = await expect();
      if (codeOf(greeting) !== 220) throw new Error(`SMTP greeting: ${greeting}`);

      let ehlo = await command("EHLO cybara", 250);

      if (!implicitTls) {
        const supportsStartTls = /(^|\n)\d{3}[ -]STARTTLS/i.test(ehlo);
        if (!supportsStartTls) {
          if (!params.allowInsecure) {
            throw new Error("SMTP server does not offer STARTTLS and insecure send is disabled");
          }
        } else {
          await command("STARTTLS", 220);
          const plain = socket;
          plain.removeListener("data", onData);
          buffer = "";
          pendingLines = [];
          socket = tlsConnect({ socket: plain as Socket, servername: params.host });
          attach(socket);
          await new Promise<void>((res, rej) => {
            (socket as TLSSocket).once("secureConnect", () => res());
            (socket as TLSSocket).once("error", rej);
          });
          ehlo = await command("EHLO cybara", 250);
        }
      }

      await command("AUTH LOGIN", 334);
      await command(b64(params.username), 334);
      await command(b64(params.password), 235);
      await command(`MAIL FROM:<${params.from}>`, 250);
      await command(`RCPT TO:<${params.to}>`, 250);
      await command("DATA", 354);
      const message = [
        `From: ${params.from}`,
        `To: ${params.to}`,
        `Subject: ${subject}`,
        `Content-Type: text/plain; charset=utf-8`,
        ``,
        params.body,
      ].join("\r\n");
      socket.write(`${message}\r\n.\r\n`);
      const finalLine = await expect();
      if (codeOf(finalLine) !== 250) throw new Error(`SMTP DATA end: ${finalLine}`);
      finish(true);
    };

    if (implicitTls) {
      socket = tlsConnect({ host: params.host, port: params.port, servername: params.host });
    } else {
      socket = new Socket();
    }
    attach(socket);
    const startFlow = () => {
      run().catch((err) => {
        console.warn(`[Email] SMTP send failed: ${err instanceof Error ? err.message : err}`);
        finish(false);
      });
    };
    if (implicitTls) {
      (socket as TLSSocket).once("secureConnect", startFlow);
    } else {
      (socket as Socket).once("connect", startFlow);
      (socket as Socket).connect(params.port, params.host);
    }
  });
}

export const emailAdapter = new EmailAdapter();
