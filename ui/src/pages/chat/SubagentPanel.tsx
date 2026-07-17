import { Loader2, Plus, Square, Trash2, X } from "lucide-react";
import {
  type ReactElement,
  type MouseEvent as ReactMouseEvent,
  useEffect,
  useRef,
  useState,
} from "react";
import { Badge, Button, Modal } from "@/components/ui";
import {
  type Subagent,
  useClearSubagentHistory,
  useKillSubagent,
  useSpawnSubagent,
  useSubagents,
} from "@/hooks/useApi";
import { connectStatusStream } from "@/lib/status-stream";
import { useUIStore } from "@/stores/uiStore";
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
  onOpenSubagent?: (runId: string, title: string) => void;
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

export function SubagentPanel({
  agentId,
  embedded = false,
  isOpen,
  onClose,
  onOpenSubagent,
  sessionId,
  workspaceDir,
}: SubagentPanelProps): ReactElement | null {
  const { data: subagents = [], isLoading, refetch } = useSubagents(sessionId);
  const spawnSubagent = useSpawnSubagent();
  const killSubagent = useKillSubagent();
  const clearHistory = useClearSubagentHistory();
  const [newTask, setNewTask] = useState("");
  const [showSpawnModal, setShowSpawnModal] = useState(false);
  const [showClearModal, setShowClearModal] = useState(false);
  const [panelWidth, setPanelWidth] = useState(readSubagentPanelWidth);
  const subagentRefreshTimerRef = useRef<number | null>(null);
  const subagentSessionKeysRef = useRef<Set<string>>(new Set());
  const panelResizeCleanupRef = useRef<(() => void) | null>(null);
  const completedCount = subagents.filter(
    (subagent) => subagent.status !== "running" && subagent.status !== "pending"
  ).length;

  useEffect(() => {
    subagentSessionKeysRef.current = new Set(
      subagents.map((subagent) => subagent.sessionKey).filter(Boolean)
    );
  }, [subagents]);

  useEffect(() => {
    const disconnect = connectStatusStream({
      onEvent: (event) => {
        if (
          event.type !== "status" ||
          !event.sessionId ||
          !subagentSessionKeysRef.current.has(event.sessionId)
        ) {
          return;
        }
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
      const label = `Task: ${task.slice(0, 30)}${task.length > 30 ? "..." : ""}`;
      const spawned = await spawnSubagent.mutateAsync({
        task,
        label,
        agentId,
        workspaceDir: workspaceDir || undefined,
        requesterSessionId: sessionId,
      });
      setNewTask("");
      setShowSpawnModal(false);
      onOpenSubagent?.(spawned.subagentId, label);
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
                  onClick={() => onOpenSubagent?.(subagent.id, subagent.label)}
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[12px] font-medium text-gray-200">
                      {subagent.label}
                    </p>
                    <p className="mt-0.5 text-[10px] text-gray-600">
                      {subagent.activityCount} updates · {subagent.toolCallCount} tools ·{" "}
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
    </>
  );
}
