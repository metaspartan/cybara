import { describe, expect, test } from "bun:test";
import type { SessionMessageSummary } from "../../apps/mobile/src/lib/api";
import {
  MOBILE_VISIBLE_CHAT_MESSAGE_LIMIT,
  chatIsWaitingForAssistant,
  hasUnicodeTextFallback,
  latestVisibleChatMessages,
  splitMessageContent,
  splitUnicodeTextRuns,
  visibleChatMessages,
} from "../../apps/mobile/src/lib/chat-format";

const messages: SessionMessageSummary[] = [
  {
    id: "system-1",
    role: "system",
    content: "hidden system prompt",
  },
  {
    id: "user-1",
    role: "user",
    content: "show this request",
  },
];

describe("mobile chat formatting", () => {
  test("hides system messages without changing gateway message order", () => {
    expect(visibleChatMessages(messages)).toEqual([messages[1]]);
  });

  test("keeps only the latest visible chat messages for mobile rendering", () => {
    const longHistory = Array.from(
      { length: MOBILE_VISIBLE_CHAT_MESSAGE_LIMIT + 40 },
      (_, index) => ({
        id: `message-${index}`,
        role: index % 5 === 0 ? "system" : index % 2 === 0 ? "assistant" : "user",
        content: `message ${index}`,
      })
    );
    const expected = longHistory
      .filter((message) => message.role !== "system")
      .slice(-MOBILE_VISIBLE_CHAT_MESSAGE_LIMIT);

    const visible = latestVisibleChatMessages(longHistory);

    expect(visible.length).toBe(MOBILE_VISIBLE_CHAT_MESSAGE_LIMIT);
    expect(visible.some((message) => message.role === "system")).toBe(false);
    expect(visible).toEqual(expected);
  });

  test("marks the chat as waiting when the latest visible message is from the user", () => {
    expect(chatIsWaitingForAssistant(messages, false)).toBe(true);
    expect(
      chatIsWaitingForAssistant(
        [
          ...messages,
          {
            id: "assistant-1",
            role: "assistant",
            content: "done",
          },
        ],
        false
      )
    ).toBe(false);
    expect(chatIsWaitingForAssistant([], true)).toBe(true);
  });

  test("splits long assistant text around fenced code blocks", () => {
    expect(splitMessageContent("Before\n```typescript\nconst ok = true;\n```\nAfter")).toEqual([
      { type: "text", content: "Before\n" },
      { type: "code", language: "typescript", content: "const ok = true;\n" },
      { type: "text", content: "\nAfter" },
    ]);
  });

  test("keeps emoji and non-ascii runs intact for native text fallback", () => {
    const grinning = "\u{1F600}";
    const family = "\u{1F468}\u200D\u{1F469}\u200D\u{1F467}\u200D\u{1F466}";
    expect(hasUnicodeTextFallback("plain ascii")).toBe(false);
    expect(hasUnicodeTextFallback(`Ship ${grinning} cafe\u0301 中文 ${family}`)).toBe(true);
    expect(splitUnicodeTextRuns(`Ship ${grinning} cafe\u0301 中文 ${family}`)).toEqual([
      { type: "text", content: "Ship " },
      { type: "emoji", content: grinning },
      { type: "text", content: " caf" },
      { type: "unicode", content: "e\u0301" },
      { type: "text", content: " " },
      { type: "unicode", content: "中文" },
      { type: "text", content: " " },
      { type: "emoji", content: family },
    ]);
  });
});
