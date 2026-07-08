import { useState } from "react";
import { CheckCircle2, ChevronDown, ChevronUp, ListChecks, Loader2 } from "lucide-react";
import { formatRelativeTime } from "@/lib/utils";
import type { SessionPlanView } from "./chatModel";

function cn(...classes: (string | boolean | undefined)[]) {
  return classes.filter(Boolean).join(" ");
}

function planProgressLabel(plan: SessionPlanView): string {
  if (plan.summary.total === 0) return "No tasks";
  return `${plan.summary.completed}/${plan.summary.total} complete`;
}

function currentPlanItem(plan: SessionPlanView): string {
  return (
    plan.items.find((item) => item.status === "in_progress")?.content ||
    plan.items.find((item) => item.status === "pending")?.content ||
    plan.items[plan.items.length - 1]?.content ||
    "No active task"
  );
}

function PlanStatusIcon({ status }: { status: SessionPlanView["items"][number]["status"] }) {
  if (status === "completed") {
    return <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-gray-400" />;
  }
  if (status === "in_progress") {
    return <Loader2 className="mt-0.5 h-3.5 w-3.5 shrink-0 animate-spin text-gray-300" />;
  }
  return <span className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-gray-500" />;
}

export function PlanSummaryCard({
  plan,
  compact = false,
}: {
  plan: SessionPlanView;
  compact?: boolean;
}) {
  const [expanded, setExpanded] = useState(!compact);
  const progressPercent =
    plan.summary.total > 0 ? Math.round((plan.summary.completed / plan.summary.total) * 100) : 0;

  return (
    <div
      className={cn(
        "overflow-hidden rounded-lg border border-white/10 bg-white/[0.025]",
        compact ? "mb-2" : ""
      )}
    >
      <button
        type="button"
        onClick={() => setExpanded((value) => !value)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-[12px] transition-colors hover:bg-white/[0.04]"
        aria-expanded={expanded}
      >
        <ListChecks className="h-3.5 w-3.5 shrink-0 text-gray-300" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="font-medium text-gray-200">Plan</span>
            <span className="text-gray-500">{planProgressLabel(plan)}</span>
          </div>
          {compact && (
            <p className="mt-0.5 truncate text-[11px] text-gray-400">{currentPlanItem(plan)}</p>
          )}
        </div>
        {plan.updatedAt && (
          <span className="hidden shrink-0 text-[10px] text-gray-600 sm:inline">
            {formatRelativeTime(plan.updatedAt)}
          </span>
        )}
        {expanded ? (
          <ChevronUp className="h-3.5 w-3.5 shrink-0 text-gray-500" />
        ) : (
          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-gray-500" />
        )}
      </button>
      <div className="h-px bg-white/5">
        <div
          className="h-px bg-gray-400/60 transition-[width]"
          style={{ width: `${progressPercent}%` }}
        />
      </div>
      {expanded && (
        <div className="space-y-1 border-t border-white/5 px-3 py-2">
          {plan.items.map((item, index) => (
            <div key={`${item.status}-${index}-${item.content}`} className="flex items-start gap-2">
              <PlanStatusIcon status={item.status} />
              <div className="min-w-0 flex-1">
                <p
                  className={cn(
                    "text-[12px] leading-5",
                    item.status === "completed" ? "text-gray-500 line-through" : "text-gray-300"
                  )}
                >
                  {item.content}
                </p>
              </div>
              <span className="shrink-0 rounded border border-white/10 px-1.5 py-0.5 text-[10px] capitalize text-gray-500">
                {item.priority}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
