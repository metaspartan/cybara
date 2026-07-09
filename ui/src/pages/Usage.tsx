import { PageLayout } from "@/components/layout/PageLayout";
import { providerPlansApi } from "@/lib/api";
import {
  providerPlanUsageClasses,
  providerPlanWindowDisplay,
  type ProviderPlanWindowDisplay,
} from "@/lib/providerPlanDisplay";
import { cn } from "@/lib/utils";
import type { ProviderPlanSnapshot, ProviderPlanStatusResponse } from "@/types";
import { AlertTriangle, Gauge } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

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

export function Usage() {
  const [status, setStatus] = useState<ProviderPlanStatusResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setError(null);
    try {
      const response = await providerPlansApi.status();
      if (!response.success || !response.data) {
        throw new Error(response.error || "Failed to load usage");
      }
      setStatus(response.data);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    const interval = window.setInterval(() => void load(), 30000);
    return () => window.clearInterval(interval);
  }, []);

  const plans = useMemo(
    () => (status?.providers ?? []).filter(planHasUsage).sort(sortPlans),
    [status?.providers]
  );

  return (
    <PageLayout title="Usage" subtitle="Coding plan windows and provider limits">
      {loading ? (
        <UsageSkeleton />
      ) : error ? (
        <div className="rounded-xl border border-red-400/20 bg-red-500/10 p-4 text-sm text-red-100">
          <div className="flex items-center gap-2 font-semibold">
            <AlertTriangle className="h-4 w-4" />
            Usage unavailable
          </div>
          <p className="mt-2 text-red-100/80">{error}</p>
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
          <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
            {plans.map((plan) => (
              <UsageProviderCard key={plan.providerId} plan={plan} />
            ))}
          </div>
        </div>
      )}
    </PageLayout>
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

function UsageProviderCard({ plan }: { plan: ProviderPlanSnapshot }) {
  const fiveHour = providerPlanWindowDisplay(plan, "rolling_5h");
  const weekly = providerPlanWindowDisplay(plan, "rolling_week");
  const statusTone =
    plan.status === "exhausted"
      ? "text-red-200 bg-red-400/10 border-red-400/20"
      : plan.status === "warning"
        ? "text-yellow-200 bg-yellow-400/10 border-yellow-400/20"
        : plan.status === "ok"
          ? "text-emerald-200 bg-emerald-400/10 border-emerald-400/20"
          : "text-gray-300 bg-white/5 border-white/10";

  return (
    <section className="rounded-2xl border border-white/10 bg-[#101018] p-4 shadow-[0_18px_70px_rgba(0,0,0,0.25)]">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="truncate text-sm font-semibold text-white">{plan.providerName}</h2>
          <p className="mt-1 truncate text-xs text-gray-500">
            {plan.planName || plan.automaticTrackingLabel || "Automatic plan"}
          </p>
        </div>
        <span
          className={cn("rounded-full border px-2.5 py-1 text-[11px] font-semibold", statusTone)}
        >
          {plan.status}
        </span>
      </div>
      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <UsageWindow label="5h" usage={fiveHour} />
        <UsageWindow label="Weekly" usage={weekly} />
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-2 text-[11px] text-gray-500">
        <span>{plan.sourceLabel}</span>
        {plan.updatedAt ? <span>Updated {new Date(plan.updatedAt).toLocaleString()}</span> : null}
      </div>
    </section>
  );
}

function UsageWindow({ label, usage }: { label: string; usage: ProviderPlanWindowDisplay }) {
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
