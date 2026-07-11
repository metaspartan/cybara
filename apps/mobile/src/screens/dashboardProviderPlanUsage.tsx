import { Text, View } from "react-native";
import type { ProviderPlanStatusResponse } from "../lib/api";
import { formatMetricNumber } from "../lib/metrics";
import { accentPalette, colors } from "../theme/liquidGlass";
import { styles } from "./dashboardStyles";

type MobileProviderPlanUsageRow = {
  label: string;
  value: string;
  progress: number;
  reset: string | null;
  tone: string;
};

type MobileProviderPlan = ProviderPlanStatusResponse["providers"][number];
type MobileProviderPlanPreset = MobileProviderPlan["presetSuggestions"][number];

function providerPlanWindowUsage(
  plan: MobileProviderPlan | null,
  kind: "rolling_5h" | "rolling_week",
  label: string
): MobileProviderPlanUsageRow | null {
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
    label,
    value: window.unlimited ? "∞" : `${progress}%`,
    progress,
    reset: mobilePlanResetLabel(window.resetsAt),
    tone: providerPlanUsageTone(progress, window.unlimited),
  };
}

function providerPlanWindowValue(
  plan: MobileProviderPlan | null,
  kind: "rolling_5h" | "rolling_week"
): string {
  const usage = providerPlanWindowUsage(plan, kind, kind === "rolling_5h" ? "5h" : "Weekly");
  if (!usage) return "--";
  return usage.reset ? `${usage.value} (${usage.reset})` : usage.value;
}

function providerPlanUsageTone(progress: number, unlimited = false): string {
  if (unlimited || progress < 40) return colors.green;
  if (progress < 65) return colors.blueText;
  if (progress < 80) return colors.amber;
  if (progress < 95) return accentPalette.orange;
  return colors.red;
}

export function providerPlanUsageRows(
  plan: MobileProviderPlan | null
): MobileProviderPlanUsageRow[] {
  return [
    providerPlanWindowUsage(plan, "rolling_5h", "5h"),
    providerPlanWindowUsage(plan, "rolling_week", "Weekly"),
  ].filter((row): row is MobileProviderPlanUsageRow => row !== null);
}

export function providerPlanUsageSummary(plan: MobileProviderPlan | null): string | null {
  if (!plan?.managedAutomatically) return null;
  return `5h ${providerPlanWindowValue(plan, "rolling_5h")} · Weekly ${providerPlanWindowValue(
    plan,
    "rolling_week"
  )}`;
}

export function ProviderPlanUsageGrid({ rows }: { rows: MobileProviderPlanUsageRow[] }) {
  if (rows.length === 0) return null;
  return (
    <View style={styles.providerPlanUsageGrid}>
      {rows.map((row) => (
        <View key={row.label} style={styles.providerPlanUsageCard}>
          <View style={styles.providerPlanUsageHeader}>
            <Text style={styles.settingsInfoText}>{row.label}</Text>
            <Text style={[styles.routerSummaryValue, { color: row.tone }]}>{row.value}</Text>
          </View>
          <View style={styles.providerPlanUsageTrack}>
            <View
              style={[
                styles.providerPlanUsageFill,
                { backgroundColor: row.tone, width: `${Math.max(4, row.progress)}%` },
              ]}
            />
          </View>
          {row.reset ? <Text style={styles.settingsFieldHelp}>{row.reset}</Text> : null}
        </View>
      ))}
    </View>
  );
}

export function mobilePlanResetLabel(resetsAt?: string): string | null {
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

export function providerPlanPresetLimitLabel(preset: MobileProviderPlanPreset): string {
  if (preset.monthlyTokenLimit) return `${formatMetricNumber(preset.monthlyTokenLimit)} tokens/mo`;
  if (preset.monthlySpendLimit) return `$${preset.monthlySpendLimit}/mo credits`;
  if (preset.routeLimitWeekly) return `${formatMetricNumber(preset.routeLimitWeekly)} req/week`;
  if (preset.routeLimit5h) return `${formatMetricNumber(preset.routeLimit5h)} req/5h`;
  return "Provider-managed";
}
