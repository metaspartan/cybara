import { describe, expect, test } from "bun:test";
import { measureContextCompaction } from "../../src/core/llm/context-pressure";

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
});
