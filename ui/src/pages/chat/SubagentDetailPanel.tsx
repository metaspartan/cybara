import { useEffect, useRef, useState, type ReactElement } from "react";
import { Loader2, MessageSquare, Square, Trash2 } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { type Subagent, useClearSubagent, useKillSubagent, useSubagent } from "@/hooks/useApi";
import { preprocessChatMarkdown } from "@/lib/chatMarkdownPreprocessor";
import { connectStatusStream } from "@/lib/status-stream";
import { Button, Badge } from "@/components/ui";
import { SubagentTimeline } from "./SubagentTimeline";

function statusVariant(status: Subagent["status"]): "success" | "error" | "default" {
  if (status === "completed") return "success";
  if (status === "failed" || status === "timeout" || status === "killed") return "error";
  return "default";
}

function formatElapsed(startedAt?: string, endedAt?: string, now = Date.now()): string {
  if (!startedAt) return "Starting";
  const elapsedSeconds = Math.max(
    0,
    Math.floor(
      ((endedAt ? new Date(endedAt).getTime() : now) - new Date(startedAt).getTime()) / 1000
    )
  );
  const minutes = Math.floor(elapsedSeconds / 60);
  const seconds = elapsedSeconds % 60;
  return minutes > 0 ? `${minutes}m ${seconds.toString().padStart(2, "0")}s` : `${seconds}s`;
}

export function SubagentDetailPanel({
  onClear,
  onViewSession,
  runId,
}: {
  onClear: () => void;
  onViewSession: (sessionKey: string) => void;
  runId: string;
}): ReactElement {
  const { data: subagent, isLoading, refetch } = useSubagent(runId);
  const killSubagent = useKillSubagent();
  const clearSubagent = useClearSubagent();
  const refreshTimerRef = useRef<number | null>(null);
  const sessionKeyRef = useRef<string | undefined>(subagent?.sessionKey);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    sessionKeyRef.current = subagent?.sessionKey;
  }, [subagent?.sessionKey]);

  useEffect(() => {
    if (!subagent || !["pending", "running"].includes(subagent.status)) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [subagent]);

  useEffect(() => {
    const disconnect = connectStatusStream({
      onEvent: (event) => {
        if (event.type !== "status" || event.sessionId !== sessionKeyRef.current) return;
        if (refreshTimerRef.current !== null) window.clearTimeout(refreshTimerRef.current);
        refreshTimerRef.current = window.setTimeout(() => {
          void refetch();
          refreshTimerRef.current = null;
        }, 100);
      },
    });
    return () => {
      disconnect();
      if (refreshTimerRef.current !== null) window.clearTimeout(refreshTimerRef.current);
    };
  }, [refetch]);

  if (isLoading || !subagent) {
    return (
      <div className="flex h-full items-center justify-center text-gray-500">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    );
  }

  const active = subagent.status === "pending" || subagent.status === "running";

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-3 border-b border-white/5 px-4 py-3">
        <Badge variant={statusVariant(subagent.status)}>{subagent.status}</Badge>
        {active ? <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" /> : null}
        <span className="chat-meta-text text-gray-500">
          {formatElapsed(subagent.startedAt, subagent.endedAt, now)}
        </span>
        <span className="chat-meta-text ml-auto text-gray-600">
          {subagent.activityCount} updates · {subagent.toolCallCount} tools
        </span>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        <div className="mx-auto max-w-3xl space-y-5">
          <section>
            <h4 className="mb-2 text-[11px] font-semibold uppercase text-gray-500">Task</h4>
            <div className="chat-activity-text whitespace-pre-wrap rounded-md bg-white/[0.025] p-3 text-gray-300">
              {subagent.task}
            </div>
          </section>

          {active && (subagent.activities?.length || 0) === 0 ? (
            <div className="flex items-center gap-2 py-3 text-[12px] text-gray-500">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Waiting for the first update
            </div>
          ) : null}

          <SubagentTimeline subagent={subagent} />

          {subagent.result || subagent.error ? (
            <section>
              <h4 className="mb-2 text-[11px] font-semibold uppercase text-gray-500">
                Final output
              </h4>
              <div className="chat-activity-text rounded-md bg-white/[0.025] p-3 text-gray-300">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                  {preprocessChatMarkdown(subagent.result || subagent.error || "")}
                </ReactMarkdown>
              </div>
            </section>
          ) : null}
        </div>
      </div>

      <div className="flex shrink-0 justify-end gap-2 border-t border-white/5 px-3 py-2.5">
        <Button variant="secondary" onClick={() => onViewSession(subagent.sessionKey)}>
          <MessageSquare className="mr-2 h-4 w-4" /> View chat
        </Button>
        {active ? (
          <Button
            variant="danger"
            disabled={killSubagent.isPending}
            onClick={() => void killSubagent.mutateAsync(subagent.id)}
          >
            <Square className="mr-2 h-4 w-4" /> Stop
          </Button>
        ) : (
          <Button
            variant="danger"
            disabled={clearSubagent.isPending}
            onClick={async () => {
              await clearSubagent.mutateAsync(subagent.id);
              onClear();
            }}
          >
            <Trash2 className="mr-2 h-4 w-4" /> Clear
          </Button>
        )}
      </div>
    </div>
  );
}
