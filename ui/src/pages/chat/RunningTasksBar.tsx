import { Loader2 } from "lucide-react";
import { type ReactElement, useEffect, useMemo, useRef, useState } from "react";
import { type Subagent, useSubagents } from "@/hooks/useApi";
import { connectStatusStream } from "@/lib/status-stream";
import { delegatedRunWaitCount } from "../../../../shared/chat-status";

function formatElapsed(startedAt?: string, now = Date.now()): string {
  const startedMs = startedAt ? new Date(startedAt).getTime() : Number.NaN;
  if (!Number.isFinite(startedMs)) return "";
  const elapsedSeconds = Math.max(0, Math.floor((now - startedMs) / 1000));
  const minutes = Math.floor(elapsedSeconds / 60);
  const seconds = elapsedSeconds % 60;
  return minutes > 0 ? `${minutes}m ${seconds.toString().padStart(2, "0")}s` : `${seconds}s`;
}

function isActiveRun(subagent: Subagent): boolean {
  return subagent.status === "pending" || subagent.status === "running";
}

export function RunningTasksBar({
  liveDetail,
  onOpenSubagent,
  sessionId,
}: {
  liveDetail?: string | null;
  onOpenSubagent?: (runId: string, title: string) => void;
  sessionId: string | null;
}): ReactElement | null {
  const { data: subagents = [], refetch } = useSubagents(sessionId);
  const refreshTimerRef = useRef<number | null>(null);
  const sessionKeysRef = useRef<Set<string>>(new Set());
  const [now, setNow] = useState(Date.now());

  const activeRuns = useMemo(() => subagents.filter(isActiveRun), [subagents]);

  useEffect(() => {
    sessionKeysRef.current = new Set(
      [sessionId, ...subagents.map((subagent) => subagent.sessionKey)].filter(Boolean) as string[]
    );
  }, [sessionId, subagents]);

  useEffect(() => {
    const disconnect = connectStatusStream({
      onEvent: (event) => {
        if (event.type !== "status" || !event.sessionId) return;
        if (!sessionKeysRef.current.has(event.sessionId)) return;
        if (refreshTimerRef.current !== null) window.clearTimeout(refreshTimerRef.current);
        refreshTimerRef.current = window.setTimeout(() => {
          void refetch();
          refreshTimerRef.current = null;
        }, 400);
      },
    });
    return () => {
      disconnect();
      if (refreshTimerRef.current !== null) window.clearTimeout(refreshTimerRef.current);
    };
  }, [refetch]);

  useEffect(() => {
    if (activeRuns.length === 0) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [activeRuns.length]);

  const waitingCount = delegatedRunWaitCount(liveDetail);
  const displayCount = activeRuns.length > 0 ? activeRuns.length : waitingCount;
  if (displayCount === null) return null;

  return (
    <div
      className="mb-2 flex items-center gap-2 rounded-2xl border border-white/5 bg-white/[0.03] px-3 py-2"
      data-testid="running-tasks-bar"
      role="status"
    >
      <span className="flex shrink-0 items-center gap-1.5">
        <Loader2 className="h-3.5 w-3.5 animate-spin text-[rgb(var(--accent-primary))]" />
        <span className="text-[12px] font-medium text-gray-200">
          Running {displayCount} {displayCount === 1 ? "task" : "tasks"}…
        </span>
      </span>
      {activeRuns.length > 0 ? (
        <div className="flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto">
          {activeRuns.map((subagent) => {
            const label = subagent.label || subagent.task.slice(0, 40);
            return (
              <button
                key={subagent.id}
                type="button"
                data-testid="running-tasks-bar-chip"
                title={subagent.task}
                disabled={!onOpenSubagent}
                onClick={() => onOpenSubagent?.(subagent.id, label)}
                className="flex shrink-0 items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-[11px] text-gray-300 transition-colors hover:border-white/25 hover:text-gray-100 disabled:cursor-default disabled:hover:border-white/10 disabled:hover:text-gray-300"
              >
                <Loader2 className="h-3 w-3 animate-spin text-[rgb(var(--accent-primary))]" />
                <span className="max-w-[180px] truncate">{label}</span>
                <span className="tabular-nums text-gray-500">
                  {formatElapsed(subagent.startedAt || subagent.createdAt, now)}
                </span>
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
