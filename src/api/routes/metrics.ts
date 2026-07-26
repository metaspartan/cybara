import { tables } from "../../core/database";
import {
  enrichProviderPlanStatusWithLiveUsage,
  getProviderPlanStatus,
} from "../../core/provider-plans";
import { providers, resolveProviderType } from "../../core/providers";
import { redactSecrets } from "../../core/redaction";
import {
  buildAssistantOutputCloud,
  buildMetricTrend,
  buildStorageMetrics,
  buildTokenCallSnapshots,
  classifyModelBehavior,
  localDateKeyFromMs,
  parseMetricMetadata,
  type MetricTopKey,
  type ProviderMetricSummary,
  type RouteHandler,
  type TokenCloudEntry,
} from "./_shared";
import { getDailyLogCounts, getModelMetrics, type MetricsEntry } from "../queries";
import { listSessionRuntimeMetrics } from "../../core/session-runtime-metrics";

const TOKEN_ANALYSIS_ROW_LIMIT = 6000;

const sqlUtc = (ms: number) => new Date(ms).toISOString().slice(0, 19).replace("T", " ");
type MetricsEndpointKey =
  | "overview"
  | "tokens"
  | "files"
  | "tools"
  | "providers"
  | "timeSeries"
  | "models"
  | "insights"
  | "tokenAnalysis"
  | "storage"
  | "providerPlans"
  | "sessions";

function emptyMetricsAvailability(): Record<MetricsEndpointKey, { ok: boolean; error?: string }> {
  return {
    overview: { ok: false },
    tokens: { ok: false },
    files: { ok: false },
    tools: { ok: false },
    providers: { ok: false },
    timeSeries: { ok: false },
    models: { ok: false },
    insights: { ok: false },
    tokenAnalysis: { ok: false },
    storage: { ok: false },
    providerPlans: { ok: false },
    sessions: { ok: false },
  };
}

async function metricsSnapshotValue<T>(
  availability: Record<MetricsEndpointKey, { ok: boolean; error?: string }>,
  key: MetricsEndpointKey,
  fallback: T,
  task: () => Promise<T> | T
): Promise<T> {
  try {
    const result = await task();
    availability[key] = { ok: true };
    return result;
  } catch (error) {
    availability[key] = {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
    return fallback;
  }
}

function buildMetricsOverview() {
  const metrics = tables.metrics;
  const inputTokens = metrics.getTotal("token_usage", "input") || 0;
  const outputTokens = metrics.getTotal("token_usage", "output") || 0;
  const cacheTokens = metrics.getTotal("token_usage", "cache") || 0;
  const tokenTotals = {
    total: inputTokens + outputTokens + cacheTokens,
    input: inputTokens,
    output: outputTokens,
    cache: cacheTokens,
  };
  const fileStats = {
    filesRead: metrics.getTotal("file_operation", "read") || 0,
    filesWritten: metrics.getTotal("file_operation", "write") || 0,
    filesEdited: metrics.getTotal("file_operation", "edit") || 0,
    filesSearched: metrics.getTotal("file_operation", "search") || 0,
  };
  const totalToolCalls = metrics.getTotalByType("tool_call");
  const apiCallTotals = new Map(
    metrics.getKeyAggregates("api_call").map((row) => [row.key, row.total || 0])
  );
  const apiSuccess = apiCallTotals.get("success") || 0;
  const apiError = apiCallTotals.get("error") || 0;
  const apiStats = {
    totalCalls: apiSuccess + apiError,
    successfulCalls: apiSuccess,
    failedCalls: apiError,
  };
  const agentStats = {
    totalExecutions:
      (metrics.getTotal("agent_execution", "all") || 0) +
      (metrics.getTotal("agent_execution", "message") || 0),
    totalMessages: metrics.getTotal("agent_execution", "message") || 0,
  };
  const sessionStats = {
    totalSessions: metrics.getTotal("session_event", "created") || 0,
    memoryFlushes: metrics.getTotal("memory_flush", "success") || 0,
    memoryFlushFailures: metrics.getTotal("memory_flush", "failure") || 0,
    compactions: metrics.getTotal("compaction_reduction", "count") || 0,
  };
  const contextStats = {
    warnings: metrics.countByType("context_warning"),
    criticalWarnings: metrics.countByTypeMetadataLike("context_warning", '%"level":"critical"%'),
  };

  return {
    tokenUsage: tokenTotals,
    fileOperations: fileStats,
    toolCalls: { totalCalls: totalToolCalls },
    apiCalls: apiStats,
    agentActivity: agentStats,
    sessions: sessionStats,
    contextHealth: contextStats,
  };
}

function buildMetricsTokens() {
  const metrics = tables.metrics;
  const topModels = metrics.getTopKeys("token_usage_by_model") as MetricTopKey[];
  const topProviders = providerMetricTotals();
  const recentTokens = metrics.getByTypeRecent("token_usage", 50) as MetricsEntry[];
  const inputTokens = metrics.getTotal("token_usage", "input") || 0;
  const outputTokens = metrics.getTotal("token_usage", "output") || 0;

  return {
    topModels: topModels.map((model) => ({
      model: model.key,
      tokens: model.total,
    })),
    topProviders: topProviders.map((provider) => ({
      provider: provider.key,
      tokens: provider.total,
    })),
    recentUsage: recentTokens.slice(0, 50).map((entry) => ({
      timestamp: entry.created_at,
      tokens: entry.value,
      metadata: parseMetricMetadata(entry.metadata),
    })),
    totalTokens: inputTokens + outputTokens,
    estimatedCost: 0,
  };
}

function buildMetricsFiles() {
  const metrics = tables.metrics;
  const topRead = metrics.getTopKeys("file_read") as MetricTopKey[];
  const topWritten = metrics.getTopKeys("file_write") as MetricTopKey[];
  const topEdited = metrics.getTopKeys("file_edit") as MetricTopKey[];
  const recentOperations = metrics.getByTypeRecent("file_operation", 50) as MetricsEntry[];

  return {
    mostRead: topRead.map((entry) => ({ path: entry.key, count: entry.total })),
    mostWritten: topWritten.map((entry) => ({
      path: entry.key,
      count: entry.total,
    })),
    mostEdited: topEdited.map((entry) => ({
      path: entry.key,
      count: entry.total,
    })),
    recentOperations: recentOperations.slice(0, 50).map((operation) => ({
      timestamp: operation.created_at,
      type: operation.key,
      value: operation.value,
      metadata: parseMetricMetadata(operation.metadata),
    })),
  };
}

function buildMetricsTools() {
  const metrics = tables.metrics;
  const topTools = metrics.getTopKeys("tool_call") as MetricTopKey[];
  const toolErrors = metrics.getTopKeys("tool_error") as MetricTopKey[];
  const recentCalls = metrics.getByTypeRecent("tool_call", 50) as MetricsEntry[];

  return {
    mostUsed: topTools.map((entry) => ({
      tool: entry.key,
      calls: entry.total,
    })),
    mostErrors: toolErrors.map((entry) => ({
      tool: entry.key,
      errors: entry.total,
    })),
    recentCalls: recentCalls.slice(0, 50).map((call) => ({
      timestamp: call.created_at,
      tool: call.key,
      duration: call.value,
      metadata: parseMetricMetadata(call.metadata),
    })),
  };
}

function metadataUrl(metadata: string | null): string {
  const parsed = parseMetricMetadata(metadata ?? undefined);
  return typeof parsed?.url === "string" ? parsed.url : "unknown";
}

function providerMetricKeys(): Set<string> {
  const keys = new Set<string>(Object.keys(providers));
  for (const provider of tables.providers.all() as Array<{
    id: string;
    provider: string;
  }>) {
    keys.add(provider.id);
    keys.add(provider.provider);
  }
  return keys;
}

function isProviderMetricKey(key: string, configuredKeys: Set<string>): boolean {
  return configuredKeys.has(key) || resolveProviderType(key) !== undefined;
}

function providerMetricTotals(): MetricTopKey[] {
  const configuredKeys = providerMetricKeys();
  return tables.metrics
    .getKeyTotalsWithLatestMetadata("token_usage_by_provider")
    .filter((row) => isProviderMetricKey(row.key, configuredKeys))
    .filter((row) => row.key !== "all" && row.key !== "input" && row.key !== "output")
    .map((row) => ({ key: row.key, total: row.total || 0 }))
    .sort((left, right) => right.total - left.total);
}

function buildMetricsProviders() {
  const providerMap = new Map<string, ProviderMetricSummary>();
  const configuredKeys = providerMetricKeys();

  for (const row of tables.metrics.getKeyTotalsWithLatestMetadata("token_usage_by_provider")) {
    if (!isProviderMetricKey(row.key, configuredKeys)) continue;
    if (row.key === "all" || row.key === "input" || row.key === "output") continue;
    providerMap.set(row.key, {
      provider: row.key,
      hits: 0,
      tokens: row.total || 0,
      url: metadataUrl(row.metadata),
    });
  }

  for (const row of tables.metrics.getKeyTotalsWithLatestMetadata("api_call")) {
    if (row.key === "all" || row.key === "success" || row.key === "error") continue;
    const url = metadataUrl(row.metadata);
    const existing = providerMap.get(row.key);
    if (!existing) continue;
    existing.hits += row.total || 0;
    if (url !== "unknown") existing.url = url;
  }

  return {
    providers: Array.from(providerMap.values()).map((provider) => ({
      provider: provider.provider,
      url: provider.url,
      hits: provider.hits,
      tokens: provider.tokens,
    })),
  };
}

function dateKeyOffset(today: Date, offsetDays: number): string {
  const date = new Date(today);
  date.setDate(date.getDate() - offsetDays);
  return date.toISOString().split("T")[0];
}

function persistDailyMetricTotal(date: string, type: string, value: number): void {
  tables.metrics.addDaily({
    id: crypto.randomUUID(),
    date,
    type,
    key: "all",
    value,
  });
}

function buildMetricsTimeSeries() {
  const today = new Date();
  const dateKeys = Array.from({ length: 30 }, (_, index) => dateKeyOffset(today, 29 - index));
  const startDate = dateKeys[0];
  const endDate = new Date(today);
  endDate.setDate(endDate.getDate() + 1);
  const endDateExclusive = endDate.toISOString().split("T")[0];
  const daysByDate = new Map<string, Record<string, string | number>>();

  for (const date of dateKeys) {
    daysByDate.set(date, { date });
  }

  const storedDailyTotals = tables.metrics.getDailyTotalsRange(startDate, endDateExclusive);
  const datesWithStoredTotals = new Set<string>();
  for (const total of storedDailyTotals) {
    const dayData = daysByDate.get(total.date);
    if (!dayData) continue;
    if (total.type !== "none") {
      dayData[total.type] = total.total;
    }
    datesWithStoredTotals.add(total.date);
  }

  const missingDates = dateKeys.filter((date) => !datesWithStoredTotals.has(date));
  if (missingDates.length > 0) {
    const rawStart = missingDates[0];
    const lastMissingDate = missingDates[missingDates.length - 1];
    const rawEndExclusive =
      lastMissingDate === dateKeys[dateKeys.length - 1]
        ? endDateExclusive
        : dateKeys[dateKeys.indexOf(lastMissingDate) + 1];
    const rawDailyTotals = tables.metrics.getDailyTotalsFromRawRange(
      `${rawStart} 00:00:00`,
      `${rawEndExclusive} 00:00:00`
    );
    const datesWithRawTotals = new Set<string>();

    for (const total of rawDailyTotals) {
      if (datesWithStoredTotals.has(total.date)) continue;
      const dayData = daysByDate.get(total.date);
      if (!dayData) continue;
      if (total.type !== "none") {
        dayData[total.type] = total.total;
        persistDailyMetricTotal(total.date, total.type, total.total);
      }
      datesWithRawTotals.add(total.date);
    }

    for (const date of missingDates) {
      if (datesWithRawTotals.has(date)) continue;
      persistDailyMetricTotal(date, "none", 0);
    }
  }

  for (const date of dateKeys) {
    const dayData = daysByDate.get(date);
    if (!dayData) continue;

    if (!Object.keys(dayData).some((key) => key !== "date")) {
      try {
        const logCounts = getDailyLogCounts(date);
        const totalActivity =
          logCounts.systemCount + logCounts.channelCount + logCounts.messageCount;

        if (totalActivity > 0) {
          dayData.activity = totalActivity;
          dayData.messages = logCounts.messageCount;
          dayData.channel_events = logCounts.channelCount;
        }
      } catch {}
    }
  }

  return { days: dateKeys.map((date) => daysByDate.get(date) || { date }) };
}

function buildMetricsInsights(modelMetrics = getModelMetrics()) {
  const metrics = tables.metrics;
  const now = Date.now();
  const dayMs = 24 * 60 * 60 * 1000;
  const last24hStart = now - dayMs;
  const prev24hStart = now - dayMs * 2;
  const inputTokens = metrics.getTotal("token_usage", "input") || 0;
  const outputTokens = metrics.getTotal("token_usage", "output") || 0;
  const cacheTokens = metrics.getTotal("token_usage", "cache") || 0;
  const totalTokens = inputTokens + outputTokens + cacheTokens;
  const tokenAllLast24h = metrics.getTotalSince(
    "token_usage",
    "all",
    sqlUtc(last24hStart),
    sqlUtc(now)
  );
  const tokenAllPrevious24h = metrics.getTotalSince(
    "token_usage",
    "all",
    sqlUtc(prev24hStart),
    sqlUtc(last24hStart)
  );
  const modelTotals = metrics.getTopKeys("token_usage_by_model") as MetricTopKey[];
  const topModel = modelTotals[0];
  const topModelSharePct =
    topModel && totalTokens > 0 ? Number(((topModel.total / totalTokens) * 100).toFixed(2)) : 0;
  const providerMap = new Map<string, { provider: string; tokens: number; calls: number }>();
  const configuredKeys = providerMetricKeys();

  for (const row of metrics.getKeyAggregates("token_usage_by_provider")) {
    const provider = row.key;
    if (!isProviderMetricKey(provider, configuredKeys)) continue;
    if (!provider || provider === "all" || provider === "input" || provider === "output") continue;
    providerMap.set(provider, {
      provider,
      tokens: row.total || 0,
      calls: row.count || 0,
    });
  }

  for (const row of metrics.getKeyAggregates("api_call")) {
    const provider = row.key;
    if (!provider || provider === "all" || provider === "success" || provider === "error") continue;
    const current = providerMap.get(provider);
    if (!current) continue;
    current.calls += row.total || 0;
  }

  const providerEfficiency = Array.from(providerMap.values())
    .map((entry) => ({
      provider: entry.provider,
      tokens: entry.tokens,
      calls: entry.calls,
      tokensPerCall: entry.calls > 0 ? Number((entry.tokens / entry.calls).toFixed(2)) : 0,
      sharePct: totalTokens > 0 ? Number(((entry.tokens / totalTokens) * 100).toFixed(2)) : 0,
    }))
    .sort((a, b) => b.tokens - a.tokens);
  const totalToolCalls = metrics
    .getKeyAggregates("tool_call")
    .filter((row) => row.key !== "all")
    .reduce((sum, row) => sum + (row.total || 0), 0);
  const totalToolErrors = metrics.getTotalByType("tool_error");
  const toolSuccessRatePct =
    totalToolCalls > 0
      ? Number((((totalToolCalls - totalToolErrors) / totalToolCalls) * 100).toFixed(2))
      : 100;
  const toolUsage24h = metrics
    .getKeyTotalsSince("tool_call", sqlUtc(last24hStart))
    .filter((row) => row.key !== "all")
    .map((row) => ({ tool: row.key, calls: row.total || 0 }))
    .sort((a, b) => b.calls - a.calls);
  const modelInsightMap = new Map<
    string,
    {
      model: string;
      provider: string;
      avgTps: number;
      maxTps: number;
      minTps: number;
      avgLatencyMs: number;
      totalTokens: number;
      callCount: number;
    }
  >();

  for (const modelMetric of modelMetrics) {
    modelInsightMap.set(modelMetric.model, { ...modelMetric });
  }

  for (const topModelEntry of modelTotals) {
    const existing = modelInsightMap.get(topModelEntry.key);
    if (existing) {
      existing.totalTokens = Math.max(existing.totalTokens, topModelEntry.total);
    } else {
      modelInsightMap.set(topModelEntry.key, {
        model: topModelEntry.key,
        provider: "unknown",
        avgTps: 0,
        maxTps: 0,
        minTps: 0,
        avgLatencyMs: 0,
        totalTokens: topModelEntry.total,
        callCount: 0,
      });
    }
  }

  const modelInsights = Array.from(modelInsightMap.values())
    .map((model) => ({
      ...model,
      tokenSharePct:
        totalTokens > 0 ? Number(((model.totalTokens / totalTokens) * 100).toFixed(2)) : 0,
    }))
    .sort((a, b) => b.totalTokens - a.totalTokens);
  const contextWarnings24h = metrics.countByTypeSince("context_warning", sqlUtc(last24hStart));
  const criticalContextWarnings24h = metrics.countByTypeMetadataLikeSince(
    "context_warning",
    '%"level":"critical"%',
    sqlUtc(last24hStart)
  );

  return {
    tokenBreakdown: {
      total: totalTokens,
      input: inputTokens,
      output: outputTokens,
      cache: cacheTokens,
      inputPct: totalTokens > 0 ? Number(((inputTokens / totalTokens) * 100).toFixed(2)) : 0,
      outputPct: totalTokens > 0 ? Number(((outputTokens / totalTokens) * 100).toFixed(2)) : 0,
      cachePct: totalTokens > 0 ? Number(((cacheTokens / totalTokens) * 100).toFixed(2)) : 0,
    },
    tokenTrend24h: buildMetricTrend(tokenAllLast24h, tokenAllPrevious24h),
    cacheEfficiency: {
      cacheTokens,
      cacheSharePct: totalTokens > 0 ? Number(((cacheTokens / totalTokens) * 100).toFixed(2)) : 0,
    },
    topModel:
      topModel && topModel.key
        ? {
            model: topModel.key,
            tokens: topModel.total,
            sharePct: topModelSharePct,
          }
        : null,
    providerEfficiency,
    modelInsights,
    toolReliability: {
      totalCalls: totalToolCalls,
      totalErrors: totalToolErrors,
      successRatePct: toolSuccessRatePct,
    },
    toolUsage24h,
    contextHealth24h: {
      warnings: contextWarnings24h,
      criticalWarnings: criticalContextWarnings24h,
    },
  };
}

function buildRatioBands() {
  return [
    {
      band: "very_input_heavy",
      min: 4,
      max: Number.POSITIVE_INFINITY,
      calls: 0,
    },
    { band: "input_heavy", min: 2, max: 4, calls: 0 },
    { band: "balanced", min: 0.75, max: 2, calls: 0 },
    { band: "output_heavy", min: 0.35, max: 0.75, calls: 0 },
    { band: "very_output_heavy", min: 0, max: 0.35, calls: 0 },
  ];
}

function buildTokenHeatmap(tokenCalls: ReturnType<typeof buildTokenCallSnapshots>) {
  const startOfHeatmapWindow = new Date();
  startOfHeatmapWindow.setHours(0, 0, 0, 0);
  startOfHeatmapWindow.setDate(startOfHeatmapWindow.getDate() - 6);
  const heatmapStartMs = startOfHeatmapWindow.getTime();
  const heatmapByDate = new Map<
    string,
    { dayLabel: string; hourTotals: number[]; hourCalls: number[] }
  >();

  for (let offset = 0; offset < 7; offset++) {
    const date = new Date(startOfHeatmapWindow);
    date.setDate(startOfHeatmapWindow.getDate() + offset);
    const dateKey = localDateKeyFromMs(date.getTime());
    heatmapByDate.set(dateKey, {
      dayLabel: date.toLocaleDateString(undefined, { weekday: "short" }),
      hourTotals: Array.from({ length: 24 }, () => 0),
      hourCalls: Array.from({ length: 24 }, () => 0),
    });
  }

  for (const entry of tokenCalls) {
    if (entry.timestampMs === null || entry.timestampMs < heatmapStartMs) continue;
    const dateKey = localDateKeyFromMs(entry.timestampMs);
    const bucket = heatmapByDate.get(dateKey);
    if (!bucket) continue;
    const hour = new Date(entry.timestampMs).getHours();
    bucket.hourTotals[hour] += entry.totalTokens;
    bucket.hourCalls[hour] += 1;
  }

  let maxHeatmapBucket = 0;
  for (const bucket of heatmapByDate.values()) {
    for (const total of bucket.hourTotals) {
      if (total > maxHeatmapBucket) maxHeatmapBucket = total;
    }
  }

  const days = Array.from(heatmapByDate.entries()).map(([date, bucket]) => ({
    date,
    dayLabel: bucket.dayLabel,
    hours: bucket.hourTotals.map((tokens, hour) => ({
      hour,
      tokens,
      calls: bucket.hourCalls[hour] || 0,
      intensity: maxHeatmapBucket > 0 ? Number((tokens / maxHeatmapBucket).toFixed(4)) : 0,
    })),
  }));
  let hottestHour: {
    date: string;
    dayLabel: string;
    hour: number;
    tokens: number;
    calls: number;
  } | null = null;

  for (const day of days) {
    for (const hour of day.hours) {
      if (!hottestHour || hour.tokens > hottestHour.tokens) {
        hottestHour = {
          date: day.date,
          dayLabel: day.dayLabel,
          hour: hour.hour,
          tokens: hour.tokens,
          calls: hour.calls,
        };
      }
    }
  }

  return { days, hottestHour, maxHeatmapBucket };
}

function buildHourlyVelocity(
  now: number,
  hourMs: number,
  tokenCalls: ReturnType<typeof buildTokenCallSnapshots>
) {
  return Array.from({ length: 24 }, (_, index) => {
    const end = now - (23 - index) * hourMs;
    const start = end - hourMs;
    let tokens = 0;
    let calls = 0;

    for (const entry of tokenCalls) {
      if (entry.timestampMs === null) continue;
      if (entry.timestampMs >= start && entry.timestampMs < end) {
        tokens += entry.totalTokens;
        calls += 1;
      }
    }

    const labelDate = new Date(end);
    const hour = `${String(labelDate.getHours()).padStart(2, "0")}:00`;
    return { hour, tokens, calls };
  });
}

function buildTokenCloud(
  metrics: typeof tables.metrics,
  tokenCalls: ReturnType<typeof buildTokenCallSnapshots>,
  averageTokensPerCall: number,
  totalOutput: number
) {
  const modelCloudEntries = (metrics.getTopKeys("token_usage_by_model") as MetricTopKey[]).map(
    (entry) => ({
      token: entry.key,
      category: "model" as const,
      weight: entry.total,
      sharePct: 0,
    })
  );
  const providerCloudEntries = providerMetricTotals().map((entry) => ({
    token: entry.key,
    category: "provider" as const,
    weight: Number((entry.total * 0.8).toFixed(2)),
    sharePct: 0,
  }));
  const toolCloudEntries = (metrics.getTopKeys("tool_call") as MetricTopKey[])
    .filter((entry) => entry.key !== "all")
    .map((entry) => ({
      token: entry.key,
      category: "tool" as const,
      weight: Number((entry.total * Math.max(averageTokensPerCall, 1) * 0.6).toFixed(2)),
      sharePct: 0,
    }));
  const assistantMessages = tables.sessionMessages
    .recentByRole("assistant", 600)
    .filter((entry) => entry.content.trim().length > 0);
  const termCloudEntries = buildAssistantOutputCloud(
    assistantMessages,
    totalOutput,
    Math.max(averageTokensPerCall, 1)
  );
  const combinedCloud: TokenCloudEntry[] = [
    ...modelCloudEntries,
    ...providerCloudEntries,
    ...toolCloudEntries,
    ...termCloudEntries,
  ];
  const totalCloudWeight = combinedCloud.reduce((sum, entry) => sum + entry.weight, 0);

  return combinedCloud
    .map((entry) => ({
      ...entry,
      sharePct:
        totalCloudWeight > 0 ? Number(((entry.weight / totalCloudWeight) * 100).toFixed(2)) : 0,
    }))
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 36);
}

function buildModelThoughtProfiles(tokenCalls: ReturnType<typeof buildTokenCallSnapshots>) {
  const modelBehaviorMap = new Map<
    string,
    {
      model: string;
      provider: string;
      inputTokens: number;
      outputTokens: number;
      totalTokens: number;
      calls: number;
      durationTotalMs: number;
      durationSamples: number;
      generationDurationTotalMs: number;
      generationOutputTokens: number;
    }
  >();

  for (const entry of tokenCalls) {
    const key = `${entry.provider}:${entry.model}`;
    const current = modelBehaviorMap.get(key) || {
      model: entry.model,
      provider: entry.provider,
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      calls: 0,
      durationTotalMs: 0,
      durationSamples: 0,
      generationDurationTotalMs: 0,
      generationOutputTokens: 0,
    };
    current.inputTokens += entry.inputTokens;
    current.outputTokens += entry.outputTokens;
    current.totalTokens += entry.totalTokens;
    current.calls += 1;

    if (entry.durationMs !== null && entry.durationMs > 0) {
      current.durationTotalMs += entry.durationMs;
      current.durationSamples += 1;
    }
    if (entry.generationDurationMs !== null && entry.generationDurationMs >= 100) {
      current.generationDurationTotalMs += entry.generationDurationMs;
      current.generationOutputTokens += entry.outputTokens;
    }

    modelBehaviorMap.set(key, current);
  }

  return Array.from(modelBehaviorMap.values())
    .map((entry) => {
      const promptSharePct =
        entry.totalTokens > 0
          ? Number(((entry.inputTokens / entry.totalTokens) * 100).toFixed(2))
          : 0;
      const responseSharePct =
        entry.totalTokens > 0
          ? Number(((entry.outputTokens / entry.totalTokens) * 100).toFixed(2))
          : 0;
      const avgTokensPerCall =
        entry.calls > 0 ? Number((entry.totalTokens / entry.calls).toFixed(2)) : 0;
      const avgLatencyMs =
        entry.durationSamples > 0
          ? Number((entry.durationTotalMs / entry.durationSamples).toFixed(2))
          : 0;
      const avgTps =
        entry.generationDurationTotalMs > 0
          ? Number(
              ((entry.generationOutputTokens / entry.generationDurationTotalMs) * 1000).toFixed(2)
            )
          : 0;

      return {
        model: entry.model,
        provider: entry.provider,
        totalTokens: entry.totalTokens,
        calls: entry.calls,
        promptSharePct,
        responseSharePct,
        avgTokensPerCall,
        avgLatencyMs,
        avgTps,
        behavior: classifyModelBehavior(promptSharePct, avgTps, avgLatencyMs, avgTokensPerCall),
      };
    })
    .sort((a, b) => b.totalTokens - a.totalTokens)
    .slice(0, 12);
}

function buildMetricsTokenAnalysis() {
  const metrics = tables.metrics;
  const now = Date.now();
  const hourMs = 60 * 60 * 1000;
  const dayMs = 24 * hourMs;
  const tokenUsageEntries = metrics.getByTypeRecent(
    "token_usage",
    TOKEN_ANALYSIS_ROW_LIMIT
  ) as MetricsEntry[];
  const tokenCalls = buildTokenCallSnapshots(tokenUsageEntries).filter(
    (entry) => entry.totalTokens > 0 || entry.inputTokens > 0 || entry.outputTokens > 0
  );
  const totalInput = tokenCalls.reduce((sum, entry) => sum + entry.inputTokens, 0);
  const totalOutput = tokenCalls.reduce((sum, entry) => sum + entry.outputTokens, 0);
  const totalTokens = tokenCalls.reduce((sum, entry) => sum + entry.totalTokens, 0);
  const callCount = tokenCalls.length;
  const averageTokensPerCall = callCount > 0 ? Number((totalTokens / callCount).toFixed(2)) : 0;
  const sortedCallTotals = tokenCalls.map((entry) => entry.totalTokens).sort((a, b) => a - b);
  const medianTokensPerCall =
    sortedCallTotals.length === 0
      ? 0
      : sortedCallTotals.length % 2 === 1
        ? sortedCallTotals[(sortedCallTotals.length - 1) / 2]!
        : Number(
            (
              (sortedCallTotals[sortedCallTotals.length / 2 - 1]! +
                sortedCallTotals[sortedCallTotals.length / 2]!) /
              2
            ).toFixed(2)
          );
  const ratioBands = buildRatioBands();
  let ratioSampleCount = 0;

  for (const entry of tokenCalls) {
    if (entry.inputTokens <= 0 && entry.outputTokens <= 0) continue;
    const ratio = entry.outputTokens > 0 ? entry.inputTokens / entry.outputTokens : Infinity;
    const match =
      ratioBands.find((band) => ratio >= band.min && ratio < band.max) ||
      (ratio === Infinity ? ratioBands[0] : undefined);
    if (match) {
      match.calls += 1;
      ratioSampleCount += 1;
    }
  }

  const heatmap = buildTokenHeatmap(tokenCalls);
  const tokenCloud = buildTokenCloud(metrics, tokenCalls, averageTokensPerCall, totalOutput);
  const modelThoughtProfiles = buildModelThoughtProfiles(tokenCalls);
  const topTokenBursts = [...tokenCalls]
    .sort((a, b) => b.totalTokens - a.totalTokens)
    .slice(0, 10)
    .map((entry) => ({
      timestamp: entry.timestamp,
      model: entry.model,
      provider: entry.provider,
      inputTokens: entry.inputTokens,
      outputTokens: entry.outputTokens,
      totalTokens: entry.totalTokens,
      durationMs: entry.durationMs,
      tokensPerSecond: entry.tokensPerSecond,
    }));

  return {
    summary: {
      callCount,
      totalTokens,
      totalInputTokens: totalInput,
      totalOutputTokens: totalOutput,
      averageTokensPerCall,
      medianTokensPerCall,
      inputToOutputRatio: totalOutput > 0 ? Number((totalInput / totalOutput).toFixed(4)) : null,
      outputToInputRatio: totalInput > 0 ? Number((totalOutput / totalInput).toFixed(4)) : null,
    },
    promptOutputDistribution: {
      sampleCount: ratioSampleCount,
      bands: ratioBands.map((band) => ({
        band: band.band,
        calls: band.calls,
        sharePct:
          ratioSampleCount > 0 ? Number(((band.calls / ratioSampleCount) * 100).toFixed(2)) : 0,
      })),
    },
    tokenHeatmap: {
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "local",
      maxBucketTokens: heatmap.maxHeatmapBucket,
      hottestHour: heatmap.hottestHour,
      days: heatmap.days,
    },
    hourlyVelocity24h: buildHourlyVelocity(now, hourMs, tokenCalls),
    tokenCloud,
    modelThoughtProfiles,
    topTokenBursts,
    windows: {
      analyzedDays: 7,
      velocityHours: 24,
      newestCallAt: tokenCalls[tokenCalls.length - 1]?.timestamp || null,
      oldestCallAt: tokenCalls[0]?.timestamp || null,
      sampledRows: tokenUsageEntries.length,
      rowLimit: TOKEN_ANALYSIS_ROW_LIMIT,
      truncated: tokenUsageEntries.length >= TOKEN_ANALYSIS_ROW_LIMIT,
      recent24hTokens: tokenCalls.reduce((sum, entry) => {
        if (entry.timestampMs === null || entry.timestampMs < now - dayMs) return sum;
        return sum + entry.totalTokens;
      }, 0),
    },
  };
}

async function buildMetricsSnapshot(compact: boolean) {
  const availability = emptyMetricsAvailability();
  const modelMetricsTask = metricsSnapshotValue(availability, "models", [], getModelMetrics);
  const [
    overview,
    tokens,
    files,
    tools,
    providers,
    timeSeries,
    models,
    insights,
    tokenAnalysis,
    storage,
    providerPlans,
    sessions,
  ] = await Promise.all([
    metricsSnapshotValue(availability, "overview", null, buildMetricsOverview),
    compact
      ? metricsSnapshotValue(availability, "tokens", null, () => null)
      : metricsSnapshotValue(availability, "tokens", null, buildMetricsTokens),
    metricsSnapshotValue(availability, "files", null, buildMetricsFiles),
    metricsSnapshotValue(availability, "tools", null, buildMetricsTools),
    metricsSnapshotValue(availability, "providers", null, buildMetricsProviders),
    metricsSnapshotValue(availability, "timeSeries", null, buildMetricsTimeSeries),
    modelMetricsTask.then((models) => ({ models })),
    metricsSnapshotValue(availability, "insights", null, async () =>
      buildMetricsInsights(await modelMetricsTask)
    ),
    metricsSnapshotValue(availability, "tokenAnalysis", null, buildMetricsTokenAnalysis),
    metricsSnapshotValue(availability, "storage", null, buildStorageMetrics),
    compact
      ? metricsSnapshotValue(availability, "providerPlans", null, () => null)
      : metricsSnapshotValue(availability, "providerPlans", null, () =>
          enrichProviderPlanStatusWithLiveUsage(getProviderPlanStatus())
        ),
    metricsSnapshotValue(availability, "sessions", null, () => listSessionRuntimeMetrics(1, 10)),
  ]);

  return {
    overview,
    tokens,
    files,
    tools,
    providers,
    timeSeries,
    models,
    insights,
    tokenAnalysis,
    storage,
    providerPlans,
    sessions,
    availability,
  };
}

export const metricsRoutes: Record<string, RouteHandler> = {
  "GET /api/metrics/snapshot": (_body, params) => buildMetricsSnapshot(params?.compact === "1"),
  "GET /api/metrics/overview": () => buildMetricsOverview(),
  "GET /api/metrics/storage": () => buildStorageMetrics(),
  "GET /api/metrics/tokens": () => buildMetricsTokens(),
  "GET /api/metrics/files": () => buildMetricsFiles(),
  "GET /api/metrics/tools": () => buildMetricsTools(),
  "GET /api/metrics/providers": () => buildMetricsProviders(),
  "GET /api/metrics/time-series": () => buildMetricsTimeSeries(),
  "GET /api/metrics/models": () => ({ models: getModelMetrics() }),
  "GET /api/metrics/insights": () => buildMetricsInsights(),
  "GET /api/metrics/token-analysis": () => buildMetricsTokenAnalysis(),
  "GET /api/metrics/sessions": (_body, params) =>
    listSessionRuntimeMetrics(
      Number(params?.page) || 1,
      Number(params?.pageSize ?? params?.limit) || 25
    ),
  "POST /api/metrics/track": (body) => {
    const data = body as {
      type: string;
      key: string;
      value: number;
      metadata?: Record<string, unknown>;
    };

    if (!data.type || !data.key || data.value === undefined) {
      throw new Error("type, key, and value are required");
    }

    const id = crypto.randomUUID();
    tables.metrics.add({
      id,
      type: data.type,
      key: data.key,
      value: data.value,
      metadata: data.metadata ? JSON.stringify(redactSecrets(data.metadata)) : undefined,
    });

    return { success: true, id };
  },
};
