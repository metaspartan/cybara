import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { apiFetch } from "@/lib/auth";
import { connectStatusStream, type StatusStreamEvent } from "@/lib/status-stream";
import {
  emitPetOpenSession,
  persistPetWindowPosition,
  setPetWindowExpanded,
  startPetWindowDrag,
} from "@/lib/tauriPet";
import { cn } from "@/lib/utils";

const DRAG_THRESHOLD_PX = 5;
const ACTIVE_STATUSES = new Set([
  "thinking",
  "generating",
  "compacting",
  "tool_executing",
  "tool_completed",
]);

interface ActiveSessionEntry {
  sessionId: string;
  status: string;
  detail?: string;
}

interface SessionSummary {
  id?: string;
  title?: string;
}

export function PetOverlay() {
  const [open, setOpen] = useState(false);
  const [activeSessions, setActiveSessions] = useState<ActiveSessionEntry[]>([]);
  const [titles, setTitles] = useState<Map<string, string>>(() => new Map());
  const dragStateRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    dragging: boolean;
  } | null>(null);
  const moveTimerRef = useRef<number | null>(null);

  useEffect(() => {
    document.documentElement.style.background = "transparent";
    document.body.style.background = "transparent";
    const root = document.getElementById("root");
    if (root) root.style.background = "transparent";
  }, []);

  useEffect(() => {
    let unlisten: (() => void) | null = null;
    void (async () => {
      try {
        const { getCurrentWindow } = await import("@tauri-apps/api/window");
        unlisten = await getCurrentWindow().onMoved(() => {
          if (moveTimerRef.current !== null) window.clearTimeout(moveTimerRef.current);
          moveTimerRef.current = window.setTimeout(() => {
            void persistPetWindowPosition();
          }, 400);
        });
      } catch {
        return;
      }
    })();
    return () => {
      if (unlisten) unlisten();
      if (moveTimerRef.current !== null) window.clearTimeout(moveTimerRef.current);
    };
  }, []);

  useEffect(() => {
    const disconnect = connectStatusStream({
      onEvent: (event: StatusStreamEvent) => {
        if (event.type === "snapshot") {
          setActiveSessions(
            (event.activeSessions || [])
              .filter((session) => ACTIVE_STATUSES.has(session.status))
              .map((session) => ({
                sessionId: session.sessionId,
                status: session.status,
                detail: session.detail,
              }))
          );
          return;
        }
        if (event.type !== "status" || !event.sessionId) return;
        const sessionId = event.sessionId;
        if (ACTIVE_STATUSES.has(event.status)) {
          setActiveSessions((previous) => {
            const next = previous.filter((entry) => entry.sessionId !== sessionId);
            next.push({ sessionId, status: event.status, detail: event.detail });
            return next;
          });
        } else {
          setActiveSessions((previous) =>
            previous.filter((entry) => entry.sessionId !== sessionId)
          );
        }
      },
    });
    return () => disconnect();
  }, []);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void (async () => {
      try {
        const response = await apiFetch("/api/sessions");
        const data = (await response.json()) as SessionSummary[] | { sessions?: SessionSummary[] };
        const list = Array.isArray(data) ? data : (data.sessions ?? []);
        if (cancelled) return;
        setTitles(() => {
          const next = new Map<string, string>();
          for (const session of list) {
            if (session.id && session.title) next.set(session.id, session.title);
          }
          return next;
        });
      } catch {
        return;
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open]);

  const togglePopover = useCallback(() => {
    setOpen((previous) => {
      const next = !previous;
      void setPetWindowExpanded(next);
      return next;
    });
  }, []);

  const onPointerDown = useCallback((event: React.PointerEvent<HTMLButtonElement>) => {
    dragStateRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      dragging: false,
    };
  }, []);

  const onPointerMove = useCallback((event: React.PointerEvent<HTMLButtonElement>) => {
    const drag = dragStateRef.current;
    if (!drag || drag.pointerId !== event.pointerId || drag.dragging) return;
    if (Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) < DRAG_THRESHOLD_PX) {
      return;
    }
    drag.dragging = true;
    void startPetWindowDrag();
  }, []);

  const onPointerUp = useCallback(
    (event: React.PointerEvent<HTMLButtonElement>) => {
      const drag = dragStateRef.current;
      dragStateRef.current = null;
      if (drag?.dragging) return;
      event.preventDefault();
      togglePopover();
    },
    [togglePopover]
  );

  const openSession = useCallback((sessionId: string) => {
    setOpen(false);
    void setPetWindowExpanded(false);
    void emitPetOpenSession(sessionId);
  }, []);

  const activeCount = activeSessions.length;
  const sessionLabel = useCallback(
    (entry: ActiveSessionEntry) =>
      titles.get(entry.sessionId) || `Session ${entry.sessionId.slice(0, 8)}`,
    [titles]
  );
  const sortedSessions = useMemo(
    () => [...activeSessions].sort((a, b) => a.sessionId.localeCompare(b.sessionId)),
    [activeSessions]
  );

  return (
    <div className="flex h-screen w-screen flex-col items-start bg-transparent p-2">
      <button
        type="button"
        aria-label={activeCount > 0 ? `Cybara pet — ${activeCount} running` : "Cybara pet"}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        className={cn(
          "relative h-16 w-16 flex-shrink-0 select-none rounded-full bg-[#12121a] cursor-grab transition-transform duration-150 hover:scale-105 active:scale-95 active:cursor-grabbing",
          activeCount > 0 ? "border-2 border-indigo-400/70" : "border border-white/20",
          activeCount === 0 && "cybara-pet-idle"
        )}
        style={{ touchAction: "none" }}
      >
        {activeCount > 0 ? (
          <span className="cybara-thinking-sprite" aria-hidden="true" />
        ) : (
          <img
            src="/cybara.png"
            alt=""
            draggable={false}
            className="pointer-events-none absolute left-1/2 top-1/2 h-11 w-11 -translate-x-1/2 -translate-y-1/2"
          />
        )}
        {activeCount > 0 && (
          <span className="absolute -right-1 -top-1 flex h-5 min-w-[20px] items-center justify-center rounded-full bg-indigo-500 px-1 text-[11px] font-semibold text-white">
            {activeCount}
          </span>
        )}
      </button>
      {open && (
        <div className="mt-2 w-full flex-1 overflow-y-auto rounded-xl border border-white/15 bg-[#12121a] p-2">
          <div className="px-2 py-1 text-[11px] font-medium uppercase tracking-wide text-gray-500">
            {activeCount > 0 ? `Running sessions (${activeCount})` : "No active sessions"}
          </div>
          {sortedSessions.map((entry) => (
            <button
              key={entry.sessionId}
              type="button"
              onClick={() => openSession(entry.sessionId)}
              className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-white/5"
            >
              <span className="h-2 w-2 flex-shrink-0 animate-pulse rounded-full bg-emerald-400" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-xs text-gray-100">{sessionLabel(entry)}</span>
                <span className="block truncate text-[10px] text-gray-500">
                  {entry.detail || entry.status}
                </span>
              </span>
            </button>
          ))}
          <button
            type="button"
            onClick={() => openSession("")}
            className="mt-1 w-full rounded-lg border border-white/10 px-2 py-1.5 text-center text-xs text-gray-300 hover:bg-white/5"
          >
            Open Cybara
          </button>
        </div>
      )}
    </div>
  );
}
