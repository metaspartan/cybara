import { describe, expect, test } from "bun:test";
import {
  formatMetricBytes,
  formatMetricNumber,
  formatStorageBytes,
  hasDetailedMetrics,
  hasMetricEndpoint,
  mergeMetricsOverview,
  metricProgressPercent,
  metricSuccessRate,
  metricsOverviewSnapshot,
  modelTokenShareRows,
  providerTokenShareRows,
  reconcileMetricsSnapshot,
  storageCategoryEntries,
  timeSeriesTotals,
  tokenFlowBars,
  tokenVelocityAreaRows,
  totalFileOperations,
  type MetricsSnapshot,
  type MetricsOverview,
  type MetricsStorage,
} from "../../apps/mobile/src/lib/metrics";

const overview: MetricsOverview = {
  tokenUsage: { total: 1500, input: 900, output: 500, cache: 100 },
  fileOperations: { filesRead: 4, filesWritten: 3, filesEdited: 2, filesSearched: 5 },
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
    expect(formatMetricNumber(undefined)).toBe("--");
    expect(formatMetricBytes(2048)).toBe("2.0 KB");
    expect(formatMetricBytes(undefined)).toBe("--");
    expect(formatStorageBytes(77_279_809_536)).toBe("77.28 GB");
    expect(metricSuccessRate(overview)).toBe("90.0%");
    expect(metricSuccessRate(null)).toBe("--");
    expect(totalFileOperations(overview)).toBe(14);
    expect(tokenFlowBars(overview)).toEqual([
      { label: "Input", value: 900 },
      { label: "Output", value: 500 },
      { label: "Cache", value: 100 },
    ]);
  });

  test("keeps zero-value chart bars visually empty", () => {
    expect(metricProgressPercent(0, 100, 4)).toBe(0);
    expect(metricProgressPercent(1, 100, 4)).toBe(4);
    expect(metricProgressPercent(150, 100, 4)).toBe(100);
    expect(metricProgressPercent(Number.NaN, 100, 4)).toBe(0);
  });

  test("builds and refreshes a lightweight overview without losing detailed metrics", () => {
    const preview = metricsOverviewSnapshot(overview);
    expect(preview.overview).toEqual(overview);
    expect(preview.availability.overview.ok).toBe(true);
    expect(hasDetailedMetrics(preview)).toBe(false);

    const detailed = {
      ...preview,
      storage,
      availability: {
        ...preview.availability,
        storage: { ok: true },
      },
    } satisfies MetricsSnapshot;
    const refreshedOverview = {
      ...overview,
      tokenUsage: { ...overview.tokenUsage, total: 2400 },
    };
    const refreshed = mergeMetricsOverview(detailed, refreshedOverview);

    expect(refreshed.overview?.tokenUsage.total).toBe(2400);
    expect(refreshed.storage).toBe(storage);
    expect(refreshed.availability.storage.ok).toBe(true);
    expect(hasDetailedMetrics(refreshed)).toBe(true);
  });

  test("keeps partial metric endpoint failures unavailable instead of treating them as zero", () => {
    const partial = {
      ...metricsOverviewSnapshot(overview),
      tools: {
        mostUsed: [],
        mostErrors: [],
        recentCalls: [],
      },
      availability: {
        ...metricsOverviewSnapshot(overview).availability,
        tools: { ok: true },
        insights: { ok: false, error: "insights offline" },
        sessions: { ok: false, error: "sessions offline" },
      },
    } satisfies MetricsSnapshot;

    expect(hasMetricEndpoint(partial, "tools")).toBe(true);
    expect(hasMetricEndpoint(partial, "insights")).toBe(false);
    expect(hasMetricEndpoint(partial, "sessions")).toBe(false);
    expect(hasDetailedMetrics(partial)).toBe(true);
  });

  test("preserves an overview completed after an older full snapshot request began", () => {
    const incoming = {
      ...metricsOverviewSnapshot(overview),
      storage,
      availability: {
        ...metricsOverviewSnapshot(overview).availability,
        storage: { ok: true },
      },
    } satisfies MetricsSnapshot;
    const newerOverview = {
      ...overview,
      tokenUsage: { ...overview.tokenUsage, total: 2400 },
    };
    const current = mergeMetricsOverview(incoming, newerOverview);

    const reconciled = reconcileMetricsSnapshot(current, incoming, 4, 5);
    expect(reconciled.overview?.tokenUsage.total).toBe(2400);
    expect(reconciled.storage).toBe(storage);

    const withoutOverlap = reconcileMetricsSnapshot(current, incoming, 5, 5);
    expect(withoutOverlap.overview?.tokenUsage.total).toBe(1500);
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

  test("builds velocity and provider/model token share rows from metrics snapshot", () => {
    const snapshot = {
      overview,
      tokens: null,
      files: null,
      tools: null,
      providers: {
        providers: [
          {
            provider: "openai",
            url: "https://api.openai.com",
            hits: 3,
            tokens: 700,
          },
        ],
      },
      timeSeries: null,
      models: {
        models: [
          {
            model: "gpt-5",
            provider: "openai",
            avgTps: 30,
            maxTps: 40,
            minTps: 20,
            avgLatencyMs: 800,
            totalTokens: 700,
            callCount: 3,
          },
        ],
      },
      insights: null,
      tokenAnalysis: {
        tokenVelocity: { hours: [{ hour: "14:00", tokens: 700, calls: 3 }] },
        modelThoughtProfiles: [
          {
            model: "gpt-5",
            provider: "openai",
            behavior: "balanced",
            inputTokens: 400,
            outputTokens: 300,
            totalTokens: 700,
            promptSharePct: 57,
            responseSharePct: 43,
            avgTps: 30,
            avgLatencyMs: 800,
          },
        ],
      },
      storage: null,
      availability: {
        overview: { ok: true },
        tokens: { ok: false },
        files: { ok: false },
        tools: { ok: false },
        providers: { ok: true },
        timeSeries: { ok: false },
        models: { ok: true },
        insights: { ok: false },
        tokenAnalysis: { ok: true },
        storage: { ok: false },
      },
    } satisfies MetricsSnapshot;

    expect(tokenVelocityAreaRows(snapshot.tokenAnalysis)).toEqual([
      { label: "14:00", value: 700, detail: "3 calls" },
    ]);
    expect(providerTokenShareRows(snapshot)[0]).toMatchObject({
      label: "openai",
      value: "700",
      amount: 700,
    });
    expect(modelTokenShareRows(snapshot)[0]).toMatchObject({
      label: "gpt-5",
      value: "700 tokens",
      detail: "openai - balanced",
      amount: 700,
    });
  });
});
