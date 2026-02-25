import { Client, LocalAuth, type Message } from "whatsapp-web.js";
import qrcode from "qrcode-terminal";
import QRCode from "qrcode";
import { existsSync, mkdirSync } from "fs";
import { join } from "path";
import type { ChannelAdapter, ToolCallInfo, MessageHandler } from "../types";
import { formatToolCallsPlain } from "../formatting";
import { logChannelMessage } from "../../logging";
import { buildChannelSecurityConfig, securityManager } from "../security";
import { getDefaultWhatsAppAuthPath } from "../paths";
import { handleChannelManagementCommand } from "../commands";
import { saveInboundMediaFromBase64 } from "../media";

export const whatsappSessions = new Map<string, string>();

type QRCallback = (qr: string, channelId: string) => void;
let qrCallback: QRCallback | null = null;

export function setQRCallback(callback: QRCallback): void {
  qrCallback = callback;
}

interface WhatsAppRuntimeState {
  ready: boolean;
  authenticated: boolean;
  awaitingQr: boolean;
  qr: string | null;
  qrDataUrl: string | null;
  lastEventAt: string;
  lastError: string | null;
}

interface WhatsAppAdapterConfig {
  allow_self_messages?: boolean | string | number;
}

interface WhatsAppConnectionState extends WhatsAppRuntimeState {
  running: boolean;
}

export class WhatsAppAdapter implements ChannelAdapter {
  type = "whatsapp" as const;
  name = "WhatsApp";

  private clients = new Map<string, Client>();
  private messageHandler: MessageHandler = async () => "No handler configured";
  private readyStates = new Map<string, boolean>();
  private runtimeStates = new Map<string, WhatsAppRuntimeState>();
  private channelConfigs = new Map<string, WhatsAppAdapterConfig>();
  private accountIds = new Map<string, string>();
  private outboundMessageIds = new Map<string, Set<string>>();
  private processedMessageIds = new Map<string, Set<string>>();

  private getOrCreateRuntimeState(channelId: string): WhatsAppRuntimeState {
    const existing = this.runtimeStates.get(channelId);
    if (existing) {
      return existing;
    }
    const initialState: WhatsAppRuntimeState = {
      ready: false,
      authenticated: false,
      awaitingQr: false,
      qr: null,
      qrDataUrl: null,
      lastEventAt: new Date().toISOString(),
      lastError: null,
    };
    this.runtimeStates.set(channelId, initialState);
    return initialState;
  }

  private updateRuntimeState(
    channelId: string,
    updates: Partial<WhatsAppRuntimeState>
  ): WhatsAppRuntimeState {
    const nextState: WhatsAppRuntimeState = {
      ...this.getOrCreateRuntimeState(channelId),
      ...updates,
      lastEventAt: new Date().toISOString(),
    };
    this.runtimeStates.set(channelId, nextState);
    return nextState;
  }

  private rememberOutboundMessage(channelId: string, message: Message | null | undefined): void {
    const messageId = message?.id?._serialized;
    if (!messageId) {
      return;
    }
    let ids = this.outboundMessageIds.get(channelId);
    if (!ids) {
      ids = new Set<string>();
      this.outboundMessageIds.set(channelId, ids);
    }
    ids.add(messageId);
    if (ids.size > 200) {
      const [oldest] = ids;
      if (oldest) {
        ids.delete(oldest);
      }
    }
  }

  private consumeOutboundMessage(channelId: string, messageId: string): boolean {
    const ids = this.outboundMessageIds.get(channelId);
    if (!ids?.has(messageId)) {
      return false;
    }
    ids.delete(messageId);
    return true;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
      setTimeout(resolve, ms);
    });
  }

  private normalizeJid(value: string | undefined | null): string {
    if (!value) return "";
    return value
      .split(":")[0]
      .toLowerCase()
      .split("@", 1)[0];
  }

  private shouldSkipMessage(channelId: string, messageId: string | undefined): boolean {
    if (!messageId) return false;

    let ids = this.processedMessageIds.get(channelId);
    if (!ids) {
      ids = new Set<string>();
      this.processedMessageIds.set(channelId, ids);
    }

    if (ids.has(messageId)) {
      return true;
    }

    ids.add(messageId);
    if (ids.size > 400) {
      const iterator = ids.values();
      const oldest = iterator.next().value;
      if (oldest) {
        ids.delete(oldest);
      }
    }
    return false;
  }

  private isSelfMessageEnabled(channelConfig: WhatsAppAdapterConfig | undefined): boolean {
    if (!channelConfig) {
      return false;
    }

    const value = channelConfig.allow_self_messages;
    if (typeof value === "boolean") {
      return value;
    }

    if (typeof value === "string") {
      return value.toLowerCase() === "true";
    }

    if (typeof value === "number") {
      return value === 1;
    }

    return false;
  }

  private isSelfChatMessage(channelId: string, msg: Message): boolean {
    const accountId = this.normalizeJid(this.accountIds.get(channelId));
    const from = this.normalizeJid(msg.from);
    if (!from || !accountId) {
      if (!from || !msg.fromMe) {
        return false;
      }

      const to = this.normalizeJid(msg.to);
      return to ? from === to : true;
    }

    if (from === accountId && !msg.to) {
      return true;
    }

    const to = this.normalizeJid(msg.to);
    if (!to) {
      return false;
    }

    if (from === to) {
      return true;
    }

    return msg.fromMe && accountId === from;
  }

  private shellQuote(input: string): string {
    return `'${input.replace(/'/g, `'\\''`)}'`;
  }

  private getErrorMessage(error: unknown): string {
    if (error instanceof Error) return error.message;
    return String(error || "Unknown error");
  }

  private isProfileLockError(error: unknown): boolean {
    const message = this.getErrorMessage(error).toLowerCase();
    return message.includes("already running for") || message.includes("usedatadir");
  }

  private isProcessAlive(pid: number): boolean {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  }

  private async killProcessesUsingPath(path: string): Promise<number> {
    const quotedPath = this.shellQuote(path);
    const pidQuery = `(lsof -t +D ${quotedPath} 2>/dev/null; pgrep -f ${quotedPath} 2>/dev/null) | sort -u`;
    const output = Bun.spawnSync(["sh", "-lc", pidQuery], { stdout: "pipe", stderr: "pipe" });
    const pidText = new TextDecoder().decode(output.stdout).trim();
    if (!pidText) {
      return 0;
    }

    const pids = pidText
      .split(/\s+/)
      .map((value) => Number.parseInt(value, 10))
      .filter((pid) => Number.isFinite(pid) && pid > 0 && pid !== process.pid);
    if (pids.length === 0) {
      return 0;
    }

    let killed = 0;
    for (const pid of pids) {
      try {
        process.kill(pid, "SIGTERM");
        killed += 1;
      } catch {
        // Ignore; process may already be gone.
      }
    }

    await this.sleep(500);

    for (const pid of pids) {
      if (!this.isProcessAlive(pid)) continue;
      try {
        process.kill(pid, "SIGKILL");
      } catch {
        // Ignore; process may have exited between checks.
      }
    }

    return killed;
  }

  private async recoverProfileLock(channelId: string, authPath: string): Promise<number> {
    const sessionPath = join(authPath, `session-${channelId}`);
    let killed = await this.killProcessesUsingPath(sessionPath);
    if (killed === 0) {
      killed = await this.killProcessesUsingPath(authPath);
    }
    return killed;
  }

  setMessageHandler(handler: MessageHandler) {
    this.messageHandler = handler;
  }

  getMessageHandler(): MessageHandler {
    return this.messageHandler;
  }

  async start(channelId: string, config: Record<string, unknown>): Promise<void> {
    if (this.clients.has(channelId)) {
      console.log(`[WhatsApp] Client already running for channel ${channelId}`);
      return;
    }

    console.log(`[WhatsApp] Starting client for channel ${channelId}...`);

    securityManager.setConfig(channelId, buildChannelSecurityConfig(config));
    this.channelConfigs.set(channelId, config as WhatsAppAdapterConfig);
    this.updateRuntimeState(channelId, {
      ready: false,
      authenticated: false,
      awaitingQr: false,
      qr: null,
      qrDataUrl: null,
      lastError: null,
    });

    const authPath = (config.auth_path as string) || getDefaultWhatsAppAuthPath(channelId);
    if (!existsSync(authPath)) {
      mkdirSync(authPath, { recursive: true });
    }

    const client = new Client({
      authStrategy: new LocalAuth({
        clientId: channelId,
        dataPath: authPath,
      }),
      puppeteer: {
        headless: true,
        args: [
          "--no-sandbox",
          "--disable-setuid-sandbox",
          "--disable-dev-shm-usage",
          "--disable-accelerated-2d-canvas",
          "--no-first-run",
          "--no-zygote",
          "--disable-gpu",
        ],
      },
    });

    client.on("qr", (qr) => {
      console.log(`[WhatsApp] Scan QR code to link device for channel ${channelId}:`);
      qrcode.generate(qr, { small: true });
      this.updateRuntimeState(channelId, {
        awaitingQr: true,
        ready: false,
        authenticated: false,
        qr,
        qrDataUrl: null,
        lastError: null,
      });

      void QRCode.toDataURL(qr, { margin: 1, width: 320 })
        .then((qrDataUrl: string) => {
          this.updateRuntimeState(channelId, { qrDataUrl });
        })
        .catch((error: unknown) => {
          console.warn("[WhatsApp] Failed to generate QR image:", error);
        });

      if (qrCallback) {
        qrCallback(qr, channelId);
      }
    });

    client.on("ready", () => {
      console.log(`[WhatsApp] Client ready for channel ${channelId}`);
      this.readyStates.set(channelId, true);
      const accountId = client.info?.wid?._serialized;
      if (accountId) {
        this.accountIds.set(channelId, accountId);
      }
      this.updateRuntimeState(channelId, {
        ready: true,
        authenticated: true,
        awaitingQr: false,
        qr: null,
        qrDataUrl: null,
        lastError: null,
      });
    });

    client.on("authenticated", () => {
      const state = this.getOrCreateRuntimeState(channelId);
      if (!state.authenticated) {
        console.log(`[WhatsApp] Client authenticated for channel ${channelId}`);
      }
      const accountId = client.info?.wid?._serialized;
      if (accountId) {
        this.accountIds.set(channelId, accountId);
      }
      this.updateRuntimeState(channelId, {
        authenticated: true,
        awaitingQr: false,
        lastError: null,
      });
    });

    client.on("auth_failure", (msg) => {
      console.error(`[WhatsApp] Authentication failed for channel ${channelId}:`, msg);
      this.readyStates.set(channelId, false);
      this.updateRuntimeState(channelId, {
        ready: false,
        authenticated: false,
        awaitingQr: false,
        lastError: String(msg || "Authentication failed"),
      });
    });

    client.on("disconnected", (reason) => {
      console.log(`[WhatsApp] Client disconnected for channel ${channelId}:`, reason);
      this.readyStates.set(channelId, false);
      this.updateRuntimeState(channelId, {
        ready: false,
        awaitingQr: false,
        lastError: reason ? String(reason) : null,
      });
    });

    client.on("message", async (msg: Message) => {
      await this.handleMessage(channelId, msg);
    });

    client.on("message_create", async (msg: Message) => {
      if (!msg.fromMe) {
        return;
      }
      await this.handleMessage(channelId, msg);
    });

    this.clients.set(channelId, client);
    this.readyStates.set(channelId, false);

    try {
      await client.initialize();
    } catch (error) {
      let initError: unknown = error;

      if (this.isProfileLockError(error)) {
        const killedCount = await this.recoverProfileLock(channelId, authPath);
        if (killedCount > 0) {
          console.warn(
            `[WhatsApp] Recovered profile lock for ${channelId} by terminating ${killedCount} process(es). Retrying initialization...`
          );
          try {
            await client.initialize();
            return;
          } catch (retryError) {
            initError = retryError;
          }
        }
      }

      console.error(`[WhatsApp] Failed to initialize:`, initError);
      this.updateRuntimeState(channelId, {
        ready: false,
        authenticated: false,
        awaitingQr: false,
        lastError: this.getErrorMessage(initError),
      });
      this.clients.delete(channelId);
      this.readyStates.delete(channelId);
      throw initError;
    }
  }

  private async handleMessage(channelId: string, msg: Message): Promise<void> {
    const channelConfig = this.channelConfigs.get(channelId);
    const allowSelfMessages = this.isSelfMessageEnabled(channelConfig);
    const messageId = msg.id?._serialized || "";

    if (messageId && this.shouldSkipMessage(channelId, messageId)) {
      return;
    }

    // Outbound messages from the bot should never be reprocessed.
    if (msg.fromMe) {
      const isSelfChat = this.isSelfChatMessage(channelId, msg);
      if (!allowSelfMessages || !isSelfChat) {
        return;
      }
      if (messageId && this.consumeOutboundMessage(channelId, messageId)) {
        return;
      }
    }

    // Ignore status broadcasts
    if (msg.from === "status@broadcast") return;

    const text = msg.body;
    if (!text && !msg.hasMedia) return;

    const chatId = msg.from;
    const userId = msg.author || msg.from; // author is set in groups

    const accessCheck = msg.fromMe && allowSelfMessages
      ? ({ permitted: true } as const)
      : securityManager.checkAccess(channelId, userId, "whatsapp");

    if (!accessCheck.permitted) {
      if (accessCheck.reason === "new_pairing" || accessCheck.reason === "blocked") {
        try {
          await msg.reply(accessCheck.message || `🔐 Pairing code: ${accessCheck.code}`);
        } catch (e) {
          console.error("[WhatsApp] Failed to send security message:", e);
        }
      }
      return;
    }

    let hasFile = false;
    let filePath = "";
    let fileType = "";
    let placeholder = "";
    let content = text;

    if (msg.hasMedia) {
      try {
        const media = await msg.downloadMedia();
        if (media) {
          hasFile = true;
          fileType = media.mimetype;
          placeholder = `<media:${media.mimetype.split("/")[0]}>`;
          const base64Data =
            typeof (media as { data?: unknown }).data === "string"
              ? (media as { data: string }).data
              : "";
          if (base64Data) {
            const fileName =
              typeof (media as { filename?: unknown }).filename === "string"
                ? (media as { filename: string }).filename
                : `${msg.id._serialized}`;
            try {
              const saved = saveInboundMediaFromBase64({
                channel: "whatsapp",
                base64Data,
                fileName,
                contentType: media.mimetype,
              });
              filePath = saved.path;
            } catch (persistError) {
              console.warn("[WhatsApp] Failed to persist inbound media locally:", persistError);
            }
          }
          content = text || placeholder;
        }
      } catch (error) {
        console.error("[WhatsApp] Failed to download media:", error);
      }
    }

    await logChannelMessage("whatsapp", "incoming", content, {
      channelId: chatId,
      senderId: userId,
      metadata: {
        messageId: msg.id._serialized,
        isGroup: msg.from.includes("@g.us"),
        hasMedia: msg.hasMedia,
        type: msg.type,
      },
    });

    let sessionId = whatsappSessions.get(chatId);
    if (!sessionId) {
      sessionId = crypto.randomUUID();
      whatsappSessions.set(chatId, sessionId);
    }

    let response: string;
    try {
      const commandResponse = await handleChannelManagementCommand(text || "", {
        channelId,
        chatId,
        platform: "whatsapp",
        sessionId,
        createSessionId: () => crypto.randomUUID(),
        setSessionId: (nextSessionId: string) => {
          sessionId = nextSessionId;
          whatsappSessions.set(chatId, nextSessionId);
        },
      });

      if (commandResponse !== null) {
        response = commandResponse;
      } else {
        response = await this.messageHandler(content, chatId, sessionId, {
          hasFile,
          filePath,
          fileType,
          placeholder,
        });
      }
    } catch (error) {
      console.error("[WhatsApp] Error handling message:", error);
      response = "❌ Sorry, I encountered an error processing your message. Please try again.";
    }

    await logChannelMessage("whatsapp", "outgoing", response, {
      channelId: chatId,
      metadata: { replyToId: msg.id._serialized },
    });

    try {
      const sentMessage = await msg.reply(response);
      this.rememberOutboundMessage(channelId, sentMessage);
    } catch (error) {
      console.error("[WhatsApp] Failed to send reply:", error);
      try {
        const chat = await msg.getChat();
        const sentMessage = await chat.sendMessage(response);
        this.rememberOutboundMessage(channelId, sentMessage as Message);
      } catch (err) {
        console.error("[WhatsApp] Failed to send message:", err);
      }
    }
  }

  async stop(channelId: string): Promise<void> {
    const client = this.clients.get(channelId);
    if (!client) {
      console.log(`[WhatsApp] No client found for channel ${channelId}`);
      return;
    }

    console.log(`[WhatsApp] Stopping client for channel ${channelId}...`);
    try {
      await client.destroy();
    } catch (error) {
      console.error(`[WhatsApp] Error destroying client:`, error);
    }
    this.clients.delete(channelId);
    this.readyStates.delete(channelId);
    this.runtimeStates.delete(channelId);
    this.channelConfigs.delete(channelId);
    this.accountIds.delete(channelId);
    this.outboundMessageIds.delete(channelId);
    this.processedMessageIds.delete(channelId);
    console.log(`[WhatsApp] Stopped for channel ${channelId}`);
  }

  isRunning(channelId: string): boolean {
    return this.clients.has(channelId);
  }

  async sendMessage(
    channelId: string,
    chatId: string | number,
    text: string,
    _options?: Record<string, unknown>
  ): Promise<boolean> {
    const client = this.clients.get(channelId);
    if (!client || !this.readyStates.get(channelId)) {
      console.error("[WhatsApp] sendMessage: No ready client for channel", channelId);
      return false;
    }

    try {
      await client.sendMessage(String(chatId), text);
      return true;
    } catch (error) {
      console.error("[WhatsApp] Failed to send message:", error);
      return false;
    }
  }

  formatResponse(content: string, toolCalls?: ToolCallInfo[], thinking?: string): string {
    let text = content;

    if (toolCalls && toolCalls.length > 0) {
      text = formatToolCallsPlain(toolCalls) + "\n\n" + text;
    }

    if (thinking) {
      text += `\n\n💭 _${thinking}_`;
    }

    return text;
  }

  async getQRCode(channelId: string): Promise<string | null> {
    return this.runtimeStates.get(channelId)?.qr ?? null;
  }

  getState(channelId: string): WhatsAppConnectionState {
    const state = this.runtimeStates.get(channelId) || {
      ready: false,
      authenticated: false,
      awaitingQr: false,
      qr: null,
      qrDataUrl: null,
      lastEventAt: new Date().toISOString(),
      lastError: null,
    };
    return {
      running: this.clients.has(channelId),
      ...state,
    };
  }
}

export const whatsappAdapter = new WhatsAppAdapter();
