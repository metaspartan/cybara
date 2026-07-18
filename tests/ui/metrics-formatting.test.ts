import { describe, expect, test } from "bun:test";
import { cacheReadSharePct } from "../../ui/src/pages/metrics/metricsFormatting";

describe("metrics formatting", () => {
  test("computes cache share from normalized effective input without double counting", () => {
    expect(cacheReadSharePct(100, 60)).toBe(60);
    expect(cacheReadSharePct(0, 60)).toBe(0);
    expect(cacheReadSharePct(40, 60)).toBe(100);
  });
});
