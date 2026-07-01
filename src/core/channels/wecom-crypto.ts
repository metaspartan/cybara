import { createHash, createDecipheriv, createCipheriv, timingSafeEqual, randomBytes } from "crypto";

export interface WecomInbound {
  from: string;
  agentId: string;
  content: string;
}

function aesKeyFromEncoding(encodingAesKey: string): Buffer {
  return Buffer.from(encodingAesKey + "=", "base64");
}

export function wecomSignature(
  token: string,
  timestamp: string,
  nonce: string,
  encrypt: string
): string {
  const parts = [token, timestamp, nonce, encrypt].sort();
  return createHash("sha1").update(parts.join(""), "utf8").digest("hex");
}

export function verifyWecomSignature(
  token: string,
  timestamp: string,
  nonce: string,
  encrypt: string,
  signature: string
): boolean {
  if (!signature || !token) return false;
  const expected = wecomSignature(token, timestamp, nonce, encrypt);
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function decryptWecom(
  encrypt: string,
  encodingAesKey: string
): { message: string; receiveId: string } {
  const key = aesKeyFromEncoding(encodingAesKey);
  const iv = key.subarray(0, 16);
  const decipher = createDecipheriv("aes-256-cbc", key, iv);
  decipher.setAutoPadding(false);
  let decrypted = Buffer.concat([
    decipher.update(Buffer.from(encrypt, "base64")),
    decipher.final(),
  ]);
  const padLen = decrypted[decrypted.length - 1];
  decrypted = decrypted.subarray(0, decrypted.length - padLen);
  const content = decrypted.subarray(16);
  const msgLen = content.readUInt32BE(0);
  const message = content.subarray(4, 4 + msgLen).toString("utf8");
  const receiveId = content.subarray(4 + msgLen).toString("utf8");
  return { message, receiveId };
}

export function encryptWecom(message: string, encodingAesKey: string, receiveId: string): string {
  const key = aesKeyFromEncoding(encodingAesKey);
  const iv = key.subarray(0, 16);
  const msg = Buffer.from(message, "utf8");
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(msg.length, 0);
  let bytes = Buffer.concat([randomBytes(16), lenBuf, msg, Buffer.from(receiveId, "utf8")]);
  const blockSize = 32;
  const padLen = blockSize - (bytes.length % blockSize) || blockSize;
  bytes = Buffer.concat([bytes, Buffer.alloc(padLen, padLen)]);
  const cipher = createCipheriv("aes-256-cbc", key, iv);
  cipher.setAutoPadding(false);
  return Buffer.concat([cipher.update(bytes), cipher.final()]).toString("base64");
}

export function extractXmlField(xml: string, tag: string): string {
  const re = new RegExp(`<${tag}>(?:<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>|([\\s\\S]*?))</${tag}>`);
  const m = re.exec(xml);
  return m ? (m[1] ?? m[2] ?? "").trim() : "";
}

export function parseWecomMessage(xml: string): WecomInbound | null {
  if (extractXmlField(xml, "MsgType") !== "text") return null;
  const content = extractXmlField(xml, "Content");
  if (!content) return null;
  return {
    from: extractXmlField(xml, "FromUserName"),
    agentId: extractXmlField(xml, "AgentID"),
    content,
  };
}
