import { describe, expect, test } from "bun:test";
import {
  signNextcloud,
  verifyNextcloudSignature,
  parseNextcloudMessage,
} from "../../src/core/channels/nextcloud-events";
import { parseZaloEvent, verifyZaloMac } from "../../src/core/channels/zalo-events";

describe("Nextcloud Talk", () => {
  const secret = "botsecret";
  const random = "r4nd0m";
  const message = '{"message":"hello"}';

  test("sign + verify round-trip", () => {
    const sig = signNextcloud(random, message, secret);
    expect(verifyNextcloudSignature(random, message, sig, secret)).toBe(true);
    expect(verifyNextcloudSignature(random, message, sig, "wrong")).toBe(false);
    expect(verifyNextcloudSignature("", message, sig, secret)).toBe(false);
  });

  test("parses a Create message event", () => {
    const body = {
      type: "Create",
      actor: { id: "users/alice" },
      object: { content: '{"message":"hello there"}' },
      target: { id: "roomtoken1" },
    };
    expect(parseNextcloudMessage(body)).toEqual({
      roomToken: "roomtoken1",
      actorId: "users/alice",
      text: "hello there",
    });
  });

  test("ignores non-Create / empty", () => {
    expect(parseNextcloudMessage({ type: "Join" })).toBeNull();
    expect(
      parseNextcloudMessage({ type: "Create", object: { content: '{"message":""}' } })
    ).toBeNull();
  });
});

describe("Zalo", () => {
  test("parses user_send_text events", () => {
    const body = { event_name: "user_send_text", sender: { id: "u1" }, message: { text: "hi" } };
    expect(parseZaloEvent(body)).toEqual({ senderId: "u1", text: "hi" });
  });

  test("ignores other events", () => {
    expect(parseZaloEvent({ event_name: "follow" })).toBeNull();
    expect(parseZaloEvent(null)).toBeNull();
  });

  test("mac verification round-trip", () => {
    const { createHash } = require("crypto");
    const appId = "app1";
    const raw = '{"event_name":"user_send_text"}';
    const ts = "1700000000";
    const secret = "oasecret";
    const mac = createHash("sha256")
      .update(appId + raw + ts + secret)
      .digest("hex");
    expect(verifyZaloMac(appId, raw, ts, secret, mac)).toBe(true);
    expect(verifyZaloMac(appId, raw, ts, secret, "bad")).toBe(false);
  });
});
