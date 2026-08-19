import { Check, Clock, Loader2, Pause, Play, Square, Target } from "lucide-react";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import type { SessionGoal } from "@/types";
import type { ChatHorizontalPadding } from "../../../../shared/chat-appearance";
import { chatHorizontalPaddingClassName } from "./chatAppearanceLayout";

const STATUS_LABEL: Record<SessionGoal["status"], string> = {
  active: "Working",
  paused: "Paused",
  blocked: "Blocked",
  complete: "Complete",
};

const STATUS_STYLE: Record<SessionGoal["status"], string> = {
  active: "bg-emerald-400/15 text-emerald-300 border-emerald-400/25",
  paused: "bg-amber-400/15 text-amber-300 border-amber-400/25",
  blocked: "bg-red-400/15 text-red-300 border-red-400/25",
  complete: "bg-sky-400/15 text-sky-300 border-sky-400/25",
};

const STATUS_DOT: Record<SessionGoal["status"], string> = {
  active: "bg-emerald-400 animate-pulse",
  paused: "bg-amber-400",
  blocked: "bg-red-400",
  complete: "bg-sky-400",
};

function goalElapsedMs(goal: SessionGoal, nowMs: number): number {
  const accumulated =
    typeof goal.activeMs === "number" && Number.isFinite(goal.activeMs) ? goal.activeMs : 0;
  if (goal.status !== "active") return accumulated;
  const resumedAt = goal.lastResumedAt ?? goal.createdAt;
  const resumedMs = Date.parse(resumedAt);
  if (!Number.isFinite(resumedMs)) return accumulated;
  return accumulated + Math.max(0, nowMs - resumedMs);
}

function formatElapsed(totalMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(totalMs / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const pad = (value: number) => String(value).padStart(2, "0");
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${pad(minutes)}:${pad(seconds)}`;
}

function useGoalElapsed(goal: SessionGoal | null): number {
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    if (!goal || goal.status !== "active") return;
    const timer = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [goal, goal?.status]);
  return goal ? goalElapsedMs(goal, nowMs) : 0;
}

interface GoalPanelProps {
  goal: SessionGoal | null;
  loading: boolean;
  working: boolean;
  onPause: () => void;
  onResume: () => void;
  onComplete: () => void;
  onClear: () => void;
  layout?: "default" | "new-chat";
  horizontalPadding?: ChatHorizontalPadding;
}

export function GoalPanel({
  goal,
  loading,
  working,
  onPause,
  onResume,
  onComplete,
  onClear,
  layout = "default",
  horizontalPadding = "default",
}: GoalPanelProps) {
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const elapsedMs = useGoalElapsed(goal);

  const runAction = async (label: string, action: () => void | Promise<void>) => {
    if (busyAction) return;
    setBusyAction(label);
    try {
      await action();
    } finally {
      setBusyAction(null);
    }
  };

  const actionDisabled = busyAction !== null;

  if (!goal) {
    if (loading) {
      return layout === "new-chat" ? (
        <div className="new-chat-workspace-bar mx-4 flex h-9 min-w-0 items-center gap-2 rounded-t-[18px] border border-b-0 px-3 text-[12px]">
          <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-[var(--icon-muted)]" />
          <span className="text-[var(--text-muted)]">Loading goal...</span>
        </div>
      ) : (
        <div className="flex items-center gap-2 px-4 py-2 text-xs text-[var(--text-muted)]">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Loading goal...
        </div>
      );
    }
    return null;
  }

  const isActive = goal.status === "active";
  const canResume = goal.status !== "active";
  const canPause = isActive;
  const canComplete = goal.status !== "complete";
  const looping = isActive && working;

  const renderActions = () => (
    <>
      {canPause ? (
        <button
          type="button"
          disabled={actionDisabled}
          onClick={() => void runAction("pause", onPause)}
          className="inline-flex h-6 items-center gap-1 rounded-md border border-[var(--surface-border)] bg-[var(--surface-raised)] px-2 text-[11px] font-medium text-[var(--text-secondary)] transition-colors hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)] disabled:opacity-50 cursor-pointer"
          title="Pause the goal loop"
        >
          <Pause className="h-3 w-3" />
          Pause
        </button>
      ) : null}
      {canResume ? (
        <button
          type="button"
          disabled={actionDisabled}
          onClick={() => void runAction("resume", onResume)}
          className="inline-flex h-6 items-center gap-1 rounded-md border border-emerald-400/25 bg-emerald-400/10 px-2 text-[11px] font-medium text-emerald-300 transition-colors hover:bg-emerald-400/20 disabled:opacity-50 cursor-pointer"
          title="Resume the goal loop"
        >
          <Play className="h-3 w-3" />
          Resume
        </button>
      ) : null}
      {canComplete ? (
        <button
          type="button"
          disabled={actionDisabled}
          onClick={() => void runAction("complete", onComplete)}
          className="inline-flex h-6 items-center gap-1 rounded-md border border-[var(--surface-border)] bg-[var(--surface-raised)] px-2 text-[11px] font-medium text-[var(--text-secondary)] transition-colors hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)] disabled:opacity-50 cursor-pointer"
          title="Mark the goal complete"
        >
          <Check className="h-3 w-3" />
          Complete
        </button>
      ) : null}
      <button
        type="button"
        disabled={actionDisabled}
        onClick={() => void runAction("clear", onClear)}
        className="inline-flex h-6 items-center gap-1 rounded-md border border-red-400/20 bg-red-400/5 px-2 text-[11px] font-medium text-red-300/80 transition-colors hover:bg-red-400/15 hover:text-red-200 disabled:opacity-50 cursor-pointer"
        title="Clear the goal"
      >
        <Square className="h-3 w-3" />
        Clear
      </button>
    </>
  );

  if (layout === "new-chat") {
    return (
      <div className="new-chat-workspace-bar mx-4 flex h-9 min-w-0 items-center gap-2 rounded-t-[18px] border border-b-0 px-3 text-[12px]">
        <Target className="h-3.5 w-3.5 shrink-0 text-[var(--icon-muted)]" />
        <span
          className="min-w-0 flex-1 truncate font-medium text-[var(--text-primary)]"
          title={goal.objective}
        >
          {goal.objective}
        </span>
        <span
          className={cn(
            "inline-flex shrink-0 items-center gap-1 rounded-full border px-1.5 py-px text-[10px] font-medium",
            STATUS_STYLE[goal.status]
          )}
        >
          <span className={cn("h-1.5 w-1.5 rounded-full", STATUS_DOT[goal.status])} />
          {STATUS_LABEL[goal.status]}
        </span>
        <span
          className="inline-flex shrink-0 items-center gap-1 font-mono text-[10px] text-[var(--text-muted)] tabular-nums"
          title="Elapsed working time"
        >
          <Clock className="h-3 w-3" />
          {formatElapsed(elapsedMs)}
        </span>
        {looping ? (
          <span className="inline-flex shrink-0 items-center gap-1 text-[10px] text-emerald-300/80">
            <Loader2 className="h-3 w-3 animate-spin" />
            Looping…
          </span>
        ) : null}
        <span className="ml-auto flex shrink-0 items-center gap-1">{renderActions()}</span>
      </div>
    );
  }

  return (
    <div className="border-t border-[var(--surface-border)] bg-[var(--surface-panel)] py-2">
      <div
        className={cn(
          "flex flex-wrap items-center gap-x-3 gap-y-1.5",
          chatHorizontalPaddingClassName(horizontalPadding)
        )}
      >
        <div className="flex min-w-0 items-center gap-2">
          <Target className="h-3.5 w-3.5 shrink-0 text-[var(--text-muted)]" />
          <span
            className="truncate text-xs font-medium text-[var(--text-primary)]"
            title={goal.objective}
          >
            {goal.objective}
          </span>
        </div>
        <span
          className={cn(
            "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium",
            STATUS_STYLE[goal.status]
          )}
        >
          <span className={cn("h-1.5 w-1.5 rounded-full", STATUS_DOT[goal.status])} />
          {STATUS_LABEL[goal.status]}
        </span>
        <span
          className="inline-flex items-center gap-1 font-mono text-[11px] text-[var(--text-muted)] tabular-nums"
          title="Elapsed working time"
        >
          <Clock className="h-3 w-3" />
          {formatElapsed(elapsedMs)}
        </span>
        {looping ? (
          <span className="inline-flex items-center gap-1 text-[11px] text-emerald-300/80">
            <Loader2 className="h-3 w-3 animate-spin" />
            Looping…
          </span>
        ) : null}
        {goal.lastStatusNote ? (
          <span
            className="min-w-0 truncate text-[11px] text-[var(--text-muted)]"
            title={goal.lastStatusNote}
          >
            {goal.lastStatusNote}
          </span>
        ) : null}
        <span className="ml-auto flex items-center gap-1.5">{renderActions()}</span>
      </div>
    </div>
  );
}
