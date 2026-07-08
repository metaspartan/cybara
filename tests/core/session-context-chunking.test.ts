import { describe, expect, test } from "bun:test";
import {
  computeAdaptiveChunkRatio,
  estimateMessageTokens,
  estimateMessageTranscriptTokens,
  estimateMessagesTokens,
  estimateSessionContextUsage,
  splitMessagesByTokenShare,
  isOversizedForSummary,
  shouldCompactContext,
} from "../../src/core/session-context";
import type { ChatMessage } from "../../src/core/agent";

function msg(role: string, content: string): ChatMessage {
  return { role: role as ChatMessage["role"], content, timestamp: new Date().toISOString() };
}

describe("session-context chunking helpers", () => {
  test("estimateMessageTokens is roughly content-length / 4", () => {
    const tokens = estimateMessageTokens(msg("user", "hello world this is a test"));
    expect(tokens).toBeGreaterThan(0);
    expect(tokens).toBeLessThan(100);
  });

  test("estimateMessagesTokens sums across messages", () => {
    const msgs = [msg("user", "one"), msg("assistant", "two two")];
    const total = estimateMessagesTokens(msgs);
    expect(total).toBeGreaterThan(estimateMessageTokens(msgs[0]));
  });

  test("active context estimate excludes stored tool timeline metadata", () => {
    const message = {
      ...msg("assistant", "Done."),
      thinking: "hidden thought ".repeat(100),
      tool_calls: [
        {
          id: "tool-1",
          name: "read",
          args: { path: "/tmp/example.ts" },
          status: "completed",
          result: { content: "x".repeat(40_000) },
        },
      ],
      process_activities: [
        {
          id: "activity-1",
          phase: "result",
          text: "Read a large file",
          timestamp: Date.now(),
          toolName: "read",
        },
      ],
    } as Parameters<typeof estimateMessageTokens>[0];
    expect(estimateMessageTokens(message)).toBeLessThan(100);
    expect(estimateMessageTranscriptTokens(message)).toBeGreaterThan(10_000);
  });

  test("session context usage reports active tokens separately from transcript metadata", () => {
    const messages = [
      msg("user", "review this repository"),
      {
        ...msg("assistant", "I reviewed the repository."),
        tool_calls: [
          {
            id: "tool-1",
            name: "read",
            args: {},
            status: "completed",
            result: "x".repeat(80_000),
          },
        ],
      },
    ] as Parameters<typeof estimateSessionContextUsage>[0];
    const usage = estimateSessionContextUsage(messages, "grok-build");
    expect(usage.usedTokens).toBeLessThan(usage.transcriptTokens);
    expect(usage.metadataTokens).toBe(usage.transcriptTokens - usage.usedTokens);
    expect(usage.usedPercent).toBeLessThan(100);
    expect(usage.compacted).toBe(false);
    expect(usage.source).toBe("estimated");
  });

  test("compaction checks do not need newContent after the turn is appended", () => {
    const content = "x".repeat(88_000);
    const messages = [msg("user", content)];
    expect(shouldCompactContext(messages, "mixtral").needed).toBe(false);
    expect(shouldCompactContext(messages, "mixtral", content).needed).toBe(true);
  });

  test("splitMessagesByTokenShare splits into N roughly-equal chunks", () => {
    const msgs = Array.from({ length: 10 }, (_, i) =>
      msg("user", `message number ${i} with content`)
    );
    const chunks = splitMessagesByTokenShare(msgs, 2);
    expect(chunks.length).toBe(2);
    // All messages accounted for.
    const total = chunks.reduce((sum, c) => sum + c.length, 0);
    expect(total).toBe(msgs.length);
    // No empty chunks.
    expect(chunks.every((c) => c.length > 0)).toBe(true);
  });

  test("splitMessagesByTokenShare handles fewer messages than parts", () => {
    const msgs = [msg("user", "a"), msg("assistant", "b")];
    const chunks = splitMessagesByTokenShare(msgs, 5);
    // Should not produce more chunks than messages.
    expect(chunks.length).toBeLessThanOrEqual(msgs.length);
  });

  test("splitMessagesByTokenShare returns [] for empty input", () => {
    expect(splitMessagesByTokenShare([], 3)).toEqual([]);
  });

  test("splitMessagesByTokenShare returns [messages] for parts=1", () => {
    const msgs = [msg("user", "x"), msg("assistant", "y")];
    expect(splitMessagesByTokenShare(msgs, 1)).toEqual([msgs]);
  });

  test("computeAdaptiveChunkRatio returns a value between MIN and BASE", () => {
    const msgs = [msg("user", "short")];
    const ratio = computeAdaptiveChunkRatio(msgs, 128000);
    expect(ratio).toBeGreaterThan(0);
    expect(ratio).toBeLessThanOrEqual(1);
  });

  test("computeAdaptiveChunkRatio reduces ratio for oversized messages", () => {
    const smallMsgs = [msg("user", "tiny")];
    const largeMsgs = [msg("user", "x".repeat(20000))];
    const smallRatio = computeAdaptiveChunkRatio(smallMsgs, 8000);
    const largeRatio = computeAdaptiveChunkRatio(largeMsgs, 8000);
    expect(largeRatio).toBeLessThanOrEqual(smallRatio);
  });

  test("isOversizedForSummary flags messages exceeding the threshold", () => {
    const smallMsg = msg("user", "hello");
    const hugeMsg = msg("user", "x".repeat(100000));
    expect(isOversizedForSummary(smallMsg, 128000)).toBe(false);
    expect(isOversizedForSummary(hugeMsg, 1000)).toBe(true);
  });
});
