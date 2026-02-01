// Web Adapter - Stub implementation
// Web UI uses SSE/WebSockets directly, not this adapter pattern

import type { ChannelAdapter, ToolCallInfo } from "../types";
import { formatToolCallsPlain } from "../formatting";

export class WebAdapter implements ChannelAdapter {
    type = "web" as const;
    name = "Web UI";

    private running = new Set<string>();

    async start(channelId: string, _config: Record<string, unknown>): Promise<void> {
        console.log(`[Web] Starting adapter for channel ${channelId}`);
        this.running.add(channelId);
        // Web UI doesn't require active connection management
        // Messages are handled via HTTP API + SSE
    }

    async stop(channelId: string): Promise<void> {
        console.log(`[Web] Stopping adapter for channel ${channelId}`);
        this.running.delete(channelId);
    }

    isRunning(channelId: string): boolean {
        return this.running.has(channelId);
    }

    async sendMessage(
        _channelId: string,
        _chatId: string | number,
        _text: string,
        _options?: Record<string, unknown>
    ): Promise<boolean> {
        // Web messages are pushed via SSE, not this method
        console.log("[Web] Messages are handled via SSE, not sendMessage");
        return true;
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

export const webAdapter = new WebAdapter();
