import { spawn } from "child_process";
import { createConnection, type Socket } from "net";
import type { ChannelAdapter, ToolCallInfo, MessageHandler } from "../types";
import { formatToolCallsPlain } from "../formatting";
import { logChannelMessage } from "../../logging";
import { buildChannelSecurityConfig, securityManager } from "../security";
import { handleChannelManagementCommand } from "../commands";

export const signalSessions = new Map<string, string>();

type SignalDaemonProcess = ReturnType<typeof spawn>;

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

  private connections = new Map<string, { socket: Socket; process?: SignalDaemonProcess }>();
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
    const isWindows = process.platform === "win32";
    const configuredTcp = typeof config.tcp_address === "string" ? config.tcp_address.trim() : "";
    const tcpAddress = configuredTcp || (isWindows ? "127.0.0.1:7583" : "");
    const socketPath = (config.socket_path as string) || "/tmp/signal-cli.sock";
    const useTcp = tcpAddress.length > 0;
    const tcpHost = useTcp ? tcpAddress.split(":")[0] || "127.0.0.1" : "";
    const tcpPort = useTcp ? Number(tcpAddress.split(":")[1] || tcpAddress) || 7583 : 0;

    if (!phoneNumber) {
      throw new Error("phone_number is required for Signal adapter");
    }

    securityManager.setConfig(channelId, buildChannelSecurityConfig(config));

    if (this.connections.has(channelId)) {
      console.log(`[Signal] Already connected for channel ${channelId}`);
      return;
    }

    console.log(`[Signal] Starting for channel ${channelId}...`);

    const tryConnect = (): Promise<Socket | null> =>
      new Promise((resolve) => {
        const candidate = useTcp
          ? createConnection({ host: tcpHost, port: tcpPort })
          : createConnection(socketPath);
        candidate.once("connect", () => resolve(candidate));
        candidate.once("error", () => {
          candidate.destroy();
          resolve(null);
        });
      });

    let daemonProcess: SignalDaemonProcess | undefined;
    let socket = await tryConnect();
    if (!socket) {
      console.log(`[Signal] Starting signal-cli daemon...`);
      const daemonArgs = useTcp
        ? ["-a", phoneNumber, "daemon", "--tcp", tcpAddress]
        : ["-a", phoneNumber, "daemon", "--socket", socketPath];
      const lowered = signalCliPath.toLowerCase();
      const needsShell = isWindows && (lowered.endsWith(".bat") || lowered.endsWith(".cmd"));
      const [spawnCommand, spawnArgs] = needsShell
        ? ["cmd.exe", ["/d", "/s", "/c", signalCliPath, ...daemonArgs]]
        : [signalCliPath, daemonArgs];
      daemonProcess = spawn(spawnCommand as string, spawnArgs as string[], {
        stdio: ["pipe", "pipe", "pipe"],
        detached: !isWindows,
      });

      daemonProcess.stdout?.on("data", (data) => {
        console.log(`[Signal] daemon stdout: ${data}`);
      });

      daemonProcess.stderr?.on("data", (data) => {
        console.error(`[Signal] daemon stderr: ${data}`);
      });

      daemonProcess.on("error", (err) => {
        console.error(`[Signal] daemon error:`, err);
      });

      const deadline = Date.now() + 10000;
      while (!socket && Date.now() < deadline) {
        await new Promise((resolveDelay) => setTimeout(resolveDelay, 500));
        socket = await tryConnect();
      }
      if (!socket) {
        throw new Error(
          `Timeout waiting for signal-cli daemon at ${useTcp ? tcpAddress : socketPath}`
        );
      }
    }

    console.log(`[Signal] Connected to daemon ${useTcp ? `tcp ${tcpAddress}` : "socket"}`);

    let buffer = "";
    socket.on("data", (data) => {
      buffer += data.toString();

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

    this.connections.set(channelId, { socket, process: daemonProcess });
    console.log(`[Signal] Successfully started for channel ${channelId}`);
  }

  private handleJsonRpc(channelId: string, json: JsonRpcResponse | JsonRpcNotification): void {
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
    const text = envelope.dataMessage?.message?.trim() || "";
    const attachments = envelope.dataMessage?.attachments || [];
    if (!text && attachments.length === 0) return;

    const sender = envelope.sourceNumber || envelope.sourceUuid || "unknown";
    const isGroupMessage = !!envelope.dataMessage?.groupInfo?.groupId;

    const accessCheck = securityManager.checkAccess(
      channelId,
      sender,
      "signal",
      envelope.sourceName,
      { isGroup: isGroupMessage }
    );

    if (!accessCheck.permitted) {
      if (accessCheck.silent) return;
      if (accessCheck.reason === "new_pairing" || accessCheck.reason === "blocked") {
        await this.sendSignalMessage(
          channelId,
          sender,
          accessCheck.message || `🔐 Pairing code: ${accessCheck.code}`
        );
      }
      return;
    }

    let content = text;
    let hasFile = false;
    let fileType = "";
    let placeholder = "";

    if (attachments.length > 0) {
      const firstAttachment = attachments[0];
      hasFile = true;
      fileType = firstAttachment?.contentType || "application/octet-stream";
      const fileName = firstAttachment?.filename || "signal-file";
      placeholder = `<attachment:${fileName}>`;
      if (!content) {
        content = placeholder;
      }
    }

    await logChannelMessage("signal", "incoming", content, {
      channelId: sender,
      senderId: sender,
      metadata: {
        timestamp: envelope.timestamp,
        sourceName: envelope.sourceName,
        hasAttachments: hasFile,
        fileType,
      },
    });

    let sessionId = signalSessions.get(sender);
    if (!sessionId) {
      sessionId = crypto.randomUUID();
      signalSessions.set(sender, sessionId);
    }

    let response: string;
    try {
      const commandResponse = await handleChannelManagementCommand(content, {
        channelId,
        chatId: sender,
        platform: "signal",
        sessionId,
        createSessionId: () => crypto.randomUUID(),
        setSessionId: (nextSessionId: string) => {
          sessionId = nextSessionId;
          signalSessions.set(sender, nextSessionId);
        },
      });

      if (commandResponse !== null) {
        response = commandResponse;
      } else {
        response = await this.messageHandler(content, sender, sessionId, {
          channelId,
          hasFile,
          filePath: "",
          fileType,
          placeholder,
        });
      }
    } catch (error) {
      console.error("[Signal] Error handling message:", error);
      response = "❌ Sorry, I encountered an error processing your message. Please try again.";
    }

    await logChannelMessage("signal", "outgoing", response, {
      channelId: sender,
    });

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

    return new Promise((resolve) => {
      this.pendingRequests.set(request.id, {
        resolve: () => resolve(true),
        reject: (err) => {
          console.error(`[Signal] Send failed:`, err);
          resolve(false);
        },
      });

      conn.socket.write(JSON.stringify(request) + "\n");

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
