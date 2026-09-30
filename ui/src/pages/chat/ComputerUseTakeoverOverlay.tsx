import { useEffect, useRef, useState } from "react";
import { apiFetch } from "@/lib/auth";
import { cn } from "@/lib/utils";

export interface ComputerUseTakeover {
  sessionId: string;
  app: string;
  startedAt: number;
  lastActionAt: number;
  yieldedToUser: boolean;
  reason: string | null;
}

const POLL_INTERVAL_MS = 1200;
const IDLE_HIDE_MS = 6000;

export function ComputerUseTakeoverOverlay({ sessionId }: { sessionId?: string | null }) {
  const [takeover, setTakeover] = useState<ComputerUseTakeover | null>(null);
  const [leaving, setLeaving] = useState(false);
  const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!sessionId) {
      setTakeover(null);
      return;
    }
    let cancelled = false;

    const poll = async () => {
      try {
        const response = await apiFetch(
          `/api/computer-use/active?sessionId=${encodeURIComponent(sessionId)}`
        );
        if (cancelled) return;
        if (!response.ok) throw new Error(`takeover status ${response.status}`);
        const payload = (await response.json()) as {
          data?: ComputerUseTakeover | null;
        };
        const data = payload.data ?? null;
        if (idleTimer.current) {
          clearTimeout(idleTimer.current);
          idleTimer.current = null;
        }
        if (data) {
          setTakeover(data);
          setLeaving(false);
          return;
        }
        setTakeover((current) => current);
        setLeaving(true);
        idleTimer.current = setTimeout(() => {
          setTakeover(null);
          setLeaving(false);
        }, IDLE_HIDE_MS);
      } catch {
        if (!cancelled) setTakeover(null);
      }
    };

    void poll();
    const interval = setInterval(poll, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
      if (idleTimer.current) clearTimeout(idleTimer.current);
    };
  }, [sessionId]);

  if (!takeover) return null;

  const yielded = takeover.yieldedToUser;

  return (
    <div
      role="status"
      aria-live="assertive"
      data-testid="computer-use-takeover"
      className={cn(
        "pointer-events-none fixed inset-x-0 top-0 z-[9999] flex justify-center px-4 pt-3 transition-all duration-500",
        leaving ? "-translate-y-full opacity-0" : "translate-y-0 opacity-100"
      )}
    >
      <div
        className={cn(
          "flex items-center gap-3 rounded-full border px-4 py-2 text-[13px] font-medium shadow-2xl backdrop-blur-xl transition-colors duration-300",
          yielded
            ? "border-amber-400/40 bg-amber-500/15 text-amber-100"
            : "border-[rgb(var(--accent-primary))]/40 bg-[rgb(var(--accent-primary))]/20 text-white"
        )}
      >
        <span className="relative flex h-2.5 w-2.5 shrink-0">
          <span
            className={cn(
              "absolute inline-flex h-full w-full animate-ping rounded-full opacity-75",
              yielded ? "bg-amber-300" : "bg-white"
            )}
          />
          <span
            className={cn(
              "relative inline-flex h-2.5 w-2.5 rounded-full",
              yielded ? "bg-amber-300" : "bg-white"
            )}
          />
        </span>
        <span className="truncate">
          {yielded
            ? takeover.reason || "You took control. Cybara paused so it does not fight you."
            : `Cybara is using your computer${takeover.app ? ` · ${takeover.app}` : ""}`}
        </span>
      </div>
    </div>
  );
}
