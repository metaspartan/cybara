import { Ban, CheckCircle2, ChevronDown, Circle, Clock3, ListChecks, X } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import type { SessionPlanTimelineEntry, SessionPlanView } from "./chatModel";

type PlanSummaryCardPlan = SessionPlanTimelineEntry | SessionPlanView;

export function sessionPlanProgressLabel(plan: PlanSummaryCardPlan): string {
  if (plan.summary.total === 0) return "No tasks";
  return `${plan.summary.completed}/${plan.summary.total} complete`;
}

export function sessionPlanCurrentTask(plan: PlanSummaryCardPlan): string {
  const active = plan.items.filter((item) => item.status !== "cancelled");
  return (
    active.find((item) => item.status === "in_progress")?.content ||
    active.find((item) => item.status === "pending")?.content ||
    active[active.length - 1]?.content ||
    "No active task"
  );
}

function planProgress(plan: PlanSummaryCardPlan): number {
  return plan.summary.total > 0
    ? Math.round((plan.summary.completed / plan.summary.total) * 100)
    : 0;
}

function planItemIcon(status: PlanSummaryCardPlan["items"][number]["status"]) {
  if (status === "completed") return <CheckCircle2 className="h-3 w-3" />;
  if (status === "in_progress") return <Clock3 className="h-3 w-3" />;
  if (status === "cancelled") return <Ban className="h-3 w-3" />;
  return <Circle className="h-3 w-3" />;
}

export function PlanSummaryCard({
  compact = false,
  defaultExpanded = false,
  dismissible = false,
  expandable = false,
  onDismiss,
  plan,
  title,
}: {
  compact?: boolean;
  defaultExpanded?: boolean;
  dismissible?: boolean;
  expandable?: boolean;
  onDismiss?: () => void;
  plan: PlanSummaryCardPlan;
  title?: string;
}) {
  const { t } = useI18n();
  const cardTitle = title ?? t("chat.plan.title");
  const progressLabel =
    plan.summary.total === 0
      ? sessionPlanProgressLabel(plan)
      : t("chat.plan.progress", {
          completed: plan.summary.completed,
          total: plan.summary.total,
        });
  const progress = planProgress(plan);
  const currentTask = sessionPlanCurrentTask(plan);
  const canExpand = expandable && plan.items.length > 0;
  const body = (
    <>
      <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-[#050609]">
        <div className="h-full rounded-full bg-gray-400" style={{ width: `${progress}%` }} />
      </div>
      <p className={cn("mt-1.5 text-[12px] leading-5 text-gray-400", compact && "truncate")}>
        {currentTask}
      </p>
      {canExpand && (
        <div className="mt-2 space-y-1.5 border-t border-[#2b303b] pt-2">
          {plan.items.map((item, index) => (
            <div key={`${item.content}-${index}`} className="flex items-start gap-2 text-[12px]">
              <span className="mt-0.5 shrink-0 text-gray-500">{planItemIcon(item.status)}</span>
              <span
                className={cn(
                  "min-w-0 flex-1 leading-5 text-gray-300",
                  item.status === "completed" && "text-gray-500",
                  item.status === "cancelled" && "text-gray-600 line-through"
                )}
              >
                {item.content}
              </span>
              <span className="shrink-0 text-[10px] uppercase tracking-wide text-gray-600">
                {item.priority}
              </span>
            </div>
          ))}
        </div>
      )}
    </>
  );

  if (canExpand) {
    return (
      <div
        className={cn(
          "rounded-lg border border-[#343843] bg-[#171a22] text-gray-200 shadow-[0_10px_28px_rgba(0,0,0,0.2)]",
          compact ? "mb-2 px-3 py-2" : "p-2.5"
        )}
        data-testid={compact ? "chat-composer-plan" : "chat-plan-card"}
      >
        <details open={defaultExpanded || undefined}>
          <summary className="flex list-none items-center justify-between gap-3 [&::-webkit-details-marker]:hidden">
            <span className="flex min-w-0 flex-1 items-center gap-2 rounded-md text-left transition-colors hover:text-white">
              <ChevronDown className="h-3.5 w-3.5 shrink-0 text-gray-500 transition-transform group-open:rotate-0" />
              <ListChecks className="h-3.5 w-3.5 shrink-0 text-gray-400" />
              <span className="truncate text-[12px] font-medium">{cardTitle}</span>
            </span>
            <span className="flex shrink-0 items-center gap-2">
              <span className="text-[11px] text-gray-500">{progressLabel}</span>
              {dismissible && (
                <button
                  type="button"
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    onDismiss?.();
                  }}
                  className="rounded-md p-1 text-gray-500 transition-colors hover:bg-[#242733] hover:text-gray-200"
                  aria-label="Hide current plan"
                  title="Hide current plan"
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </span>
          </summary>
          {body}
        </details>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "rounded-lg border border-[#343843] bg-[#171a22] text-gray-200 shadow-[0_10px_28px_rgba(0,0,0,0.2)]",
        compact ? "mb-2 px-3 py-2" : "p-2.5"
      )}
      data-testid={compact ? "chat-composer-plan" : "chat-plan-card"}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <ListChecks className="h-3.5 w-3.5 shrink-0 text-gray-400" />
          <span className="truncate text-[12px] font-medium">{cardTitle}</span>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span className="text-[11px] text-gray-500">{progressLabel}</span>
          {dismissible && (
            <button
              type="button"
              onClick={onDismiss}
              className="rounded-md p-1 text-gray-500 transition-colors hover:bg-[#242733] hover:text-gray-200"
              aria-label="Hide current plan"
              title="Hide current plan"
            >
              <X className="h-3 w-3" />
            </button>
          )}
        </div>
      </div>
      {body}
    </div>
  );
}
