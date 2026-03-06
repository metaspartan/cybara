import { io, type Socket } from "socket.io-client";
import type { ChannelAdapter, ToolCallInfo, MessageHandler } from "../types";
import { formatToolCallsPlain } from "../formatting";
import { logChannelMessage } from "../../logging";
import { buildChannelSecurityConfig, securityManager } from "../security";
import { handleChannelManagementCommand } from "../commands";

export const imessageSessions = new Map<string, string>();

interface BlueBubblesMessage {
  guid: string;
  text: string;
  chatGuid: string;
  handle?: {
    address: string;
    service: string;
  };
  isFromMe: boolean;
  dateCreated: number;
  attachments?: Array<{
    guid: string;
    mimeType: string;
    transferName: string;
    totalBytes: number;
  }>;
}

interface BlueBubblesEvent {
  message: BlueBubblesMessage;
}

export class IMessageAdapter implements ChannelAdapter {
  type = "imessage" as const;
  name = "iMessage";

  private sockets = new Map<string, Socket>();
  private configs = new Map<string, { serverUrl: string; password: string }>();
  private messageHandler: MessageHandler = async () => "No handler configured";

  setMessageHandler(handler: MessageHandler) {
    this.messageHandler = handler;
  }

  getMessageHandler(): MessageHandler {
    return this.messageHandler;
  }

  async start(channelId: string, config: Record<string, unknown>): Promise<void> {
    const serverUrl = config.server_url as string;
    const password = config.password as string;

    if (!serverUrl) {
      throw new Error("server_url is required for iMessage adapter");
    }

    if (!password) {
      throw new Error("password is required for iMessage adapter");
    }

    if (this.sockets.has(channelId)) {
      console.log(`[iMessage] Already connected for channel ${channelId}`);
      return;
    }

    securityManager.setConfig(channelId, buildChannelSecurityConfig(config));

    console.log(`[iMessage] Connecting to BlueBubbles server at ${serverUrl}...`);

    const baseUrl = serverUrl.replace(/\/$/, "");
    this.configs.set(channelId, { serverUrl: baseUrl, password });

    const socket = io(baseUrl, {
      auth: { password },
      transports: ["websocket", "polling"],
      reconnection: true,
      reconnectionAttempts: 5,
      reconnectionDelay: 1000,
    });

    socket.on("connect", () => {
      console.log(`[iMessage] Connected to BlueBubbles for channel ${channelId}`);
    });

    socket.on("connect_error", (error) => {
      console.error(`[iMessage] Connection error:`, error.message);
    });

    socket.on("disconnect", (reason) => {
      console.log(`[iMessage] Disconnected:`, reason);
    });

    socket.on("new-message", async (data: BlueBubblesEvent) => {
      await this.handleMessage(channelId, data.message);
    });

    socket.on("updated-message", async (data: BlueBubblesEvent) => {
      console.log(`[iMessage] Message updated:`, data.message.guid);
    });

    socket.on("typing-indicator", (data: { guid: string; display: boolean }) => {
      console.log(`[iMessage] Typing indicator:`, data.guid, data.display);
    });

    this.sockets.set(channelId, socket);

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error("Connection timeout"));
      }, 10000);

      socket.once("connect", () => {
        clearTimeout(timeout);
        resolve();
      });

      socket.once("connect_error", (error) => {
        clearTimeout(timeout);
        reject(error);
      });
    });

    console.log(`[iMessage] Successfully started for channel ${channelId}`);
  }

  private async handleMessage(channelId: string, message: BlueBubblesMessage): Promise<void> {
    // Ignore own messages
    if (message.isFromMe) return;

    const text = message.text;
    if (!text && (!message.attachments || message.attachments.length === 0)) return;

    const chatGuid = message.chatGuid;
    const sender = message.handle?.address || "unknown";
    const isGroupChat = chatGuid.toLowerCase().startsWith("chat");

    const accessCheck = securityManager.checkAccess(channelId, sender, "imessage", undefined, {
      isGroup: isGroupChat,
    });

    if (!accessCheck.permitted) {
      if (accessCheck.silent) return;
      if (accessCheck.reason === "new_pairing" || accessCheck.reason === "blocked") {
        await this.sendBlueBubblesMessage(
          channelId,
          chatGuid,
          accessCheck.message || `🔐 Pairing code: ${accessCheck.code}`
        );
      }
      return;
    }

    let hasFile = false;
    let fileType = "";
    let placeholder = "";
    let content = text || "";

    if (message.attachments && message.attachments.length > 0) {
      const att = message.attachments[0];
      hasFile = true;
      fileType = att.mimeType;
      placeholder = `<attachment:${att.transferName}>`;
      if (!content) content = placeholder;
    }

    await logChannelMessage("imessage", "incoming", content, {
      channelId: chatGuid,
      senderId: sender,
      metadata: {
        messageGuid: message.guid,
        dateCreated: message.dateCreated,
        hasAttachments: hasFile,
      },
    });

    let sessionId = imessageSessions.get(chatGuid);
    if (!sessionId) {
      sessionId = crypto.randomUUID();
      imessageSessions.set(chatGuid, sessionId);
    }

    let response: string;
    try {
      const commandResponse = await handleChannelManagementCommand(content, {
        channelId,
        chatId: chatGuid,
        platform: "imessage",
        sessionId,
        createSessionId: () => crypto.randomUUID(),
        setSessionId: (nextSessionId: string) => {
          sessionId = nextSessionId;
          imessageSessions.set(chatGuid, nextSessionId);
        },
      });

      if (commandResponse !== null) {
        response = commandResponse;
      } else {
        response = await this.messageHandler(content, chatGuid, sessionId, {
          hasFile,
          filePath: "",
          fileType,
          placeholder,
        });
      }
    } catch (error) {
      console.error("[iMessage] Error handling message:", error);
      response = "❌ Sorry, I encountered an error processing your message. Please try again.";
    }

    await logChannelMessage("imessage", "outgoing", response, {
      channelId: chatGuid,
      metadata: { replyToGuid: message.guid },
    });

    await this.sendBlueBubblesMessage(channelId, chatGuid, response);
  }

  private async sendBlueBubblesMessage(
    channelId: string,
    chatGuid: string,
    message: string
  ): Promise<boolean> {
    const config = this.configs.get(channelId);
    if (!config) return false;

    try {
      const response = await fetch(`${config.serverUrl}/api/v1/message/text`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          chatGuid,
          message,
          method: "private-api", // Use Private API for faster delivery
          tempGuid: crypto.randomUUID(),
        }),
      });

      if (!response.ok) {
        const error = await response.text();
        console.error(`[iMessage] Failed to send message:`, error);
        return false;
      }

      return true;
    } catch (error) {
      console.error(`[iMessage] Error sending message:`, error);
      return false;
    }
  }

  async stop(channelId: string): Promise<void> {
    const socket = this.sockets.get(channelId);
    if (!socket) {
      console.log(`[iMessage] No socket found for channel ${channelId}`);
      return;
    }

    console.log(`[iMessage] Stopping for channel ${channelId}...`);
    socket.disconnect();
    this.sockets.delete(channelId);
    this.configs.delete(channelId);
    console.log(`[iMessage] Stopped for channel ${channelId}`);
  }

  isRunning(channelId: string): boolean {
    const socket = this.sockets.get(channelId);
    return socket?.connected ?? false;
  }

  async sendMessage(
    channelId: string,
    chatId: string | number,
    text: string,
    _options?: Record<string, unknown>
  ): Promise<boolean> {
    return this.sendBlueBubblesMessage(channelId, String(chatId), text);
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

  async getServerInfo(channelId: string): Promise<Record<string, unknown> | null> {
    const config = this.configs.get(channelId);
    if (!config) return null;

    try {
      const response = await fetch(`${config.serverUrl}/api/v1/server/info`);
      if (!response.ok) return null;
      return (await response.json()) as Record<string, unknown>;
    } catch {
      return null;
    }
  }
}

export const imessageAdapter = new IMessageAdapter();
