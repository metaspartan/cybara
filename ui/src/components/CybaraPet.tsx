import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { apiFetch } from "@/lib/auth";
import { connectStatusStream, type StatusStreamEvent } from "@/lib/status-stream";
import {
  PET_CHANGED_EVENT,
  persistPetPosition,
  readPetEnabled,
  readPetPosition,
  type PetPosition,
} from "@/lib/petPreferences";
import { persistSessionId } from "@/pages/chat/chatModel";
import {
  closePetWindow,
  ensurePetWindow,
  isTauriRuntime,
  listenForPetOpenSession,
} from "@/lib/tauriPet";
import { cn } from "@/lib/utils";

const PET_SIZE = 64;
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

function clampPosition(position: PetPosition): PetPosition {
  const maxX = Math.max(8, window.innerWidth - PET_SIZE - 8);
  const maxY = Math.max(8, window.innerHeight - PET_SIZE - 8);
  return {
    x: Math.min(Math.max(8, position.x), maxX),
    y: Math.min(Math.max(8, position.y), maxY),
  };
}

function defaultPosition(): PetPosition {
  return clampPosition({
    x: window.innerWidth - PET_SIZE - 28,
    y: window.innerHeight - PET_SIZE - 96,
  });
}

export function CybaraPet() {
  const navigate = useNavigate();
  const [enabled, setEnabled] = useState(() => readPetEnabled());
  const [position, setPosition] = useState<PetPosition>(() =>
    clampPosition(readPetPosition() ?? defaultPosition())
  );
  const [dragging, setDragging] = useState(false);
  const [open, setOpen] = useState(false);
  const [activeSessions, setActiveSessions] = useState<ActiveSessionEntry[]>([]);
  const [titles, setTitles] = useState<Map<string, string>>(() => new Map());
  const dragStateRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    originX: number;
    originY: number;
    moved: boolean;
  } | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);

  const tauri = isTauriRuntime();

  useEffect(() => {
    const onChange = () => setEnabled(readPetEnabled());
    window.addEventListener(PET_CHANGED_EVENT, onChange);
    return () => window.removeEventListener(PET_CHANGED_EVENT, onChange);
  }, []);

  useEffect(() => {
    if (!tauri) return;
    if (enabled) {
      void ensurePetWindow();
    } else {
      void closePetWindow();
    }
  }, [tauri, enabled]);

  useEffect(() => {
    if (!tauri) return;
    let dispose: (() => void) | null = null;
    void listenForPetOpenSession((sessionId) => {
      if (sessionId) persistSessionId(sessionId);
      navigate("/chat");
    }).then((unlisten) => {
      dispose = unlisten;
    });
    return () => {
      if (dispose) dispose();
    };
  }, [tauri, navigate]);

  useEffect(() => {
    if (!enabled || tauri) return;
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
    return () => {
      disconnect();
      setActiveSessions([]);
    };
  }, [enabled]);

  useEffect(() => {
    const onResize = () => setPosition((previous) => clampPosition(previous));
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    window.addEventListener("pointerdown", onPointerDown);
    return () => window.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

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

  const onPointerDown = useCallback(
    (event: React.PointerEvent<HTMLButtonElement>) => {
      try {
        event.currentTarget.setPointerCapture(event.pointerId);
      } catch {
        void 0;
      }
      dragStateRef.current = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        originX: position.x,
        originY: position.y,
        moved: false,
      };
    },
    [position.x, position.y]
  );

  const onPointerMove = useCallback((event: React.PointerEvent<HTMLButtonElement>) => {
    const drag = dragStateRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const deltaX = event.clientX - drag.startX;
    const deltaY = event.clientY - drag.startY;
    if (!drag.moved && Math.hypot(deltaX, deltaY) < DRAG_THRESHOLD_PX) return;
    drag.moved = true;
    setDragging(true);
    setPosition(clampPosition({ x: drag.originX + deltaX, y: drag.originY + deltaY }));
  }, []);

  const onPointerUp = useCallback((event: React.PointerEvent<HTMLButtonElement>) => {
    const drag = dragStateRef.current;
    dragStateRef.current = null;
    setDragging(false);
    if (drag?.moved) {
      setPosition((current) => {
        persistPetPosition(current);
        return current;
      });
      return;
    }
    event.preventDefault();
    setOpen((previous) => !previous);
  }, []);

  const openSession = useCallback(
    (sessionId: string) => {
      persistSessionId(sessionId);
      setOpen(false);
      navigate("/chat");
    },
    [navigate]
  );

  const activeCount = activeSessions.length;
  const popoverBelow = position.y < 220;
  const sessionLabel = useCallback(
    (entry: ActiveSessionEntry) =>
      titles.get(entry.sessionId) || `Session ${entry.sessionId.slice(0, 8)}`,
    [titles]
  );

  const sortedSessions = useMemo(
    () => [...activeSessions].sort((a, b) => a.sessionId.localeCompare(b.sessionId)),
    [activeSessions]
  );

  if (!enabled || tauri) return null;

  return (
    <div
      ref={rootRef}
      className="fixed z-[90]"
      style={{ left: position.x, top: position.y, width: PET_SIZE, height: PET_SIZE }}
    >
      {open && (
        <div
          className={cn(
            "absolute w-64 rounded-xl border border-white/10 bg-[#12121a]/95 p-2 shadow-2xl backdrop-blur",
            popoverBelow ? "top-[72px]" : "bottom-[72px]",
            position.x > window.innerWidth - 280 ? "right-0" : "left-0"
          )}
        >
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
            onClick={() => {
              setOpen(false);
              navigate("/chat");
            }}
            className="mt-1 w-full rounded-lg border border-white/10 px-2 py-1.5 text-center text-xs text-gray-300 hover:bg-white/5"
          >
            Open Chat
          </button>
        </div>
      )}
      <button
        type="button"
        aria-label={activeCount > 0 ? `Cybara pet — ${activeCount} running` : "Cybara pet"}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        className={cn(
          "relative h-16 w-16 select-none drop-shadow-xl transition-transform",
          dragging ? "scale-105 cursor-grabbing" : "cursor-grab hover:scale-105",
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
            className="pointer-events-none absolute inset-0 h-full w-full scale-[0.86] object-contain"
          />
        )}
        {activeCount > 0 && (
          <span className="absolute -right-1 -top-1 flex h-5 min-w-[20px] items-center justify-center rounded-full bg-indigo-500 px-1 text-[11px] font-semibold text-white shadow">
            {activeCount}
          </span>
        )}
      </button>
    </div>
  );
}
