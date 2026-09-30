import { describe, expect, test } from "bun:test";
import {
  COMPACTION_SUMMARY_MAX_CHARS,
  buildCompactionFallbackSummary,
  isContextSummaryMessage,
  shouldCompactContext,
} from "../../src/core/session-context";
import type { ChatMessage } from "../../src/api/chat-types";

function userMessage(content: string): ChatMessage {
  return { role: "user", content, timestamp: "2026-01-01T00:00:00.000Z" };
}

function summaryMessage(content: string): ChatMessage {
  return {
    role: "system",
    content: `[Context Summary: earlier work]\n${content}`,
    timestamp: "2026-01-01T00:00:00.000Z",
  };
}

describe("compaction fallback summary stays bounded", () => {
  test("never nests the previous summary inside the new one", () => {
    let summary = "initial checkpoint content";
    for (let round = 0; round < 6; round += 1) {
      summary = buildCompactionFallbackSummary(
        [userMessage(`turn ${round}`), { role: "assistant" as const, content: `reply ${round}` }],
        summary
      );
    }
    const occurrences = summary.split("Prior checkpoint:").length - 1;
    expect(occurrences).toBeLessThanOrEqual(1);
  });

  test("keeps the summary inside the compaction character budget", () => {
    const hugePrevious = "x".repeat(COMPACTION_SUMMARY_MAX_CHARS * 2);
    const summary = buildCompactionFallbackSummary([userMessage("y".repeat(50_000))], hugePrevious);
    expect(summary.length).toBeLessThanOrEqual(COMPACTION_SUMMARY_MAX_CHARS);
  });

  test("preserves the newest turns and the prior checkpoint", () => {
    const summary = buildCompactionFallbackSummary(
      [
        userMessage("oldest request"),
        { role: "assistant" as const, content: "oldest reply" },
        userMessage("newest request"),
        { role: "assistant" as const, content: "newest reply" },
      ],
      "prior goals and decisions"
    );
    expect(summary).toContain("prior goals and decisions");
    expect(summary).toContain("newest request");
  });
});

describe("context summary detection", () => {
  test("recognizes a checkpoint message and not an ordinary system message", () => {
    expect(isContextSummaryMessage(summaryMessage("content"))).toBe(true);
    expect(
      isContextSummaryMessage({ role: "system", content: "You are a helpful assistant." })
    ).toBe(false);
  });
});

describe("compaction does not thrash once a checkpoint exists", () => {
  const window = 4000;

  test("still compacts a long conversation that has never been compacted", () => {
    const messages = Array.from({ length: 40 }, (_, i) =>
      userMessage(`message ${i} ${"detail ".repeat(20)}`)
    );
    expect(shouldCompactContext(messages, undefined, undefined, window).needed).toBe(true);
  });

  test("stops re-compacting an already compacted conversation that fits the window", () => {
    const messages = [
      summaryMessage("condensed earlier work"),
      userMessage("a".repeat(2000)),
      { role: "assistant" as const, content: "b".repeat(2000) },
    ];
    expect(shouldCompactContext(messages, undefined, undefined, window).needed).toBe(false);
  });

  test("compacts again once the compacted conversation actually overflows", () => {
    const messages = [
      summaryMessage("condensed earlier work"),
      userMessage("a".repeat(20_000)),
      { role: "assistant" as const, content: "b".repeat(20_000) },
    ];
    expect(shouldCompactContext(messages, undefined, undefined, window).needed).toBe(true);
  });
});
