import { describe, expect, test } from "bun:test";
import db from "../../src/core/database";
import {
  computeAdaptiveChunkRatio,
  compactContext,
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

  test("active context estimate compacts historical tool-result dumps", () => {
    const dump = `Here are the results from the tool execution:\n\nTool: file_search\nResult: ${"x".repeat(200_000)}`;
    const message = msg("assistant", dump);
    expect(estimateMessageTokens(message)).toBeLessThan(120);
    expect(estimateMessageTranscriptTokens(message)).toBeGreaterThan(50_000);
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

  test("counts summary checkpoints separately from legacy tool-output pruning metrics", () => {
    const sessionId = `summary-metrics-${crypto.randomUUID()}`;
    const insert = db.prepare(
      `INSERT INTO metrics (id, type, key, value, metadata) VALUES (?, 'context_compaction', ?, ?, ?)`
    );
    insert.run(
      crypto.randomUUID(),
      sessionId,
      500,
      JSON.stringify({ messagesBefore: 20, messagesAfter: 6 })
    );
    insert.run(
      crypto.randomUUID(),
      sessionId,
      900,
      JSON.stringify({ messagesBefore: 12, messagesAfter: 12 })
    );

    try {
      const usage = estimateSessionContextUsage([msg("user", "continue")], "mixtral", {
        sessionId,
      });
      expect(usage.compactionCount).toBe(1);
      expect(usage.compactedTokens).toBe(500);
    } finally {
      db.prepare("DELETE FROM metrics WHERE key = ?").run(sessionId);
    }
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
    const total = chunks.reduce((sum, c) => sum + c.length, 0);
    expect(total).toBe(msgs.length);
    expect(chunks.every((c) => c.length > 0)).toBe(true);
  });

  test("splitMessagesByTokenShare handles fewer messages than parts", () => {
    const msgs = [msg("user", "a"), msg("assistant", "b")];
    const chunks = splitMessagesByTokenShare(msgs, 5);
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

  test("long-conversation compaction preserves source history and detailed recent context", async () => {
    const messages = Array.from({ length: 30 }, (_, index) =>
      msg(
        index % 2 === 0 ? "user" : "assistant",
        `turn-${index}-${"x".repeat(1100)}-MARKER_${index}-${"y".repeat(3900)}`
      )
    );
    const original = structuredClone(messages);
    const result = await compactContext(messages, "mixtral");

    expect(result.wasCompacted).toBe(true);
    expect(messages).toEqual(original);
    expect(result.messages.length).toBeLessThan(messages.length);
    expect(result.summary).toContain("MARKER_");
    expect(result.summary).not.toContain("[...truncated]");
    expect(result.messages.at(-1)).toEqual(messages.at(-1));
    expect(result.messages.at(-2)).toEqual(messages.at(-2));
  });

  test("forced compaction exercises the same summary path below the automatic threshold", async () => {
    const messages = Array.from({ length: 8 }, (_, index) =>
      msg(index % 2 === 0 ? "user" : "assistant", `turn-${index}-IDENTIFIER_${index}`)
    );
    const result = await compactContext(messages, "mixtral", undefined, { force: true });

    expect(result.wasCompacted).toBe(true);
    expect(result.summary).toContain("IDENTIFIER_");
    expect(result.messages.at(-1)).toEqual(messages.at(-1));
  });

  test("iterative compaction updates one checkpoint instead of stacking summaries", async () => {
    const previousMarker = "PRESERVE_PREVIOUS_CHECKPOINT";
    const messages = [
      msg("system", "Keep this system instruction"),
      msg("system", `[Context Summary: ${previousMarker}]`),
      ...Array.from({ length: 10 }, (_, index) =>
        msg(index % 2 === 0 ? "user" : "assistant", `new-turn-${index}-${"x".repeat(200)}`)
      ),
    ];
    const result = await compactContext(messages, "mixtral", undefined, { force: true });
    const summaries = result.messages.filter((message) =>
      message.content.startsWith("[Context Summary:")
    );

    expect(result.wasCompacted).toBe(true);
    expect(summaries).toHaveLength(1);
    expect(summaries[0]?.content).toContain(previousMarker);
    expect(
      result.messages.some((message) => message.content === "Keep this system instruction")
    ).toBe(true);
    expect(shouldCompactContext(result.messages, "mixtral").needed).toBe(false);
  });
});
