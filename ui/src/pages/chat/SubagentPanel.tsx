import { useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  ChevronDown,
  ChevronRight,
  Loader2,
  MessageSquare,
  Plus,
  Square,
  Trash2,
  X,
} from "lucide-react";
import {
  type Subagent,
  useClearSubagent,
  useClearSubagentHistory,
  useKillSubagent,
  useSpawnSubagent,
  useSubagent,
  useSubagents,
} from "@/hooks/useApi";
import { connectStatusStream } from "@/lib/status-stream";
import { preprocessChatMarkdown } from "@/lib/chatMarkdownPreprocessor";
import { useUIStore } from "@/stores/uiStore";
import { Badge, Button, Modal } from "@/components/ui";
import { SubagentIcon } from "./SubagentIcon";
import {
  clampSubagentPanelWidth,
  SUBAGENT_PANEL_DEFAULT_WIDTH,
  SUBAGENT_PANEL_WIDTH_STORAGE_KEY,
} from "./subagentPanelSizing";

interface SubagentPanelProps {
  agentId?: string;
  embedded?: boolean;
  isOpen: boolean;
  onClose: () => void;
  onViewSession?: (sessionKey: string) => void;
  sessionId: string | null;
  workspaceDir?: string | null;
}

function readSubagentPanelWidth(): number {
  if (typeof window === "undefined") return SUBAGENT_PANEL_DEFAULT_WIDTH;
  const storedWidth = Number.parseInt(
    window.localStorage.getItem(SUBAGENT_PANEL_WIDTH_STORAGE_KEY) || "",
    10
  );
  return clampSubagentPanelWidth(
    Number.isFinite(storedWidth) ? storedWidth : SUBAGENT_PANEL_DEFAULT_WIDTH,
    window.innerWidth
  );
}

function statusVariant(status: Subagent["status"]): "success" | "error" | "default" {
  if (status === "completed") return "success";
  if (status === "failed" || status === "timeout") return "error";
  return "default";
}

function formatJson(value: unknown): string {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    for (const key of ["content", "output", "stdout"]) {
      if (typeof record[key] === "string" && record[key].trim()) return record[key];
    }
  }
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function SubagentTimeline({ subagent }: { subagent: Subagent }) {
  const activities = useMemo(
    () => [...(subagent.activities || [])].sort((a, b) => a.timestamp - b.timestamp),
    [subagent.activities]
  );
  const toolCalls = useMemo(
    () =>
      [...(subagent.toolCalls || [])].sort(
        (a, b) =>
          (a.timeline_index ?? Number.MAX_SAFE_INTEGER) -
          (b.timeline_index ?? Number.MAX_SAFE_INTEGER)
      ),
    [subagent.toolCalls]
  );
  const [expandedTools, setExpandedTools] = useState<Set<string>>(new Set());

  return (
    <div className="space-y-4">
      {activities.length > 0 && (
        <section>
          <h4 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-gray-500">
            Activity
          </h4>
          <div className="space-y-1.5 border-l border-white/10 pl-3">
            {activities.map((activity) => (
              <div key={activity.id} className="chat-activity-text flex gap-2 text-gray-400">
                <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-gray-500" />
                <div className="min-w-0">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>
                    {preprocessChatMarkdown(activity.text)}
                  </ReactMarkdown>
                  {activity.toolName && activity.toolName !== "__thought" && (
                    <span className="chat-meta-text mt-0.5 block font-mono text-gray-600">
                      {activity.toolName} · {activity.phase}
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {subagent.thinking && activities.every((activity) => activity.toolName !== "__thought") && (
        <section>
          <h4 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-gray-500">
            Thinking
          </h4>
          <div className="chat-thought-text max-h-52 overflow-y-auto rounded-lg border border-white/10 bg-black/20 p-3 text-gray-400">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>
              {preprocessChatMarkdown(subagent.thinking)}
            </ReactMarkdown>
          </div>
        </section>
      )}

      {toolCalls.length > 0 && (
        <section>
          <h4 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-gray-500">
            Tool calls
          </h4>
          <div className="space-y-1.5">
            {toolCalls.map((toolCall, index) => {
              const key = toolCall.id || `${toolCall.name}-${index}`;
              const expanded = expandedTools.has(key);
              return (
                <div
                  key={key}
                  className="overflow-hidden rounded-lg border border-white/10 bg-black/20"
                >
                  <button
                    type="button"
                    className="chat-activity-text flex w-full items-center gap-2 px-3 py-2 text-left text-gray-300 hover:bg-white/[0.04]"
                    onClick={() =>
                      setExpandedTools((current) => {
                        const next = new Set(current);
                        if (next.has(key)) next.delete(key);
                        else next.add(key);
                        return next;
                      })
                    }
                  >
                    {expanded ? (
                      <ChevronDown className="h-3 w-3" />
                    ) : (
                      <ChevronRight className="h-3 w-3" />
                    )}
                    <span className="min-w-0 flex-1 truncate font-mono">{toolCall.name}</span>
                    <span className="chat-meta-text capitalize text-gray-600">
                      {toolCall.status || "completed"}
                    </span>
                  </button>
                  {expanded && (
                    <div className="grid gap-2 border-t border-white/10 p-2.5">
                      {toolCall.args && Object.keys(toolCall.args).length > 0 && (
                        <div>
                          <div className="chat-meta-text mb-1 uppercase text-gray-600">
                            Arguments
                          </div>
                          <pre className="chat-code-text max-h-40 overflow-auto whitespace-pre-wrap break-all rounded bg-black/30 p-2 text-gray-400">
                            {formatJson(toolCall.args)}
                          </pre>
                        </div>
                      )}
                      <div>
                        <div className="chat-meta-text mb-1 uppercase text-gray-600">Output</div>
                        <pre className="chat-code-text max-h-56 overflow-auto whitespace-pre-wrap break-all rounded bg-black/30 p-2 text-gray-300">
                          {formatJson(toolCall.result)}
                        </pre>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}

export function SubagentPanel({
  agentId,
  embedded = false,
  isOpen,
  onClose,
  onViewSession,
  sessionId,
  workspaceDir,
}: SubagentPanelProps) {
  const { data: subagents = [], isLoading, refetch } = useSubagents(sessionId);
  const spawnSubagent = useSpawnSubagent();
  const killSubagent = useKillSubagent();
  const clearHistory = useClearSubagentHistory();
  const clearSubagent = useClearSubagent();
  const [newTask, setNewTask] = useState("");
  const [showSpawnModal, setShowSpawnModal] = useState(false);
  const [showClearModal, setShowClearModal] = useState(false);
  const [selectedSubagentId, setSelectedSubagentId] = useState<string | null>(null);
  const [panelWidth, setPanelWidth] = useState(readSubagentPanelWidth);
  const { data: selectedSubagent, isLoading: detailLoading } = useSubagent(selectedSubagentId);
  const subagentRefreshTimerRef = useRef<number | null>(null);
  const panelResizeCleanupRef = useRef<(() => void) | null>(null);
  const completedCount = subagents.filter(
    (subagent) => subagent.status !== "running" && subagent.status !== "pending"
  ).length;

  useEffect(() => {
    const disconnect = connectStatusStream({
      onEvent: (event) => {
        if (!event || typeof event !== "object") return;
        if (event.type !== "status" && event.type !== "task_completed") return;
        if (subagentRefreshTimerRef.current !== null) {
          window.clearTimeout(subagentRefreshTimerRef.current);
        }
        subagentRefreshTimerRef.current = window.setTimeout(() => {
          void refetch();
          subagentRefreshTimerRef.current = null;
        }, 500);
      },
    });
    return () => {
      disconnect();
      if (subagentRefreshTimerRef.current !== null) {
        window.clearTimeout(subagentRefreshTimerRef.current);
      }
    };
  }, [refetch]);

  useEffect(() => {
    setSelectedSubagentId(null);
  }, [sessionId]);

  useEffect(() => {
    const handleWindowResize = () => {
      setPanelWidth((current) => clampSubagentPanelWidth(current, window.innerWidth));
    };
    window.addEventListener("resize", handleWindowResize);
    return () => {
      window.removeEventListener("resize", handleWindowResize);
      panelResizeCleanupRef.current?.();
    };
  }, []);

  const persistPanelWidth = (width: number) => {
    window.localStorage.setItem(SUBAGENT_PANEL_WIDTH_STORAGE_KEY, String(width));
  };

  const resizePanelBy = (delta: number) => {
    setPanelWidth((current) => {
      const next = clampSubagentPanelWidth(current + delta, window.innerWidth);
      persistPanelWidth(next);
      return next;
    });
  };

  const beginPanelResize = (event: ReactMouseEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    panelResizeCleanupRef.current?.();
    const startX = event.clientX;
    const startWidth = panelWidth;
    const previousCursor = document.body.style.cursor;
    const previousUserSelect = document.body.style.userSelect;

    const handleMouseMove = (moveEvent: MouseEvent) => {
      setPanelWidth(
        clampSubagentPanelWidth(startWidth + startX - moveEvent.clientX, window.innerWidth)
      );
    };

    const cleanup = () => {
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousUserSelect;
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
      panelResizeCleanupRef.current = null;
    };

    const handleMouseUp = (upEvent: MouseEvent) => {
      const next = clampSubagentPanelWidth(
        startWidth + startX - upEvent.clientX,
        window.innerWidth
      );
      setPanelWidth(next);
      persistPanelWidth(next);
      cleanup();
    };

    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    panelResizeCleanupRef.current = cleanup;
    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
  };

  const handleSpawn = async () => {
    const task = newTask.trim();
    if (!task || !sessionId || spawnSubagent.isPending) return;
    try {
      await spawnSubagent.mutateAsync({
        task,
        label: `Task: ${task.slice(0, 30)}${task.length > 30 ? "..." : ""}`,
        agentId,
        workspaceDir: workspaceDir || undefined,
        requesterSessionId: sessionId,
      });
      setNewTask("");
      setShowSpawnModal(false);
    } catch (error) {
      useUIStore
        .getState()
        .addToast("error", error instanceof Error ? error.message : "Failed to spawn subagent");
    }
  };

  if (!isOpen) return null;

  return (
    <>
      <aside
        className={
          embedded
            ? "relative flex h-full w-full flex-col bg-[var(--chat-environment-panel-bg)]"
            : "relative flex shrink-0 flex-col border-l border-white/5 bg-[var(--chat-environment-panel-bg)]"
        }
        style={embedded ? undefined : { width: panelWidth }}
      >
        {!embedded && (
          <div
            aria-label="Resize subagent panel"
            aria-orientation="vertical"
            className="group absolute left-[-3px] top-0 z-40 h-full w-1.5 cursor-col-resize touch-none bg-transparent"
            onKeyDown={(event) => {
              if (event.key === "ArrowLeft") {
                event.preventDefault();
                resizePanelBy(16);
              } else if (event.key === "ArrowRight") {
                event.preventDefault();
                resizePanelBy(-16);
              }
            }}
            onMouseDown={beginPanelResize}
            role="separator"
            tabIndex={0}
            title="Resize subagent panel"
          >
            <span className="absolute left-1/2 top-0 h-full w-px -translate-x-1/2 bg-white/10 transition-colors group-hover:bg-[rgba(var(--accent-primary),0.65)] group-focus-visible:bg-[rgba(var(--accent-primary),0.65)]" />
          </div>
        )}
        <header className="flex items-center justify-between border-b border-white/5 px-3 py-2.5">
          <div className="flex items-center gap-2">
            <SubagentIcon className="h-3.5 w-3.5 text-gray-400" />
            <h3 className="text-sm font-medium text-gray-200">Subagents</h3>
            {subagents.length > 0 && <Badge size="sm">{subagents.length}</Badge>}
          </div>
          <div className="flex items-center gap-0.5">
            <button
              aria-label="Clear completed subagent history"
              className="rounded-lg p-1.5 text-gray-500 hover:bg-white/5 hover:text-gray-200 disabled:opacity-40"
              disabled={completedCount === 0}
              onClick={() => setShowClearModal(true)}
              title="Clear completed history"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
            <button
              aria-label="Spawn subagent"
              className="rounded-lg p-1.5 text-gray-500 hover:bg-white/5 hover:text-gray-200 disabled:opacity-40"
              disabled={!sessionId}
              onClick={() => setShowSpawnModal(true)}
              title="Spawn subagent"
            >
              <Plus className="h-3.5 w-3.5" />
            </button>
            {!embedded && (
              <button
                aria-label="Close subagents"
                className="rounded-lg p-1.5 text-gray-500 hover:bg-white/5 hover:text-gray-200"
                onClick={onClose}
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        </header>

        <div className="flex-1 space-y-1.5 overflow-y-auto p-2">
          {isLoading ? (
            <div className="py-8 text-center text-gray-500">
              <Loader2 className="mx-auto mb-2 h-5 w-5 animate-spin" />
              <p className="text-xs">Loading subagents</p>
            </div>
          ) : !sessionId ? (
            <div className="py-8 text-center text-xs text-gray-500">
              Start or open a chat first.
            </div>
          ) : subagents.length === 0 ? (
            <div className="py-8 text-center text-gray-500">
              <SubagentIcon className="mx-auto mb-2 h-6 w-6 opacity-30" />
              <p className="text-xs">No subagents in this chat</p>
            </div>
          ) : (
            subagents.map((subagent) => (
              <div
                key={subagent.id}
                className="group flex w-full items-start gap-2 rounded-lg border border-white/5 bg-white/[0.03] p-2.5 hover:border-white/15"
              >
                <button
                  type="button"
                  className="min-w-0 flex-1 text-left"
                  onClick={() => setSelectedSubagentId(subagent.id)}
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[12px] font-medium text-gray-200">
                      {subagent.label}
                    </p>
                    <p className="mt-0.5 text-[10px] text-gray-600">
                      {subagent.toolCallCount} tools ·{" "}
                      {new Date(subagent.createdAt).toLocaleTimeString()}
                    </p>
                  </div>
                </button>
                <Badge variant={statusVariant(subagent.status)} size="sm">
                  {subagent.status}
                </Badge>
                {subagent.status === "running" && (
                  <button
                    type="button"
                    aria-label={`Stop ${subagent.label}`}
                    className="rounded p-1 text-gray-500 opacity-0 hover:bg-red-500/10 hover:text-red-300 group-hover:opacity-100"
                    onClick={() => void killSubagent.mutateAsync(subagent.id)}
                  >
                    <Square className="h-3 w-3" />
                  </button>
                )}
              </div>
            ))
          )}
        </div>
      </aside>

      <Modal
        isOpen={showSpawnModal}
        onClose={() => setShowSpawnModal(false)}
        title="Spawn Subagent"
        size="md"
      >
        <div className="space-y-4">
          <textarea
            data-autofocus
            value={newTask}
            onChange={(event) => setNewTask(event.target.value)}
            placeholder="Describe the task for the subagent..."
            className="h-32 w-full resize-none rounded-lg border border-white/10 bg-white/5 px-4 py-3 text-sm text-gray-200 placeholder-gray-600 focus:border-gray-500 focus:outline-none"
          />
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setShowSpawnModal(false)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              disabled={!newTask.trim() || spawnSubagent.isPending}
              onClick={handleSpawn}
            >
              {spawnSubagent.isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <SubagentIcon className="mr-2 h-4 w-4" />
              )}
              Spawn
            </Button>
          </div>
        </div>
      </Modal>

      <Modal
        isOpen={showClearModal}
        onClose={() => setShowClearModal(false)}
        title="Clear Subagent History"
        size="sm"
      >
        <div className="space-y-4">
          <p className="text-sm text-gray-400">
            Clear {completedCount} completed subagent {completedCount === 1 ? "run" : "runs"} from
            this chat? Active runs will remain.
          </p>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setShowClearModal(false)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              disabled={!sessionId || clearHistory.isPending}
              onClick={async () => {
                if (!sessionId) return;
                const cleared = await clearHistory.mutateAsync(sessionId);
                setShowClearModal(false);
                useUIStore
                  .getState()
                  .addToast(
                    "success",
                    `Cleared ${cleared} subagent ${cleared === 1 ? "run" : "runs"}`
                  );
              }}
            >
              Clear History
            </Button>
          </div>
        </div>
      </Modal>

      <Modal
        isOpen={!!selectedSubagentId}
        onClose={() => setSelectedSubagentId(null)}
        title={selectedSubagent?.label || "Subagent Details"}
        size="lg"
      >
        {detailLoading || !selectedSubagent ? (
          <div className="py-12 text-center text-gray-500">
            <Loader2 className="mx-auto h-5 w-5 animate-spin" />
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center justify-between gap-3">
              <Badge variant={statusVariant(selectedSubagent.status)}>
                {selectedSubagent.status}
              </Badge>
              <span className="text-[11px] text-gray-600">
                {selectedSubagent.toolCallCount} tool{" "}
                {selectedSubagent.toolCallCount === 1 ? "call" : "calls"}
              </span>
            </div>
            <div className="chat-activity-text rounded-lg border border-white/10 bg-white/[0.03] p-3 text-gray-300 whitespace-pre-wrap">
              {selectedSubagent.task}
            </div>
            <SubagentTimeline subagent={selectedSubagent} />
            {(selectedSubagent.result || selectedSubagent.error) && (
              <section>
                <h4 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-gray-500">
                  Final output
                </h4>
                <div className="chat-activity-text max-h-64 overflow-auto rounded-lg border border-white/10 bg-black/20 p-3 text-gray-300">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>
                    {preprocessChatMarkdown(
                      selectedSubagent.result || selectedSubagent.error || ""
                    )}
                  </ReactMarkdown>
                </div>
              </section>
            )}
            <div className="flex flex-wrap justify-end gap-2 border-t border-white/10 pt-4">
              {onViewSession && (
                <Button
                  variant="secondary"
                  onClick={() => onViewSession(selectedSubagent.sessionKey)}
                >
                  <MessageSquare className="mr-2 h-4 w-4" /> View Session
                </Button>
              )}
              {selectedSubagent.status === "running" ? (
                <Button
                  variant="danger"
                  onClick={() => void killSubagent.mutateAsync(selectedSubagent.id)}
                >
                  <Square className="mr-2 h-4 w-4" /> Stop
                </Button>
              ) : (
                <Button
                  variant="danger"
                  disabled={clearSubagent.isPending}
                  onClick={async () => {
                    await clearSubagent.mutateAsync(selectedSubagent.id);
                    setSelectedSubagentId(null);
                  }}
                >
                  <Trash2 className="mr-2 h-4 w-4" /> Clear
                </Button>
              )}
            </div>
          </div>
        )}
      </Modal>
    </>
  );
}
