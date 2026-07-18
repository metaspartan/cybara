import { describe, expect, test } from "bun:test";
import {
  parseDingTalkMessage,
  verifyDingTalkSignature,
  signDingTalk,
} from "../../src/core/channels/dingtalk-events";
import { parseZulipMessage } from "../../src/core/channels/zulip-events";

describe("DingTalk message parsing", () => {
  test("parses a text message with session webhook", () => {
    const body = {
      msgtype: "text",
      text: { content: "  hello ding  " },
      conversationId: "cidABC",
      senderStaffId: "staff-1",
      senderNick: "Carsen",
      sessionWebhook: "https://oapi.dingtalk.com/robot/sendBySession?session=xyz",
      conversationType: "1",
    };
    expect(parseDingTalkMessage(body)).toEqual({
      conversationId: "cidABC",
      senderId: "staff-1",
      senderNick: "Carsen",
      text: "hello ding",
      sessionWebhook: "https://oapi.dingtalk.com/robot/sendBySession?session=xyz",
      isGroup: false,
    });
  });

  test("classifies group conversations", () => {
    const parsed = parseDingTalkMessage({
      msgtype: "text",
      text: { content: "hello group" },
      conversationId: "group-1",
      senderStaffId: "staff-2",
      conversationType: "2",
    });

    expect(parsed?.isGroup).toBe(true);
  });

  test("ignores non-text and empty content", () => {
    expect(parseDingTalkMessage({ msgtype: "image" })).toBeNull();
    expect(parseDingTalkMessage({ msgtype: "text", text: { content: "  " } })).toBeNull();
    expect(parseDingTalkMessage(null)).toBeNull();
  });
});

describe("DingTalk signature verification", () => {
  const secret = "SEC-token-123";
  const timestamp = "1700000000000";

  test("accepts a valid signature", () => {
    const sign = signDingTalk(timestamp, secret);
    expect(verifyDingTalkSignature(timestamp, sign, secret)).toBe(true);
  });

  test("rejects wrong secret, timestamp, and empty inputs", () => {
    const sign = signDingTalk(timestamp, secret);
    expect(verifyDingTalkSignature(timestamp, sign, "other")).toBe(false);
    expect(verifyDingTalkSignature("1700000000001", sign, secret)).toBe(false);
    expect(verifyDingTalkSignature("", sign, secret)).toBe(false);
    expect(verifyDingTalkSignature(timestamp, "", secret)).toBe(false);
  });
});

describe("Zulip message parsing", () => {
  test("parses a stream message and strips the bot mention", () => {
    const body = {
      token: "tok-1",
      message: {
        sender_email: "user@x.com",
        sender_id: 42,
        type: "stream",
        display_recipient: "general",
        subject: "topic",
        content: "@**Cybara Bot** what is 2+2",
      },
    };
    expect(parseZulipMessage(body)).toEqual({
      token: "tok-1",
      senderEmail: "user@x.com",
      senderId: "42",
      recipient: "general",
      messageType: "stream",
      text: "what is 2+2",
    });
  });

  test("falls back to sender email for private messages", () => {
    const body = {
      token: "t",
      message: { sender_email: "dm@x.com", type: "private", content: "hi" },
    };
    const parsed = parseZulipMessage(body);
    expect(parsed?.recipient).toBe("dm@x.com");
    expect(parsed?.text).toBe("hi");
  });

  test("ignores empty content and missing message", () => {
    expect(parseZulipMessage({ token: "t", message: { content: "@**bot**" } })).toBeNull();
    expect(parseZulipMessage({ token: "t" })).toBeNull();
    expect(parseZulipMessage(null)).toBeNull();
  });
});
