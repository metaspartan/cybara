import { describe, expect, test } from "bun:test";
import { createHmac } from "crypto";
import {
  parseMsTeamsActivity,
  verifyMsTeamsSignature,
} from "../../src/core/channels/msteams-events";

describe("Microsoft Teams activity parsing", () => {
  test("extracts a message activity", () => {
    const body = {
      type: "message",
      text: "hello there",
      serviceUrl: "https://smba.trafficmanager.net/",
      from: { id: "29:abc", name: "Carsen" },
      conversation: { id: "19:meeting@thread.v2" },
    };
    expect(parseMsTeamsActivity(body)).toEqual({
      conversationId: "19:meeting@thread.v2",
      serviceUrl: "https://smba.trafficmanager.net/",
      sender: "29:abc",
      senderName: "Carsen",
      text: "hello there",
    });
  });

  test("strips <at> bot mentions and collapses whitespace", () => {
    const body = {
      type: "message",
      text: "<at>CybaraBot</at>   what is  2+2",
      from: { id: "29:x" },
      conversation: { id: "19:y" },
    };
    expect(parseMsTeamsActivity(body)?.text).toBe("what is 2+2");
  });

  test("ignores non-message and empty text", () => {
    expect(parseMsTeamsActivity({ type: "conversationUpdate" })).toBeNull();
    expect(parseMsTeamsActivity({ type: "message", text: "   " })).toBeNull();
    expect(parseMsTeamsActivity(null)).toBeNull();
  });
});

describe("Microsoft Teams HMAC signature", () => {
  const token = Buffer.from("super-secret-key").toString("base64");
  const rawBody = JSON.stringify({ type: "message", text: "hi" });
  const sign = (body: string, key: string) =>
    createHmac("sha256", Buffer.from(key, "base64")).update(body, "utf8").digest("base64");

  test("accepts a valid HMAC header", () => {
    const auth = `HMAC ${sign(rawBody, token)}`;
    expect(verifyMsTeamsSignature(rawBody, auth, token)).toBe(true);
  });

  test("rejects a tampered body", () => {
    const auth = `HMAC ${sign(rawBody, token)}`;
    expect(verifyMsTeamsSignature(rawBody + "x", auth, token)).toBe(false);
  });

  test("rejects wrong token, missing header, and missing prefix", () => {
    const other = Buffer.from("different-key").toString("base64");
    expect(verifyMsTeamsSignature(rawBody, `HMAC ${sign(rawBody, other)}`, token)).toBe(false);
    expect(verifyMsTeamsSignature(rawBody, "", token)).toBe(false);
    expect(verifyMsTeamsSignature(rawBody, `HMAC ${sign(rawBody, token)}`, "")).toBe(false);
  });
});
