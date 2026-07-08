import type { ProviderPlanSnapshot, ProviderPlanWindow } from "@/types";

export interface ProviderPlanWindowDisplay {
  percent: number | null;
  value: string;
  unlimited: boolean;
  resetLabel: string | null;
}

export type ProviderPlanUsageLevel =
  | "unknown"
  | "green"
  | "blue"
  | "yellow"
  | "orange"
  | "red";

export interface ProviderPlanUsageClasses {
  level: ProviderPlanUsageLevel;
  borderClass: string;
  bgClass: string;
  textClass: string;
  fillClass: string;
}

const PROVIDER_PLAN_USAGE_CLASSES: Record<ProviderPlanUsageLevel, ProviderPlanUsageClasses> = {
  unknown: {
    level: "unknown",
    borderClass: "border-white/10",
    bgClass: "bg-white/[0.03]",
    textClass: "text-gray-500",
    fillClass: "bg-gray-500/40",
  },
  green: {
    level: "green",
    borderClass: "border-emerald-400/20",
    bgClass: "bg-emerald-400/10",
    textClass: "text-emerald-200",
    fillClass: "bg-emerald-300/80",
  },
  blue: {
    level: "blue",
    borderClass: "border-sky-400/20",
    bgClass: "bg-sky-400/10",
    textClass: "text-sky-200",
    fillClass: "bg-sky-300",
  },
  yellow: {
    level: "yellow",
    borderClass: "border-yellow-400/25",
    bgClass: "bg-yellow-400/10",
    textClass: "text-yellow-200",
    fillClass: "bg-yellow-300",
  },
  orange: {
    level: "orange",
    borderClass: "border-orange-400/25",
    bgClass: "bg-orange-400/10",
    textClass: "text-orange-200",
    fillClass: "bg-orange-300",
  },
  red: {
    level: "red",
    borderClass: "border-red-400/25",
    bgClass: "bg-red-400/10",
    textClass: "text-red-200",
    fillClass: "bg-red-300",
  },
};

export function providerPlanUsageLevel(usage: ProviderPlanWindowDisplay): ProviderPlanUsageLevel {
  if (usage.unlimited) return "green";
  if (usage.percent === null) return "unknown";
  if (usage.percent < 40) return "green";
  if (usage.percent < 65) return "blue";
  if (usage.percent < 80) return "yellow";
  if (usage.percent < 95) return "orange";
  return "red";
}

export function providerPlanUsageClasses(
  usage: ProviderPlanWindowDisplay
): ProviderPlanUsageClasses {
  return PROVIDER_PLAN_USAGE_CLASSES[providerPlanUsageLevel(usage)];
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
