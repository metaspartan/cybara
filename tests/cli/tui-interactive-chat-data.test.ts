import { describe, expect, test } from "bun:test";
import { messagesFromResponse } from "../../src/cli/tui/interactive-chat-data";

describe("TUI interactive chat data", () => {
  test("preserves persisted turn timestamps for completed work duration", () => {
    const messages = messagesFromResponse([
      {
        role: "user",
        content: "Read package.json",
        timestamp: "2026-07-17 09:45:43.043",
      },
      {
        role: "assistant",
        content: "The package is Cybara.",
        timestamp: "2026-07-17 09:45:49.361",
      },
    ]);

    expect(messages[0]?.timestamp).toBe(Date.parse("2026-07-17T09:45:43.043Z"));
    expect(messages[1]?.timestamp).toBe(Date.parse("2026-07-17T09:45:49.361Z"));
    expect(messages[1]?.turnStartedAt).toBe(messages[0]?.timestamp);
  });

  test("does not carry a prior turn timestamp across a system message", () => {
    const messages = messagesFromResponse([
      { role: "assistant", content: "Ready", timestamp: "2026-07-17T09:45:49.361Z" },
    ]);

    expect(messages[0]?.turnStartedAt).toBeUndefined();
  });

  test("preserves stopped assistant turns with activity and no text", () => {
    const messages = messagesFromResponse([
      {
        role: "user",
        content: "Inspect the workspace",
        timestamp: "2026-07-17T09:45:43.043Z",
      },
      {
        role: "assistant",
        content: "",
        timestamp: "2026-07-17T09:45:49.361Z",
        source: "chat_stopped",
        process_activities: [
          {
            id: "activity-1",
            phase: "result",
            text: "Explored package.json",
            toolName: "read",
          },
        ],
      },
    ]);

    expect(messages).toHaveLength(2);
    expect(messages[1]?.content).toBe("");
    expect(messages[1]?.process_activities).toEqual([
      {
        id: "activity-1",
        phase: "result",
        text: "Explored package.json",
        toolName: "read",
      },
    ]);
    expect(messages[1]?.turnStartedAt).toBe(messages[0]?.timestamp);
  });
});
