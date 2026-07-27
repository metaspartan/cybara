import type { AgentDatasetRun } from "@/lib/api";

const STANDARD_NUMBER_FORMAT = new Intl.NumberFormat(undefined, {
  notation: "standard",
  maximumFractionDigits: 1,
});
const COMPACT_NUMBER_FORMAT = new Intl.NumberFormat(undefined, {
  notation: "compact",
  maximumFractionDigits: 1,
});

export function formatDatasetMetricCount(value: number): string {
  return (value >= 10_000 ? COMPACT_NUMBER_FORMAT : STANDARD_NUMBER_FORMAT).format(value);
}

export function formatDatasetDuration(value: number): string {
  if (value < 1000) return `${Math.round(value)}ms`;
  if (value < 60_000) return `${(value / 1000).toFixed(1)}s`;
  return `${Math.floor(value / 60_000)}m ${Math.round((value % 60_000) / 1000)}s`;
}

export function datasetRunProviderLabel(provider: string | null): string | null {
  if (!provider) return null;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(provider)
    ? null
    : provider;
}

export function datasetRunIsActive(run: AgentDatasetRun): boolean {
  return run.status === "queued" || run.status === "running";
}
