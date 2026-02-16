import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { tables } from "../../src/core/database";
import { securityManager } from "../../src/core/channels/security";
import { processTelegramWebhook, telegramBot } from "../../src/core/channels/adapters/telegram";

function makeChannelId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function makeTelegramUpdate(text: string) {
  return {
    update_id: Date.now(),
    message: {
      message_id: 101,
      from: {
        id: 555001,
        is_bot: false,
        first_name: "Alice",
        username: "alice",
      },
      chat: {
        id: 880011,
        type: "private" as const,
      },
      date: Math.floor(Date.now() / 1000),
      text,
    },
  };
}

type FetchCall = {
  url: string;
  method: string;
  body: unknown;
};

const originalFetch = globalThis.fetch;

describe("Telegram webhook mocked flows", () => {
  let channelId = "";
  let fetchCalls: FetchCall[] = [];

  beforeEach(() => {
    channelId = makeChannelId("telegram-webhook");
    fetchCalls = [];

    tables.channels.create({
      id: channelId,
      type: "telegram",
      name: "Telegram Test",
      enabled: true,
      config: { bot_token: "test-bot-token" },
    });

    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      let body: unknown = null;
      if (typeof init?.body === "string") {
        try {
          body = JSON.parse(init.body);
        } catch {
          body = init.body;
        }
      }
      fetchCalls.push({
        url,
        method: init?.method || "GET",
        body,
      });

      return new Response(JSON.stringify({ ok: true, result: {} }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    tables.channels.delete(channelId);
  });

  test("returns false for unknown channel id", async () => {
    const ok = await processTelegramWebhook("missing-channel", makeTelegramUpdate("hello"));
    expect(ok).toBe(false);
  });

  test("blocks unpaired sender and sends pairing message", async () => {
    let handlerCalls = 0;

    telegramBot.setMessageHandler(async () => {
      handlerCalls += 1;
      return "should not run";
    });
    securityManager.setConfig(channelId, { dm_policy: "pairing", allowed_senders: [] });

    const ok = await processTelegramWebhook(channelId, makeTelegramUpdate("hello"));

    expect(ok).toBe(true);
    expect(handlerCalls).toBe(0);
    expect(fetchCalls.some((call) => call.url.includes("/sendChatAction"))).toBe(false);

    const sendMessageCall = fetchCalls.find((call) => call.url.includes("/sendMessage"));
    expect(sendMessageCall).toBeDefined();
    const payload = sendMessageCall?.body as { text?: string };
    expect(payload.text).toContain("Pairing Required");
  });

  test("processes allowed sender message, triggers typing, and sends reply", async () => {
    const handlerInputs: Array<{
      message: string;
      chatId: string | number;
      userId: number;
      incomingChannelId: string;
    }> = [];

    telegramBot.setMessageHandler(async (message, chatId, userId, incomingChannelId) => {
      handlerInputs.push({ message, chatId, userId, incomingChannelId });
      return "pong";
    });
    securityManager.setConfig(channelId, { dm_policy: "open" });

    const ok = await processTelegramWebhook(channelId, makeTelegramUpdate("ping"));

    expect(ok).toBe(true);
    expect(handlerInputs).toHaveLength(1);
    expect(handlerInputs[0].message).toBe("ping");
    expect(handlerInputs[0].chatId).toBe(880011);
    expect(handlerInputs[0].userId).toBe(555001);
    expect(handlerInputs[0].incomingChannelId).toBe(channelId);

    expect(fetchCalls.some((call) => call.url.includes("/sendChatAction"))).toBe(true);

    const sendMessageCall = fetchCalls.find((call) => call.url.includes("/sendMessage"));
    expect(sendMessageCall).toBeDefined();
    const payload = sendMessageCall?.body as {
      text?: string;
      parse_mode?: string;
      reply_to_message_id?: number;
    };
    expect(payload.text).toBe("pong");
    expect(payload.parse_mode).toBe("Markdown");
    expect(payload.reply_to_message_id).toBe(101);
  });
});
