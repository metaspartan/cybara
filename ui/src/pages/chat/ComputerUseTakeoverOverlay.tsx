import { OctagonX } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
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

const POLL_INTERVAL_MS = 900;
const IDLE_HIDE_MS = 2500;
const TICK_MS = 1000;

function formatElapsed(startedAt: number, nowMs: number): string {
  const totalSeconds = Math.max(0, Math.floor((nowMs - startedAt) / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

export function ComputerUseTakeoverOverlay({
  sessionId,
  onStop,
}: {
  sessionId?: string | null;
  onStop?: () => void;
}) {
  const [takeover, setTakeover] = useState<ComputerUseTakeover | null>(null);
  const [leaving, setLeaving] = useState(false);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [stopping, setStopping] = useState(false);
  const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!takeover) return;
    const timer = setInterval(() => setNowMs(Date.now()), TICK_MS);
    return () => clearInterval(timer);
  }, [takeover]);

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
          setStopping(false);
          setNowMs(Date.now());
          return;
        }
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

  const stop = useCallback(() => {
    if (stopping) return;
    setStopping(true);
    onStop?.();
  }, [onStop, stopping]);

  useEffect(() => {
    if (!takeover) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        stop();
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [stop, takeover]);

  if (!takeover) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Cybara is using your computer"
      data-testid="computer-use-takeover-surface"
      className={cn(
        "fixed inset-0 z-[9999] flex items-center justify-center px-6 transition-opacity duration-500",
        leaving ? "pointer-events-none opacity-0" : "opacity-100"
      )}
    >
      <div className="absolute inset-0 bg-black/72 backdrop-blur-md" />
      <div
        className="pointer-events-none absolute inset-0 opacity-70"
        style={{
          background:
            "radial-gradient(1100px 700px at 50% 34%, rgba(var(--accent-primary), 0.22) 0%, transparent 68%)",
        }}
      />
      <div className="relative flex w-full max-w-xl flex-col items-center gap-7 text-center">
        <span className="relative flex h-4 w-4">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[rgb(var(--accent-primary))] opacity-70" />
          <span className="relative inline-flex h-4 w-4 rounded-full bg-[rgb(var(--accent-primary))]" />
        </span>
        <div className="flex flex-col gap-3">
          <h2 className="text-4xl font-semibold tracking-tight text-white">
            Cybara is using your computer
          </h2>
          <p className="text-base leading-relaxed text-white/70">
            Cybara keeps working while you use your computer. To take back control, stop the turn.
          </p>
        </div>
        <div className="flex items-center gap-3 rounded-full border border-white/15 bg-white/10 px-5 py-2 text-sm text-white/85 backdrop-blur-xl">
          {takeover.app ? (
            <span className="max-w-[16rem] truncate font-medium">{takeover.app}</span>
          ) : null}
          {takeover.app ? <span className="text-white/35">|</span> : null}
          <span className="tabular-nums text-white/70">
            {formatElapsed(takeover.startedAt, nowMs)} elapsed
          </span>
        </div>
        <button
          type="button"
          data-testid="computer-use-stop"
          onClick={stop}
          disabled={stopping}
          className={cn(
            "pointer-events-auto inline-flex items-center gap-2 rounded-xl border border-white/20 bg-white/10 px-6 py-3 text-sm font-semibold text-white shadow-2xl backdrop-blur-xl transition-colors",
            "hover:bg-white/20 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/70",
            "disabled:cursor-not-allowed disabled:opacity-60"
          )}
        >
          <OctagonX className="h-4 w-4" aria-hidden="true" />
          {stopping ? "Stopping" : "Stop"}
        </button>
      </div>
    </div>
  );
}
