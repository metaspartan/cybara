import { createHash } from "crypto";
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

function signedFeishuPayload(body: unknown, encryptKey: string): WebhookPayload {
  const rawBody = JSON.stringify(body);
  const timestamp = String(Math.floor(Date.now() / 1000));
  const nonce = "nonce";
  const signature = createHash("sha256")
    .update(timestamp + nonce + encryptKey + rawBody, "utf8")
    .digest("hex");
  return {
    body,
    rawBody,
    headers: {
      "x-lark-request-timestamp": timestamp,
      "x-lark-request-nonce": nonce,
      "x-lark-signature": signature,
    },
    query: {},
  };
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
      encrypt_key: "encrypt-key",
    });
    const result = await adapter.handleWebhook(
      "feishu-auth",
      signedFeishuPayload(
        {
          header: { event_type: "im.message.receive_v1" },
          event: {
            message: {
              chat_id: "chat",
              message_type: "text",
              content: JSON.stringify({ text: "hello" }),
            },
            sender: { sender_id: { open_id: "sender" } },
          },
        },
        "encrypt-key"
      )
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

  test("Feishu requires signed requests and acknowledges challenge retries", async () => {
    const adapter = new FeishuAdapter();
    await adapter.start("feishu-signed", {
      app_id: "app",
      app_secret: "secret",
      verification_token: "expected",
      encrypt_key: "encrypt-key",
    });
    const body = { type: "url_verification", challenge: "ready", token: "expected" };
    const signed = signedFeishuPayload(body, "encrypt-key");
    expect(await adapter.handleWebhook("feishu-signed", signed)).toEqual({
      status: 200,
      body: { challenge: "ready" },
    });
    expect(await adapter.handleWebhook("feishu-signed", signed)).toEqual({
      status: 200,
      body: { challenge: "ready" },
    });
    await adapter.stop("feishu-signed");
  });

  test("Feishu acknowledges event retries without dispatching twice", async () => {
    const adapter = new FeishuAdapter();
    await adapter.start("feishu-retry", {
      app_id: "app",
      app_secret: "secret",
      verification_token: "expected",
      encrypt_key: "encrypt-key",
      dm_policy: "open",
    });
    let calls = 0;
    let markHandled: (() => void) | undefined;
    const handled = new Promise<void>((resolve) => {
      markHandled = resolve;
    });
    adapter.setMessageHandler(async () => {
      calls += 1;
      markHandled?.();
      return "";
    });
    const signed = signedFeishuPayload(
      {
        token: "expected",
        header: { event_type: "im.message.receive_v1" },
        event: {
          message: {
            chat_id: "chat",
            chat_type: "p2p",
            message_type: "text",
            content: JSON.stringify({ text: "hello" }),
          },
          sender: { sender_id: { open_id: "sender" } },
        },
      },
      "encrypt-key"
    );

    expect((await adapter.handleWebhook("feishu-retry", signed)).status).toBe(200);
    await handled;
    expect((await adapter.handleWebhook("feishu-retry", signed)).status).toBe(200);
    expect(calls).toBe(1);
    await adapter.stop("feishu-retry");
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
