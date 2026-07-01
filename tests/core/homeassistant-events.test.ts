import { describe, expect, test } from "bun:test";
import { parseHomeAssistantWebhook, notifyTarget } from "../../src/core/channels/homeassistant-events";

describe("parseHomeAssistantWebhook", () => {
  test("reads text from body and defaults sender/conversation", () => {
    expect(parseHomeAssistantWebhook({ text: "turn on lights" }, {})).toEqual({
      text: "turn on lights",
      senderId: "homeassistant",
      conversationId: "homeassistant",
    });
  });

  test("honors explicit user/conversation and alternate text keys", () => {
    expect(
      parseHomeAssistantWebhook({ message: "hi", user: "carsen", conversation_id: "kitchen" }, {})
    ).toEqual({ text: "hi", senderId: "carsen", conversationId: "kitchen" });
  });

  test("falls back to query params", () => {
    expect(parseHomeAssistantWebhook({}, { command: "status", user: "u1" })).toEqual({
      text: "status",
      senderId: "u1",
      conversationId: "homeassistant",
    });
  });

  test("returns null when no text is present", () => {
    expect(parseHomeAssistantWebhook({ user: "x" }, {})).toBeNull();
    expect(parseHomeAssistantWebhook(null, {})).toBeNull();
  });
});

describe("notifyTarget", () => {
  test("splits domain.service", () => {
    expect(notifyTarget("notify.mobile_app_pixel")).toEqual({
      domain: "notify",
      service: "mobile_app_pixel",
    });
  });
  test("defaults domain to notify for a bare service", () => {
    expect(notifyTarget("persistent_notification")).toEqual({
      domain: "notify",
      service: "persistent_notification",
    });
  });
});
