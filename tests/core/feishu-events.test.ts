import { describe, expect, test } from "bun:test";
import { createHash, createCipheriv, randomBytes } from "crypto";
import {
  parseFeishuMessage,
  extractFeishuChallenge,
  verifyFeishuSignature,
  decryptFeishuEvent,
} from "../../src/core/channels/feishu-events";

function larkEncrypt(payload: unknown, encryptKey: string): string {
  const key = createHash("sha256").update(encryptKey, "utf8").digest();
  const iv = randomBytes(16);
  const cipher = createCipheriv("aes-256-cbc", key, iv);
  const plaintext = Buffer.from(JSON.stringify(payload), "utf8");
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return Buffer.concat([iv, encrypted]).toString("base64");
}

describe("Feishu message parsing", () => {
  test("extracts an im.message.receive_v1 text event", () => {
    const body = {
      header: { event_type: "im.message.receive_v1" },
      event: {
        message: {
          chat_id: "oc_abc",
          chat_type: "group",
          message_type: "text",
          content: JSON.stringify({ text: "hello lark" }),
        },
        sender: { sender_id: { open_id: "ou_123" } },
      },
    };
    expect(parseFeishuMessage(body)).toEqual({
      chatId: "oc_abc",
      senderId: "ou_123",
      messageType: "text",
      text: "hello lark",
      isGroup: true,
    });

    body.event.message.chat_type = "p2p";
    expect(parseFeishuMessage(body)?.isGroup).toBe(false);
  });

  test("ignores non-message events and empty text", () => {
    expect(parseFeishuMessage({ header: { event_type: "other" } })).toBeNull();
    expect(
      parseFeishuMessage({
        header: { event_type: "im.message.receive_v1" },
        event: { message: { content: JSON.stringify({ text: "   " }) } },
      })
    ).toBeNull();
    expect(parseFeishuMessage(null)).toBeNull();
  });
});

describe("Feishu URL verification challenge", () => {
  test("returns challenge for url_verification", () => {
    expect(extractFeishuChallenge({ type: "url_verification", challenge: "xyz" })).toBe("xyz");
  });
  test("returns null otherwise", () => {
    expect(extractFeishuChallenge({ type: "event_callback" })).toBeNull();
    expect(extractFeishuChallenge(null)).toBeNull();
  });
});

describe("Feishu AES event decryption", () => {
  test("round-trips an encrypted event", () => {
    const key = "my-encrypt-key";
    const payload = { type: "url_verification", challenge: "roundtrip" };
    const encrypt = larkEncrypt(payload, key);
    expect(decryptFeishuEvent(encrypt, key)).toEqual(payload);
  });
});

describe("Feishu signature verification", () => {
  const encryptKey = "secretkey";
  const timestamp = "1700000000";
  const nonce = "abc123";
  const rawBody = JSON.stringify({ encrypt: "..." });
  const sign = (ts: string, n: string, k: string, body: string) =>
    createHash("sha256")
      .update(ts + n + k + body, "utf8")
      .digest("hex");

  test("accepts a valid signature", () => {
    const sig = sign(timestamp, nonce, encryptKey, rawBody);
    expect(verifyFeishuSignature(timestamp, nonce, encryptKey, rawBody, sig)).toBe(true);
  });

  test("rejects tampered body, wrong key, and empty inputs", () => {
    const sig = sign(timestamp, nonce, encryptKey, rawBody);
    expect(verifyFeishuSignature(timestamp, nonce, encryptKey, rawBody + "x", sig)).toBe(false);
    expect(verifyFeishuSignature(timestamp, nonce, "wrong", rawBody, sig)).toBe(false);
    expect(verifyFeishuSignature(timestamp, nonce, "", rawBody, sig)).toBe(false);
    expect(verifyFeishuSignature(timestamp, nonce, encryptKey, rawBody, "")).toBe(false);
  });
});
