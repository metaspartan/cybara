import { useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { ProviderPlanSnapshot, SessionContextUsage } from "@/types";
import {
  providerPlanUsageClasses,
  providerPlanWindowDisplay,
  providerPlanWindowSummary,
  type ProviderPlanWindowDisplay,
} from "@/lib/providerPlanDisplay";

function formatTokenCount(value: number): string {
  if (!Number.isFinite(value)) return "0";
  if (Math.abs(value) >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (Math.abs(value) >= 1_000) return `${Math.round(value / 1_000)}k`;
  return String(Math.max(0, Math.round(value)));
}

function contextUsageLabel(usage?: SessionContextUsage | null): string {
  if (!usage) return "Context usage unavailable until this session is loaded.";
  const details = [
    `Active context: ${formatTokenCount(usage.usedTokens)} of ${formatTokenCount(
      usage.limitTokens
    )} tokens used (${usage.usedPercent}%). ${formatTokenCount(
      usage.remainingTokens
    )} tokens remaining.`,
  ];
  if (usage.compacted && (usage.compactionCount || 0) > 0) {
    details.push(
      `Compacted ${usage.compactionCount} time${usage.compactionCount === 1 ? "" : "s"}.`
    );
  }
  if ((usage.metadataTokens || 0) > 0) {
    details.push(
      `${formatTokenCount(usage.metadataTokens || 0)} transcript metadata tokens are not replayed to the model.`
    );
  }
  return details.join(" ");
}

function contextUsageDetailRows(usage?: SessionContextUsage | null): Array<string> {
  if (!usage) return [];
  const rows: string[] = [];
  if (usage.compacted && (usage.compactionCount || 0) > 0) {
    rows.push(`Compacted ${usage.compactionCount} time${usage.compactionCount === 1 ? "" : "s"}`);
  }
  if ((usage.compactedTokens || 0) > 0) {
    rows.push(
      `${formatTokenCount(usage.compactedTokens || 0)} tokens summarized out of the active window`
    );
  }
  if ((usage.metadataTokens || 0) > 0 && (usage.transcriptTokens || 0) > usage.usedTokens) {
    rows.push(
      `${formatTokenCount(usage.metadataTokens || 0)} tool/timeline metadata tokens not replayed`
    );
  }
  return rows;
}

function contextUsagePrimaryDetail(usage: SessionContextUsage): string {
  return `${formatTokenCount(usage.usedTokens)} / ${formatTokenCount(
    usage.limitTokens
  )} active tokens`;
}

function providerPlanTooltipRows(
  plan?: ProviderPlanSnapshot | null
): Array<{ label: string; usage: ProviderPlanWindowDisplay }> {
  if (!plan?.managedAutomatically) return [];
  return [
    { label: "5h", usage: providerPlanWindowDisplay(plan, "rolling_5h") },
    { label: "Weekly", usage: providerPlanWindowDisplay(plan, "rolling_week") },
  ].filter(({ usage }) => usage.unlimited || usage.percent !== null);
}

function contextUsageTooltip(
  usage?: SessionContextUsage | null,
  providerPlan?: ProviderPlanSnapshot | null
) {
  const planDetail = providerPlanWindowSummary(providerPlan);
  const planRows = providerPlanTooltipRows(providerPlan);
  if (!usage) {
    return {
      percent: "?",
      title: "Context window:",
      body: "Not loaded yet",
      detail: "Open a session or send a message to estimate usage.",
      detailRows: [],
      planDetail,
      planRows,
    };
  }
  const percent = Math.min(100, Math.max(0, usage.usedPercent));
  const detailRows = contextUsageDetailRows(usage);
  return {
    percent: `${Math.round(percent)}%`,
    title: "Context window:",
    body: `${Math.round(percent)}% full`,
    detail: contextUsagePrimaryDetail(usage),
    detailRows,
    planDetail,
    planRows,
  };
}

function ProviderPlanTooltipBar({
  label,
  usage,
}: {
  label: string;
  usage: ProviderPlanWindowDisplay;
}) {
  const classes = providerPlanUsageClasses(usage);
  const width = usage.unlimited ? 100 : (usage.percent ?? 0);
  return (
    <div className="context-usage-tooltip-plan-bar">
      <div className="flex items-center justify-between gap-3 text-[11px]">
        <span className="text-gray-500">{label}</span>
        <span className={`font-semibold tabular-nums ${classes.textClass}`}>{usage.value}</span>
      </div>
      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-white/10">
        <div
          className={`h-full rounded-full ${classes.fillClass}`}
          style={{ width: `${Math.max(usage.unlimited ? 100 : 2, width)}%` }}
        />
      </div>
      {usage.resetLabel && (
        <div className="mt-0.5 truncate text-[10px] text-gray-500">{usage.resetLabel}</div>
      )}
    </div>
  );
}

export function ContextUsageRing({
  usage,
  providerPlan,
}: {
  usage?: SessionContextUsage | null;
  providerPlan?: ProviderPlanSnapshot | null;
}) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<{
    left: number;
    placement: "above" | "below";
    top: number;
  } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const tooltipId = useId();
  const percent = usage ? Math.min(100, Math.max(0, usage.usedPercent)) : 0;
  const color =
    percent >= 90
      ? "var(--context-ring-danger)"
      : percent >= 70
        ? "var(--context-ring-warn)"
        : "var(--context-ring-ok)";
  const tooltip = contextUsageTooltip(usage, providerPlan);
  const label = contextUsageLabel(usage);
  useLayoutEffect(() => {
    if (!open) {
      setPosition(null);
      return;
    }
    const updatePosition = (): void => {
      const trigger = triggerRef.current;
      if (!trigger) return;
      const rect = trigger.getBoundingClientRect();
      const tooltipWidth = Math.min(280, window.innerWidth - 16);
      const halfWidth = tooltipWidth / 2;
      const placement = rect.top >= 180 ? "above" : "below";
      setPosition({
        left: Math.min(
          window.innerWidth - halfWidth - 8,
          Math.max(halfWidth + 8, rect.left + rect.width / 2)
        ),
        placement,
        top: placement === "above" ? rect.top - 10 : rect.bottom + 10,
      });
    };
    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [open]);

  const tooltipContent = position ? (
    <div
      id={tooltipId}
      role="tooltip"
      className="context-usage-tooltip pointer-events-none fixed z-[200] w-max max-w-[min(280px,calc(100vw-16px))] rounded-lg border px-3 py-2 text-center text-[12px] leading-5"
      style={{
        left: position.left,
        top: position.top,
        transform: position.placement === "above" ? "translate(-50%, -100%)" : "translateX(-50%)",
      }}
    >
      <div className="context-usage-tooltip-title">{tooltip.title}</div>
      <div className="context-usage-tooltip-body font-medium">{tooltip.body}</div>
      <div className="context-usage-tooltip-detail">{tooltip.detail}</div>
      {tooltip.detailRows.length > 0 && (
        <div className="mt-1 space-y-0.5 text-left text-[11px] leading-4">
          {tooltip.detailRows.map((row) => (
            <div key={row} className="context-usage-tooltip-detail">
              {row}
            </div>
          ))}
        </div>
      )}
      {tooltip.planRows.length > 0 && (
        <div className="context-usage-tooltip-plan mt-2 space-y-1.5 border-t pt-2 text-left">
          <div className="text-[11px] font-medium">Plan usage</div>
          {tooltip.planRows.map(({ label, usage }) => (
            <ProviderPlanTooltipBar key={label} label={label} usage={usage} />
          ))}
          {tooltip.planDetail && <div className="sr-only">Plan usage: {tooltip.planDetail}</div>}
        </div>
      )}
    </div>
  ) : null;
  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-label={label}
        aria-describedby={open ? tooltipId : undefined}
        aria-expanded={open}
        className="relative h-5 w-5 shrink-0 appearance-none rounded-full border-0 bg-transparent p-0 outline-none"
        onBlur={() => setOpen(false)}
        onClick={() => setOpen((current) => !current)}
        onFocus={() => setOpen(true)}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        tabIndex={0}
      >
        <div
          className="absolute inset-[3px] rounded-full p-[1.5px]"
          style={{
            background: `conic-gradient(${color} ${percent * 3.6}deg, var(--context-ring-track) 0deg)`,
          }}
        >
          <div className="context-usage-ring-fill h-full w-full rounded-full" />
        </div>
      </button>
      {tooltipContent && typeof document !== "undefined"
        ? createPortal(tooltipContent, document.body)
        : null}
    </>
  );
}
