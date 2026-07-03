import { createHmac, timingSafeEqual } from "crypto";

export interface MsTeamsInbound {
  conversationId: string;
  serviceUrl: string;
  sender: string;
  senderName: string;
  text: string;
}

export function verifyMsTeamsSignature(
  rawBody: string,
  authHeader: string,
  securityToken: string
): boolean {
  if (!authHeader || !securityToken) return false;
  const provided = authHeader.replace(/^HMAC\s+/i, "").trim();
  if (!provided) return false;
  let key: Buffer;
  try {
    key = Buffer.from(securityToken, "base64");
  } catch {
    return false;
  }
  const expected = createHmac("sha256", key).update(rawBody, "utf8").digest("base64");
  const a = Buffer.from(expected);
  const b = Buffer.from(provided);
  return a.length === b.length && timingSafeEqual(a, b);
}

function stripMentions(text: string): string {
  return text
    .replace(/<at[^>]*>.*?<\/at>/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function parseMsTeamsActivity(body: unknown): MsTeamsInbound | null {
  const a = body as {
    type?: string;
    text?: string;
    serviceUrl?: string;
    from?: { id?: string; name?: string };
    conversation?: { id?: string };
  };
  if (a?.type !== "message") return null;
  const text = typeof a.text === "string" ? stripMentions(a.text) : "";
  if (!text) return null;
  return {
    conversationId: a.conversation?.id || "",
    serviceUrl: typeof a.serviceUrl === "string" ? a.serviceUrl : "",
    sender: a.from?.id || "",
    senderName: a.from?.name || "",
    text,
  };
}
