import { ActivityIndicator, Pressable, Text, View } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  CheckCircle2,
  ChevronRight,
  Cpu,
  Database,
  Gauge,
  HeartPulse,
  ListTodo,
  ShieldAlert,
  Zap,
} from "lucide-react-native";
import {
  MetricAreaChart,
  MetricBarChart,
  MetricBreakdown,
  MetricEndpointGrid,
  MetricMicro,
  MetricSection,
  MetricShareRows,
  MetricTokenCloud,
  TokenHeatmap,
} from "../components/MetricVisuals";
import {
  formatMetricBytes,
  formatMetricNumber,
  hasDetailedMetrics,
  metricSuccessRate,
  modelTokenShareRows,
  providerTokenShareRows,
  storageCategoryEntries,
  timeSeriesTotals,
  tokenFlowBars,
  tokenVelocityAreaRows,
  totalFileOperations,
  type MetricsSnapshot,
} from "../lib/metrics";
import type { CybaraMobileApi, ProviderPlanStatusResponse } from "../lib/api";
import {
  MOBILE_RECENT_ACTIVITY_CHROME,
  formatMobileValue,
  type FeatureCounts,
  type MobileSurfaceKey,
} from "../lib/dashboard";
import { accentPalette, colors } from "../theme/liquidGlass";
import { StableDetailPanel } from "./dashboardControls";
import { endpointStatusLabel, relativeTimestamp } from "./dashboardHelpers";
import { styles } from "./dashboardStyles";
import { EmptyState, LoadingState, SummaryTile, type IconGlyph } from "./dashboardPrimitives";
import type { FeatureSummary } from "../lib/api";

const USAGE_ORDER_KEY = "cybara.mobile.usageOrder";
type MobileMetricsSection = "activity" | "usage" | "runtime" | "system";

function mobileMetricLatency(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "--";
  return value < 1000 ? `${Math.round(value)}ms` : `${(value / 1000).toFixed(1)}s`;
}

async function readUsageOrder(): Promise<string[]> {
  try {
    const raw = await AsyncStorage.getItem(USAGE_ORDER_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string")
      : [];
  } catch {
    return [];
  }
}

async function writeUsageOrder(ids: string[]): Promise<void> {
  try {
    await AsyncStorage.setItem(USAGE_ORDER_KEY, JSON.stringify(ids));
  } catch {
    void 0;
  }
}

function statusRank(status: string): number {
  if (status === "exhausted") return 0;
  if (status === "warning") return 1;
  if (status === "ok") return 2;
  return 3;
}

function sortPlanRows(
  rows: MobileProviderPlanRow[],
  customOrder: string[]
): MobileProviderPlanRow[] {
  if (customOrder.length === 0) {
    return [...rows].sort(
      (a, b) =>
        statusRank(a.status) - statusRank(b.status) ||
        a.providerName.localeCompare(b.providerName, undefined, {
          sensitivity: "base",
        })
    );
  }
  const rank = new Map(customOrder.map((id, index) => [id, index]));
  return [...rows].sort((a, b) => {
    const rankA = rank.get(a.id) ?? Number.MAX_SAFE_INTEGER;
    const rankB = rank.get(b.id) ?? Number.MAX_SAFE_INTEGER;
    if (rankA !== rankB) return rankA - rankB;
    return statusRank(a.status) - statusRank(b.status);
  });
}

function MetricsOverviewSection({
  accentColor,
  metrics,
  metricsError,
  metricsRefreshing,
  metricsUpdatedAt,
  summary,
}: {
  accentColor: string;
  metrics: MetricsSnapshot | null;
  metricsError: string | null;
  metricsRefreshing: boolean;
  metricsUpdatedAt: number | null;
  summary: FeatureSummary | null;
}) {
  const health = summary?.health;
  const healthy = health?.status === "healthy";
  const overview = metrics?.overview ?? null;
  const availableMetrics = metrics
    ? Object.values(metrics.availability).filter((endpoint) => endpoint.ok).length
    : 0;
  const metricFeedCount = metrics ? Object.keys(metrics.availability).length : 0;
  const tokenBars = tokenFlowBars(overview);
  const freshness = metricsUpdatedAt
    ? `Updated ${relativeTimestamp(new Date(metricsUpdatedAt).toISOString())}`
    : "Loading";

  return (
    <>
      <View style={styles.summaryGrid}>
        <SummaryTile
          Icon={HeartPulse}
          label="Health"
          value={healthy ? "Healthy" : health ? "Check" : "Loading"}
          detail={endpointStatusLabel(summary?.availability.health)}
          tone={healthy ? colors.green : colors.amber}
        />
        <SummaryTile
          Icon={Cpu}
          label="Tokens"
          value={formatMetricNumber(overview?.tokenUsage.total)}
          detail={`${formatMetricNumber(overview?.agentActivity.totalMessages)} messages`}
          tone={accentColor}
        />
        <SummaryTile
          Icon={Zap}
          label="API"
          value={metricSuccessRate(overview)}
          detail={`${formatMetricNumber(overview?.apiCalls.totalCalls)} calls`}
          tone={colors.blueText}
        />
        <SummaryTile
          Icon={Database}
          label="Storage"
          value={metrics?.storage ? formatMetricBytes(metrics.storage.totalBytes) : "--"}
          detail={`${availableMetrics}/${metricFeedCount} feeds`}
          tone={colors.green}
        />
      </View>

      {metricsError ? <EmptyState label="Metrics unavailable" detail={metricsError} /> : null}

      <View style={styles.subsectionHeader}>
        <Text style={styles.subsectionTitle}>Token flow</Text>
        <View style={styles.inlineButtonRow}>
          {metricsRefreshing ? <ActivityIndicator color={accentColor} size="small" /> : null}
          <Text style={styles.counterText}>{metricsRefreshing ? "Updating" : freshness}</Text>
        </View>
      </View>
      <MetricBreakdown data={tokenBars} tone={accentColor} />
    </>
  );
}

function MetricsDetailSkeleton() {
  return (
    <View style={styles.metricSkeletonGrid} accessibilityLabel="Loading detailed metrics">
      {["Activity", "Runtime", "Providers"].map((label) => (
        <View key={label} style={styles.metricSkeletonBlock}>
          <View style={styles.metricSkeletonHeader}>
            <View style={styles.metricSkeletonTitle} />
            <ActivityIndicator color={colors.textDim} size="small" />
          </View>
          <View style={styles.metricSkeletonTrack} />
          <View style={styles.metricSkeletonTrackShort} />
        </View>
      ))}
    </View>
  );
}

export function MetricsPanel({
  accentColor,
  api,
  counts,
  metrics,
  metricsError,
  metricsRefreshing,
  metricsUpdatedAt,
  providerPlanStatus,
  summary,
  openSurface,
}: {
  accentColor: string;
  api: CybaraMobileApi;
  counts: FeatureCounts;
  metrics: MetricsSnapshot | null;
  metricsError: string | null;
  metricsRefreshing: boolean;
  metricsUpdatedAt: number | null;
  providerPlanStatus: ProviderPlanStatusResponse | null;
  summary: FeatureSummary | null;
  openSurface: (surface: MobileSurfaceKey) => void;
}) {
  const [sessionRuntime, setSessionRuntime] = useState(metrics?.sessions ?? null);
  const [sessionRuntimeLoading, setSessionRuntimeLoading] = useState(false);
  const [activeMetricsSection, setActiveMetricsSection] =
    useState<MobileMetricsSection>("activity");

  useEffect(() => {
    setSessionRuntime(metrics?.sessions ?? null);
  }, [metrics?.sessions]);

  const loadSessionRuntimePage = useCallback(
    async (page: number) => {
      if (sessionRuntimeLoading) return;
      setSessionRuntimeLoading(true);
      try {
        setSessionRuntime(await api.metricsSessions(page));
      } finally {
        setSessionRuntimeLoading(false);
      }
    },
    [api, sessionRuntimeLoading]
  );

  if (!metrics && !metricsError) {
    return (
      <MetricsPanelSkeleton
        accentColor={accentColor}
        counts={counts}
        openSurface={openSurface}
        summary={summary}
      />
    );
  }

  const health = summary?.health;
  const checks = Object.entries(health?.checks || {});
  const recentLogs = summary?.logs.slice(0, 3) ?? [];
  const overview = metrics?.overview ?? null;
  const insights = metrics?.insights ?? null;
  const tokenAnalysis = metrics?.tokenAnalysis ?? null;
  const availableMetrics = metrics
    ? Object.values(metrics.availability).filter((endpoint) => endpoint.ok).length
    : 0;
  const metricFeedCount = metrics ? Object.keys(metrics.availability).length : 0;
  const activitySeries = timeSeriesTotals(metrics?.timeSeries ?? null, [
    "token_usage",
    "tool_call",
    "api_call",
    "file_operation",
    "activity",
    "messages",
  ]);
  const velocityRows = tokenVelocityAreaRows(tokenAnalysis);
  const providerRows = providerTokenShareRows(metrics);
  const modelRows = modelTokenShareRows(metrics);
  const storageRows = storageCategoryEntries(metrics?.storage ?? null).slice(0, 8);
  const providerPlanRows = mobileProviderPlanRows(
    providerPlanStatus ?? metrics?.providerPlans ?? null
  ).slice(0, 8);
  const sessionMetrics = sessionRuntime ?? metrics?.sessions;
  const sessionPagination = sessionMetrics?.pagination;

  if (!hasDetailedMetrics(metrics)) {
    return (
      <StableDetailPanel>
        <MetricsOverviewSection
          accentColor={accentColor}
          metrics={metrics}
          metricsError={metricsError}
          metricsRefreshing={metricsRefreshing}
          metricsUpdatedAt={metricsUpdatedAt}
          summary={summary}
        />
        <MetricsDetailSkeleton />
      </StableDetailPanel>
    );
  }

  return (
    <StableDetailPanel>
      <MetricsOverviewSection
        accentColor={accentColor}
        metrics={metrics}
        metricsError={metricsError}
        metricsRefreshing={metricsRefreshing}
        metricsUpdatedAt={metricsUpdatedAt}
        summary={summary}
      />

      <View style={styles.metricSectionTabs} accessibilityRole="tablist">
        {[
          { key: "activity", label: "Activity" },
          { key: "usage", label: "Usage" },
          { key: "runtime", label: "Runtime" },
          { key: "system", label: "System" },
        ].map(({ key, label }) => {
          const selected = activeMetricsSection === key;
          return (
            <Pressable
              key={key}
              accessibilityRole="tab"
              accessibilityState={{ selected }}
              onPress={() => setActiveMetricsSection(key as MobileMetricsSection)}
              style={[
                styles.metricSectionTab,
                selected && {
                  backgroundColor: `${accentColor}18`,
                  borderColor: `${accentColor}55`,
                },
              ]}
            >
              <Text
                numberOfLines={1}
                style={[
                  styles.metricSectionTabText,
                  { color: selected ? accentColor : colors.textMuted },
                ]}
              >
                {label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {activeMetricsSection === "activity" ? (
        <>
          <MetricSection
            title="Activity trend"
            detail="Last 14 days across tokens, tools, API, files, and messages"
          >
            <MetricBarChart data={activitySeries} tone={accentColor} />
          </MetricSection>

          <MetricSection title="Token velocity" detail="Last 24 hours by token volume and calls">
            <MetricAreaChart data={velocityRows} tone={accentColor} />
          </MetricSection>

          <MetricSection
            title="Token heatmap"
            detail={
              tokenAnalysis?.tokenHeatmap?.hottestHour
                ? `${tokenAnalysis.tokenHeatmap.hottestHour.dayLabel} ${String(tokenAnalysis.tokenHeatmap.hottestHour.hour).padStart(2, "0")}:00 hottest`
                : "7-day hourly usage"
            }
          >
            <TokenHeatmap tokenAnalysis={tokenAnalysis} tone={accentColor} />
          </MetricSection>
        </>
      ) : null}

      {activeMetricsSection === "usage" ? (
        <>
          <MetricSection title="Prompt vs output" detail="Ratio, median, and response balance">
            <View style={styles.metricMicroGrid}>
              <MetricMicro
                label="Input:Output"
                value={
                  tokenAnalysis?.summary?.inputToOutputRatio === null ||
                  tokenAnalysis?.summary?.inputToOutputRatio === undefined
                    ? "n/a"
                    : `${tokenAnalysis.summary.inputToOutputRatio}:1`
                }
              />
              <MetricMicro
                label="Avg/call"
                value={formatMetricNumber(tokenAnalysis?.summary?.averageTokensPerCall)}
              />
              <MetricMicro
                label="Median"
                value={formatMetricNumber(tokenAnalysis?.summary?.medianTokensPerCall)}
              />
            </View>
            <MetricShareRows
              rows={(tokenAnalysis?.promptOutputDistribution?.bands || []).map((band) => ({
                label: band.band.replace(/_/g, " "),
                value: `${band.sharePct}%`,
                amount: band.sharePct,
              }))}
              tone={colors.green}
            />
          </MetricSection>

          <MetricSection
            title="Token insights"
            detail={`${insights?.tokenTrend24h.changePct ?? 0}% 24h trend - ${insights?.cacheEfficiency.cacheSharePct ?? 0}% cache`}
          >
            <View style={styles.metricMicroGrid}>
              <MetricMicro
                label="Top model share"
                value={`${insights?.topModel?.sharePct ?? 0}%`}
              />
              <MetricMicro
                label="Tool success"
                value={`${insights?.toolReliability.successRatePct ?? 100}%`}
              />
              <MetricMicro
                label="Context warnings"
                value={String(
                  insights?.contextHealth24h.warnings ?? overview?.contextHealth?.warnings ?? 0
                )}
              />
            </View>
          </MetricSection>

          <MetricSection title="Provider efficiency" detail="Tokens per provider call">
            <MetricShareRows rows={providerRows} tone={colors.blueText} />
          </MetricSection>
        </>
      ) : null}

      {activeMetricsSection === "runtime" ? (
        <>
          <MetricSection
            title="Provider plans"
            detail={`${providerPlanStatus?.summary?.configured ?? metrics?.providerPlans?.summary?.configured ?? 0} configured - ${
              providerPlanStatus?.summary?.warnings ??
              metrics?.providerPlans?.summary?.warnings ??
              0
            } warnings`}
          >
            <ProviderPlanMetricsGrid plans={providerPlanRows} />
          </MetricSection>

          <MetricSection title="Models" detail="Throughput, latency, and token share">
            <MetricShareRows rows={modelRows} tone={colors.amber} />
          </MetricSection>

          <MetricSection
            title="Chat runtime"
            detail={`${formatMetricNumber(sessionMetrics?.totals.callCount)} provider calls across ${formatMetricNumber(sessionMetrics?.totals.sessions)} chats`}
          >
            <View style={styles.metricMicroGrid}>
              <MetricMicro
                label="Input"
                value={formatMetricNumber(sessionMetrics?.totals.inputTokens)}
              />
              <MetricMicro
                label="Output"
                value={formatMetricNumber(sessionMetrics?.totals.outputTokens)}
              />
              <MetricMicro
                label="Model calls"
                value={formatMetricNumber(sessionMetrics?.totals.callCount)}
              />
              <MetricMicro
                label="Output speed"
                value={
                  sessionMetrics?.totals.tokensPerSecond === null ||
                  sessionMetrics?.totals.tokensPerSecond === undefined
                    ? "--"
                    : `${sessionMetrics.totals.tokensPerSecond} tok/s`
                }
              />
              <MetricMicro
                label="Average TTFT"
                value={mobileMetricLatency(sessionMetrics?.totals.firstTokenMs)}
              />
              <MetricMicro
                label="Compactions"
                value={formatMetricNumber(sessionMetrics?.totals.compactionCount)}
              />
              <MetricMicro
                label="Cache read"
                value={formatMetricNumber(sessionMetrics?.totals.cachedInputTokens)}
              />
              <MetricMicro
                label="Cache write"
                value={formatMetricNumber(sessionMetrics?.totals.cacheWriteTokens)}
              />
              <MetricMicro
                label="Compacted"
                value={formatMetricNumber(sessionMetrics?.totals.compactedTokens)}
              />
            </View>
            <MetricShareRows
              rows={(sessionMetrics?.sessions || []).slice(0, 10).map((session) => ({
                label: session.title,
                value: `${formatMetricNumber(session.inputTokens)} in · ${formatMetricNumber(session.outputTokens)} out`,
                detail: `${session.model || "Unknown model"} · ${session.tokensPerSecond === null ? "--" : `${session.tokensPerSecond} tok/s`} · ${mobileMetricLatency(session.firstTokenMs)}`,
                amount: session.totalTokens,
              }))}
              tone={colors.cyan}
            />
            {sessionPagination && sessionPagination.totalPages > 1 ? (
              <View style={styles.pagerRow}>
                <Text style={styles.counterText}>
                  Page {sessionPagination.page} of {sessionPagination.totalPages}
                </Text>
                <View style={styles.inlineButtonRow}>
                  <Pressable
                    style={[styles.smallButton, sessionRuntimeLoading && styles.controlDisabled]}
                    disabled={!sessionPagination.hasPreviousPage || sessionRuntimeLoading}
                    onPress={() => void loadSessionRuntimePage(sessionPagination.page - 1)}
                  >
                    <Text style={styles.smallButtonText}>Previous</Text>
                  </Pressable>
                  <Pressable
                    style={[styles.smallButton, sessionRuntimeLoading && styles.controlDisabled]}
                    disabled={!sessionPagination.hasNextPage || sessionRuntimeLoading}
                    onPress={() => void loadSessionRuntimePage(sessionPagination.page + 1)}
                  >
                    <Text style={styles.smallButtonText}>Next</Text>
                  </Pressable>
                </View>
              </View>
            ) : null}
          </MetricSection>

          <MetricSection
            title="Tools"
            detail={`${formatMetricNumber(overview?.toolCalls.totalCalls)} calls - ${formatMetricNumber(insights?.toolReliability.totalErrors)} errors`}
          >
            <MetricShareRows
              rows={(metrics?.tools?.mostUsed || []).slice(0, 7).map((tool) => ({
                label: tool.tool,
                value: `${formatMetricNumber(tool.calls)} calls`,
                amount: tool.calls,
              }))}
              tone={colors.green}
            />
            {metrics?.tools?.mostErrors?.length ? (
              <MetricShareRows
                rows={metrics.tools.mostErrors.slice(0, 4).map((tool) => ({
                  label: tool.tool,
                  value: `${formatMetricNumber(tool.errors)} errors`,
                  amount: tool.errors,
                }))}
                tone={colors.red}
              />
            ) : null}
          </MetricSection>

          <MetricSection
            title="Files"
            detail={`${formatMetricNumber(totalFileOperations(overview))} read/write/edit operations`}
          >
            <MetricShareRows
              rows={(metrics?.files?.mostRead || []).slice(0, 4).map((file) => ({
                label: file.path.split("/").pop() || file.path,
                value: `${formatMetricNumber(file.count)} reads`,
                amount: file.count,
              }))}
              tone={colors.cyan}
            />
            <MetricShareRows
              rows={[
                ...(metrics?.files?.mostWritten || []).slice(0, 2).map((file) => ({
                  label: file.path.split("/").pop() || file.path,
                  value: `${formatMetricNumber(file.count)} writes`,
                  amount: file.count,
                })),
                ...(metrics?.files?.mostEdited || []).slice(0, 2).map((file) => ({
                  label: file.path.split("/").pop() || file.path,
                  value: `${formatMetricNumber(file.count)} edits`,
                  amount: file.count,
                })),
              ]}
              tone={colors.amber}
            />
          </MetricSection>
        </>
      ) : null}

      {activeMetricsSection === "system" ? (
        <>
          <MetricSection title="Storage" detail={formatMetricBytes(metrics?.storage?.totalBytes)}>
            <MetricShareRows
              rows={storageRows.map((entry) => ({
                label: entry.label,
                value: formatMetricBytes(entry.bytes),
                detail: compactWorkspace(entry.path),
                amount: entry.bytes,
              }))}
              tone={colors.cyan}
            />
          </MetricSection>

          <MetricSection
            title="Token cloud"
            detail="Models, providers, tools, and recurring output terms"
          >
            <MetricTokenCloud entries={tokenAnalysis?.tokenCloud} />
          </MetricSection>
        </>
      ) : null}

      <View style={styles.subsectionHeader}>
        <Text style={styles.subsectionTitle}>Runtime checks</Text>
        <Text style={styles.counterText}>{checks.length}</Text>
      </View>
      {checks.length > 0 ? (
        checks.map(([key, value]) => {
          const record = value as Record<string, unknown>;
          const status =
            typeof record.status === "string" && record.status.trim()
              ? record.status
              : formatMobileValue(value);
          const detail = ["total", "running", "stopped"]
            .map((metric) =>
              typeof record[metric] === "number" ? `${metric} ${record[metric]}` : null
            )
            .filter(Boolean)
            .join(" - ");
          return (
            <View key={key} style={styles.listRow}>
              <View
                style={[
                  styles.listIcon,
                  {
                    backgroundColor:
                      status === "healthy" ? `${colors.green}18` : `${colors.amber}18`,
                  },
                ]}
              >
                <HeartPulse
                  color={status === "healthy" ? colors.green : colors.amber}
                  size={20}
                  strokeWidth={2.1}
                />
              </View>
              <View style={styles.listText}>
                <Text style={styles.listTitle}>{key}</Text>
                <Text style={styles.listDetail} numberOfLines={1}>
                  {detail || status}
                </Text>
              </View>
            </View>
          );
        })
      ) : (
        <LoadingState label="Loading metrics" detail="Waiting for gateway health checks." />
      )}

      <View style={styles.subsectionHeader}>
        <Text style={styles.subsectionTitle}>Recent signals</Text>
        <Pressable style={styles.smallButton} onPress={() => openSurface("logs")}>
          <Text style={styles.smallButtonText}>Logs</Text>
        </Pressable>
      </View>
      {recentLogs.length > 0 ? (
        recentLogs.map((log) => (
          <MetricsActivityRow
            key={log.id}
            Icon={ListTodo}
            title={log.title}
            detail={`${log.source} - ${log.createdAt ? relativeTimestamp(log.createdAt) : "recent"}`}
            state="Event"
            tone={accentColor}
            onPress={() => openSurface("logs")}
          />
        ))
      ) : (
        <EmptyState
          label="No recent signals"
          detail="Gateway logs have not reported activity yet."
        />
      )}

      <MetricSection
        title="Metric feeds"
        detail={`${availableMetrics}/${metricFeedCount} endpoints online`}
      >
        <MetricEndpointGrid availability={metrics?.availability} />
      </MetricSection>
    </StableDetailPanel>
  );
}

export function UsagePanel({
  accentColor,
  providerPlanError,
  providerPlanStatus,
}: {
  accentColor: string;
  providerPlanError: string | null;
  providerPlanStatus: ProviderPlanStatusResponse | null;
}) {
  const [customOrder, setCustomOrder] = useState<string[]>([]);

  useEffect(() => {
    void readUsageOrder().then(setCustomOrder);
  }, []);

  const movePlan = useCallback(
    (providerId: string, direction: -1 | 1) => {
      setCustomOrder((prevOrder) => {
        const baseRows = mobileProviderPlanRows(providerPlanStatus);
        const ids = sortPlanRows(baseRows, prevOrder).map((row) => row.id);
        const currentIndex = ids.indexOf(providerId);
        const targetIndex = currentIndex + direction;
        if (currentIndex < 0 || targetIndex < 0 || targetIndex >= ids.length) return prevOrder;
        const next = [...ids];
        const [moved] = next.splice(currentIndex, 1);
        if (!moved) return prevOrder;
        next.splice(targetIndex, 0, moved);
        void writeUsageOrder(next);
        return next;
      });
    },
    [providerPlanStatus]
  );

  const providerPlanRows = useMemo(
    () => sortPlanRows(mobileProviderPlanRows(providerPlanStatus), customOrder),
    [providerPlanStatus, customOrder]
  );

  if (!providerPlanStatus && !providerPlanError) {
    return (
      <StableDetailPanel>
        <LoadingState label="Loading usage" detail="Checking provider plan windows." />
      </StableDetailPanel>
    );
  }

  return (
    <StableDetailPanel>
      <View style={styles.summaryGrid}>
        <SummaryTile
          Icon={Gauge}
          label="Tracked"
          value={formatMetricNumber(providerPlanRows.length)}
          detail="Automatic plans"
          tone={accentColor}
        />
        <SummaryTile
          Icon={CheckCircle2}
          label="Configured"
          value={formatMetricNumber(providerPlanStatus?.summary?.configured)}
          detail="Ready providers"
          tone={colors.green}
        />
        <SummaryTile
          Icon={AlertTriangle}
          label="Warnings"
          value={formatMetricNumber(providerPlanStatus?.summary?.warnings)}
          detail="Near limits"
          tone={colors.amber}
        />
        <SummaryTile
          Icon={ShieldAlert}
          label="Exhausted"
          value={formatMetricNumber(providerPlanStatus?.summary?.exhausted)}
          detail="Hard stops"
          tone={colors.red}
        />
      </View>

      {providerPlanError ? (
        <EmptyState label="Usage unavailable" detail={providerPlanError} />
      ) : null}

      <MetricSection title="Provider usage" detail="5-hour and weekly coding-plan windows">
        <ProviderPlanMetricsGrid
          plans={providerPlanRows}
          onMoveUp={(id) => movePlan(id, -1)}
          onMoveDown={(id) => movePlan(id, 1)}
        />
      </MetricSection>
    </StableDetailPanel>
  );
}

type MobileProviderPlanRow = {
  id: string;
  providerName: string;
  planName: string;
  status: string;
  windows: Array<{
    label: string;
    value: string;
    progress: number;
    tone: string;
    reset: string | null;
  }>;
};

function mobileProviderPlanRows(
  providerPlanStatus: ProviderPlanStatusResponse | null
): MobileProviderPlanRow[] {
  return (
    providerPlanStatus?.providers
      .filter(
        (plan) =>
          plan.managedAutomatically &&
          (plan.monitored || plan.windows.length > 0 || plan.externalSourceAvailable)
      )
      .map((plan) => ({
        id: plan.providerId,
        providerName: plan.providerName,
        planName: plan.planName || plan.automaticTrackingLabel || "Automatic plan",
        status: plan.status,
        windows: [
          { label: "5h", kind: "rolling_5h" as const },
          { label: "Weekly", kind: "rolling_week" as const },
        ]
          .map(({ label, kind }) => {
            const usage = mobileProviderPlanWindowDisplay(plan, kind);
            if (!usage) return null;
            return { label, ...usage };
          })
          .filter((row): row is NonNullable<typeof row> => row !== null),
      }))
      .filter((plan) => plan.windows.length > 0) ?? []
  );
}

function ProviderPlanMetricsGrid({
  plans,
  onMoveUp,
  onMoveDown,
}: {
  plans: MobileProviderPlanRow[];
  onMoveUp?: (id: string) => void;
  onMoveDown?: (id: string) => void;
}) {
  if (plans.length === 0) {
    return <Text style={styles.settingsInfoText}>No provider plan data yet</Text>;
  }
  return (
    <View style={styles.providerPlanMetricsGrid}>
      {plans.map((plan, index) => (
        <View key={plan.id} style={styles.providerPlanMetricsCard}>
          <View style={styles.providerPlanMetricsHeader}>
            <View style={styles.flexShrink}>
              <Text numberOfLines={1} style={styles.settingsInfoTitle}>
                {plan.providerName}
              </Text>
              <Text numberOfLines={1} style={styles.settingsInfoText}>
                {plan.planName}
              </Text>
            </View>
            {onMoveUp && onMoveDown ? (
              <View style={{ flexDirection: "row", gap: 2 }}>
                <Pressable
                  hitSlop={8}
                  disabled={index === 0}
                  onPress={() => onMoveUp(plan.id)}
                  style={{
                    opacity: index === 0 ? 0.3 : 1,
                    padding: 4,
                  }}
                >
                  <ArrowUp size={16} color={colors.textMuted} />
                </Pressable>
                <Pressable
                  hitSlop={8}
                  disabled={index === plans.length - 1}
                  onPress={() => onMoveDown(plan.id)}
                  style={{
                    opacity: index === plans.length - 1 ? 0.3 : 1,
                    padding: 4,
                  }}
                >
                  <ArrowDown size={16} color={colors.textMuted} />
                </Pressable>
              </View>
            ) : null}
            <Text numberOfLines={1} style={styles.providerPlanMetricsStatus}>
              {plan.status}
            </Text>
          </View>
          <View style={styles.providerPlanMetricsWindows}>
            {plan.windows.map((window) => (
              <View key={`${plan.id}-${window.label}`} style={styles.providerPlanMetricsWindow}>
                <View style={styles.providerPlanMetricsWindowHeader}>
                  <Text style={styles.settingsInfoText}>{window.label}</Text>
                  <Text style={[styles.routerSummaryValue, { color: window.tone }]}>
                    {window.value}
                  </Text>
                </View>
                <View style={styles.providerPlanUsageTrack}>
                  <View
                    style={[
                      styles.providerPlanUsageFill,
                      {
                        backgroundColor: window.tone,
                        width: `${Math.max(4, window.progress)}%`,
                      },
                    ]}
                  />
                </View>
                {window.reset ? (
                  <Text numberOfLines={1} style={styles.providerPlanMetricsReset}>
                    {window.reset}
                  </Text>
                ) : null}
              </View>
            ))}
          </View>
        </View>
      ))}
    </View>
  );
}

function MetricsPanelSkeleton({
  accentColor,
  counts,
  openSurface,
  summary,
}: {
  accentColor: string;
  counts: FeatureCounts;
  openSurface: (surface: MobileSurfaceKey) => void;
  summary: FeatureSummary | null;
}) {
  const health = summary?.health;
  const healthy = health?.status === "healthy";
  return (
    <StableDetailPanel>
      <View style={styles.summaryGrid}>
        <SummaryTile
          Icon={HeartPulse}
          label="Health"
          value={healthy ? "Healthy" : health ? "Check" : "Loading"}
          detail={endpointStatusLabel(summary?.availability.health)}
          tone={healthy ? colors.green : colors.amber}
        />
        <SummaryTile
          Icon={Cpu}
          label="Tokens"
          value="Loading"
          detail="Metrics snapshot"
          tone={accentColor}
        />
        <SummaryTile
          Icon={Zap}
          label="API"
          value="Loading"
          detail={`${counts.logs} events`}
          tone={colors.blueText}
        />
        <SummaryTile
          Icon={Database}
          label="Storage"
          value="Loading"
          detail="Gateway files"
          tone={colors.green}
        />
      </View>

      <View style={styles.metricSkeletonHero} accessibilityLabel="Loading metrics">
        <ActivityIndicator color={accentColor} size="small" />
        <View style={styles.metricSkeletonText}>
          <Text style={styles.subsectionTitle}>Loading metrics</Text>
          <Text style={styles.emptyDetail}>
            Token, model, provider, tool, and storage feeds are loading.
          </Text>
        </View>
      </View>

      <View style={styles.metricSkeletonGrid}>
        {["Token flow", "Activity trend", "Token velocity", "Provider plans"].map((label) => (
          <View key={label} style={styles.metricSkeletonBlock}>
            <View style={styles.metricSkeletonHeader}>
              <View style={styles.metricSkeletonTitle} />
              <Text style={styles.counterText}>{label}</Text>
            </View>
            <View style={styles.metricSkeletonTrack} />
            <View style={styles.metricSkeletonTrackShort} />
            <View style={styles.metricSkeletonPills}>
              <View style={styles.metricSkeletonPill} />
              <View style={styles.metricSkeletonPill} />
              <View style={styles.metricSkeletonPillNarrow} />
            </View>
          </View>
        ))}
      </View>

      <View style={styles.subsectionHeader}>
        <Text style={styles.subsectionTitle}>Recent signals</Text>
        <Pressable style={styles.smallButton} onPress={() => openSurface("logs")}>
          <Text style={styles.smallButtonText}>Logs</Text>
        </Pressable>
      </View>
      <LoadingState label="Loading metrics" detail="Live signals are still available from Logs." />
    </StableDetailPanel>
  );
}

function MetricsActivityRow({
  Icon,
  title,
  detail,
  state,
  tone,
  onPress,
}: {
  Icon: IconGlyph;
  title: string;
  detail: string;
  state: string;
  tone: string;
  onPress?: () => void;
}) {
  const Container = onPress ? Pressable : View;
  return (
    <Container style={styles.activityRow} onPress={onPress}>
      <View style={[styles.activityDot, { backgroundColor: tone }]} />
      <View style={styles.activityIcon}>
        <Icon color={colors.text} size={21} strokeWidth={2.1} />
      </View>
      <View style={styles.activityText}>
        <Text
          ellipsizeMode="tail"
          numberOfLines={MOBILE_RECENT_ACTIVITY_CHROME.truncateTitles ? 1 : undefined}
          style={styles.activityTitle}
        >
          {title}
        </Text>
        <Text ellipsizeMode="tail" numberOfLines={1} style={styles.activityDetail}>
          {detail}
        </Text>
      </View>
      <View style={[styles.statePill, { borderColor: `${tone}55`, backgroundColor: `${tone}17` }]}>
        <Text style={[styles.stateText, { color: tone }]}>{state}</Text>
      </View>
      {onPress ? <ChevronRight color={colors.textMuted} size={20} strokeWidth={2} /> : null}
    </Container>
  );
}

function compactWorkspace(value?: string | null): string {
  if (!value) return "No workspace";
  const parts = value.split(/[\\/]/).filter(Boolean);
  if (parts.length <= 2) return value;
  return `.../${parts.slice(-2).join("/")}`;
}

export function mobileProviderPlanDetail(
  plan?: ProviderPlanStatusResponse["providers"][number] | null
): string | null {
  if (!plan?.managedAutomatically) return null;
  const percentFor = (kind: "rolling_5h" | "rolling_week") => {
    const usage = mobileProviderPlanWindowDisplay(plan, kind);
    if (!usage) return "--";
    return usage.reset ? `${usage.value} (${usage.reset})` : usage.value;
  };
  return `Plan usage: 5h ${percentFor("rolling_5h")} · Weekly ${percentFor("rolling_week")}`;
}

function mobileProviderPlanWindowDisplay(
  plan: ProviderPlanStatusResponse["providers"][number] | null | undefined,
  kind: "rolling_5h" | "rolling_week"
): {
  value: string;
  progress: number;
  tone: string;
  reset: string | null;
} | null {
  if (!plan?.managedAutomatically) return null;
  const window = plan.windows.find(
    (entry) =>
      entry.kind === kind &&
      entry.usageKnown &&
      (entry.unlimited || typeof entry.usedPercent === "number")
  );
  if (!window || (!window.unlimited && typeof window.usedPercent !== "number")) return null;
  const progress = window.unlimited
    ? 100
    : Math.min(100, Math.max(0, Math.ceil(window.usedPercent ?? 0)));
  return {
    value: window.unlimited ? "∞" : `${progress}%`,
    progress,
    tone: mobilePlanUsageTone(progress, window.unlimited),
    reset: mobileProviderPlanResetLabel(window.resetsAt),
  };
}

function mobilePlanUsageTone(percent: number, unlimited = false): string {
  if (unlimited || percent < 40) return colors.green;
  if (percent < 65) return colors.blueText;
  if (percent < 80) return colors.amber;
  if (percent < 95) return accentPalette.orange;
  return colors.red;
}

function mobileProviderPlanResetLabel(resetsAt?: string): string | null {
  if (!resetsAt) return null;
  const resetMs = Date.parse(resetsAt);
  if (!Number.isFinite(resetMs)) return null;
  const diffMs = resetMs - Date.now();
  if (diffMs <= 0) return "reset ready";
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (diffMs < hour) return `${Math.max(1, Math.ceil(diffMs / minute))}m reset`;
  if (diffMs < day) {
    const hours = Math.floor(diffMs / hour);
    const minutes = Math.ceil((diffMs % hour) / minute);
    return minutes > 0 ? `${hours}h ${minutes}m reset` : `${hours}h reset`;
  }
  return `${Math.ceil(diffMs / day)}d reset`;
}
