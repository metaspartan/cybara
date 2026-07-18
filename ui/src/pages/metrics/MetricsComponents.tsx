import type { ReactNode } from "react";
import { ChevronLeft, ChevronRight, Clock } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/Card";
import type { SessionRuntimeMetrics } from "@/hooks/useApi";
import { cacheReadSharePct, formatNumber } from "./metricsFormatting";

export function MetricAreaChart({
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

export function MetricShareStack({
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
            style={{
              width: `${Math.max(row.value > 0 ? 2 : 0, (row.value / safeTotal) * 100)}%`,
            }}
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

export function MetricRankedRows({
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

function formatLatency(value: number | null): string {
  if (value === null) return "--";
  return value < 1000 ? `${Math.round(value)}ms` : `${(value / 1000).toFixed(1)}s`;
}

export function SessionRuntimeTable({
  metrics,
  loading,
  onPageChange,
}: {
  metrics?: SessionRuntimeMetrics;
  loading: boolean;
  onPageChange: (page: number) => void;
}) {
  const totals = metrics?.totals;
  const pagination = metrics?.pagination;
  const cacheShare = cacheReadSharePct(totals?.inputTokens || 0, totals?.cachedInputTokens || 0);
  return (
    <Card className="mb-8 overflow-hidden">
      <CardHeader className="border-b border-[var(--surface-border)]">
        <CardTitle className="flex items-center gap-2">
          <Clock className="h-5 w-5 text-cyan-400" />
          Chat Runtime
        </CardTitle>
        <CardDescription>
          Per-chat tokens, cache activity, generation speed, latency, and compaction
        </CardDescription>
      </CardHeader>
      <CardContent className="p-0">
        {loading ? (
          <div className="p-5">
            <MetricPanelSkeleton rows={5} />
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-px border-b border-[var(--surface-border)] bg-[var(--surface-border)] md:grid-cols-3 xl:grid-cols-6">
              {[
                ["Tracked chats", formatNumber(totals?.sessions || 0)],
                ["Provider calls", formatNumber(totals?.callCount || 0)],
                [
                  "Output speed",
                  totals?.tokensPerSecond ? `${totals.tokensPerSecond} tok/s` : "--",
                ],
                ["Average TTFT", formatLatency(totals?.firstTokenMs ?? null)],
                ["Cache read", `${cacheShare.toFixed(1)}%`],
                ["Compacted", formatNumber(totals?.compactedTokens || 0)],
              ].map(([label, value]) => (
                <div key={label} className="bg-[var(--surface-panel)] px-5 py-4">
                  <p className="text-xs text-[var(--text-muted)]">{label}</p>
                  <p className="mt-1 text-lg font-semibold tabular-nums text-gray-100">{value}</p>
                </div>
              ))}
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-[1040px] w-full text-left text-sm">
                <thead className="bg-[var(--surface-raised)] text-[11px] uppercase text-[var(--text-muted)]">
                  <tr>
                    <th className="px-5 py-3 font-medium">Chat</th>
                    <th className="px-4 py-3 font-medium">Provider / model</th>
                    <th className="px-4 py-3 text-right font-medium">Input</th>
                    <th className="px-4 py-3 text-right font-medium">Output</th>
                    <th className="px-4 py-3 text-right font-medium">Cache read / write</th>
                    <th className="px-4 py-3 text-right font-medium">Speed</th>
                    <th className="px-4 py-3 text-right font-medium">TTFT</th>
                    <th className="px-5 py-3 text-right font-medium">Compaction</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--surface-border)]">
                  {(metrics?.sessions || []).map((session) => (
                    <tr
                      key={session.sessionId}
                      className="transition-colors hover:bg-[var(--surface-hover)]"
                    >
                      <td className="max-w-[280px] px-5 py-3">
                        <p className="truncate font-medium text-gray-100">{session.title}</p>
                        <p className="mt-0.5 truncate text-xs text-gray-500">
                          {session.callCount} call
                          {session.callCount === 1 ? "" : "s"}
                        </p>
                      </td>
                      <td className="max-w-[220px] px-4 py-3">
                        <p className="truncate text-gray-300">{session.model || "Unknown model"}</p>
                        <p className="truncate text-xs text-gray-500">
                          {session.provider || "Unknown provider"}
                        </p>
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-gray-300">
                        {formatNumber(session.inputTokens)}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-gray-300">
                        {formatNumber(session.outputTokens)}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-[rgb(var(--accent-primary))]">
                        {formatNumber(session.cachedInputTokens)} /{" "}
                        {formatNumber(session.cacheWriteTokens)}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-gray-300">
                        {session.tokensPerSecond === null
                          ? "--"
                          : `${session.tokensPerSecond} tok/s`}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-gray-300">
                        {formatLatency(session.firstTokenMs)}
                      </td>
                      <td className="px-5 py-3 text-right tabular-nums text-gray-300">
                        {session.compactionCount > 0
                          ? `${session.compactionCount} · ${formatNumber(session.compactedTokens)}`
                          : "--"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {metrics?.sessions.length === 0 ? (
                <p className="px-5 py-10 text-center text-sm text-gray-500">
                  Runtime metrics appear after an agent completes a provider call.
                </p>
              ) : null}
            </div>
            {pagination && pagination.totalPages > 1 ? (
              <div className="flex items-center justify-between border-t border-[var(--surface-border)] px-5 py-3">
                <p className="text-xs text-[var(--text-muted)]">
                  Page {pagination.page} of {pagination.totalPages} · {pagination.totalItems} chats
                </p>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => onPageChange(pagination.page - 1)}
                    disabled={!pagination.hasPreviousPage || loading}
                    className="inline-flex h-8 w-8 items-center justify-center rounded-md text-[var(--text-secondary)] transition-colors hover:bg-[var(--surface-hover)] disabled:cursor-not-allowed disabled:opacity-35"
                    aria-label="Previous chat runtime page"
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => onPageChange(pagination.page + 1)}
                    disabled={!pagination.hasNextPage || loading}
                    className="inline-flex h-8 w-8 items-center justify-center rounded-md text-[var(--text-secondary)] transition-colors hover:bg-[var(--surface-hover)] disabled:cursor-not-allowed disabled:opacity-35"
                    aria-label="Next chat runtime page"
                  >
                    <ChevronRight className="h-4 w-4" />
                  </button>
                </div>
              </div>
            ) : null}
          </>
        )}
      </CardContent>
    </Card>
  );
}

export function MetricSkeletonLine({ className = "h-3 w-full" }: { className?: string }) {
  return <div className={`rounded-full bg-white/10 ${className}`} />;
}

export function MetricPanelSkeleton({ rows = 4 }: { rows?: number }) {
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

export function MetricRowsSkeleton({ rows = 4 }: { rows?: number }) {
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

export function MetricChartSkeleton() {
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

export function MetricHeatmapSkeleton() {
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

export function MetricCloudSkeleton() {
  const widths = ["w-16", "w-24", "w-20", "w-28", "w-14", "w-32", "w-20", "w-24"];
  return (
    <div className="flex animate-pulse flex-wrap gap-2" aria-label="Loading token cloud">
      {widths.map((width, index) => (
        <MetricSkeletonLine key={`${width}:${index}`} className={`h-8 ${width}`} />
      ))}
    </div>
  );
}

export function StatCard({
  icon,
  label,
  value,
  color,
  bgColor,
  loading,
}: {
  icon: ReactNode;
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

export function TokenBar({
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

export function FileStat({
  icon,
  label,
  value,
}: {
  icon: ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="text-center p-3 rounded-lg bg-white/5">
      <div className="text-gray-400 mb-1">{icon}</div>
      <p className="text-xl font-bold text-white">{value}</p>
      <p className="text-xs text-gray-500">{label}</p>
    </div>
  );
}

export function ActivityStat({
  icon,
  label,
  value,
}: {
  icon: ReactNode;
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
