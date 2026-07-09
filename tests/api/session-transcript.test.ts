import { describe, expect, test } from "bun:test";
import { mergeSessionTranscriptMessages } from "../../src/api/session-transcript";
import type { ChatMessage } from "../../src/api/chat";

describe("session transcript separation", () => {
  test("keeps durable history complete when active model context was compacted", () => {
    const persisted: ChatMessage[] = [
      { role: "user", content: "Initial request", timestamp: "2026-07-09T01:00:00.000Z" },
      {
        role: "assistant",
        content: `Full review\n${"detail ".repeat(2400)}`,
        timestamp: "2026-07-09T01:01:00.000Z",
      },
      { role: "user", content: "Continue", timestamp: "2026-07-09T01:02:00.000Z" },
    ];
    const active: ChatMessage[] = [
      { role: "system", content: "[Context Summary: earlier work]" },
      persisted[2]!,
    ];

    expect(mergeSessionTranscriptMessages(persisted, active)).toEqual(persisted);
  });

  test("enriches persisted messages and appends an unpersisted live tail", () => {
    const persisted: ChatMessage[] = [
      { role: "user", content: "Review this repo", timestamp: "2026-07-09 01:00:00.000" },
      { role: "assistant", content: "Working", timestamp: "2026-07-09 01:01:00.000" },
    ];
    const active: ChatMessage[] = [
      { role: "user", content: "Review this repo", timestamp: "2026-07-09T01:00:00.000Z" },
      {
        role: "assistant",
        content: "Working",
        timestamp: "2026-07-09T01:01:00.000Z",
        thinking: "Inspecting files",
        tool_calls: [{ id: "read-1", name: "read", status: "completed" }],
      },
      { role: "user", content: "Also check tests", timestamp: "2026-07-09T01:02:00.000Z" },
    ];

    const merged = mergeSessionTranscriptMessages(persisted, active);
    expect(merged).toHaveLength(3);
    expect(merged[1]?.thinking).toBe("Inspecting files");
    expect(merged[1]?.tool_calls?.[0]?.name).toBe("read");
    expect(merged[1]?.timestamp).toBe("2026-07-09 01:01:00.000");
    expect(merged[2]?.content).toBe("Also check tests");
  });

  test("preserves repeated identical messages by occurrence count", () => {
    const repeated: ChatMessage = { role: "user", content: "Continue" };
    const merged = mergeSessionTranscriptMessages(
      [repeated, repeated],
      [repeated, repeated, repeated]
    );
    expect(merged).toHaveLength(3);
  });
});
