import { describe, expect, test } from "bun:test";
import {
  compactOpenAILoopMessagesForContext,
  resolveMaterializationContextBudgetChars,
} from "../../src/core/agent-context-guard";
import { tables } from "../../src/core/database";
import {
  isMidLoopContextCompactionDetail,
  measureContextCompaction,
  recordMidLoopContextCompaction,
} from "../../src/core/llm/context-pressure";
import {
  broadcastStatus,
  getSessionStatusSnapshot,
  onStatus,
  reduceSessionStatusSnapshot,
} from "../../src/core/status";

describe("mid-loop context pressure", () => {
  test("bounds deliverable-stage context without expanding smaller model budgets", () => {
    expect(resolveMaterializationContextBudgetChars(4_000_000)).toBe(120_000);
    expect(resolveMaterializationContextBudgetChars(80_000)).toBe(80_000);
    expect(resolveMaterializationContextBudgetChars(1_000)).toBe(4096);
  });

  test("measures the token reduction from compacted transcript characters", () => {
    expect(measureContextCompaction(40_000, 10_000)).toEqual({
      beforeTokens: 10_000,
      afterTokens: 2_500,
      reducedTokens: 7_500,
      reducedPercent: 75,
    });
  });

  test("does not report unchanged, expanded, or empty transcripts", () => {
    expect(measureContextCompaction(0, 0)).toBeNull();
    expect(measureContextCompaction(1_000, 1_000)).toBeNull();
    expect(measureContextCompaction(1_000, 2_000)).toBeNull();
  });

  test("normalizes fractional and negative character counts", () => {
    expect(measureContextCompaction(10.8, -50)).toEqual({
      beforeTokens: 3,
      afterTokens: 0,
      reducedTokens: 3,
      reducedPercent: 100,
    });
  });

  test("keeps tool-output trimming internal while filtering historical status events", () => {
    const statuses: string[] = [];
    const unsubscribe = onStatus((status) => {
      if (status.detail) statuses.push(status.detail);
    });
    try {
      expect(
        recordMidLoopContextCompaction({
          beforeChars: 4_000,
          afterChars: 644,
          messageCount: 12,
        })?.reducedTokens
      ).toBe(839);
    } finally {
      unsubscribe();
    }
    expect(statuses).toEqual([]);

    const detail = "Reduced earlier tool output by 839 tokens to preserve context.";
    expect(isMidLoopContextCompactionDetail(detail)).toBe(true);
    const snapshot = reduceSessionStatusSnapshot(undefined, {
      status: "thinking",
      timestamp: 1,
      detail,
      sessionId: "historical-context-pressure",
    });
    expect(snapshot?.activities).toEqual([]);
  });

  test("keeps repeated mid-loop pruning out of the visible conversation timeline", () => {
    const sessionId = `context-pressure-${crypto.randomUUID()}`;
    const messages: Array<Record<string, unknown>> = [
      { role: "system", content: "system" },
      { role: "user", content: "inspect the project" },
      { role: "assistant", content: "analysis ".repeat(500) },
      { role: "tool", tool_call_id: "call-1", content: "result ".repeat(500) },
      { role: "user", content: "continue" },
      { role: "assistant", content: "recent" },
      { role: "user", content: "keep going" },
    ];

    const context = {
      model: "kimi-k3",
      toolContext: { agentId: "agent-kimi", sessionId },
    };
    expect(compactOpenAILoopMessagesForContext(messages, 800, false, context)).toBe(true);
    expect(compactOpenAILoopMessagesForContext(messages, 800, false, context)).toBe(false);

    const snapshot = getSessionStatusSnapshot(sessionId);
    expect(snapshot).toBeNull();
    expect(tables.metrics.getCount("tool_transcript_compaction", sessionId)).toBe(1);
    expect(tables.metrics.getCount("context_compaction", sessionId)).toBe(0);

    broadcastStatus({ status: "idle", sessionId, timestamp: Date.now() });
  });

  test("stabilizes after pruning multi-million-token cumulative transcripts", () => {
    const turns = 200;
    const estimatedInputTokensPerTurn = 10_000;
    const estimatedOutputTokensPerTurn = 5_000;
    const messages: Array<Record<string, unknown>> = [{ role: "system", content: "system" }];
    for (let index = 0; index < turns; index += 1) {
      messages.push({ role: "user", content: `input-${index}-${"i".repeat(40_000)}` });
      messages.push({
        role: "assistant",
        content: `work-${index}`,
        tool_calls: [{ id: `call-${index}`, function: { name: "read", arguments: "{}" } }],
      });
      messages.push({
        role: "tool",
        tool_call_id: `call-${index}`,
        content: `output-${index}-${"o".repeat(20_000)}`,
      });
    }

    expect(turns * estimatedInputTokensPerTurn).toBe(2_000_000);
    expect(turns * estimatedOutputTokensPerTurn).toBe(1_000_000);
    expect(compactOpenAILoopMessagesForContext(messages, 400_000)).toBe(true);
    const stable = JSON.stringify(messages);
    expect(compactOpenAILoopMessagesForContext(messages, 400_000)).toBe(false);
    expect(JSON.stringify(messages)).toBe(stable);
  });
});
