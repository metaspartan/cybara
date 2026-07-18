import { createHash, createDecipheriv, timingSafeEqual } from "crypto";

export interface FeishuInbound {
  chatId: string;
  senderId: string;
  messageType: string;
  text: string;
  isGroup: boolean;
}

export function decryptFeishuEvent(encrypt: string, encryptKey: string): unknown {
  const key = createHash("sha256").update(encryptKey, "utf8").digest();
  const data = Buffer.from(encrypt, "base64");
  const iv = data.subarray(0, 16);
  const ciphertext = data.subarray(16);
  const decipher = createDecipheriv("aes-256-cbc", key, iv);
  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return JSON.parse(decrypted.toString("utf8"));
}

export function verifyFeishuSignature(
  timestamp: string,
  nonce: string,
  encryptKey: string,
  rawBody: string,
  signature: string
): boolean {
  if (!encryptKey || !signature) return false;
  const expected = createHash("sha256")
    .update(timestamp + nonce + encryptKey + rawBody, "utf8")
    .digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function extractFeishuChallenge(body: unknown): string | null {
  const b = body as { type?: string; challenge?: string };
  if (b?.type === "url_verification" && typeof b.challenge === "string") {
    return b.challenge;
  }
  return null;
}

export function parseFeishuMessage(body: unknown): FeishuInbound | null {
  const b = body as {
    header?: { event_type?: string };
    event?: {
      message?: {
        chat_id?: string;
        chat_type?: string;
        message_type?: string;
        content?: string;
      };
      sender?: { sender_id?: { open_id?: string; user_id?: string; union_id?: string } };
    };
  };
  if (b?.header?.event_type !== "im.message.receive_v1") return null;
  const message = b.event?.message;
  if (!message) return null;
  const messageType = message.message_type || "";
  let text = "";
  if (typeof message.content === "string") {
    try {
      const parsed = JSON.parse(message.content) as { text?: string };
      text = typeof parsed.text === "string" ? parsed.text.trim() : "";
    } catch {
      text = "";
    }
  }
  if (!text) return null;
  const sid = b.event?.sender?.sender_id;
  const senderId = sid?.open_id || sid?.user_id || sid?.union_id || "";
  return {
    chatId: message.chat_id || "",
    senderId,
    messageType,
    text,
    isGroup: message.chat_type !== "p2p",
  };
}
