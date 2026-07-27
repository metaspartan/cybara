import { describe, expect, test } from "bun:test";
import {
  cacheReadSharePct,
  formatBytes,
  formatNumber,
  metricTokenActivityRows,
} from "../../ui/src/pages/metrics/metricsFormatting";

describe("metrics formatting", () => {
  test("computes cache share from normalized effective input without double counting", () => {
    expect(cacheReadSharePct(100, 60)).toBe(60);
    expect(cacheReadSharePct(0, 60)).toBe(0);
    expect(cacheReadSharePct(40, 60)).toBe(100);
  });

  test("keeps token activity separate from unrelated high-magnitude status metrics", () => {
    expect(
      metricTokenActivityRows([
        {
          date: "2026-07-27",
          token_usage: 1200,
          tool_call: 12,
          api_call: 9,
          system_status: 9_999_999_999_999,
        },
      ])
    ).toEqual([
      {
        label: "2026-07-27",
        value: 1200,
        detail: "12 tools · 9 API calls",
      },
    ]);
  });

  test("formats unavailable metric values without crashing the page", () => {
    expect(formatNumber(undefined)).toBe("0");
    expect(formatNumber(Number.NaN)).toBe("0");
    expect(formatBytes(null)).toBe("0 B");
  });
});
