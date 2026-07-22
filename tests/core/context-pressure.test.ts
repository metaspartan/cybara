import { describe, expect, test } from "bun:test";
import {
  isMidLoopContextCompactionDetail,
  measureContextCompaction,
  recordMidLoopContextCompaction,
} from "../../src/core/llm/context-pressure";
import { onStatus, reduceSessionStatusSnapshot } from "../../src/core/status";

describe("mid-loop context pressure", () => {
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
});
