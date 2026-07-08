import { useEffect, useMemo, useState } from "react";
import {
  BarChart3,
  FileText,
  Cpu,
  Zap,
  HardDrive,
  Database,
  TrendingUp,
  Activity,
  Terminal,
  MessageSquare,
  Gauge,
  Clock,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/Card";
import { PageLayout } from "@/components/layout";
import {
  useMetricsOverview,
  useMetricsTokens,
  useMetricsFiles,
  useMetricsTools,
  useMetricsTimeSeries,
  useMetricsProviders,
  useMetricsModels,
  useMetricsInsights,
  useMetricsTokenAnalysis,
  useMetricsStorage,
  type MetricsOverview,
  type TokenMetrics,
  type TokenAnalysisMetrics,
  type FileMetrics,
  type ToolMetrics,
  type TimeSeriesData,
  type ProviderMetrics,
  type ModelMetrics,
  type MetricsInsights,
  type MetricsStorage,
} from "@/hooks/useApi";
import { providerPlansApi } from "@/lib/api";
import {
  providerPlanUsageClasses,
  providerPlanWindowDisplay,
  type ProviderPlanWindowDisplay,
} from "@/lib/providerPlanDisplay";
import type { ProviderPlanSnapshot, ProviderPlanStatusResponse } from "@/types";

const DETAIL_METRICS_IDLE_DELAY_MS = 120;

type MetricsIdleWindow = Window & {
  requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number;
  cancelIdleCallback?: (handle: number) => void;
};

function formatNumber(num: number): string {
  if (num >= 1000000) return (num / 1000000).toFixed(2) + "M";
  if (num >= 1000) return (num / 1000).toFixed(1) + "K";
  return num.toString();
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
}

function providerPlanStatusTone(status: ProviderPlanSnapshot["status"]): string {
  if (status === "ok") return "text-emerald-300";
  if (status === "warning") return "text-amber-300";
  if (status === "exhausted") return "text-red-300";
  return "text-gray-400";
}

interface ProviderPlanMetricRow {
  id: string;
  providerName: string;
  planName?: string;
  status: ProviderPlanSnapshot["status"];
  label: string;
  usage: ProviderPlanWindowDisplay;
}

export function Metrics() {
  const { data: overview, isLoading: loadingOverview } = useMetricsOverview();
  const [detailMetricsEnabled, setDetailMetricsEnabled] = useState(false);
  const detailQueryOptions = useMemo(
    () => ({ enabled: detailMetricsEnabled }),
    [detailMetricsEnabled]
  );
  const { data: tokens, isLoading: loadingTokens } = useMetricsTokens(detailQueryOptions);
  const { data: files, isLoading: loadingFiles } = useMetricsFiles(detailQueryOptions);
  const { data: tools, isLoading: loadingTools } = useMetricsTools(detailQueryOptions);
  const { data: timeSeries, isLoading: loadingTimeSeries } =
    useMetricsTimeSeries(detailQueryOptions);
  const { data: providers, isLoading: loadingProviders } = useMetricsProviders(detailQueryOptions);
  const { data: modelMetrics, isLoading: loadingModels } = useMetricsModels(detailQueryOptions);
  const { data: insights, isLoading: loadingInsights } = useMetricsInsights(detailQueryOptions);
  const { data: tokenAnalysis, isLoading: loadingTokenAnalysis } =
    useMetricsTokenAnalysis(detailQueryOptions);
  const { data: storage, isLoading: loadingStorage } = useMetricsStorage(detailQueryOptions);
  const [providerPlanStatus, setProviderPlanStatus] = useState<ProviderPlanStatusResponse | null>(
    null
  );
  const [loadingProviderPlans, setLoadingProviderPlans] = useState(false);

  const isLoading = loadingOverview;
  const insightsData = insights as MetricsInsights | undefined;
  const tokenAnalysisData = tokenAnalysis as TokenAnalysisMetrics | undefined;
  const storageData = storage as MetricsStorage | undefined;

  useEffect(() => {
    if (loadingOverview) {
      setDetailMetricsEnabled(false);
      return;
    }

    const activate = () => setDetailMetricsEnabled(true);
    const idleWindow = window as MetricsIdleWindow;
    if (
      typeof idleWindow.requestIdleCallback === "function" &&
      typeof idleWindow.cancelIdleCallback === "function"
    ) {
      const id = idleWindow.requestIdleCallback(activate, {
        timeout: DETAIL_METRICS_IDLE_DELAY_MS,
      });
      return () => idleWindow.cancelIdleCallback?.(id);
    }

    const timeout = window.setTimeout(activate, DETAIL_METRICS_IDLE_DELAY_MS);
    return () => window.clearTimeout(timeout);
  }, [loadingOverview]);

  useEffect(() => {
    if (!detailMetricsEnabled) return;
    let mounted = true;
    setLoadingProviderPlans(true);
    providerPlansApi
      .status()
      .then((response) => {
        if (mounted && response.success) setProviderPlanStatus(response.data ?? null);
      })
      .catch(() => {
        if (mounted) setProviderPlanStatus(null);
      })
      .finally(() => {
        if (mounted) setLoadingProviderPlans(false);
      });
    return () => {
      mounted = false;
    };
  }, [detailMetricsEnabled]);

  const tokensPending = !tokens && (!detailMetricsEnabled || loadingTokens);
  const filesPending = !files && (!detailMetricsEnabled || loadingFiles);
  const toolsPending = !tools && (!detailMetricsEnabled || loadingTools);
  const timeSeriesPending = !timeSeries && (!detailMetricsEnabled || loadingTimeSeries);
  const providersPending = !providers && (!detailMetricsEnabled || loadingProviders);
  const modelsPending = !modelMetrics && (!detailMetricsEnabled || loadingModels);
  const insightsPending = !insightsData && (!detailMetricsEnabled || loadingInsights);
  const tokenAnalysisPending =
    !tokenAnalysisData && (!detailMetricsEnabled || loadingTokenAnalysis);
  const storagePending = !storageData && (!detailMetricsEnabled || loadingStorage);
  const providerPlansPending =
    !providerPlanStatus && (!detailMetricsEnabled || loadingProviderPlans);

  const stats = useMemo(() => {
    if (!overview) return null;

    const totalTokens = overview.tokenUsage.total;
    const successRate =
      overview.apiCalls.totalCalls > 0
        ? ((overview.apiCalls.successfulCalls / overview.apiCalls.totalCalls) * 100).toFixed(1)
        : "0";

    const totalFiles =
      overview.fileOperations.filesRead +
      overview.fileOperations.filesWritten +
      overview.fileOperations.filesEdited;

    return {
      totalTokens,
      successRate,
      totalFiles,
      avgTokensPerMessage:
        overview.agentActivity.totalMessages > 0
          ? Math.round(totalTokens / overview.agentActivity.totalMessages)
          : 0,
    };
  }, [overview]);

  const cybaraSignals = useMemo(() => {
    const totalToolCalls = overview?.toolCalls.totalCalls || 0;
    const totalMessages = overview?.agentActivity.totalMessages || 0;
    const memoryToolCalls = (tools?.mostUsed || [])
      .filter((entry) => entry.tool.startsWith("memory_"))
      .reduce((sum, entry) => sum + entry.calls, 0);

    const toolsPerMessage =
      totalMessages > 0 ? Number((totalToolCalls / totalMessages).toFixed(2)) : 0;
    const memorySharePct =
      totalToolCalls > 0 ? Number(((memoryToolCalls / totalToolCalls) * 100).toFixed(2)) : 0;
    const topProviderShare = insightsData?.providerEfficiency?.[0]?.sharePct || 0;
    const providerBalance = Number(Math.max(0, 100 - topProviderShare).toFixed(2));

    const behaviorTotals = new Map<string, number>();
    for (const profile of tokenAnalysisData?.modelThoughtProfiles || []) {
      behaviorTotals.set(
        profile.behavior,
        (behaviorTotals.get(profile.behavior) || 0) + profile.totalTokens
      );
    }
    const behaviorEntries = Array.from(behaviorTotals.entries()).sort((a, b) => b[1] - a[1]);
    const dominantBehavior = behaviorEntries[0]?.[0] || "n/a";

    const outputHeavyShare = (tokenAnalysisData?.promptOutputDistribution?.bands || [])
      .filter((band) => band.band === "output_heavy" || band.band === "very_output_heavy")
      .reduce((sum, band) => sum + band.sharePct, 0);

    return {
      toolsPerMessage,
      memorySharePct,
      providerBalance,
      dominantBehavior,
      outputHeavyShare: Number(outputHeavyShare.toFixed(2)),
      topBurst: tokenAnalysisData?.topTokenBursts?.[0],
    };
  }, [overview, tools, insightsData, tokenAnalysisData]);

  const storageCategoryEntries = useMemo(() => {
    if (!storageData) return [];
    return [
      {
        label: "Data",
        bytes: storageData.components.data.bytes,
        path: storageData.components.data.path,
      },
      {
        label: "Sessions",
        bytes: storageData.components.sessions?.bytes || 0,
        path: storageData.components.sessions?.path || "",
      },
      {
        label: "Media",
        bytes: storageData.components.media?.bytes || 0,
        path: storageData.components.media?.path || "",
      },
      {
        label: "Channels",
        bytes: storageData.components.channels?.bytes || 0,
        path: storageData.components.channels?.path || "",
      },
      {
        label: "Artifacts",
        bytes: storageData.components.artifacts.bytes,
        path: storageData.components.artifacts.path,
      },
      {
        label: "Logs",
        bytes: storageData.components.logs.bytes,
        path: storageData.components.logs.path,
      },
      {
        label: "Memory",
        bytes: storageData.components.memory.bytes,
        path: storageData.components.memory.path,
      },
      {
        label: "Skills",
        bytes: storageData.components.skills.bytes,
        path: storageData.components.skills.path,
      },
      {
        label: "Secure",
        bytes: storageData.components.secure.bytes,
        path: storageData.components.secure.path,
      },
      {
        label: "Other",
        bytes: storageData.components.other?.bytes || storageData.uncategorizedBytes || 0,
        path: storageData.components.other?.path || storageData.directories.cybaraDir,
      },
    ]
      .filter((entry) => entry.bytes > 0)
      .sort((a, b) => b.bytes - a.bytes);
  }, [storageData]);

  const storageTopLevelEntries = useMemo(() => {
    if (!storageData?.topLevel || storageData.topLevel.length === 0) return [];
    return [...storageData.topLevel].sort((a, b) => b.bytes - a.bytes);
  }, [storageData]);

  const tokenCloudEntries = useMemo(
    () => (tokenAnalysisData?.tokenCloud || []).slice(0, 60),
    [tokenAnalysisData?.tokenCloud]
  );

  const visibleProviders = useMemo(
    () => (providers?.providers || []).slice(0, 12),
    [providers?.providers]
  );

  const modelPerformanceRows = useMemo(() => {
    const rows = modelMetrics?.models || [];
    const maxTps = Math.max(...rows.map((model) => model.avgTps), 1);
    return rows.map((model, index) => ({
      ...model,
      key: `${model.provider}:${model.model}:${index}`,
      tpsPercent: (model.avgTps / maxTps) * 100,
    }));
  }, [modelMetrics?.models]);

  const activityDayRows = useMemo(() => {
    const rows = timeSeries?.days || [];
    const totals = rows.map((day, index) => {
      const dayTotal = Object.entries(day)
        .filter(([key]) => key !== "date")
        .reduce((sum, [, value]) => sum + (typeof value === "number" ? value : 0), 0);
      return { date: day.date, dayTotal, key: `${day.date}:${index}` };
    });
    const maxDayTotal = Math.max(...totals.map((day) => day.dayTotal), 1);
    return totals.map((day) => ({
      ...day,
      height: (day.dayTotal / maxDayTotal) * 100,
    }));
  }, [timeSeries?.days]);

  const tokenVelocityRows = useMemo(
    () =>
      (tokenAnalysisData?.hourlyVelocity24h || []).slice(-24).map((entry) => ({
        label: entry.hour,
        value: entry.tokens,
        detail: `${formatNumber(entry.calls)} calls`,
      })),
    [tokenAnalysisData?.hourlyVelocity24h]
  );

  const tokenFlowShareRows = useMemo(
    () => [
      {
        label: "Input",
        value: overview?.tokenUsage.input || 0,
        color: "bg-blue-400",
      },
      {
        label: "Output",
        value: overview?.tokenUsage.output || 0,
        color: "bg-emerald-400",
      },
      {
        label: "Cache",
        value: overview?.tokenUsage.cache || 0,
        color: "bg-violet-400",
      },
    ],
    [overview?.tokenUsage.cache, overview?.tokenUsage.input, overview?.tokenUsage.output]
  );

  const providerTokenRows = useMemo(() => {
    const providerEfficiency = insightsData?.providerEfficiency || [];
    if (providerEfficiency.length > 0) {
      return providerEfficiency.slice(0, 8).map((entry) => ({
        label: entry.provider,
        value: entry.tokens,
        detail: `${formatNumber(entry.tokensPerCall)} tok/call · ${formatNumber(entry.calls)} calls`,
      }));
    }

    return (tokens?.topProviders || []).slice(0, 8).map((entry) => ({
      label: entry.provider,
      value: entry.tokens,
      detail: `${formatNumber(entry.tokens)} tokens`,
    }));
  }, [insightsData?.providerEfficiency, tokens?.topProviders]);

  const modelTokenRows = useMemo(
    () =>
      (tokenAnalysisData?.modelThoughtProfiles || modelMetrics?.models || [])
        .slice(0, 8)
        .map((entry) => {
          const value = "totalTokens" in entry ? entry.totalTokens : 0;
          const detail =
            "behavior" in entry
              ? `${entry.provider} · ${entry.behavior}`
              : `${entry.provider} · ${entry.avgTps} tok/s`;
          return { label: entry.model, value, detail };
        }),
    [modelMetrics?.models, tokenAnalysisData?.modelThoughtProfiles]
  );

  const providerPlanRows = useMemo<ProviderPlanMetricRow[]>(
    () =>
      (providerPlanStatus?.providers || [])
        .filter((plan) => plan.monitored || plan.windows.length > 0 || plan.externalSourceAvailable)
        .flatMap((plan) =>
          [
            { label: "5h", usage: providerPlanWindowDisplay(plan, "rolling_5h") },
            { label: "Weekly", usage: providerPlanWindowDisplay(plan, "rolling_week") },
          ]
            .filter(({ usage }) => usage.unlimited || usage.percent !== null)
            .map(({ label, usage }) => ({
              id: `${plan.providerId}:${label}`,
              providerName: plan.providerName,
              planName: plan.planName,
              status: plan.status,
              label,
              usage,
            }))
        )
        .slice(0, 12),
    [providerPlanStatus?.providers]
  );

  if (isLoading) {
    return (
      <PageLayout title="Metrics" subtitle="Loading metrics...">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {[...Array(8)].map((_, i) => (
            <Card key={i} className="animate-pulse">
              <CardContent className="p-6">
                <div className="h-4 bg-white/10 rounded w-1/2 mb-2" />
                <div className="h-8 bg-white/10 rounded w-3/4" />
              </CardContent>
            </Card>
          ))}
        </div>
      </PageLayout>
    );
  }

  return (
    <PageLayout title="Metrics" subtitle="Track token usage, file operations, and system activity">
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-8">
        <StatCard
          icon={<Cpu className="w-5 h-5" />}
          label="Total Tokens"
          value={formatNumber(stats?.totalTokens || 0)}
          color="text-blue-400"
          bgColor="bg-blue-500/20"
        />
        <StatCard
          icon={<Activity className="w-5 h-5" />}
          label="API Success Rate"
          value={`${stats?.successRate || 0}%`}
          color="text-purple-400"
          bgColor="bg-purple-500/20"
        />
        <StatCard
          icon={<FileText className="w-5 h-5" />}
          label="Total Files"
          value={formatNumber(stats?.totalFiles || 0)}
          color="text-orange-400"
          bgColor="bg-orange-500/20"
        />
        <StatCard
          icon={<MessageSquare className="w-5 h-5" />}
          label="Messages"
          value={formatNumber(overview?.agentActivity.totalMessages || 0)}
          color="text-green-400"
          bgColor="bg-green-500/20"
        />
        <StatCard
          icon={<Database className="w-5 h-5" />}
          label="Storage Used"
          value={formatBytes(storageData?.totalBytes || 0)}
          color="text-cyan-300"
          bgColor="bg-cyan-500/20"
          loading={storagePending}
        />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6 mb-8">
        <Card className="xl:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <TrendingUp className="w-5 h-5 text-cyan-400" />
              Token Velocity
            </CardTitle>
            <CardDescription>24-hour area trend for recent input/output workloads</CardDescription>
          </CardHeader>
          <CardContent>
            {tokenAnalysisPending ? (
              <MetricChartSkeleton />
            ) : (
              <MetricAreaChart
                rows={tokenVelocityRows}
                strokeColor="#22d3ee"
                fillColor="#22d3ee"
                emptyLabel="No token velocity data yet"
              />
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Gauge className="w-5 h-5 text-emerald-400" />
              Token Mix
            </CardTitle>
            <CardDescription>
              Input, output, and cache share for current research usage
            </CardDescription>
          </CardHeader>
          <CardContent>
            <MetricShareStack rows={tokenFlowShareRows} total={overview?.tokenUsage.total || 0} />
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6 mb-8">
        <Card className="xl:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Activity className="w-5 h-5 text-cyan-400" />
              Token Heatmap
            </CardTitle>
            <CardDescription>7-day intensity map by hour with hottest usage window</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {tokenAnalysisPending ? (
              <MetricHeatmapSkeleton />
            ) : tokenAnalysisData?.tokenHeatmap?.days &&
              tokenAnalysisData.tokenHeatmap.days.length > 0 ? (
              <>
                <div className="space-y-2">
                  {tokenAnalysisData.tokenHeatmap.days.map((day) => (
                    <div key={day.date} className="grid grid-cols-[64px,1fr] gap-2 items-center">
                      <p className="text-xs text-gray-400">{day.dayLabel}</p>
                      <div
                        className="grid gap-1"
                        style={{ gridTemplateColumns: "repeat(24, minmax(0, 1fr))" }}
                      >
                        {day.hours.map((hour) => (
                          <div
                            key={`${day.date}-${hour.hour}`}
                            className="h-3 rounded-sm border border-white/5"
                            style={{
                              backgroundColor: `rgba(34, 211, 238, ${0.08 + hour.intensity * 0.92})`,
                            }}
                            title={`${day.date} ${String(hour.hour).padStart(2, "0")}:00 - ${formatNumber(hour.tokens)} tokens (${hour.calls} calls)`}
                          />
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
                {tokenAnalysisData.tokenHeatmap.hottestHour && (
                  <div className="rounded-lg bg-white/5 p-3 text-xs text-gray-300">
                    Hottest window: {tokenAnalysisData.tokenHeatmap.hottestHour.dayLabel}{" "}
                    {String(tokenAnalysisData.tokenHeatmap.hottestHour.hour).padStart(2, "0")}:00{" "}
                    with {formatNumber(tokenAnalysisData.tokenHeatmap.hottestHour.tokens)} tokens
                  </div>
                )}
              </>
            ) : (
              <p className="text-sm text-gray-500">No heatmap data yet</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <TrendingUp className="w-5 h-5 text-emerald-400" />
              Prompt vs Output
            </CardTitle>
            <CardDescription>Token flow ratios and distribution</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {tokenAnalysisPending ? (
              <MetricPanelSkeleton rows={4} />
            ) : (
              <>
                <div className="rounded-lg bg-white/5 p-3">
                  <p className="text-xs text-gray-500 mb-1">Input:Output</p>
                  <p className="text-lg font-semibold text-white">
                    {tokenAnalysisData?.summary?.inputToOutputRatio !== null &&
                    tokenAnalysisData?.summary?.inputToOutputRatio !== undefined
                      ? `${tokenAnalysisData.summary.inputToOutputRatio}:1`
                      : "n/a"}
                  </p>
                </div>
                <div className="rounded-lg bg-white/5 p-3">
                  <p className="text-xs text-gray-500 mb-2">Distribution</p>
                  <div className="space-y-2">
                    {tokenAnalysisData?.promptOutputDistribution?.bands?.map((band) => (
                      <div key={band.band}>
                        <div className="flex items-center justify-between text-xs mb-1">
                          <span className="text-gray-300">{band.band.split("_").join(" ")}</span>
                          <span className="text-gray-500">{band.sharePct}%</span>
                        </div>
                        <div className="h-1.5 bg-white/10 rounded-full overflow-hidden">
                          <div
                            className="h-full bg-emerald-500 rounded-full"
                            style={{ width: `${Math.min(100, band.sharePct)}%` }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="rounded-lg bg-white/5 p-3 grid grid-cols-2 gap-2 text-xs">
                  <div>
                    <p className="text-gray-500">Avg/call</p>
                    <p className="text-white">
                      {formatNumber(tokenAnalysisData?.summary?.averageTokensPerCall || 0)}
                    </p>
                  </div>
                  <div>
                    <p className="text-gray-500">Median</p>
                    <p className="text-white">
                      {formatNumber(tokenAnalysisData?.summary?.medianTokensPerCall || 0)}
                    </p>
                  </div>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Zap className="w-5 h-5 text-blue-400" />
              Provider Token Share
            </CardTitle>
            <CardDescription>
              Where token volume and spend pressure are concentrated
            </CardDescription>
          </CardHeader>
          <CardContent>
            {tokensPending || insightsPending ? (
              <MetricRowsSkeleton />
            ) : (
              <MetricRankedRows rows={providerTokenRows} accentClass="bg-blue-400" />
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Cpu className="w-5 h-5 text-amber-400" />
              Model Token Share
            </CardTitle>
            <CardDescription>Top models by tracked token volume and behavior</CardDescription>
          </CardHeader>
          <CardContent>
            {modelsPending || tokenAnalysisPending ? (
              <MetricRowsSkeleton />
            ) : (
              <MetricRankedRows rows={modelTokenRows} accentClass="bg-amber-400" />
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Gauge className="w-5 h-5 text-emerald-400" />
              Provider Plan Health
            </CardTitle>
            <CardDescription>Automatic usage windows for connected coding plans</CardDescription>
          </CardHeader>
          <CardContent>
            {providerPlansPending ? (
              <MetricRowsSkeleton />
            ) : (
              <div className="space-y-3">
                {providerPlanRows.map((row) => {
                  const classes = providerPlanUsageClasses(row.usage);
                  const width = row.usage.unlimited ? 100 : (row.usage.percent ?? 0);
                  return (
                    <div key={row.id} className="rounded-lg bg-white/5 p-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-sm text-white truncate">{row.providerName}</p>
                          <p className="text-xs text-gray-500 truncate">
                            {row.label} limit{row.planName ? ` · ${row.planName}` : ""}
                          </p>
                        </div>
                        <span className={`text-xs font-medium ${classes.textClass}`}>
                          {row.usage.value}
                        </span>
                      </div>
                      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/10">
                        <div
                          className={`h-full rounded-full ${classes.fillClass}`}
                          style={{ width: `${Math.max(row.usage.unlimited ? 100 : 2, width)}%` }}
                        />
                      </div>
                      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-gray-500">
                        <span className={providerPlanStatusTone(row.status)}>{row.status}</span>
                        {row.usage.resetLabel && <span>{row.usage.resetLabel}</span>}
                      </div>
                    </div>
                  );
                })}
                {providerPlanRows.length === 0 && (
                  <p className="text-sm text-gray-500">No provider plan data yet</p>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 mb-8">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Cpu className="w-5 h-5 text-amber-400" />
              Token Cloud
            </CardTitle>
            <CardDescription>
              Most active models, providers, tools, and recurring terms
            </CardDescription>
          </CardHeader>
          <CardContent>
            {tokenAnalysisPending ? (
              <MetricCloudSkeleton />
            ) : tokenCloudEntries.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {tokenCloudEntries.map((entry) => {
                  const size = Math.min(26, 11 + entry.sharePct * 0.5);
                  const color =
                    entry.category === "model"
                      ? "text-cyan-300"
                      : entry.category === "provider"
                        ? "text-emerald-300"
                        : entry.category === "tool"
                          ? "text-violet-300"
                          : entry.category === "pattern"
                            ? "text-orange-300"
                            : "text-amber-300";
                  return (
                    <span
                      key={`${entry.category}-${entry.token}`}
                      className={`px-2 py-1 rounded-md bg-white/5 border border-white/10 ${color}`}
                      style={{ fontSize: `${size}px`, lineHeight: 1.1 }}
                      title={`${entry.category} · ${entry.sharePct}%`}
                    >
                      {entry.token}
                    </span>
                  );
                })}
              </div>
            ) : (
              <p className="text-sm text-gray-500">No token cloud data yet</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Gauge className="w-5 h-5 text-rose-400" />
              Model Thought Profiles
            </CardTitle>
            <CardDescription>Prompt/output style, latency, and throughput by model</CardDescription>
          </CardHeader>
          <CardContent>
            {tokenAnalysisPending ? (
              <MetricRowsSkeleton />
            ) : (
              <div className="space-y-3">
                {tokenAnalysisData?.modelThoughtProfiles?.slice(0, 8).map((profile) => (
                  <div
                    key={`${profile.provider}-${profile.model}`}
                    className="rounded-lg bg-white/5 p-3"
                  >
                    <div className="flex items-center justify-between mb-1">
                      <p className="text-sm text-white">{profile.model}</p>
                      <span className="text-[11px] uppercase tracking-wide text-rose-300">
                        {profile.behavior}
                      </span>
                    </div>
                    <div className="flex items-center justify-between text-xs text-gray-400">
                      <span>{profile.promptSharePct}% prompt</span>
                      <span>{profile.responseSharePct}% output</span>
                      <span>{profile.avgTps} tok/s</span>
                      <span>{profile.avgLatencyMs}ms</span>
                    </div>
                  </div>
                ))}
                {(!tokenAnalysisData?.modelThoughtProfiles ||
                  tokenAnalysisData.modelThoughtProfiles.length === 0) && (
                  <p className="text-sm text-gray-500">No model thought profile data yet</p>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <TrendingUp className="w-5 h-5 text-indigo-400" />
              Token Insights
            </CardTitle>
            <CardDescription>24h trend, cache share, and top model concentration</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {insightsPending ? (
              <MetricPanelSkeleton rows={4} />
            ) : (
              <>
                <div className="grid grid-cols-3 gap-3">
                  <div className="rounded-lg bg-white/5 p-3">
                    <p className="text-xs text-gray-500 mb-1">24h Trend</p>
                    <p
                      className={`text-lg font-semibold ${insightsData?.tokenTrend24h.direction === "up" ? "text-emerald-400" : insightsData?.tokenTrend24h.direction === "down" ? "text-red-400" : "text-gray-300"}`}
                    >
                      {insightsData?.tokenTrend24h.changePct ?? 0}%
                    </p>
                  </div>
                  <div className="rounded-lg bg-white/5 p-3">
                    <p className="text-xs text-gray-500 mb-1">Cache Share</p>
                    <p className="text-lg font-semibold text-purple-300">
                      {insightsData?.cacheEfficiency.cacheSharePct ?? 0}%
                    </p>
                  </div>
                  <div className="rounded-lg bg-white/5 p-3">
                    <p className="text-xs text-gray-500 mb-1">Top Model Share</p>
                    <p className="text-lg font-semibold text-amber-300">
                      {insightsData?.topModel?.sharePct ?? 0}%
                    </p>
                  </div>
                </div>
                <div className="pt-3 border-t border-white/10">
                  <p className="text-sm text-gray-400 mb-1">Most used model</p>
                  <p className="text-sm text-white font-medium">
                    {insightsData?.topModel?.model || "No model data yet"}
                  </p>
                  {insightsData?.topModel && (
                    <p className="text-xs text-gray-500 mt-1">
                      {formatNumber(insightsData.topModel.tokens)} tokens tracked
                    </p>
                  )}
                </div>
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Gauge className="w-5 h-5 text-cyan-400" />
              Provider Efficiency
            </CardTitle>
            <CardDescription>Tokens per provider call with share breakdown</CardDescription>
          </CardHeader>
          <CardContent>
            {insightsPending ? (
              <MetricRowsSkeleton />
            ) : (
              <div className="space-y-3">
                {insightsData?.providerEfficiency.slice(0, 6).map((provider, i) => (
                  <div key={i} className="rounded-lg bg-white/5 p-3">
                    <div className="flex items-center justify-between mb-1">
                      <p className="text-sm text-white">{provider.provider}</p>
                      <p className="text-xs text-gray-400">{provider.sharePct}% share</p>
                    </div>
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-cyan-300">
                        {formatNumber(provider.tokensPerCall)} tok/call
                      </span>
                      <span className="text-gray-500">{formatNumber(provider.calls)} calls</span>
                    </div>
                  </div>
                ))}
                {(!insightsData?.providerEfficiency ||
                  insightsData.providerEfficiency.length === 0) && (
                  <p className="text-sm text-gray-500 text-center py-4">
                    No provider efficiency data yet
                  </p>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Zap className="w-5 h-5 text-yellow-400" />
              Token Usage
            </CardTitle>
            <CardDescription>Breakdown of token consumption</CardDescription>
          </CardHeader>
          <CardContent>
            {tokensPending ? (
              <MetricPanelSkeleton rows={7} />
            ) : (
              <div className="space-y-4">
                <TokenBar
                  label="Input"
                  value={overview?.tokenUsage.input || 0}
                  total={overview?.tokenUsage.total || 1}
                  color="bg-blue-500"
                />
                <TokenBar
                  label="Output"
                  value={overview?.tokenUsage.output || 0}
                  total={overview?.tokenUsage.total || 1}
                  color="bg-green-500"
                />
                <TokenBar
                  label="Cache"
                  value={overview?.tokenUsage.cache || 0}
                  total={overview?.tokenUsage.total || 1}
                  color="bg-purple-500"
                />

                <div className="pt-4 border-t border-white/10">
                  <p className="text-sm text-gray-400 mb-2">By Model</p>
                  <div className="space-y-2">
                    {tokens?.topModels.slice(0, 5).map((model, i) => (
                      <div key={i} className="flex items-center justify-between">
                        <span className="text-sm text-gray-300">{model.model}</span>
                        <span className="text-sm text-gray-500">{formatNumber(model.tokens)}</span>
                      </div>
                    ))}
                    {(!tokens?.topModels || tokens.topModels.length === 0) && (
                      <p className="text-sm text-gray-500">No model data yet</p>
                    )}
                  </div>
                </div>

                <div className="pt-4 border-t border-white/10">
                  <p className="text-sm text-gray-400 mb-2">By Provider</p>
                  <div className="space-y-2">
                    {tokens?.topProviders.slice(0, 5).map((provider, i) => (
                      <div key={i} className="flex items-center justify-between">
                        <span className="text-sm text-gray-300">{provider.provider}</span>
                        <span className="text-sm text-gray-500">
                          {formatNumber(provider.tokens)}
                        </span>
                      </div>
                    ))}
                    {(!tokens?.topProviders || tokens.topProviders.length === 0) && (
                      <p className="text-sm text-gray-500">No provider data yet</p>
                    )}
                  </div>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <HardDrive className="w-5 h-5 text-orange-400" />
              File Operations
            </CardTitle>
            <CardDescription>Files read, written, and edited</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-3 gap-4 mb-6">
              <FileStat
                icon={<FileText className="w-4 h-4" />}
                label="Read"
                value={formatNumber(overview?.fileOperations.filesRead || 0)}
              />
              <FileStat
                icon={<FileText className="w-4 h-4" />}
                label="Written"
                value={formatNumber(overview?.fileOperations.filesWritten || 0)}
              />
              <FileStat
                icon={<Terminal className="w-4 h-4" />}
                label="Edited"
                value={formatNumber(overview?.fileOperations.filesEdited || 0)}
              />
            </div>

            {filesPending ? (
              <MetricRowsSkeleton rows={6} />
            ) : (
              <>
                <div>
                  <p className="text-sm text-gray-400 mb-2">Most Read Files</p>
                  <div className="space-y-2">
                    {files?.mostRead.slice(0, 5).map((file, i) => (
                      <div key={i} className="flex items-center justify-between">
                        <span className="text-sm text-gray-300 truncate max-w-[200px]">
                          {file.path.split("/").pop()}
                        </span>
                        <span className="text-sm text-gray-500">{formatNumber(file.count)}</span>
                      </div>
                    ))}
                    {(!files?.mostRead || files.mostRead.length === 0) && (
                      <p className="text-sm text-gray-500">No file data yet</p>
                    )}
                  </div>
                </div>

                <div className="pt-4 border-t border-white/10">
                  <p className="text-sm text-gray-400 mb-2">Most Written Files</p>
                  <div className="space-y-2">
                    {files?.mostWritten.slice(0, 5).map((file, i) => (
                      <div key={i} className="flex items-center justify-between">
                        <span className="text-sm text-gray-300 truncate max-w-[200px]">
                          {file.path.split("/").pop()}
                        </span>
                        <span className="text-sm text-gray-500">{formatNumber(file.count)}</span>
                      </div>
                    ))}
                    {(!files?.mostWritten || files.mostWritten.length === 0) && (
                      <p className="text-sm text-gray-500">No file data yet</p>
                    )}
                  </div>
                </div>

                <div className="pt-4 border-t border-white/10">
                  <p className="text-sm text-gray-400 mb-2">Most Edited Files</p>
                  <div className="space-y-2">
                    {files?.mostEdited.slice(0, 5).map((file, i) => (
                      <div key={i} className="flex items-center justify-between">
                        <span className="text-sm text-gray-300 truncate max-w-[200px]">
                          {file.path.split("/").pop()}
                        </span>
                        <span className="text-sm text-gray-500">{formatNumber(file.count)}</span>
                      </div>
                    ))}
                    {(!files?.mostEdited || files.mostEdited.length === 0) && (
                      <p className="text-sm text-gray-500">No file data yet</p>
                    )}
                  </div>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Terminal className="w-5 h-5 text-cyan-400" />
              Tool Usage
            </CardTitle>
            <CardDescription>Most frequently used tools</CardDescription>
          </CardHeader>
          <CardContent>
            {toolsPending || insightsPending ? (
              <MetricRowsSkeleton rows={8} />
            ) : (
              <>
                <div className="space-y-3">
                  {tools?.mostUsed.slice(0, 8).map((tool, i) => (
                    <div key={i} className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-lg bg-cyan-500/20 flex items-center justify-center">
                        <Terminal className="w-4 h-4 text-cyan-400" />
                      </div>
                      <div className="flex-1">
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-sm text-gray-300">{tool.tool}</span>
                          <span className="text-sm text-gray-500">{formatNumber(tool.calls)}</span>
                        </div>
                        <div className="h-2 bg-white/10 rounded-full overflow-hidden">
                          <div
                            className="h-full bg-cyan-500 rounded-full"
                            style={{
                              width: `${Math.min(100, (tool.calls / (tools?.mostUsed[0]?.calls || 1)) * 100)}%`,
                            }}
                          />
                        </div>
                      </div>
                    </div>
                  ))}
                  {(!tools?.mostUsed || tools.mostUsed.length === 0) && (
                    <p className="text-sm text-gray-500 text-center py-4">No tool data yet</p>
                  )}
                </div>
                {insightsData?.toolReliability && (
                  <div className="mt-4 pt-4 border-t border-white/10 grid grid-cols-3 gap-2 text-xs">
                    <div className="rounded bg-white/5 p-2 text-center">
                      <p className="text-gray-500">Success</p>
                      <p className="text-emerald-400 font-semibold">
                        {insightsData.toolReliability.successRatePct}%
                      </p>
                    </div>
                    <div className="rounded bg-white/5 p-2 text-center">
                      <p className="text-gray-500">Calls</p>
                      <p className="text-white font-semibold">
                        {formatNumber(insightsData.toolReliability.totalCalls)}
                      </p>
                    </div>
                    <div className="rounded bg-white/5 p-2 text-center">
                      <p className="text-gray-500">Errors</p>
                      <p className="text-red-400 font-semibold">
                        {formatNumber(insightsData.toolReliability.totalErrors)}
                      </p>
                    </div>
                  </div>
                )}
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Activity className="w-5 h-5 text-green-400" />
              Activity Summary
            </CardTitle>
            <CardDescription>System activity overview</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-4">
              <ActivityStat
                icon={<MessageSquare className="w-5 h-5" />}
                label="Agent Messages"
                value={formatNumber(overview?.agentActivity.totalMessages || 0)}
              />
              <ActivityStat
                icon={<Terminal className="w-5 h-5" />}
                label="Tool Calls"
                value={formatNumber(overview?.toolCalls.totalCalls || 0)}
              />
              <ActivityStat
                icon={<Zap className="w-5 h-5" />}
                label="API Calls"
                value={formatNumber(overview?.apiCalls.totalCalls || 0)}
              />
              <ActivityStat
                icon={<TrendingUp className="w-5 h-5" />}
                label="Avg Tokens/Message"
                value={formatNumber(stats?.avgTokensPerMessage || 0)}
              />
            </div>

            <div className="mt-6 pt-6 border-t border-white/10">
              <p className="text-sm text-gray-400 mb-3">API Status</p>
              <div className="grid grid-cols-2 gap-4">
                <div className="flex items-center justify-between p-3 rounded-lg bg-green-500/10">
                  <span className="text-sm text-gray-300">Successful</span>
                  <span className="text-sm text-green-400">
                    {formatNumber(overview?.apiCalls.successfulCalls || 0)}
                  </span>
                </div>
                <div className="flex items-center justify-between p-3 rounded-lg bg-red-500/10">
                  <span className="text-sm text-gray-300">Failed</span>
                  <span className="text-sm text-red-400">
                    {formatNumber(overview?.apiCalls.failedCalls || 0)}
                  </span>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Zap className="w-5 h-5 text-yellow-400" />
              Providers
            </CardTitle>
            <CardDescription>API provider usage and hits</CardDescription>
          </CardHeader>
          <CardContent>
            {providersPending ? (
              <MetricRowsSkeleton />
            ) : visibleProviders.length > 0 ? (
              <div className="space-y-4">
                {visibleProviders.map((provider, i) => (
                  <div
                    key={`${provider.provider}:${provider.url}:${i}`}
                    className="p-4 rounded-lg bg-white/5 border border-white/10"
                  >
                    <div className="flex items-center justify-between mb-2">
                      <div>
                        <p className="text-sm font-medium text-white">{provider.provider}</p>
                        <p className="text-xs text-gray-500 truncate max-w-[200px]">
                          {provider.url}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="text-lg font-bold text-white">
                          {formatNumber(provider.tokens)}
                        </p>
                        <p className="text-xs text-gray-500">tokens</p>
                      </div>
                    </div>
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-gray-400">API Hits</span>
                      <span className="text-gray-300">{formatNumber(provider.hits)}</span>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-gray-500 text-center py-4">No provider data yet</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Cpu className="w-5 h-5 text-indigo-400" />
              Cybara Signal
            </CardTitle>
            <CardDescription>Autonomy and model behavior telemetry</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {toolsPending || insightsPending || tokenAnalysisPending ? (
              <MetricPanelSkeleton rows={5} />
            ) : (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <div className="rounded-lg bg-white/5 p-3">
                    <p className="text-xs text-gray-500 mb-1">Autonomy</p>
                    <p className="text-lg font-semibold text-indigo-300">
                      {cybaraSignals.toolsPerMessage}
                    </p>
                    <p className="text-[11px] text-gray-500">tools/message</p>
                  </div>
                  <div className="rounded-lg bg-white/5 p-3">
                    <p className="text-xs text-gray-500 mb-1">Memory Share</p>
                    <p className="text-lg font-semibold text-emerald-300">
                      {cybaraSignals.memorySharePct}%
                    </p>
                    <p className="text-[11px] text-gray-500">memory tool calls</p>
                  </div>
                  <div className="rounded-lg bg-white/5 p-3">
                    <p className="text-xs text-gray-500 mb-1">Provider Balance</p>
                    <p className="text-lg font-semibold text-cyan-300">
                      {cybaraSignals.providerBalance}
                    </p>
                    <p className="text-[11px] text-gray-500">100 - top provider share</p>
                  </div>
                  <div className="rounded-lg bg-white/5 p-3">
                    <p className="text-xs text-gray-500 mb-1">Output-Heavy</p>
                    <p className="text-lg font-semibold text-amber-300">
                      {cybaraSignals.outputHeavyShare}%
                    </p>
                    <p className="text-[11px] text-gray-500">response-forward calls</p>
                  </div>
                </div>

                <div className="rounded-lg bg-white/5 p-3 border border-white/10">
                  <p className="text-xs text-gray-500 mb-1">Dominant Thinking Style</p>
                  <p className="text-sm font-medium text-white">{cybaraSignals.dominantBehavior}</p>
                </div>

                {cybaraSignals.topBurst && (
                  <div className="rounded-lg bg-white/5 p-3 border border-white/10">
                    <p className="text-xs text-gray-500 mb-1">Top Burst</p>
                    <p className="text-sm text-indigo-300">
                      {formatNumber(cybaraSignals.topBurst.totalTokens)} tokens in one call
                    </p>
                    <p className="text-xs text-gray-500 mt-1">
                      {cybaraSignals.topBurst.model} · {cybaraSignals.topBurst.provider}
                    </p>
                  </div>
                )}
              </>
            )}
          </CardContent>
        </Card>
      </div>

      <Card className="mb-8">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Gauge className="w-5 h-5 text-emerald-400" />
            Model Performance
          </CardTitle>
          <CardDescription>Tokens per second and latency by model</CardDescription>
        </CardHeader>
        <CardContent>
          {modelsPending ? (
            <MetricRowsSkeleton rows={5} />
          ) : modelPerformanceRows.length > 0 ? (
            <div className="space-y-3">
              {modelPerformanceRows.map((model) => (
                <div key={model.key} className="p-4 rounded-lg bg-white/5 border border-white/10">
                  <div className="flex items-center justify-between mb-2">
                    <div>
                      <p className="text-sm font-medium text-white">{model.model}</p>
                      <p className="text-xs text-gray-500">{model.provider}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-lg font-bold text-emerald-400">
                        {model.avgTps} <span className="text-xs text-gray-400">tok/s</span>
                      </p>
                    </div>
                  </div>

                  <div className="h-2 bg-white/10 rounded-full overflow-hidden mb-3">
                    <div
                      className="h-full bg-emerald-500 rounded-full transition-all"
                      style={{ width: `${model.tpsPercent}%` }}
                    />
                  </div>

                  <div className="grid grid-cols-3 gap-2 text-xs">
                    <div className="flex items-center gap-1">
                      <Clock className="w-3 h-3 text-gray-500" />
                      <span className="text-gray-400">{model.avgLatencyMs}ms avg</span>
                    </div>
                    <div className="text-center text-gray-400">
                      {formatNumber(model.totalTokens)} tokens
                    </div>
                    <div className="text-right text-gray-400">{model.callCount} calls</div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-8 text-gray-500">
              <Gauge className="w-12 h-12 mx-auto mb-2 opacity-50" />
              <p>No model performance data yet</p>
              <p className="text-sm">Use the chat to generate TPS metrics</p>
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="mb-8">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <HardDrive className="w-5 h-5 text-cyan-300" />
            Storage Footprint
          </CardTitle>
          <CardDescription>Local disk usage for Cybara data and runtime files</CardDescription>
        </CardHeader>
        <CardContent>
          {storagePending ? (
            <MetricPanelSkeleton rows={8} />
          ) : storageData ? (
            <div className="space-y-4">
              <div className="rounded-lg bg-white/5 p-3">
                <p className="text-xs text-gray-500 mb-1">Total Local Storage</p>
                <p className="text-xl font-semibold text-white">
                  {formatBytes(storageData.totalBytes)}
                </p>
                <p className="text-[11px] text-gray-500 mt-1">
                  {storageData.directories.cybaraDir}
                </p>
                <div className="mt-3 grid grid-cols-1 sm:grid-cols-3 gap-2 text-[11px]">
                  <div className="rounded-md border border-white/10 bg-white/[0.02] px-2 py-1.5">
                    <p className="text-gray-500">Accounted</p>
                    <p className="text-gray-200">
                      {formatBytes(storageData.accountedBytes ?? storageData.totalBytes)}
                    </p>
                  </div>
                  <div className="rounded-md border border-white/10 bg-white/[0.02] px-2 py-1.5">
                    <p className="text-gray-500">Uncategorized</p>
                    <p className="text-gray-200">
                      {formatBytes(storageData.uncategorizedBytes ?? 0)}
                    </p>
                  </div>
                  <div className="rounded-md border border-white/10 bg-white/[0.02] px-2 py-1.5">
                    <p className="text-gray-500">Database (in Data)</p>
                    <p className="text-gray-200">
                      {formatBytes(storageData.components.database.bytes)}
                    </p>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
                <div className="space-y-2">
                  {storageCategoryEntries.map((entry) => {
                    const sharePct =
                      storageData.totalBytes > 0 ? (entry.bytes / storageData.totalBytes) * 100 : 0;
                    return (
                      <div
                        key={entry.label}
                        className="rounded-lg border border-white/10 bg-white/[0.02] p-3"
                      >
                        <div className="flex items-center justify-between text-sm mb-1.5">
                          <span className="text-gray-200">{entry.label}</span>
                          <span className="text-cyan-300">{formatBytes(entry.bytes)}</span>
                        </div>
                        <div className="h-1.5 bg-white/10 rounded-full overflow-hidden mb-1.5">
                          <div
                            className="h-full bg-cyan-500 rounded-full"
                            style={{ width: `${Math.min(100, sharePct)}%` }}
                          />
                        </div>
                        <p className="text-[11px] text-gray-500 truncate">{entry.path}</p>
                      </div>
                    );
                  })}
                </div>

                <div className="rounded-lg border border-white/10 bg-white/[0.02] p-3">
                  <p className="text-sm text-gray-200 mb-2">Top Local Paths</p>
                  <div className="space-y-2 max-h-[420px] overflow-y-auto pr-1">
                    {storageTopLevelEntries.length > 0 ? (
                      storageTopLevelEntries.map((entry) => {
                        const sharePct =
                          storageData.totalBytes > 0
                            ? (entry.bytes / storageData.totalBytes) * 100
                            : 0;
                        return (
                          <div
                            key={entry.path}
                            className="rounded-md border border-white/10 bg-black/20 p-2.5"
                          >
                            <div className="flex items-center justify-between gap-3 text-[12px]">
                              <span className="text-gray-200 truncate">{entry.name}</span>
                              <span className="text-cyan-300 shrink-0">
                                {formatBytes(entry.bytes)}
                              </span>
                            </div>
                            <p className="text-[11px] text-gray-500 truncate mt-1">{entry.path}</p>
                            <p className="text-[10px] text-gray-500 mt-1">
                              {sharePct.toFixed(2)}% of total
                            </p>
                          </div>
                        );
                      })
                    ) : (
                      <p className="text-[12px] text-gray-500">No top-level path data available.</p>
                    )}
                  </div>
                </div>
              </div>

              {storageCategoryEntries.length === 0 && (
                <div className="rounded-lg border border-white/10 bg-white/[0.02] p-3 text-sm text-gray-500">
                  Storage categories are empty.
                </div>
              )}

              {(() => {
                const entry = {
                  label: "Database files",
                  bytes: storageData.components.database.bytes,
                  path: storageData.components.database.path,
                };
                const sharePct =
                  storageData.totalBytes > 0 ? (entry.bytes / storageData.totalBytes) * 100 : 0;
                return (
                  <div
                    key={entry.label}
                    className="rounded-lg border border-white/10 bg-white/[0.02] p-3"
                  >
                    <div className="flex items-center justify-between text-sm mb-1.5">
                      <span className="text-gray-200">{entry.label}</span>
                      <span className="text-cyan-300">{formatBytes(entry.bytes)}</span>
                    </div>
                    <div className="h-1.5 bg-white/10 rounded-full overflow-hidden mb-1.5">
                      <div
                        className="h-full bg-cyan-500 rounded-full"
                        style={{ width: `${Math.min(100, sharePct)}%` }}
                      />
                    </div>
                    <p className="text-[11px] text-gray-500 truncate">{entry.path}</p>
                  </div>
                );
              })()}
            </div>
          ) : (
            <p className="text-sm text-gray-500">No storage data available.</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <BarChart3 className="w-5 h-5 text-indigo-400" />
            30-Day Activity
          </CardTitle>
          <CardDescription>Daily activity over the past month</CardDescription>
        </CardHeader>
        <CardContent>
          {timeSeriesPending ? (
            <MetricChartSkeleton />
          ) : activityDayRows.length > 0 ? (
            <>
              <div className="h-48 flex items-end gap-1">
                {activityDayRows.map((day) => (
                  <div
                    key={day.key}
                    className="flex-1 bg-indigo-500/30 hover:bg-indigo-500/50 transition-colors rounded-t cursor-pointer"
                    style={{ height: `${Math.max(day.height, 2)}%` }}
                    title={`${day.date}: ${formatNumber(day.dayTotal)} total activity`}
                  />
                ))}
              </div>
              <div className="flex justify-between mt-2 text-xs text-gray-500">
                <span>{activityDayRows[0]?.date}</span>
                <span>{activityDayRows[activityDayRows.length - 1]?.date}</span>
              </div>
            </>
          ) : (
            <div className="h-48 flex items-center justify-center text-gray-500">
              <div className="text-center">
                <BarChart3 className="w-12 h-12 mx-auto mb-2 opacity-50" />
                <p>No activity data yet</p>
                <p className="text-sm">Use the platform to start generating metrics</p>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </PageLayout>
  );
}

function MetricAreaChart({
  rows,
  strokeColor,
  fillColor,
  emptyLabel,
}: {
  rows: Array<{ label: string; value: number; detail?: string }>;
  strokeColor: string;
  fillColor: string;
  emptyLabel: string;
}) {
  const width = 640;
  const height = 180;
  const maxValue = Math.max(1, ...rows.map((row) => row.value));
  const points = rows.map((row, index) => {
    const x = rows.length <= 1 ? width : (index / (rows.length - 1)) * width;
    const y = height - (row.value / maxValue) * (height - 12) - 6;
    return { x, y, row };
  });
  const linePath = points
    .map((point, index) => `${index === 0 ? "M" : "L"} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`)
    .join(" ");
  const areaPath =
    points.length > 0
      ? `M 0 ${height} ${linePath} L ${width} ${height} Z`
      : `M 0 ${height} L ${width} ${height}`;

  if (rows.length === 0) {
    return (
      <div className="flex h-48 items-center justify-center rounded-lg border border-white/10 bg-white/[0.02] text-sm text-gray-500">
        {emptyLabel}
      </div>
    );
  }

  return (
    <div>
      <svg viewBox={`0 0 ${width} ${height}`} className="h-48 w-full overflow-visible">
        <path d={areaPath} fill={fillColor} opacity={0.16} />
        <path
          d={linePath}
          fill="none"
          stroke={strokeColor}
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={3}
        />
        {points.map((point, index) => (
          <circle
            key={`${point.row.label}:${index}`}
            cx={point.x}
            cy={point.y}
            r={2.8}
            fill={strokeColor}
          >
            <title>
              {point.row.label}: {formatNumber(point.row.value)}
              {point.row.detail ? ` (${point.row.detail})` : ""}
            </title>
          </circle>
        ))}
      </svg>
      <div className="mt-2 flex justify-between text-xs text-gray-500">
        <span>{rows[0]?.label}</span>
        <span>{rows[rows.length - 1]?.label}</span>
      </div>
    </div>
  );
}

function MetricShareStack({
  rows,
  total,
}: {
  rows: Array<{ label: string; value: number; color: string }>;
  total: number;
}) {
  const safeTotal =
    total > 0 ? total : rows.reduce((sum, row) => sum + Math.max(0, row.value), 0) || 1;
  return (
    <div className="space-y-4">
      <div className="flex h-4 overflow-hidden rounded-full bg-white/10">
        {rows.map((row) => (
          <div
            key={row.label}
            className={row.color}
            style={{ width: `${Math.max(row.value > 0 ? 2 : 0, (row.value / safeTotal) * 100)}%` }}
            title={`${row.label}: ${formatNumber(row.value)}`}
          />
        ))}
      </div>
      <div className="space-y-2">
        {rows.map((row) => {
          const pct = safeTotal > 0 ? (row.value / safeTotal) * 100 : 0;
          return (
            <div key={row.label} className="flex items-center justify-between gap-3 text-sm">
              <div className="flex items-center gap-2">
                <span className={`h-2.5 w-2.5 rounded-full ${row.color}`} />
                <span className="text-gray-300">{row.label}</span>
              </div>
              <span className="text-gray-500">
                {formatNumber(row.value)} · {pct.toFixed(1)}%
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function MetricRankedRows({
  rows,
  accentClass,
}: {
  rows: Array<{ label: string; value: number; detail?: string }>;
  accentClass: string;
}) {
  const maxValue = Math.max(1, ...rows.map((row) => row.value));
  if (rows.length === 0) {
    return (
      <div className="rounded-lg border border-white/10 bg-white/[0.02] p-6 text-center text-sm text-gray-500">
        No ranked token data yet
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {rows.map((row) => (
        <div key={`${row.label}:${row.detail || ""}`} className="space-y-1.5">
          <div className="flex items-center justify-between gap-3 text-sm">
            <div className="min-w-0">
              <p className="truncate text-gray-200">{row.label}</p>
              {row.detail && <p className="truncate text-xs text-gray-500">{row.detail}</p>}
            </div>
            <span className="shrink-0 text-gray-400">{formatNumber(row.value)}</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-white/10">
            <div
              className={`h-full rounded-full ${accentClass}`}
              style={{ width: `${Math.max(3, (row.value / maxValue) * 100)}%` }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

function MetricSkeletonLine({ className = "h-3 w-full" }: { className?: string }) {
  return <div className={`rounded-full bg-white/10 ${className}`} />;
}

function MetricPanelSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div className="animate-pulse space-y-3" aria-label="Loading metrics">
      {Array.from({ length: rows }).map((_, index) => (
        <div key={index} className="rounded-lg border border-white/10 bg-white/[0.02] p-3">
          <MetricSkeletonLine className="h-3 w-2/5" />
          <MetricSkeletonLine className="mt-3 h-5 w-3/4" />
          <MetricSkeletonLine className="mt-3 h-2 w-full" />
        </div>
      ))}
    </div>
  );
}

function MetricRowsSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div className="animate-pulse space-y-3" aria-label="Loading metrics rows">
      {Array.from({ length: rows }).map((_, index) => (
        <div key={index} className="space-y-2">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0 flex-1">
              <MetricSkeletonLine className="h-3 w-2/3" />
              <MetricSkeletonLine className="mt-2 h-2 w-1/2" />
            </div>
            <MetricSkeletonLine className="h-3 w-12" />
          </div>
          <MetricSkeletonLine className="h-2 w-full" />
        </div>
      ))}
    </div>
  );
}

function MetricChartSkeleton() {
  return (
    <div
      className="h-48 animate-pulse rounded-lg border border-white/10 bg-white/[0.02] p-4"
      aria-label="Loading metrics chart"
    >
      <div className="flex h-full items-end gap-2">
        {Array.from({ length: 18 }).map((_, index) => (
          <div
            key={index}
            className="flex-1 rounded-t bg-white/10"
            style={{ height: `${18 + ((index * 17) % 68)}%` }}
          />
        ))}
      </div>
    </div>
  );
}

function MetricHeatmapSkeleton() {
  return (
    <div className="animate-pulse space-y-2" aria-label="Loading token heatmap">
      {Array.from({ length: 7 }).map((_, rowIndex) => (
        <div key={rowIndex} className="grid grid-cols-[64px,1fr] gap-2 items-center">
          <MetricSkeletonLine className="h-3 w-10" />
          <div className="grid gap-1" style={{ gridTemplateColumns: "repeat(24, minmax(0, 1fr))" }}>
            {Array.from({ length: 24 }).map((_, index) => (
              <div key={index} className="h-3 rounded-sm bg-white/10" />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function MetricCloudSkeleton() {
  const widths = ["w-16", "w-24", "w-20", "w-28", "w-14", "w-32", "w-20", "w-24"];
  return (
    <div className="flex animate-pulse flex-wrap gap-2" aria-label="Loading token cloud">
      {widths.map((width, index) => (
        <MetricSkeletonLine key={`${width}:${index}`} className={`h-8 ${width}`} />
      ))}
    </div>
  );
}

function StatCard({
  icon,
  label,
  value,
  color,
  bgColor,
  loading,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  color: string;
  bgColor: string;
  loading?: boolean;
}) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center gap-2 mb-2">
          <div className={`p-2 rounded-lg ${bgColor}`}>{icon}</div>
          <span className="text-sm text-gray-400">{label}</span>
        </div>
        {loading ? (
          <div className="h-8 w-24 animate-pulse rounded bg-white/10" />
        ) : (
          <p className={`text-2xl font-bold ${color}`}>{value}</p>
        )}
      </CardContent>
    </Card>
  );
}

function TokenBar({
  label,
  value,
  total,
  color,
}: {
  label: string;
  value: number;
  total: number;
  color: string;
}) {
  const percentage = total > 0 ? (value / total) * 100 : 0;

  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <span className="text-sm text-gray-400">{label}</span>
        <span className="text-sm text-gray-500">
          {formatNumber(value)} ({percentage.toFixed(1)}%)
        </span>
      </div>
      <div className="h-2 bg-white/10 rounded-full overflow-hidden">
        <div className={`h-full ${color} rounded-full`} style={{ width: `${percentage}%` }} />
      </div>
    </div>
  );
}

function FileStat({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="text-center p-3 rounded-lg bg-white/5">
      <div className="text-gray-400 mb-1">{icon}</div>
      <p className="text-xl font-bold text-white">{value}</p>
      <p className="text-xs text-gray-500">{label}</p>
    </div>
  );
}

function ActivityStat({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-center gap-3 p-3 rounded-lg bg-white/5">
      <div className="text-gray-400">{icon}</div>
      <div>
        <p className="text-2xl font-bold text-white">{value}</p>
        <p className="text-xs text-gray-500">{label}</p>
      </div>
    </div>
  );
}

export default Metrics;
