import { createHmac, timingSafeEqual } from "crypto";

export interface DingTalkInbound {
  conversationId: string;
  senderId: string;
  senderNick: string;
  text: string;
  sessionWebhook: string;
}

export function signDingTalk(timestamp: string, appSecret: string): string {
  return createHmac("sha256", appSecret)
    .update(`${timestamp}\n${appSecret}`, "utf8")
    .digest("base64");
}

export function verifyDingTalkSignature(
  timestamp: string,
  sign: string,
  appSecret: string
): boolean {
  if (!timestamp || !sign || !appSecret) return false;
  const expected = signDingTalk(timestamp, appSecret);
  const a = Buffer.from(expected);
  const b = Buffer.from(sign);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function parseDingTalkMessage(body: unknown): DingTalkInbound | null {
  const b = body as {
    msgtype?: string;
    text?: { content?: string };
    conversationId?: string;
    senderStaffId?: string;
    senderId?: string;
    senderNick?: string;
    sessionWebhook?: string;
  };
  if (b?.msgtype !== "text") return null;
  const text = typeof b.text?.content === "string" ? b.text.content.trim() : "";
  if (!text) return null;
  return {
    conversationId: b.conversationId || "",
    senderId: b.senderStaffId || b.senderId || "",
    senderNick: b.senderNick || "",
    text,
    sessionWebhook: typeof b.sessionWebhook === "string" ? b.sessionWebhook : "",
  };
}
