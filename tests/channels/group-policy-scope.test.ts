import { createHmac } from "crypto";
import { describe, expect, test } from "bun:test";
import { LineAdapter } from "../../src/core/channels/adapters/line";

function linePayload(
  secret: string,
  source: { type: "user"; userId: string } | { type: "group"; groupId: string; userId: string }
) {
  const body = {
    events: [
      {
        type: "message",
        replyToken: "reply-token",
        message: { type: "text", text: "hello" },
        source,
      },
    ],
  };
  const rawBody = JSON.stringify(body);
  return {
    body,
    rawBody,
    headers: {
      "x-line-signature": createHmac("sha256", secret).update(rawBody).digest("base64"),
    },
    query: {},
  };
}

describe("channel group policy scope", () => {
  test("LINE applies group policy without applying it to direct messages", async () => {
    const adapter = new LineAdapter();
    const channelId = `line-scope-${crypto.randomUUID()}`;
    const secret = "line-scope-secret";
    let handled = 0;
    adapter.setMessageHandler(async () => {
      handled++;
      return "";
    });
    await adapter.start(channelId, {
      channel_access_token: "token",
      channel_secret: secret,
      dm_policy: "open",
      group_policy: "disabled",
    });

    try {
      await adapter.handleWebhook(
        channelId,
        linePayload(secret, { type: "group", groupId: "group-1", userId: "user-1" })
      );
      expect(handled).toBe(0);

      await adapter.handleWebhook(
        channelId,
        linePayload(secret, { type: "user", userId: "user-1" })
      );
      expect(handled).toBe(1);
    } finally {
      await adapter.stop(channelId);
    }
  });
});
