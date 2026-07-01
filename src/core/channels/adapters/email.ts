/**
 * Email channel adapter (SMTP send + IMAP poll receive).
 *
 * Sends outbound email via raw SMTP (socket-level, no nodemailer dependency) and
 * polls an IMAP inbox for inbound mail (IMAP poll + allowed-senders). This
 * adapter handles SMTP send directly; IMAP receive is polled by the manager
 * via fetchInbox().
 */
import { Socket } from "net";
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

  /**
   * Send an email via raw SMTP (EHLO/AUTH LOGIN/MAIL FROM/RCPT TO/DATA).
   * `chatId` is the recipient address. Minimal but dependency-free.
   */
  async sendMessage(
    channelId: string,
    chatId: string | number,
    text: string
  ): Promise<boolean> {
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

/** Minimal SMTP submission over a raw socket with AUTH LOGIN. */
function sendSmtp(params: {
  host: string;
  port: number;
  username: string;
  password: string;
  from: string;
  to: string;
  subject: string;
  body: string;
}): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new Socket();
    let step = 0;
    let buffer = "";
    const b64 = (s: string) => Buffer.from(s).toString("base64");
    const lines = [
      `EHLO cybara`,
      `AUTH LOGIN`,
      b64(params.username),
      b64(params.password),
      `MAIL FROM:<${params.from}>`,
      `RCPT TO:<${params.to}>`,
      `DATA`,
      [
        `From: ${params.from}`,
        `To: ${params.to}`,
        `Subject: ${params.subject}`,
        `Content-Type: text/plain; charset=utf-8`,
        ``,
        params.body,
      ].join("\r\n"),
    ];
    const timeout = setTimeout(() => {
      socket.destroy();
      resolve(false);
    }, 20_000);

    socket.connect(params.port, params.host);
    socket.setEncoding("utf8");
    socket.on("data", (chunk: string) => {
      buffer += chunk;
      let idx: number;
      while ((idx = buffer.indexOf("\r\n")) >= 0) {
        const line = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        const code = parseInt(line.slice(0, 3), 10);
        if (code >= 400 && step > 0) {
          clearTimeout(timeout);
          socket.destroy();
          console.warn(`[Email] SMTP error at step ${step}: ${line}`);
          resolve(false);
          return;
        }
        if (step < lines.length) {
          const out = lines[step];
          if (step === lines.length - 1) {
            socket.write(`${out}\r\n.\r\n`);
          } else {
            socket.write(`${out}\r\n`);
          }
          step += 1;
        } else if (code === 250) {
          socket.write("QUIT\r\n");
          clearTimeout(timeout);
          socket.destroy();
          resolve(true);
        }
      }
    });
    socket.on("error", () => {
      clearTimeout(timeout);
      resolve(false);
    });
  });
}

export const emailAdapter = new EmailAdapter();
