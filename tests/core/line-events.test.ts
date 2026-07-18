import { describe, expect, test } from "bun:test";
import { createHmac } from "crypto";
import { verifyLineSignature, parseLineEvents } from "../../src/core/channels/line-events";

describe("LINE signature verification", () => {
  const secret = "s3cr3t";
  const body = '{"events":[]}';
  const goodSig = createHmac("sha256", secret).update(body).digest("base64");

  test("accepts a valid signature", () => {
    expect(verifyLineSignature(body, goodSig, secret)).toBe(true);
  });

  test("rejects a tampered body or wrong secret", () => {
    expect(verifyLineSignature('{"events":[1]}', goodSig, secret)).toBe(false);
    expect(verifyLineSignature(body, goodSig, "wrong")).toBe(false);
    expect(verifyLineSignature(body, "", secret)).toBe(false);
  });
});

describe("LINE event parsing", () => {
  test("extracts text messages with reply token and source", () => {
    const body = {
      events: [
        {
          type: "message",
          replyToken: "rt1",
          message: { type: "text", text: "hi" },
          source: { type: "user", userId: "u1" },
        },
      ],
    };
    expect(parseLineEvents(body)).toEqual([
      { replyToken: "rt1", sourceId: "u1", text: "hi", isGroup: false },
    ]);
  });

  test("prefers group/room id over user id", () => {
    const body = {
      events: [
        {
          type: "message",
          replyToken: "r",
          message: { type: "text", text: "yo" },
          source: { type: "group", groupId: "g1", userId: "u1" },
        },
      ],
    };
    expect(parseLineEvents(body)[0].sourceId).toBe("g1");
    expect(parseLineEvents(body)[0].isGroup).toBe(true);
  });

  test("ignores non-text and non-message events", () => {
    const body = {
      events: [
        { type: "follow", source: { userId: "u1" } },
        { type: "message", message: { type: "sticker" }, source: { userId: "u1" } },
        { type: "message", message: { type: "text", text: "  " }, source: { userId: "u1" } },
      ],
    };
    expect(parseLineEvents(body)).toEqual([]);
  });

  test("handles missing/garbage", () => {
    expect(parseLineEvents({})).toEqual([]);
    expect(parseLineEvents(null)).toEqual([]);
  });
});
