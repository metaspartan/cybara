import type { ProviderPlanSnapshot, ProviderPlanWindow } from "@/types";

export interface ProviderPlanWindowDisplay {
  percent: number | null;
  value: string;
  unlimited: boolean;
  resetLabel: string | null;
}

export function formatProviderPlanReset(resetsAt?: string): string | null {
  if (!resetsAt) return null;
  const resetMs = Date.parse(resetsAt);
  if (!Number.isFinite(resetMs)) return null;
  const diffMs = resetMs - Date.now();
  if (diffMs <= 0) return "reset ready";
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (diffMs < hour) return `resets in ${Math.max(1, Math.ceil(diffMs / minute))}m`;
  if (diffMs < day) {
    const hours = Math.floor(diffMs / hour);
    const minutes = Math.ceil((diffMs % hour) / minute);
    return minutes > 0 ? `resets in ${hours}h ${minutes}m` : `resets in ${hours}h`;
  }
  return `resets in ${Math.ceil(diffMs / day)}d`;
}

export function providerPlanWindowDisplay(
  plan: ProviderPlanSnapshot,
  kind: ProviderPlanWindow["kind"]
): ProviderPlanWindowDisplay {
  const window = plan.windows.find(
    (entry) =>
      entry.kind === kind &&
      entry.usageKnown &&
      (entry.unlimited || typeof entry.usedPercent === "number")
  );
  const resetLabel = formatProviderPlanReset(window?.resetsAt);
  if (window?.unlimited) return { percent: null, value: "∞", unlimited: true, resetLabel };
  if (!window || typeof window.usedPercent !== "number") {
    return { percent: null, value: "--", unlimited: false, resetLabel: null };
  }
  const percent = Math.min(100, Math.max(0, Math.ceil(window.usedPercent)));
  return { percent, value: `${percent}%`, unlimited: false, resetLabel };
}

export function providerPlanWindowSummary(plan?: ProviderPlanSnapshot | null): string | null {
  if (!plan?.managedAutomatically) return null;
  const summaryFor = (kind: ProviderPlanWindow["kind"], label: string) => {
    const display = providerPlanWindowDisplay(plan, kind);
    const reset = display.resetLabel ? ` (${display.resetLabel})` : "";
    return `${label} ${display.value}${reset}`;
  };
  return `${summaryFor("rolling_5h", "5h")} · ${summaryFor("rolling_week", "Weekly")}`;
}
