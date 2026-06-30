import { createHmac, timingSafeEqual } from "crypto";

export interface LineInbound {
  replyToken: string;
  sourceId: string;
  text: string;
}

export function verifyLineSignature(rawBody: string, signature: string, channelSecret: string): boolean {
  if (!signature || !channelSecret) return false;
  const expected = createHmac("sha256", channelSecret).update(rawBody).digest("base64");
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function parseLineEvents(body: unknown): LineInbound[] {
  const events = (body as { events?: unknown[] })?.events;
  if (!Array.isArray(events)) return [];
  const out: LineInbound[] = [];
  for (const ev of events) {
    const e = ev as {
      type?: string;
      replyToken?: string;
      message?: { type?: string; text?: string };
      source?: { userId?: string; groupId?: string; roomId?: string };
    };
    if (e.type !== "message" || e.message?.type !== "text") continue;
    const text = typeof e.message.text === "string" ? e.message.text.trim() : "";
    if (!text) continue;
    const sourceId = e.source?.groupId || e.source?.roomId || e.source?.userId || "";
    out.push({ replyToken: e.replyToken || "", sourceId, text });
  }
  return out;
}
