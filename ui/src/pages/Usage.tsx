import { PageLayout } from "@/components/layout/PageLayout";
import { ProviderIcon, hasProviderIcon } from "@/components/ProviderIcon";
import { UsageGauge } from "@/components/UsageGauge";
import { providerPlansApi } from "@/lib/api";
import {
  providerPlanUsageClasses,
  providerPlanUsageLevel,
  providerPlanWindowDisplay,
  type ProviderPlanWindowDisplay,
} from "@/lib/providerPlanDisplay";
import { cn } from "@/lib/utils";
import type { ProviderPlanSnapshot, ProviderPlanStatusResponse } from "@/types";
import { AlertTriangle, BarChart3, Cloud, Gauge, List } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";

type UsageViewMode = "bars" | "gauges" | "compact";

const USAGE_VIEW_STORAGE_KEY = "cybara-usage-view";
const VALID_VIEW_MODES = new Set<UsageViewMode>(["bars", "gauges", "compact"]);

function readUsageViewMode(): UsageViewMode {
  if (typeof window === "undefined") return "bars";
  const stored = window.localStorage.getItem(USAGE_VIEW_STORAGE_KEY);
  return stored && VALID_VIEW_MODES.has(stored as UsageViewMode)
    ? (stored as UsageViewMode)
    : "bars";
}

function planHasUsage(plan: ProviderPlanSnapshot): boolean {
  return (
    plan.managedAutomatically &&
    (Boolean(plan.configuredProviderId) ||
      plan.monitored ||
      plan.externalSourceAvailable ||
      plan.windows.some((window) => window.usageKnown))
  );
}

function sortPlans(a: ProviderPlanSnapshot, b: ProviderPlanSnapshot) {
  const statusRank = (status: ProviderPlanSnapshot["status"]) =>
    status === "exhausted" ? 0 : status === "warning" ? 1 : status === "ok" ? 2 : 3;
  return (
    statusRank(a.status) - statusRank(b.status) ||
    a.providerName.localeCompare(b.providerName, undefined, { sensitivity: "base" })
  );
}

function statusToneClass(status: ProviderPlanSnapshot["status"]): string {
  if (status === "exhausted") return "text-red-200 bg-red-400/10 border-red-400/20";
  if (status === "warning") return "text-yellow-200 bg-yellow-400/10 border-yellow-400/20";
  if (status === "ok") return "text-emerald-200 bg-emerald-400/10 border-emerald-400/20";
  return "text-gray-300 bg-white/5 border-white/10";
}

export function Usage() {
  const {
    data: status,
    isLoading,
    isError,
    error,
  } = useQuery<ProviderPlanStatusResponse>({
    queryKey: ["provider-plan-status"],
    queryFn: async () => {
      const response = await providerPlansApi.status();
      if (!response.success || !response.data) {
        throw new Error(response.error || "Failed to load usage");
      }
      return response.data;
    },
    staleTime: 15_000,
    gcTime: 30 * 60_000,
    refetchInterval: 30_000,
    refetchIntervalInBackground: true,
    refetchOnWindowFocus: true,
    refetchOnMount: true,
  });

  const [viewMode, setViewMode] = useState<UsageViewMode>("bars");

  useEffect(() => {
    setViewMode(readUsageViewMode());
  }, []);

  useEffect(() => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(USAGE_VIEW_STORAGE_KEY, viewMode);
    }
  }, [viewMode]);

  const plans = useMemo(
    () => (status?.providers ?? []).filter(planHasUsage).sort(sortPlans),
    [status?.providers]
  );

  const showSkeleton = isLoading && !status;
  const showError = isError && !status;
  const errorMessage = error instanceof Error ? error.message : String(error ?? "");

  const viewToggle = <ViewToggle mode={viewMode} onChange={setViewMode} />;

  return (
    <PageLayout
      title="Usage"
      subtitle="Coding plan windows and provider limits"
      actions={viewToggle}
    >
      {showSkeleton ? (
        <UsageSkeleton />
      ) : showError ? (
        <div className="rounded-xl border border-red-400/20 bg-red-500/10 p-4 text-sm text-red-100">
          <div className="flex items-center gap-2 font-semibold">
            <AlertTriangle className="h-4 w-4" />
            Usage unavailable
          </div>
          <p className="mt-2 text-red-100/80">{errorMessage}</p>
        </div>
      ) : plans.length === 0 ? (
        <div className="flex min-h-[360px] items-center justify-center rounded-2xl border border-white/10 bg-white/[0.03] p-8 text-center">
          <div className="max-w-sm">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-white/5 text-gray-400">
              <Gauge className="h-5 w-5" />
            </div>
            <h2 className="mt-4 text-base font-semibold text-white">No automatic usage yet</h2>
            <p className="mt-2 text-sm leading-6 text-gray-400">
              Connect a supported OAuth coding-plan provider and usage will appear here
              automatically.
            </p>
          </div>
        </div>
      ) : (
        <div className="space-y-5">
          <UsageSummary status={status} plans={plans} />
          {viewMode === "compact" ? (
            <div className="overflow-hidden rounded-2xl border border-white/10 bg-[#101018] shadow-[0_18px_70px_rgba(0,0,0,0.25)]">
              {plans.map((plan, index) => (
                <CompactProviderRow
                  key={plan.providerId}
                  plan={plan}
                  isLast={index === plans.length - 1}
                />
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
              {plans.map((plan) => (
                <UsageProviderCard key={plan.providerId} plan={plan} mode={viewMode} />
              ))}
            </div>
          )}
        </div>
      )}
    </PageLayout>
  );
}

function ViewToggle({
  mode,
  onChange,
}: {
  mode: UsageViewMode;
  onChange: (mode: UsageViewMode) => void;
}) {
  const options: { value: UsageViewMode; icon: typeof BarChart3; label: string }[] = [
    { value: "bars", icon: BarChart3, label: "Bars" },
    { value: "gauges", icon: Gauge, label: "Gauges" },
    { value: "compact", icon: List, label: "Compact" },
  ];
  return (
    <div className="inline-flex items-center gap-0.5 rounded-lg border border-white/10 bg-white/[0.04] p-0.5">
      {options.map((option) => {
        const Icon = option.icon;
        const active = mode === option.value;
        return (
          <button
            key={option.value}
            type="button"
            onClick={() => onChange(option.value)}
            className={cn(
              "inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium transition-colors",
              active
                ? "bg-white/10 text-white"
                : "text-gray-500 hover:bg-white/5 hover:text-gray-300"
            )}
            title={`${option.label} layout`}
            aria-pressed={active}
          >
            <Icon className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">{option.label}</span>
          </button>
        );
      })}
    </div>
  );
}

function UsageSummary({
  status,
  plans,
}: {
  status: ProviderPlanStatusResponse | null;
  plans: ProviderPlanSnapshot[];
}) {
  const warningCount = plans.filter((plan) => plan.status === "warning").length;
  const exhaustedCount = plans.filter((plan) => plan.status === "exhausted").length;
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <UsageStat label="Tracked providers" value={String(plans.length)} />
      <UsageStat label="Configured" value={String(status?.summary.configured ?? 0)} />
      <UsageStat label="Warnings" value={String(warningCount)} tone="warning" />
      <UsageStat label="Exhausted" value={String(exhaustedCount)} tone="danger" />
    </div>
  );
}

function UsageStat({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: string;
  tone?: "default" | "warning" | "danger";
}) {
  return (
    <div
      className={cn(
        "rounded-xl border p-4",
        tone === "warning"
          ? "border-yellow-400/20 bg-yellow-400/10"
          : tone === "danger"
            ? "border-red-400/20 bg-red-400/10"
            : "border-white/10 bg-white/[0.04]"
      )}
    >
      <div className="text-xs font-medium uppercase tracking-wide text-gray-500">{label}</div>
      <div className="mt-2 text-2xl font-semibold tracking-tight text-white">{value}</div>
    </div>
  );
}

function ProviderAvatar({ providerType, size = 24 }: { providerType: string; size?: number }) {
  return (
    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/[0.06] border border-white/10 text-white">
      {hasProviderIcon(providerType) ? (
        <ProviderIcon provider={providerType} size={size} />
      ) : (
        <Cloud className="h-5 w-5 text-gray-400" />
      )}
    </div>
  );
}

function UsageProviderCard({ plan, mode }: { plan: ProviderPlanSnapshot; mode: UsageViewMode }) {
  const fiveHour = providerPlanWindowDisplay(plan, "rolling_5h");
  const weekly = providerPlanWindowDisplay(plan, "rolling_week");

  return (
    <section className="rounded-2xl border border-white/10 bg-[#101018] p-4 shadow-[0_18px_70px_rgba(0,0,0,0.25)]">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <ProviderAvatar providerType={plan.providerType} />
          <div className="min-w-0">
            <h2 className="truncate text-sm font-semibold text-white">{plan.providerName}</h2>
            <p className="mt-0.5 truncate text-xs text-gray-500">
              {plan.planName || plan.automaticTrackingLabel || "Automatic plan"}
            </p>
          </div>
        </div>
        <span
          className={cn(
            "shrink-0 rounded-full border px-2.5 py-1 text-[11px] font-semibold capitalize",
            statusToneClass(plan.status)
          )}
        >
          {plan.status}
        </span>
      </div>
      {mode === "gauges" ? (
        <div className="mt-5 flex items-center justify-around gap-3">
          <UsageGaugeMode label="5h" usage={fiveHour} />
          <UsageGaugeMode label="Weekly" usage={weekly} />
        </div>
      ) : (
        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <UsageBarMode label="5h" usage={fiveHour} />
          <UsageBarMode label="Weekly" usage={weekly} />
        </div>
      )}
      <div className="mt-4 flex flex-wrap items-center gap-2 text-[11px] text-gray-500">
        <span>{plan.sourceLabel}</span>
        {plan.updatedAt ? <span>Updated {new Date(plan.updatedAt).toLocaleString()}</span> : null}
      </div>
    </section>
  );
}

function UsageGaugeMode({ label, usage }: { label: string; usage: ProviderPlanWindowDisplay }) {
  const level = providerPlanUsageLevel(usage);
  return (
    <div className="flex flex-col items-center gap-2">
      <UsageGauge
        percent={usage.percent}
        unlimited={usage.unlimited}
        value={usage.value}
        label={label}
        level={level}
        size={104}
      />
      <span className="h-4 text-[11px] text-gray-500">{usage.resetLabel || ""}</span>
    </div>
  );
}

function UsageBarMode({ label, usage }: { label: string; usage: ProviderPlanWindowDisplay }) {
  const tone = providerPlanUsageClasses(usage);
  const progress = usage.unlimited ? 100 : (usage.percent ?? 0);
  return (
    <div className={cn("rounded-xl border p-3", tone.borderClass, tone.bgClass)}>
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs font-medium text-gray-400">{label}</span>
        <span className={cn("text-sm font-semibold tabular-nums", tone.textClass)}>
          {usage.value}
        </span>
      </div>
      <div className="mt-3 h-2 overflow-hidden rounded-full bg-white/10">
        <div
          className={cn("h-full rounded-full", tone.fillClass)}
          style={{ width: `${Math.max(usage.percent === null ? 0 : 3, progress)}%` }}
        />
      </div>
      <div className="mt-2 h-4 text-[11px] text-gray-500">{usage.resetLabel || ""}</div>
    </div>
  );
}

function CompactProviderRow({ plan, isLast }: { plan: ProviderPlanSnapshot; isLast: boolean }) {
  const fiveHour = providerPlanWindowDisplay(plan, "rolling_5h");
  const weekly = providerPlanWindowDisplay(plan, "rolling_week");
  return (
    <div
      className={cn(
        "flex items-center gap-3 px-4 py-3 transition-colors hover:bg-white/[0.02]",
        !isLast && "border-b border-white/5"
      )}
    >
      <ProviderAvatar providerType={plan.providerType} size={20} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium text-white">{plan.providerName}</span>
          <span
            className={cn(
              "shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold capitalize",
              statusToneClass(plan.status)
            )}
          >
            {plan.status}
          </span>
        </div>
        <p className="mt-0.5 truncate text-xs text-gray-500">
          {plan.planName || plan.automaticTrackingLabel || "Automatic plan"}
        </p>
      </div>
      <CompactUsagePill label="5h" usage={fiveHour} />
      <CompactUsagePill label="Weekly" usage={weekly} />
    </div>
  );
}

function CompactUsagePill({ label, usage }: { label: string; usage: ProviderPlanWindowDisplay }) {
  const tone = providerPlanUsageClasses(usage);
  const progress = usage.unlimited ? 100 : (usage.percent ?? 0);
  return (
    <div
      className={cn(
        "hidden w-[120px] shrink-0 rounded-lg border px-2.5 py-1.5 sm:block",
        tone.borderClass,
        tone.bgClass
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] font-medium uppercase tracking-wide text-gray-400">
          {label}
        </span>
        <span className={cn("text-xs font-bold tabular-nums", tone.textClass)}>{usage.value}</span>
      </div>
      <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-white/10">
        <div
          className={cn("h-full rounded-full", tone.fillClass)}
          style={{ width: `${Math.max(usage.percent === null ? 0 : 3, progress)}%` }}
        />
      </div>
    </div>
  );
}

function UsageSkeleton() {
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <div key={index} className="h-24 animate-pulse rounded-xl bg-white/[0.04]" />
        ))}
      </div>
      <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
        {Array.from({ length: 4 }).map((_, index) => (
          <div key={index} className="h-44 animate-pulse rounded-2xl bg-white/[0.04]" />
        ))}
      </div>
    </div>
  );
}
