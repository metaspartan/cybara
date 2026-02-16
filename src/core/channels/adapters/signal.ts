// Signal Adapter - Production implementation using signal-cli JSON-RPC daemon
// Requires: signal-cli installed and running as daemon with JSON-RPC
// Start daemon: signal-cli -a +1PHONENUMBER daemon --socket /tmp/signal-cli.sock

import { spawn, type ChildProcess } from "child_process";
import { createConnection, type Socket } from "net";
import { existsSync } from "fs";
import type { ChannelAdapter, ToolCallInfo, MessageHandler } from "../types";
import { formatToolCallsPlain } from "../formatting";
import { logChannelMessage } from "../../logging";
import { buildChannelSecurityConfig, securityManager } from "../security";

// Signal session storage (phoneNumber -> sessionId)
export const signalSessions = new Map<string, string>();

interface SignalEnvelope {
  source?: string;
  sourceNumber?: string;
  sourceUuid?: string;
  sourceName?: string;
  timestamp?: number;
  dataMessage?: {
    message?: string;
    timestamp?: number;
    groupInfo?: {
      groupId: string;
      type: string;
    };
    attachments?: Array<{
      contentType: string;
      filename?: string;
      id?: string;
      size?: number;
    }>;
  };
  syncMessage?: unknown;
  typingMessage?: unknown;
  receiptMessage?: unknown;
}

interface JsonRpcRequest {
  jsonrpc: "2.0";
  method: string;
  params: Record<string, unknown>;
  id: number;
}

interface JsonRpcResponse {
  jsonrpc: "2.0";
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
  id: number;
}

interface JsonRpcNotification {
  jsonrpc: "2.0";
  method: string;
  params: Record<string, unknown>;
}

export class SignalAdapter implements ChannelAdapter {
  type = "signal" as const;
  name = "Signal";

  private connections = new Map<string, { socket: Socket; process?: ChildProcess }>();
  private messageHandler: MessageHandler = async () => "No handler configured";
  private requestId = 0;
  private pendingRequests = new Map<
    number,
    { resolve: (value: unknown) => void; reject: (error: Error) => void }
  >();

  setMessageHandler(handler: MessageHandler) {
    this.messageHandler = handler;
  }

  getMessageHandler(): MessageHandler {
    return this.messageHandler;
  }

  async start(channelId: string, config: Record<string, unknown>): Promise<void> {
    const signalCliPath = (config.signal_cli_path as string) || "signal-cli";
    const phoneNumber = config.phone_number as string;
    const socketPath = (config.socket_path as string) || "/tmp/signal-cli.sock";

    if (!phoneNumber) {
      throw new Error("phone_number is required for Signal adapter");
    }

    // Configure security based on channel config
    securityManager.setConfig(channelId, buildChannelSecurityConfig(config));

    // Check if already running
    if (this.connections.has(channelId)) {
      console.log(`[Signal] Already connected for channel ${channelId}`);
      return;
    }

    console.log(`[Signal] Starting for channel ${channelId}...`);

    // Check if socket exists (daemon already running)
    let process: ChildProcess | undefined;
    if (!existsSync(socketPath)) {
      // Start signal-cli daemon
      console.log(`[Signal] Starting signal-cli daemon...`);
      process = spawn(signalCliPath, ["-a", phoneNumber, "daemon", "--socket", socketPath], {
        stdio: ["pipe", "pipe", "pipe"],
        detached: true,
      });

      process.stdout?.on("data", (data) => {
        console.log(`[Signal] daemon stdout: ${data}`);
      });

      process.stderr?.on("data", (data) => {
        console.error(`[Signal] daemon stderr: ${data}`);
      });

      process.on("error", (err) => {
        console.error(`[Signal] daemon error:`, err);
      });

      // Wait for socket to be created
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error("Timeout waiting for signal-cli socket"));
        }, 10000);

        const check = () => {
          if (existsSync(socketPath)) {
            clearTimeout(timeout);
            resolve();
          } else {
            setTimeout(check, 500);
          }
        };
        check();
      });
    }

    // Connect to socket
    const socket = createConnection(socketPath);

    await new Promise<void>((resolve, reject) => {
      socket.once("connect", () => {
        console.log(`[Signal] Connected to daemon socket`);
        resolve();
      });
      socket.once("error", (err) => {
        reject(err);
      });
    });

    // Handle incoming data
    let buffer = "";
    socket.on("data", (data) => {
      buffer += data.toString();

      // Parse JSON-RPC messages (newline-delimited)
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const json = JSON.parse(line);
          this.handleJsonRpc(channelId, json);
        } catch (err) {
          console.error(`[Signal] Failed to parse JSON-RPC:`, err);
        }
      }
    });

    socket.on("error", (err) => {
      console.error(`[Signal] Socket error:`, err);
    });

    socket.on("close", () => {
      console.log(`[Signal] Socket closed for channel ${channelId}`);
      this.connections.delete(channelId);
    });

    this.connections.set(channelId, { socket, process });
    console.log(`[Signal] Successfully started for channel ${channelId}`);
  }

  private handleJsonRpc(channelId: string, json: JsonRpcResponse | JsonRpcNotification): void {
    // Handle responses to our requests
    if ("id" in json && json.id !== undefined) {
      const pending = this.pendingRequests.get(json.id);
      if (pending) {
        this.pendingRequests.delete(json.id);
        if (json.error) {
          pending.reject(new Error(json.error.message));
        } else {
          pending.resolve(json.result);
        }
      }
      return;
    }

    // Handle notifications (incoming messages)
    if ("method" in json && json.method === "receive") {
      const params = json.params as { envelope?: SignalEnvelope };
      if (params.envelope) {
        this.handleEnvelope(channelId, params.envelope).catch((err) => {
          console.error(`[Signal] Error handling envelope:`, err);
        });
      }
    }
  }

  private async handleEnvelope(channelId: string, envelope: SignalEnvelope): Promise<void> {
    // Only handle data messages with text
    if (!envelope.dataMessage?.message) return;

    const text = envelope.dataMessage.message;
    const sender = envelope.sourceNumber || envelope.sourceUuid || "unknown";

    // 🔐 SECURITY CHECK: Verify sender is allowed
    const accessCheck = securityManager.checkAccess(
      channelId,
      sender,
      "signal",
      envelope.sourceName
    );

    if (!accessCheck.permitted) {
      if (accessCheck.reason === "new_pairing" || accessCheck.reason === "blocked") {
        // Send pairing/blocked message
        await this.sendSignalMessage(
          channelId,
          sender,
          accessCheck.message || `🔐 Pairing code: ${accessCheck.code}`
        );
      }
      return;
    }

    // Log incoming message
    await logChannelMessage("signal", "incoming", text, {
      channelId: sender,
      senderId: sender,
      metadata: {
        timestamp: envelope.timestamp,
        sourceName: envelope.sourceName,
        hasAttachments: (envelope.dataMessage.attachments?.length || 0) > 0,
      },
    });

    // Get or create session
    let sessionId = signalSessions.get(sender);
    if (!sessionId) {
      sessionId = crypto.randomUUID();
      signalSessions.set(sender, sessionId);
    }

    // Process message
    let response: string;
    try {
      response = await this.messageHandler(text, sender, sessionId, {
        hasFile: false,
        filePath: "",
        fileType: "",
        placeholder: "",
      });
    } catch (error) {
      console.error("[Signal] Error handling message:", error);
      response = "❌ Sorry, I encountered an error processing your message. Please try again.";
    }

    // Log outgoing message
    await logChannelMessage("signal", "outgoing", response, {
      channelId: sender,
    });

    // Send response
    await this.sendSignalMessage(channelId, sender, response);
  }

  private async sendSignalMessage(
    channelId: string,
    recipient: string,
    message: string
  ): Promise<boolean> {
    const conn = this.connections.get(channelId);
    if (!conn) return false;

    const request: JsonRpcRequest = {
      jsonrpc: "2.0",
      method: "send",
      params: {
        recipient: [recipient],
        message: message,
      },
      id: ++this.requestId,
    };

    return new Promise((resolve, reject) => {
      this.pendingRequests.set(request.id, {
        resolve: () => resolve(true),
        reject: (err) => {
          console.error(`[Signal] Send failed:`, err);
          resolve(false);
        },
      });

      conn.socket.write(JSON.stringify(request) + "\n");

      // Timeout
      setTimeout(() => {
        if (this.pendingRequests.has(request.id)) {
          this.pendingRequests.delete(request.id);
          resolve(false);
        }
      }, 30000);
    });
  }

  async stop(channelId: string): Promise<void> {
    const conn = this.connections.get(channelId);
    if (!conn) {
      console.log(`[Signal] No connection found for channel ${channelId}`);
      return;
    }

    console.log(`[Signal] Stopping for channel ${channelId}...`);
    conn.socket.destroy();
    if (conn.process) {
      conn.process.kill();
    }
    this.connections.delete(channelId);
    console.log(`[Signal] Stopped for channel ${channelId}`);
  }

  isRunning(channelId: string): boolean {
    const conn = this.connections.get(channelId);
    return conn?.socket.writable ?? false;
  }

  async sendMessage(
    channelId: string,
    chatId: string | number,
    text: string,
    _options?: Record<string, unknown>
  ): Promise<boolean> {
    return this.sendSignalMessage(channelId, String(chatId), text);
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

export const signalAdapter = new SignalAdapter();
