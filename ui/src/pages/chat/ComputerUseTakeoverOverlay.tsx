import { Monitor, OctagonX, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { apiFetch } from "@/lib/auth";

export interface ComputerUseTakeover {
  sessionId: string;
  app: string;
  startedAt: number;
  lastActionAt: number;
  yieldedToUser: boolean;
  reason: string | null;
}

interface ScopedTakeover {
  key: string;
  data: ComputerUseTakeover;
}

interface NoticePosition {
  x: number;
  y: number;
}

const POLL_INTERVAL_MS = 900;
const POSITION_STORAGE_KEY = "cybara:computer-use-notice-position";
const VIEWPORT_MARGIN = 8;
const KEYBOARD_STEP_PX = 16;
const KEYBOARD_STEP_LARGE_PX = 48;

function readStoredPosition(): NoticePosition | null {
  try {
    const raw = globalThis.localStorage?.getItem(POSITION_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { x?: unknown; y?: unknown };
    if (typeof parsed.x !== "number" || typeof parsed.y !== "number") return null;
    if (!Number.isFinite(parsed.x) || !Number.isFinite(parsed.y)) return null;
    return { x: parsed.x, y: parsed.y };
  } catch {
    return null;
  }
}

function writeStoredPosition(position: NoticePosition): void {
  try {
    globalThis.localStorage?.setItem(POSITION_STORAGE_KEY, JSON.stringify(position));
  } catch {
    return;
  }
}

function clampToViewport(position: NoticePosition, width: number, height: number): NoticePosition {
  const maxX = Math.max(VIEWPORT_MARGIN, window.innerWidth - width - VIEWPORT_MARGIN);
  const maxY = Math.max(VIEWPORT_MARGIN, window.innerHeight - height - VIEWPORT_MARGIN);
  return {
    x: Math.min(Math.max(VIEWPORT_MARGIN, position.x), maxX),
    y: Math.min(Math.max(VIEWPORT_MARGIN, position.y), maxY),
  };
}

export function ComputerUseTakeoverOverlay({
  sessionId,
  active = false,
  runId,
  stopping = false,
  onStop,
}: {
  sessionId?: string | null;
  active?: boolean;
  runId?: string | null;
  stopping?: boolean;
  onStop?: () => void | Promise<void>;
}) {
  const scope = `${sessionId ?? ""}:${runId ?? ""}`;
  const [takeover, setTakeover] = useState<ScopedTakeover | null>(null);
  const [dismissedScope, setDismissedScope] = useState<string | null>(null);
  const [position, setPosition] = useState<NoticePosition | null>(null);
  const [dragging, setDragging] = useState(false);
  const request = useRef<AbortController | null>(null);
  const surface = useRef<HTMLElement | null>(null);
  const drag = useRef<{ pointerId: number; offsetX: number; offsetY: number } | null>(null);
  const hidden = !active || stopping || dismissedScope === scope;

  useEffect(() => {
    if (!sessionId || hidden) {
      if (stopping) setDismissedScope(scope);
      return;
    }
    const controller = new AbortController();
    request.current = controller;
    let inFlight = false;
    const poll = async (): Promise<void> => {
      if (controller.signal.aborted || inFlight) return;
      inFlight = true;
      try {
        const response = await apiFetch(
          `/api/computer-use/active?sessionId=${encodeURIComponent(sessionId)}`,
          { signal: controller.signal }
        );
        if (!response.ok) throw new Error(`computer-use status ${response.status}`);
        const payload = (await response.json()) as { data?: ComputerUseTakeover | null };
        if (controller.signal.aborted) return;
        const data = payload.data;
        setTakeover(data?.sessionId === sessionId ? { key: scope, data } : null);
      } catch {
        if (!controller.signal.aborted) setTakeover(null);
      } finally {
        inFlight = false;
      }
    };
    void poll();
    const timer = setInterval(() => void poll(), POLL_INTERVAL_MS);
    return () => {
      controller.abort();
      clearInterval(timer);
      if (request.current === controller) request.current = null;
    };
  }, [hidden, scope, sessionId, stopping]);

  useEffect(() => {
    if (hidden || typeof window === "undefined") return;
    setPosition((current) => current ?? readStoredPosition());
  }, [hidden]);

  useEffect(() => {
    if (!position || typeof window === "undefined") return;
    const reclamp = (): void => {
      const rect = surface.current?.getBoundingClientRect();
      if (!rect) return;
      const next = clampToViewport(position, rect.width, rect.height);
      if (next.x !== position.x || next.y !== position.y) setPosition(next);
    };
    window.addEventListener("resize", reclamp);
    return () => window.removeEventListener("resize", reclamp);
  }, [position]);

  const currentPosition = useCallback((): NoticePosition | null => {
    const rect = surface.current?.getBoundingClientRect();
    if (!rect) return position;
    return clampToViewport(position ?? { x: rect.left, y: rect.top }, rect.width, rect.height);
  }, [position]);

  const startDrag = useCallback(
    (event: React.PointerEvent<HTMLElement>) => {
      if (event.button !== 0) return;
      const rect = surface.current?.getBoundingClientRect();
      if (!rect) return;
      const origin = currentPosition();
      event.preventDefault();
      drag.current = {
        pointerId: event.pointerId,
        offsetX: event.clientX - rect.left,
        offsetY: event.clientY - rect.top,
      };
      setPosition(origin);
      setDragging(true);
      event.currentTarget.setPointerCapture(event.pointerId);
    },
    [currentPosition]
  );

  const moveDrag = useCallback((event: React.PointerEvent<HTMLElement>) => {
    const state = drag.current;
    if (!state || state.pointerId !== event.pointerId) return;
    const rect = surface.current?.getBoundingClientRect();
    if (!rect) return;
    const next = clampToViewport(
      { x: event.clientX - state.offsetX, y: event.clientY - state.offsetY },
      rect.width,
      rect.height
    );
    setPosition(next);
    writeStoredPosition(next);
  }, []);

  const endDrag = useCallback((event: React.PointerEvent<HTMLElement>) => {
    if (drag.current?.pointerId !== event.pointerId) return;
    drag.current = null;
    setDragging(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }, []);

  const clampCandidate = useCallback((candidate: NoticePosition): NoticePosition => {
    const rect = surface.current?.getBoundingClientRect();
    if (!rect) return candidate;
    return clampToViewport(candidate, rect.width, rect.height);
  }, []);

  const moveByKeyboard = useCallback(
    (event: React.KeyboardEvent<HTMLElement>) => {
      const step = event.shiftKey ? KEYBOARD_STEP_LARGE_PX : KEYBOARD_STEP_PX;
      const deltas: Record<string, NoticePosition> = {
        ArrowUp: { x: 0, y: -step },
        ArrowDown: { x: 0, y: step },
        ArrowLeft: { x: -step, y: 0 },
        ArrowRight: { x: step, y: 0 },
      };
      const delta = deltas[event.key];
      if (!delta) return;
      event.preventDefault();
      const origin = currentPosition();
      if (!origin) return;
      const clamped = clampCandidate({ x: origin.x + delta.x, y: origin.y + delta.y });
      setPosition(clamped);
      writeStoredPosition(clamped);
    },
    [clampCandidate, currentPosition]
  );

  const resetPosition = useCallback(() => {
    setPosition(null);
    try {
      globalThis.localStorage?.removeItem(POSITION_STORAGE_KEY);
    } catch {
      return;
    }
  }, []);

  const dismiss = useCallback(() => {
    request.current?.abort();
    setDismissedScope(scope);
    setTakeover(null);
  }, [scope]);

  const stop = useCallback(() => {
    dismiss();
    void onStop?.();
  }, [dismiss, onStop]);

  if (hidden || takeover?.key !== scope) return null;

  return (
    <section
      ref={surface}
      aria-label="Computer use activity"
      data-testid="computer-use-takeover-surface"
      style={position ? { left: position.x, top: position.y, right: "auto" } : undefined}
      className={
        position
          ? "fixed z-50 flex w-[calc(100vw-2rem)] max-w-sm touch-none items-center gap-3 rounded-xl border border-amber-400/30 bg-gray-950 p-3 text-gray-100 shadow-lg"
          : "fixed right-4 top-20 z-50 flex w-[calc(100vw-2rem)] max-w-sm items-center gap-3 rounded-xl border border-amber-400/30 bg-gray-950 p-3 text-gray-100 shadow-lg sm:right-6"
      }
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          dismiss();
        }
      }}
    >
      <div
        role="button"
        tabIndex={0}
        data-testid="computer-use-drag-handle"
        aria-label="Move computer use notice. Use arrow keys, or double click to reset."
        title="Drag to move"
        onPointerDown={startDrag}
        onPointerMove={moveDrag}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onDoubleClick={resetPosition}
        onKeyDown={moveByKeyboard}
        className={`flex min-w-0 flex-1 cursor-grab touch-none items-center gap-3 rounded-lg focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-300 ${
          dragging ? "cursor-grabbing" : ""
        }`}
      >
        <Monitor className="h-5 w-5 shrink-0 text-amber-300" aria-hidden="true" />
        <div className="min-w-0 flex-1" role="status" aria-live="polite">
          <p className="text-sm font-medium">Cybara is using your computer</p>
          <p className="truncate text-xs text-gray-400">
            {takeover.data.yieldedToUser ? "Paused for your input" : takeover.data.app}
          </p>
        </div>
      </div>
      <button
        type="button"
        data-testid="computer-use-stop"
        onClick={stop}
        disabled={!onStop}
        className="inline-flex shrink-0 cursor-pointer items-center gap-1 rounded-lg border border-white/15 px-2 py-1.5 text-xs hover:bg-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-300 disabled:cursor-default disabled:opacity-50"
        aria-label="Stop computer use"
      >
        <OctagonX className="h-3.5 w-3.5" aria-hidden="true" />
        Stop
      </button>
      <button
        type="button"
        onClick={dismiss}
        className="shrink-0 cursor-pointer rounded-md p-1 text-gray-400 hover:bg-white/10 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-300"
        aria-label="Dismiss computer use notice"
        title="Hide this notice without stopping the task"
      >
        <X className="h-4 w-4" aria-hidden="true" />
      </button>
    </section>
  );
}
