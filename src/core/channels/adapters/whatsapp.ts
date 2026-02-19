import { Client, LocalAuth, type Message } from "whatsapp-web.js";
import qrcode from "qrcode-terminal";
import { existsSync, mkdirSync } from "fs";
import type { ChannelAdapter, ToolCallInfo, MessageHandler } from "../types";
import { formatToolCallsPlain } from "../formatting";
import { logChannelMessage } from "../../logging";
import { buildChannelSecurityConfig, securityManager } from "../security";
import { getDefaultWhatsAppAuthPath } from "../paths";
import { handleChannelManagementCommand } from "../commands";

export const whatsappSessions = new Map<string, string>();

type QRCallback = (qr: string, channelId: string) => void;
let qrCallback: QRCallback | null = null;

export function setQRCallback(callback: QRCallback): void {
  qrCallback = callback;
}

export class WhatsAppAdapter implements ChannelAdapter {
  type = "whatsapp" as const;
  name = "WhatsApp";

  private clients = new Map<string, Client>();
  private messageHandler: MessageHandler = async () => "No handler configured";
  private readyStates = new Map<string, boolean>();

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

      if (qrCallback) {
        qrCallback(qr, channelId);
      }
    });

    client.on("ready", () => {
      console.log(`[WhatsApp] Client ready for channel ${channelId}`);
      this.readyStates.set(channelId, true);
    });

    client.on("authenticated", () => {
      console.log(`[WhatsApp] Client authenticated for channel ${channelId}`);
    });

    client.on("auth_failure", (msg) => {
      console.error(`[WhatsApp] Authentication failed for channel ${channelId}:`, msg);
      this.readyStates.set(channelId, false);
    });

    client.on("disconnected", (reason) => {
      console.log(`[WhatsApp] Client disconnected for channel ${channelId}:`, reason);
      this.readyStates.set(channelId, false);
    });

    client.on("message", async (msg: Message) => {
      await this.handleMessage(channelId, msg);
    });

    this.clients.set(channelId, client);
    this.readyStates.set(channelId, false);

    try {
      await client.initialize();
    } catch (error) {
      console.error(`[WhatsApp] Failed to initialize:`, error);
      this.clients.delete(channelId);
      throw error;
    }
  }

  private async handleMessage(channelId: string, msg: Message): Promise<void> {
    // Ignore own messages
    if (msg.fromMe) return;

    // Ignore status broadcasts
    if (msg.from === "status@broadcast") return;

    const text = msg.body;
    if (!text && !msg.hasMedia) return;

    const chatId = msg.from;
    const userId = msg.author || msg.from; // author is set in groups

    const accessCheck = securityManager.checkAccess(channelId, userId, "whatsapp");

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
    const filePath = "";
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
      await msg.reply(response);
    } catch (error) {
      console.error("[WhatsApp] Failed to send reply:", error);
      try {
        const chat = await msg.getChat();
        await chat.sendMessage(response);
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
    console.log(`[WhatsApp] Stopped for channel ${channelId}`);
  }

  isRunning(channelId: string): boolean {
    return this.readyStates.get(channelId) ?? false;
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
    const client = this.clients.get(channelId);
    if (!client) return null;

    return null;
  }
}

export const whatsappAdapter = new WhatsAppAdapter();
