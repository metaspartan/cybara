/**
 * Webhook channel adapter.
 *
 * Lets any external system (CI, monitoring, forms, IFTTT) trigger a cybara agent
 * via a signed HTTP POST. Inbound payloads are validated against an optional
 * HMAC-SHA256 signature (x-cybara-signature header, shared secret) and then
 * routed to the channel's bound agent as a message. Outbound sendMessage is a
 * no-op (webhook is inbound-only — replies go via other channels).
 */
import { createHmac } from "crypto";
import type { ChannelAdapter, ToolCallInfo } from "../types";
import { formatToolCallsPlain } from "../formatting";
import { constantTimeEqual } from "../constant-time";

export class WebhookAdapter implements ChannelAdapter {
  type = "webhook" as const;
  name = "Webhook";

  private running = new Set<string>();

  async start(channelId: string, _config: Record<string, unknown>): Promise<void> {
    this.running.add(channelId);
    console.log(
      `[Webhook] Adapter ready for channel ${channelId} (inbound via /api/channels/:id/webhook)`
    );
  }

  async stop(channelId: string): Promise<void> {
    this.running.delete(channelId);
  }

  isRunning(channelId: string): boolean {
    return this.running.has(channelId);
  }

  async sendMessage(): Promise<boolean> {
    // Webhook is inbound-only; there is no chat to reply into.
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

/** Verify an inbound webhook signature: HMAC-SHA256 of the raw body with the shared secret. */
export function verifyWebhookSignature(
  rawBody: string,
  signature: string | undefined,
  secret: string
): boolean {
  if (!secret) return false;
  if (!signature) return false;
  try {
    const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
    const sig = signature.startsWith("sha256=") ? signature.slice(7) : signature;
    return constantTimeEqual(expected, sig);
  } catch {
    return false;
  }
}

export const webhookAdapter = new WebhookAdapter();
