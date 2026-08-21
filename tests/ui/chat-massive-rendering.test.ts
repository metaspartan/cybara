import { describe, expect, test } from "bun:test";
import {
  RICH_MESSAGE_DEFER_THRESHOLD,
  RICH_MESSAGE_TAIL_COUNT,
  shouldDeferRichMessageContent,
} from "../../ui/src/pages/chat/messageRenderBudget";

describe("massive chat rendering budget", () => {
  test("fully renders ordinary chats", () => {
    for (let index = 0; index < RICH_MESSAGE_DEFER_THRESHOLD; index += 1) {
      expect(shouldDeferRichMessageContent(index, RICH_MESSAGE_DEFER_THRESHOLD)).toBe(false);
    }
  });

  test("defers rich rendering only outside the newest message tail", () => {
    const messageCount = 409;
    const firstRichIndex = messageCount - RICH_MESSAGE_TAIL_COUNT;
    expect(shouldDeferRichMessageContent(0, messageCount)).toBe(true);
    expect(shouldDeferRichMessageContent(firstRichIndex - 1, messageCount)).toBe(true);
    expect(shouldDeferRichMessageContent(firstRichIndex, messageCount)).toBe(false);
    expect(shouldDeferRichMessageContent(messageCount - 1, messageCount)).toBe(false);
  });

  test("handles empty and out-of-range counts without deferring visible content", () => {
    expect(shouldDeferRichMessageContent(0, 0)).toBe(false);
    expect(shouldDeferRichMessageContent(0, -1)).toBe(false);
  });
});
