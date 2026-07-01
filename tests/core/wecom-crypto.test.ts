import { describe, expect, test } from "bun:test";
import { randomBytes } from "crypto";
import {
  wecomSignature,
  verifyWecomSignature,
  encryptWecom,
  decryptWecom,
  extractXmlField,
  parseWecomMessage,
} from "../../src/core/channels/wecom-crypto";

// A valid EncodingAESKey is 43 base64 chars -> 32 bytes after appending "=".
const encodingAesKey = randomBytes(32).toString("base64").replace(/=+$/, "").slice(0, 43);
const token = "cybaratoken";
const receiveId = "wwcorpid123";

describe("WeCom signature", () => {
  test("verify accepts a matching SHA1 signature", () => {
    const sig = wecomSignature(token, "1700000000", "nonce1", "ENCRYPTED");
    expect(verifyWecomSignature(token, "1700000000", "nonce1", "ENCRYPTED", sig)).toBe(true);
  });
  test("verify rejects tampered inputs and empty token/sig", () => {
    const sig = wecomSignature(token, "1700000000", "nonce1", "ENCRYPTED");
    expect(verifyWecomSignature(token, "1700000000", "nonce1", "TAMPERED", sig)).toBe(false);
    expect(verifyWecomSignature("", "1700000000", "nonce1", "ENCRYPTED", sig)).toBe(false);
    expect(verifyWecomSignature(token, "1700000000", "nonce1", "ENCRYPTED", "")).toBe(false);
  });
});

describe("WeCom AES encrypt/decrypt round-trip", () => {
  test("decrypt(encrypt(msg)) recovers the message and receiveId", () => {
    const inner = "<xml><Content><![CDATA[hello wecom]]></Content></xml>";
    const encrypted = encryptWecom(inner, encodingAesKey, receiveId);
    const { message, receiveId: rid } = decryptWecom(encrypted, encodingAesKey);
    expect(message).toBe(inner);
    expect(rid).toBe(receiveId);
  });

  test("handles multi-byte utf8 content", () => {
    const inner = "<xml><Content><![CDATA[你好 🌏]]></Content></xml>";
    const roundtrip = decryptWecom(encryptWecom(inner, encodingAesKey, receiveId), encodingAesKey);
    expect(roundtrip.message).toBe(inner);
  });
});

describe("WeCom XML parsing", () => {
  test("extractXmlField reads CDATA and plain values", () => {
    const xml =
      "<xml><FromUserName><![CDATA[user1]]></FromUserName><AgentID>1000002</AgentID></xml>";
    expect(extractXmlField(xml, "FromUserName")).toBe("user1");
    expect(extractXmlField(xml, "AgentID")).toBe("1000002");
    expect(extractXmlField(xml, "Missing")).toBe("");
  });

  test("parseWecomMessage returns text messages, ignores others", () => {
    const textXml =
      "<xml><MsgType><![CDATA[text]]></MsgType><Content><![CDATA[hi there]]></Content><FromUserName><![CDATA[u1]]></FromUserName><AgentID>7</AgentID></xml>";
    expect(parseWecomMessage(textXml)).toEqual({ from: "u1", agentId: "7", content: "hi there" });
    const imgXml = "<xml><MsgType><![CDATA[image]]></MsgType></xml>";
    expect(parseWecomMessage(imgXml)).toBeNull();
  });
});
