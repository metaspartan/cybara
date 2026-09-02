import { useEffect, useState, type ReactElement } from "react";
import { GitBranch } from "lucide-react";
import { cn } from "@/lib/utils";
import { apiFetch } from "@/lib/auth";

export function GitStatus({
  path,
  compact = false,
  refreshKey,
  pollMs = 30000,
}: {
  path: string;
  compact?: boolean;
  refreshKey?: number | string;
  pollMs?: number;
}): ReactElement | null {
  const [branch, setBranch] = useState<string | null>(null);
  const [modified, setModified] = useState(0);
  const [untracked, setUntracked] = useState(0);

  useEffect(() => {
    let cancelled = false;
    let inFlight = false;
    const controller = new AbortController();

    const fetchGit = async (): Promise<void> => {
      if (inFlight) return;
      inFlight = true;
      try {
        const res = await apiFetch(`/api/git/status?path=${encodeURIComponent(path)}`, {
          signal: controller.signal,
        });
        const value: unknown = await res.json();
        if (cancelled) return;
        const data = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
        if (data.isRepo === true) {
          setBranch(typeof data.branch === "string" && data.branch ? data.branch : "HEAD");
          setModified(Array.isArray(data.modified) ? data.modified.length : 0);
          setUntracked(Array.isArray(data.untracked) ? data.untracked.length : 0);
        } else {
          setBranch(null);
        }
      } catch (err) {
        if (cancelled || (err instanceof Error && err.name === "AbortError")) return;
        setBranch(null);
      } finally {
        inFlight = false;
      }
    };

    void fetchGit();
    const refreshWhenVisible = (): void => {
      if (document.visibilityState === "visible") void fetchGit();
    };
    const timer = pollMs > 0 ? window.setInterval(refreshWhenVisible, pollMs) : undefined;
    window.addEventListener("focus", refreshWhenVisible);
    document.addEventListener("visibilitychange", refreshWhenVisible);

    return () => {
      cancelled = true;
      controller.abort();
      if (timer !== undefined) window.clearInterval(timer);
      window.removeEventListener("focus", refreshWhenVisible);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, [path, refreshKey, pollMs]);

  if (!branch) return null;

  return (
    <div
      className={cn(
        compact
          ? "flex items-center gap-2 text-xs text-gray-500"
          : "px-3 py-2 border-t border-white/10 bg-white/5"
      )}
    >
      <div className="flex items-center gap-2 text-xs text-gray-500">
        <GitBranch className="w-3 h-3" />
        <span className="text-indigo-400 font-medium">{branch}</span>
        {modified > 0 && <span className="text-yellow-400">~{modified}</span>}
        {untracked > 0 && <span className="text-gray-400">+{untracked}</span>}
      </div>
    </div>
  );
}
