import { describe, expect, test } from "bun:test";
import { reciprocalRankFusion } from "../../src/core/memory/vector-store";

describe("reciprocal rank fusion", () => {
  test("rewards items ranked highly by multiple lists", () => {
    const fused = reciprocalRankFusion([
      { ids: ["a", "b", "c"], weight: 0.7 },
      { ids: ["b", "d", "a"], weight: 0.3 },
    ]);
    const order = fused.map((r) => r.id);
    // "b" is #2 in vector but #1 in keyword; "a" is #1 in vector but #3 in
    // keyword. Both appear in both lists and should outrank single-list items.
    expect(order.indexOf("a")).toBeLessThan(order.indexOf("c"));
    expect(order.indexOf("b")).toBeLessThan(order.indexOf("d"));
    expect(order.slice(0, 2).sort()).toEqual(["a", "b"]);
  });

  test("is robust to score scale — uses rank, not raw score", () => {
    // Even if one engine's raw scores were huge, only the RANK matters here.
    const fused = reciprocalRankFusion([
      { ids: ["x", "y"], weight: 0.5 },
      { ids: ["y", "x"], weight: 0.5 },
    ]);
    // Symmetric ranks + equal weights => equal fused scores.
    expect(fused[0].score).toBeCloseTo(fused[1].score, 10);
  });

  test("normalizes the top result to 1.0", () => {
    const fused = reciprocalRankFusion([{ ids: ["only"], weight: 1 }]);
    expect(fused[0].id).toBe("only");
    expect(fused[0].score).toBeCloseTo(1, 10);
  });

  test("respects list weight when ranks tie", () => {
    const fused = reciprocalRankFusion([
      { ids: ["heavy"], weight: 0.9 },
      { ids: ["light"], weight: 0.1 },
    ]);
    expect(fused[0].id).toBe("heavy");
  });
});
