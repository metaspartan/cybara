// WhatsApp Adapter - Production implementation using whatsapp-web.js
// Requires: whatsapp-web.js package, Puppeteer, QR code scanning
// Note: Uses unofficial WhatsApp Web API, may violate ToS

import { Client, LocalAuth, type Message } from "whatsapp-web.js";
import qrcode from "qrcode-terminal";
import { existsSync, mkdirSync } from "fs";
import type { ChannelAdapter, ToolCallInfo, MessageHandler } from "../types";
import { formatToolCallsPlain } from "../formatting";
import { logChannelMessage } from "../../logging";
import { buildChannelSecurityConfig, securityManager } from "../security";
import { getDefaultWhatsAppAuthPath } from "../paths";
import { handleChannelManagementCommand } from "../commands";

// WhatsApp session storage (chatId -> sessionId)
export const whatsappSessions = new Map<string, string>();

// QR code callback for external handling
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
    // Check if already running
    if (this.clients.has(channelId)) {
      console.log(`[WhatsApp] Client already running for channel ${channelId}`);
      return;
    }

    console.log(`[WhatsApp] Starting client for channel ${channelId}...`);

    // Configure security based on channel config
    securityManager.setConfig(channelId, buildChannelSecurityConfig(config));

    // Create auth directory
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

    // QR Code event - need to scan to link
    client.on("qr", (qr) => {
      console.log(`[WhatsApp] Scan QR code to link device for channel ${channelId}:`);
      qrcode.generate(qr, { small: true });

      // Call external handler if set
      if (qrCallback) {
        qrCallback(qr, channelId);
      }
    });

    // Ready event
    client.on("ready", () => {
      console.log(`[WhatsApp] Client ready for channel ${channelId}`);
      this.readyStates.set(channelId, true);
    });

    // Authenticated event
    client.on("authenticated", () => {
      console.log(`[WhatsApp] Client authenticated for channel ${channelId}`);
    });

    // Authentication failure
    client.on("auth_failure", (msg) => {
      console.error(`[WhatsApp] Authentication failed for channel ${channelId}:`, msg);
      this.readyStates.set(channelId, false);
    });

    // Disconnected
    client.on("disconnected", (reason) => {
      console.log(`[WhatsApp] Client disconnected for channel ${channelId}:`, reason);
      this.readyStates.set(channelId, false);
    });

    // Handle incoming messages
    client.on("message", async (msg: Message) => {
      await this.handleMessage(channelId, msg);
    });

    // Store client
    this.clients.set(channelId, client);
    this.readyStates.set(channelId, false);

    // Initialize (this will trigger QR code if not authenticated)
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

    // 🔐 SECURITY CHECK: Verify sender is allowed
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

    // Handle media
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
          // For now, include base64 reference (could save to file)
          content = text || placeholder;
        }
      } catch (error) {
        console.error("[WhatsApp] Failed to download media:", error);
      }
    }

    // Log incoming message
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

    // Get or create session
    let sessionId = whatsappSessions.get(chatId);
    if (!sessionId) {
      sessionId = crypto.randomUUID();
      whatsappSessions.set(chatId, sessionId);
    }

    // Process message
    let response: string;
    try {
      const commandResponse = await handleChannelManagementCommand(text || "", {
        channelId,
        chatId,
        platform: "whatsapp",
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

    // Log outgoing message
    await logChannelMessage("whatsapp", "outgoing", response, {
      channelId: chatId,
      metadata: { replyToId: msg.id._serialized },
    });

    // Send response
    try {
      await msg.reply(response);
    } catch (error) {
      console.error("[WhatsApp] Failed to send reply:", error);
      // Try sending as new message
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
      // WhatsApp doesn't have spoiler tags, use simple format
      text += `\n\n💭 _${thinking}_`;
    }

    return text;
  }

  // Get QR code data URL for web display
  async getQRCode(channelId: string): Promise<string | null> {
    const client = this.clients.get(channelId);
    if (!client) return null;

    // This is a simplified version - actual implementation would
    // require capturing the QR from the qr event
    return null;
  }
}

export const whatsappAdapter = new WhatsAppAdapter();
