import { createHash, timingSafeEqual } from "crypto";

export interface ZaloInbound {
  senderId: string;
  text: string;
}

export function parseZaloEvent(body: unknown): ZaloInbound | null {
  const event = body as {
    event_name?: string;
    sender?: { id?: string };
    message?: { text?: string };
  };
  if (event?.event_name !== "user_send_text") return null;
  const text = typeof event.message?.text === "string" ? event.message.text.trim() : "";
  if (!text) return null;
  return { senderId: event.sender?.id || "", text };
}

export function verifyZaloMac(
  appId: string,
  rawBody: string,
  timestamp: string,
  secret: string,
  mac: string
): boolean {
  if (!mac || !secret) return false;
  const expected = createHash("sha256")
    .update(appId + rawBody + timestamp + secret)
    .digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(mac);
  return a.length === b.length && timingSafeEqual(a, b);
}
