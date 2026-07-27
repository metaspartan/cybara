export function formatNumber(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "0";
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return value.toString();
}

export function formatBytes(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "0 B";
  if (value >= 1024 * 1024 * 1024) return `${(value / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  if (value >= 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(2)} MB`;
  if (value >= 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${value} B`;
}

export interface MetricActivityRow {
  label: string;
  value: number;
  detail: string;
}

export function metricTokenActivityRows(
  days: Array<{ date: string; [key: string]: unknown }>
): MetricActivityRow[] {
  return days.map((day) => {
    const tokenUsage = typeof day.token_usage === "number" ? day.token_usage : 0;
    const toolCalls = typeof day.tool_call === "number" ? day.tool_call : 0;
    const apiCalls = typeof day.api_call === "number" ? day.api_call : 0;
    return {
      label: day.date,
      value: tokenUsage,
      detail: `${formatNumber(toolCalls)} tools · ${formatNumber(apiCalls)} API calls`,
    };
  });
}

export function cacheReadSharePct(inputTokens: number, cachedInputTokens: number): number {
  if (!Number.isFinite(inputTokens) || inputTokens <= 0) return 0;
  if (!Number.isFinite(cachedInputTokens) || cachedInputTokens <= 0) return 0;
  return Math.min(100, (cachedInputTokens / inputTokens) * 100);
}
