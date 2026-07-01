/**
 * SMS channel adapter (Twilio).
 *
 * Sends outbound SMS via the Twilio REST API and accepts inbound SMS via Twilio
 * webhooks (POST /api/channels/:id/webhook with `From`/`Body`). Uses fetch only
 * — no Twilio SDK dependency.
 */
import type { ChannelAdapter, ToolCallInfo } from "../types";
import { formatToolCallsPlain } from "../formatting";

interface SmsConfig {
  account_sid?: string;
  auth_token?: string;
  from_number?: string;
}

export class SmsAdapter implements ChannelAdapter {
  type = "sms" as const;
  name = "SMS (Twilio)";

  private running = new Set<string>();
  private configs = new Map<string, SmsConfig>();

  async start(channelId: string, config: Record<string, unknown>): Promise<void> {
    this.configs.set(channelId, {
      account_sid: typeof config.account_sid === "string" ? config.account_sid : undefined,
      auth_token: typeof config.auth_token === "string" ? config.auth_token : undefined,
      from_number: typeof config.from_number === "string" ? config.from_number : undefined,
    });
    this.running.add(channelId);
    console.log(`[SMS] Twilio adapter ready for channel ${channelId}`);
  }

  async stop(channelId: string): Promise<void> {
    this.running.delete(channelId);
    this.configs.delete(channelId);
  }

  isRunning(channelId: string): boolean {
    return this.running.has(channelId);
  }

  async sendMessage(
    channelId: string,
    chatId: string | number,
    text: string
  ): Promise<boolean> {
    const cfg = this.configs.get(channelId);
    if (!cfg?.account_sid || !cfg?.auth_token || !cfg?.from_number) {
      console.warn("[SMS] Missing Twilio credentials; cannot send.");
      return false;
    }
    const to = String(chatId);
    const url = `https://api.twilio.com/2010-04-01/Accounts/${cfg.account_sid}/Messages.json`;
    const body = new URLSearchParams({ From: cfg.from_number, To: to, Body: text });
    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Basic ${btoa(`${cfg.account_sid}:${cfg.auth_token}`)}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: body.toString(),
    });
    if (!response.ok) {
      console.warn(`[SMS] Twilio send failed: ${response.status}`);
      return false;
    }
    return true;
  }

  formatResponse(content: string, toolCalls?: ToolCallInfo[], _thinking?: string): string {
    let text = content;
    if (toolCalls && toolCalls.length > 0) {
      text = formatToolCallsPlain(toolCalls) + "\n\n" + text;
    }
    // SMS should be terse; strip thinking to keep messages short.
    return text;
  }
}

export const smsAdapter = new SmsAdapter();
