import { describe, expect, test } from "bun:test";
import { FeishuAdapter } from "../../src/core/channels/adapters/feishu";
import { GoogleChatAdapter } from "../../src/core/channels/adapters/googlechat";
import { HomeAssistantAdapter } from "../../src/core/channels/adapters/homeassistant";
import { ZaloAdapter } from "../../src/core/channels/adapters/zalo";
import { ZulipAdapter } from "../../src/core/channels/adapters/zulip";
import type { WebhookPayload } from "../../src/core/channels/types";

function payload(body: unknown): WebhookPayload {
  return { body, rawBody: JSON.stringify(body), headers: {}, query: {} };
}

describe("channel webhook authentication", () => {
  test("Zulip rejects a parser-valid event when the configured token is omitted", async () => {
    const adapter = new ZulipAdapter();
    await adapter.start("zulip-auth", { token: "expected" });
    const result = await adapter.handleWebhook(
      "zulip-auth",
      payload({
        message: {
          sender_email: "user@example.com",
          type: "private",
          content: "hello",
        },
      })
    );
    expect(result.status).toBe(401);
    await adapter.stop("zulip-auth");
  });

  test("Feishu rejects a parser-valid event when its verification token is omitted", async () => {
    const adapter = new FeishuAdapter();
    await adapter.start("feishu-auth", {
      app_id: "app",
      app_secret: "secret",
      verification_token: "expected",
    });
    const result = await adapter.handleWebhook(
      "feishu-auth",
      payload({
        header: { event_type: "im.message.receive_v1" },
        event: {
          message: {
            chat_id: "chat",
            message_type: "text",
            content: JSON.stringify({ text: "hello" }),
          },
          sender: { sender_id: { open_id: "sender" } },
        },
      })
    );
    expect(result.status).toBe(401);
    await adapter.stop("feishu-auth");
  });

  test("Feishu refuses to start without inbound authentication", async () => {
    const adapter = new FeishuAdapter();
    await expect(
      adapter.start("feishu-auth-missing", { app_id: "app", app_secret: "secret" })
    ).rejects.toThrow("verification_token is required");
  });

  test("Google Chat refuses to start without inbound authentication", async () => {
    const adapter = new GoogleChatAdapter();
    await expect(
      adapter.start("google-auth", { webhook_url: "https://example.com/hook" })
    ).rejects.toThrow("verify_token is required");
  });

  test("Google Chat rejects an event that omits its required token", async () => {
    const adapter = new GoogleChatAdapter();
    await adapter.start("google-auth-event", {
      webhook_url: "https://example.com/hook",
      verify_token: "expected",
    });
    const result = await adapter.handleWebhook(
      "google-auth-event",
      payload({
        type: "MESSAGE",
        message: { text: "hello", sender: { name: "users/1" }, space: { name: "spaces/1" } },
      })
    );
    expect(result.status).toBe(401);
    await adapter.stop("google-auth-event");
  });

  test("Home Assistant refuses to start without inbound authentication", async () => {
    const adapter = new HomeAssistantAdapter();
    await expect(adapter.start("ha-auth", {})).rejects.toThrow("verify_token is required");
  });

  test("Home Assistant rejects an event that omits its required token", async () => {
    const adapter = new HomeAssistantAdapter();
    await adapter.start("ha-auth-event", { verify_token: "expected" });
    const result = await adapter.handleWebhook(
      "ha-auth-event",
      payload({ text: "turn on the lights" })
    );
    expect(result.status).toBe(401);
    await adapter.stop("ha-auth-event");
  });

  test("Zalo refuses to start without webhook authentication", async () => {
    const adapter = new ZaloAdapter();
    await expect(adapter.start("zalo-auth", { access_token: "token" })).rejects.toThrow(
      "app_id and app_secret are required"
    );
  });

  test("Zalo rejects a parser-valid unsigned event", async () => {
    const adapter = new ZaloAdapter();
    await adapter.start("zalo-auth-event", {
      access_token: "token",
      app_id: "app",
      app_secret: "secret",
    });
    const result = await adapter.handleWebhook(
      "zalo-auth-event",
      payload({
        event_name: "user_send_text",
        sender: { id: "sender" },
        message: { text: "hello" },
      })
    );
    expect(result.status).toBe(401);
    await adapter.stop("zalo-auth-event");
  });
});
