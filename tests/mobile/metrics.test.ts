import { describe, expect, test } from "bun:test";
import {
  formatMetricBytes,
  formatMetricNumber,
  formatStorageBytes,
  metricSuccessRate,
  storageCategoryEntries,
  timeSeriesTotals,
  tokenFlowBars,
  totalFileOperations,
  type MetricsOverview,
  type MetricsStorage,
} from "../../apps/mobile/src/lib/metrics";

const overview: MetricsOverview = {
  tokenUsage: { total: 1500, input: 900, output: 500, cache: 100 },
  fileOperations: { filesRead: 4, filesWritten: 3, filesEdited: 2 },
  toolCalls: { totalCalls: 8 },
  apiCalls: { totalCalls: 10, successfulCalls: 9, failedCalls: 1 },
  agentActivity: { totalExecutions: 5, totalMessages: 6 },
};

const storage: MetricsStorage = {
  totalBytes: 4096,
  directories: { cybaraDir: "/cybara" },
  components: {
    data: { bytes: 1024, path: "/cybara/data" },
    sessions: { bytes: 2048, path: "/cybara/sessions" },
  },
};

describe("mobile metrics helpers", () => {
  test("formats core web metrics for compact native cards", () => {
    expect(formatMetricNumber(1500)).toBe("1.5K");
    expect(formatMetricBytes(2048)).toBe("2.0 KB");
    expect(formatStorageBytes(77_279_809_536)).toBe("77.28 GB");
    expect(metricSuccessRate(overview)).toBe("90.0%");
    expect(totalFileOperations(overview)).toBe(9);
    expect(tokenFlowBars(overview)).toEqual([
      { label: "Input", value: 900 },
      { label: "Output", value: 500 },
      { label: "Cache", value: 100 },
    ]);
  });

  test("builds storage and time-series chart rows deterministically", () => {
    expect(storageCategoryEntries(storage).map((entry) => entry.label)).toEqual([
      "Sessions",
      "Data",
    ]);
    expect(
      timeSeriesTotals(
        {
          days: [
            { date: "2026-06-29", token_usage: 5, tool_call: 2 },
            { date: "2026-06-30", token_usage: 8, tool_call: 3 },
          ],
        },
        ["token_usage", "tool_call"]
      )
    ).toEqual([
      { label: "06-29", value: 7 },
      { label: "06-30", value: 11 },
    ]);
  });
});
