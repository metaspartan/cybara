import { describe, expect, test } from "bun:test";
import type { SessionMessageSummary } from "../../apps/mobile/src/lib/api";
import {
  chatIsWaitingForAssistant,
  splitMessageContent,
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
});
