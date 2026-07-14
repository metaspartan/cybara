import type { ProviderPlanStatusResponse } from "./api";

export type MetricsEndpointKey =
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

export interface MetricsEndpointState {
  ok: boolean;
  status?: number;
  error?: string;
}

export type MetricsAvailability = Record<MetricsEndpointKey, MetricsEndpointState>;

export interface MetricsOverview {
  tokenUsage: {
    total: number;
    input: number;
    output: number;
    cache: number;
  };
  fileOperations: {
    filesRead: number;
    filesWritten: number;
    filesEdited: number;
    filesSearched?: number;
  };
  toolCalls: {
    totalCalls: number;
  };
  apiCalls: {
    totalCalls: number;
    successfulCalls: number;
    failedCalls: number;
  };
  agentActivity: {
    totalExecutions: number;
    totalMessages: number;
  };
  sessions?: {
    totalSessions: number;
    memoryFlushes: number;
    memoryFlushFailures: number;
    compactions: number;
  };
  contextHealth?: {
    warnings: number;
    criticalWarnings: number;
  };
}

export interface TokenMetrics {
  topModels: Array<{ model: string; tokens: number }>;
  topProviders: Array<{ provider: string; tokens: number }>;
  recentUsage: Array<{ timestamp?: string; tokens: number; metadata?: Record<string, unknown> }>;
  totalTokens: number;
  estimatedCost?: number;
}

export interface FileMetrics {
  mostRead: Array<{ path: string; count: number }>;
  mostWritten: Array<{ path: string; count: number }>;
  mostEdited: Array<{ path: string; count: number }>;
  recentOperations: Array<{
    timestamp?: string;
    type: string;
    value: number;
    metadata?: Record<string, unknown>;
  }>;
}

export interface ToolMetrics {
  mostUsed: Array<{ tool: string; calls: number }>;
  mostErrors: Array<{ tool: string; errors: number }>;
  recentCalls: Array<{
    timestamp?: string;
    tool: string;
    duration: number;
    metadata?: Record<string, unknown>;
  }>;
}

export interface ProviderMetrics {
  providers: Array<{
    provider: string;
    url: string;
    hits: number;
    tokens: number;
  }>;
}

export interface TimeSeriesData {
  days: Array<Record<string, string | number>>;
}

export interface ModelMetric {
  model: string;
  provider: string;
  avgTps: number;
  maxTps: number;
  minTps: number;
  avgLatencyMs: number;
  totalTokens: number;
  callCount: number;
}

export interface ModelMetricsResponse {
  models: ModelMetric[];
}

export interface MetricsInsights {
  tokenBreakdown: {
    total: number;
    input: number;
    output: number;
    cache: number;
    inputPct: number;
    outputPct: number;
    cachePct: number;
  };
  tokenTrend24h: {
    current: number;
    previous: number;
    changePct: number;
    direction: "up" | "down" | "flat";
  };
  cacheEfficiency: {
    cacheTokens: number;
    cacheSharePct: number;
  };
  topModel: { model: string; tokens: number; sharePct: number } | null;
  providerEfficiency: Array<{
    provider: string;
    tokens: number;
    calls: number;
    tokensPerCall: number;
    sharePct: number;
  }>;
  modelInsights: Array<ModelMetric & { tokenSharePct: number }>;
  toolReliability: {
    totalCalls: number;
    totalErrors: number;
    successRatePct: number;
  };
  toolUsage24h: Array<{ tool: string; calls: number }>;
  contextHealth24h: {
    warnings: number;
    criticalWarnings: number;
  };
}

export interface TokenAnalysisMetrics {
  summary?: {
    totalTokens: number;
    totalInput: number;
    totalOutput: number;
    callCount: number;
    averageTokensPerCall: number;
    medianTokensPerCall: number;
    inputToOutputRatio: number | null;
  };
  tokenHeatmap?: {
    days: Array<{
      date: string;
      dayLabel: string;
      hours: Array<{ hour: number; tokens: number; calls: number; intensity: number }>;
    }>;
    hottestHour?: {
      date: string;
      dayLabel: string;
      hour: number;
      tokens: number;
      calls: number;
    } | null;
  };
  tokenVelocity?: {
    hours: Array<{ hour: string; tokens: number; calls: number }>;
  };
  promptOutputDistribution?: {
    bands: Array<{ band: string; calls: number; sharePct: number }>;
  };
  tokenCloud?: Array<{
    token: string;
    category: "model" | "provider" | "tool" | "term" | "pattern";
    weight: number;
    sharePct: number;
  }>;
  modelThoughtProfiles?: Array<{
    model: string;
    provider: string;
    behavior: string;
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    promptSharePct: number;
    responseSharePct: number;
    avgTps: number;
    avgLatencyMs: number;
  }>;
  topTokenBursts?: Array<{
    model: string;
    provider: string;
    totalTokens: number;
    timestamp?: string;
  }>;
}

export interface MetricsStorage {
  totalBytes: number;
  uncategorizedBytes?: number;
  directories: {
    cybaraDir: string;
    [key: string]: string;
  };
  components: Record<string, { bytes: number; path: string } | undefined>;
  topLevel?: Array<{ name: string; path: string; bytes: number }>;
}

export interface MetricsSnapshot {
  overview: MetricsOverview | null;
  tokens: TokenMetrics | null;
  files: FileMetrics | null;
  tools: ToolMetrics | null;
  providers: ProviderMetrics | null;
  timeSeries: TimeSeriesData | null;
  models: ModelMetricsResponse | null;
  insights: MetricsInsights | null;
  tokenAnalysis: TokenAnalysisMetrics | null;
  storage: MetricsStorage | null;
  providerPlans: ProviderPlanStatusResponse | null;
  sessions: SessionRuntimeMetrics | null;
  availability: MetricsAvailability;
}

export interface SessionRuntimeMetrics {
  totals: SessionRuntimeMetricsTotals;
  sessions: SessionRuntimeMetricsRow[];
  pagination?: {
    page: number;
    pageSize: number;
    totalPages: number;
    totalItems: number;
    hasNextPage: boolean;
    hasPreviousPage: boolean;
  };
}

export interface SessionRuntimeMetricsTotals {
  sessions: number;
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  cacheWriteTokens: number;
  totalTokens: number;
  callCount: number;
  durationMs: number;
  tokensPerSecond: number | null;
  firstTokenMs: number | null;
  compactionCount: number;
  compactedTokens: number;
}

export interface SessionRuntimeMetricsRow extends Omit<SessionRuntimeMetricsTotals, "sessions"> {
  sessionId: string;
  title: string;
  agentId: string;
  workspaceDir: string | null;
  updatedAt: string;
  provider: string | null;
  model: string | null;
}

export function emptyMetricsAvailability(): MetricsAvailability {
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

export function formatMetricNumber(value: number | undefined): string {
  const num = Number.isFinite(value) ? Number(value) : 0;
  if (Math.abs(num) >= 1_000_000) return `${(num / 1_000_000).toFixed(2)}M`;
  if (Math.abs(num) >= 1_000) return `${(num / 1_000).toFixed(1)}K`;
  return String(Math.round(num));
}

export function formatMetricBytes(value: number | undefined): string {
  const bytes = Number.isFinite(value) ? Number(value) : 0;
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${Math.round(bytes)} B`;
}

export function formatStorageBytes(value: number | undefined): string {
  const bytes = Number.isFinite(value) ? Number(value) : 0;
  if (bytes >= 1000 * 1000 * 1000) return `${(bytes / (1000 * 1000 * 1000)).toFixed(2)} GB`;
  if (bytes >= 1000 * 1000) return `${(bytes / (1000 * 1000)).toFixed(2)} MB`;
  if (bytes >= 1000) return `${(bytes / 1000).toFixed(1)} KB`;
  return `${Math.round(bytes)} B`;
}

export function metricSuccessRate(overview: MetricsOverview | null): string {
  const total = overview?.apiCalls.totalCalls || 0;
  if (total <= 0) return "0%";
  return `${(((overview?.apiCalls.successfulCalls || 0) / total) * 100).toFixed(1)}%`;
}

export function totalFileOperations(overview: MetricsOverview | null): number {
  return (
    (overview?.fileOperations.filesRead || 0) +
    (overview?.fileOperations.filesWritten || 0) +
    (overview?.fileOperations.filesEdited || 0)
  );
}

export function storageCategoryEntries(
  storage: MetricsStorage | null
): Array<{ label: string; bytes: number; path: string }> {
  if (!storage) return [];
  const components = storage.components || {};
  return [
    { label: "Data", bytes: components.data?.bytes || 0, path: components.data?.path || "" },
    {
      label: "Sessions",
      bytes: components.sessions?.bytes || 0,
      path: components.sessions?.path || "",
    },
    { label: "Media", bytes: components.media?.bytes || 0, path: components.media?.path || "" },
    {
      label: "Channels",
      bytes: components.channels?.bytes || 0,
      path: components.channels?.path || "",
    },
    {
      label: "Artifacts",
      bytes: components.artifacts?.bytes || 0,
      path: components.artifacts?.path || "",
    },
    { label: "Logs", bytes: components.logs?.bytes || 0, path: components.logs?.path || "" },
    { label: "Memory", bytes: components.memory?.bytes || 0, path: components.memory?.path || "" },
    { label: "Skills", bytes: components.skills?.bytes || 0, path: components.skills?.path || "" },
    { label: "Secure", bytes: components.secure?.bytes || 0, path: components.secure?.path || "" },
    {
      label: "Other",
      bytes: components.other?.bytes || storage.uncategorizedBytes || 0,
      path: components.other?.path || storage.directories.cybaraDir,
    },
  ]
    .filter((entry) => entry.bytes > 0)
    .sort((a, b) => b.bytes - a.bytes);
}

export function timeSeriesTotals(
  timeSeries: TimeSeriesData | null,
  keys: string[]
): Array<{ label: string; value: number }> {
  return (timeSeries?.days || []).slice(-14).map((day) => {
    const label = typeof day.date === "string" ? day.date.slice(5) : "";
    const value = keys.reduce((sum, key) => {
      const current = day[key];
      return sum + (typeof current === "number" ? current : 0);
    }, 0);
    return { label, value };
  });
}

export function tokenFlowBars(
  overview: MetricsOverview | null
): Array<{ label: string; value: number }> {
  return [
    { label: "Input", value: overview?.tokenUsage.input || 0 },
    { label: "Output", value: overview?.tokenUsage.output || 0 },
    { label: "Cache", value: overview?.tokenUsage.cache || 0 },
  ];
}

export function tokenVelocityAreaRows(
  tokenAnalysis: TokenAnalysisMetrics | null
): Array<{ label: string; value: number; detail?: string }> {
  const rows =
    tokenAnalysis?.tokenVelocity?.hours ??
    ((
      tokenAnalysis as {
        hourlyVelocity24h?: Array<{ hour: string; tokens: number; calls: number }>;
      }
    )?.hourlyVelocity24h ||
      []);
  return rows.slice(-24).map((entry) => ({
    label: entry.hour,
    value: entry.tokens,
    detail: `${formatMetricNumber(entry.calls)} calls`,
  }));
}

export function providerTokenShareRows(
  snapshot: MetricsSnapshot | null
): Array<{ label: string; value: string; detail?: string; amount: number }> {
  const insightRows = snapshot?.insights?.providerEfficiency || [];
  if (insightRows.length > 0) {
    return insightRows.slice(0, 6).map((provider) => ({
      label: provider.provider,
      value: `${formatMetricNumber(provider.tokens)} tokens`,
      detail: `${formatMetricNumber(provider.tokensPerCall)} tok/call - ${provider.sharePct}% share`,
      amount: provider.tokens,
    }));
  }

  return (snapshot?.providers?.providers || []).slice(0, 6).map((provider) => ({
    label: provider.provider,
    value: formatMetricNumber(provider.tokens),
    detail: `${formatMetricNumber(provider.hits)} hits`,
    amount: provider.tokens,
  }));
}

export function modelTokenShareRows(
  snapshot: MetricsSnapshot | null
): Array<{ label: string; value: string; detail?: string; amount: number }> {
  const profileRows = snapshot?.tokenAnalysis?.modelThoughtProfiles || [];
  if (profileRows.length > 0) {
    return profileRows.slice(0, 6).map((model) => ({
      label: model.model,
      value: `${formatMetricNumber(model.totalTokens)} tokens`,
      detail: `${model.provider} - ${model.behavior}`,
      amount: model.totalTokens,
    }));
  }

  return (snapshot?.models?.models || []).slice(0, 6).map((model) => ({
    label: model.model,
    value: `${formatMetricNumber(model.totalTokens)} tokens`,
    detail: `${model.provider} - ${model.avgTps} tok/s`,
    amount: model.totalTokens,
  }));
}
