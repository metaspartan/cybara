export function formatNumber(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return value.toString();
}

export function formatBytes(value: number): string {
  if (value >= 1024 * 1024 * 1024) return `${(value / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  if (value >= 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(2)} MB`;
  if (value >= 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${value} B`;
}

export function cacheReadSharePct(inputTokens: number, cachedInputTokens: number): number {
  if (!Number.isFinite(inputTokens) || inputTokens <= 0) return 0;
  if (!Number.isFinite(cachedInputTokens) || cachedInputTokens <= 0) return 0;
  return Math.min(100, (cachedInputTokens / inputTokens) * 100);
}
