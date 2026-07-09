import type { ChannelAdapter, ToolCallInfo, MessageHandler } from "../types";
import { evaluateChannelAccess } from "../access-gate";
import { buildChannelSecurityConfig, securityManager } from "../security";
import { formatToolCallsPlain } from "../formatting";
import { logChannelMessage } from "../../logging";

export const ntfySessions = new Map<string, string>();

export interface NtfyEvent {
  id?: string;
  event?: string;
  topic?: string;
  message?: string;
  title?: string;
  tags?: string[];
}

export function parseNtfyLine(line: string): NtfyEvent | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed) as NtfyEvent;
  } catch {
    return null;
  }
}

const SELF_TAG = "cybara";

interface NtfyConfig {
  server: string;
  topic: string;
  token?: string;
}

interface NtfyRuntime {
  config: NtfyConfig;
  abort: AbortController;
  seen: Set<string>;
}

export class NtfyAdapter implements ChannelAdapter {
  type = "ntfy" as const;
  name = "ntfy";

  private runtimes = new Map<string, NtfyRuntime>();
  private messageHandler: MessageHandler = async () => "No handler configured";

  setMessageHandler(handler: MessageHandler) {
    this.messageHandler = handler;
  }

  getMessageHandler(): MessageHandler {
    return this.messageHandler;
  }

  async start(channelId: string, config: Record<string, unknown>): Promise<void> {
    securityManager.setConfig(channelId, buildChannelSecurityConfig(config));
    const topic = typeof config.topic === "string" ? config.topic.trim() : "";
    if (!topic) throw new Error("ntfy: topic is required");
    const server = (typeof config.server === "string" && config.server.trim()) || "https://ntfy.sh";

    const runtime: NtfyRuntime = {
      config: {
        server: server.replace(/\/+$/, ""),
        topic,
        token: typeof config.token === "string" ? config.token : undefined,
      },
      abort: new AbortController(),
      seen: new Set(),
    };
    this.runtimes.set(channelId, runtime);
    void this.streamLoop(channelId);
    console.log(`[ntfy] subscribed to ${server}/${topic}`);
  }

  async stop(channelId: string): Promise<void> {
    const runtime = this.runtimes.get(channelId);
    if (runtime) runtime.abort.abort();
    this.runtimes.delete(channelId);
  }

  isRunning(channelId: string): boolean {
    return this.runtimes.has(channelId);
  }

  async sendMessage(channelId: string, _chatId: string | number, text: string): Promise<boolean> {
    const runtime = this.runtimes.get(channelId);
    if (!runtime) return false;
    const headers: Record<string, string> = { "X-Tags": SELF_TAG };
    if (runtime.config.token) headers.Authorization = `Bearer ${runtime.config.token}`;
    const res = await fetch(`${runtime.config.server}/${runtime.config.topic}`, {
      method: "POST",
      headers,
      body: text,
    });
    return res.ok;
  }

  formatResponse(content: string, toolCalls?: ToolCallInfo[]): string {
    if (toolCalls && toolCalls.length > 0) {
      return formatToolCallsPlain(toolCalls) + "\n\n" + content;
    }
    return content;
  }

  private authHeaders(runtime: NtfyRuntime): Record<string, string> {
    return runtime.config.token ? { Authorization: `Bearer ${runtime.config.token}` } : {};
  }

  private async streamLoop(channelId: string): Promise<void> {
    const runtime = this.runtimes.get(channelId);
    if (!runtime) return;
    const url = `${runtime.config.server}/${runtime.config.topic}/json`;

    while (!runtime.abort.signal.aborted) {
      try {
        const res = await fetch(url, {
          headers: this.authHeaders(runtime),
          signal: runtime.abort.signal,
        });
        if (!res.body) throw new Error("no response body");
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (!runtime.abort.signal.aborted) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";
          for (const line of lines) {
            await this.handleEvent(channelId, runtime, parseNtfyLine(line));
          }
        }
      } catch (error) {
        if (runtime.abort.signal.aborted) break;
        console.warn(`[ntfy] stream error: ${error instanceof Error ? error.message : error}`);
        await new Promise((r) => setTimeout(r, 3000));
      }
    }
  }

  private async handleEvent(
    channelId: string,
    runtime: NtfyRuntime,
    event: NtfyEvent | null
  ): Promise<void> {
    if (!event || event.event !== "message" || !event.message) return;
    if (event.tags?.includes(SELF_TAG)) return;
    if (event.id) {
      if (runtime.seen.has(event.id)) return;
      runtime.seen.add(event.id);
      if (runtime.seen.size > 500)
        runtime.seen.delete(runtime.seen.values().next().value as string);
    }

    const topic = event.topic || runtime.config.topic;
    const sessionKey = `${channelId}:${topic}`;
    let sessionId = ntfySessions.get(sessionKey);
    if (!sessionId) {
      sessionId = crypto.randomUUID();
      ntfySessions.set(sessionKey, sessionId);
    }

    await logChannelMessage("ntfy", "incoming", event.message, { channelId });

    const access = evaluateChannelAccess(channelId, String(topic), "ntfy");
    if (!access.permitted) {
      if (access.reply) await this.sendMessage(channelId, topic, access.reply);
      return;
    }

    let response: string;
    try {
      response = await this.messageHandler(event.message, topic, sessionId, {
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
      await this.sendMessage(channelId, topic, response);
      await logChannelMessage("ntfy", "outgoing", response, { channelId });
    }
  }
}

export const ntfyAdapter = new NtfyAdapter();
