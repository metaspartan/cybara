/** Git status bar widget — shows branch + modified/untracked counts. */
import { useState, useEffect } from "react";
import { GitBranch } from "lucide-react";
import { cn } from "@/lib/utils";
import { apiFetch } from "@/lib/auth";

export function GitStatus({
  path,
  compact = false,
  refreshKey,
  pollMs = 15000,
}: {
  path: string;
  compact?: boolean;
  /** Bump to force an immediate refresh (e.g. after a save/commit). */
  refreshKey?: number | string;
  /** Background refresh interval; set 0 to disable polling. */
  pollMs?: number;
}) {
  const [branch, setBranch] = useState<string | null>(null);
  const [modified, setModified] = useState(0);
  const [untracked, setUntracked] = useState(0);

  useEffect(() => {
    // Guard against setState-after-unmount and out-of-order responses when the
    // path changes or the component unmounts mid-request.
    let cancelled = false;
    const controller = new AbortController();

    const fetchGit = async () => {
      try {
        const res = await apiFetch(`/api/git/status?path=${encodeURIComponent(path)}`, {
          signal: controller.signal,
        });
        const data = await res.json();
        if (cancelled) return;
        if (data.isRepo) {
          setBranch(data.branch || "HEAD");
          setModified(data.modified?.length || 0);
          setUntracked(data.untracked?.length || 0);
        } else {
          setBranch(null);
        }
      } catch (err) {
        if (cancelled || (err as Error)?.name === "AbortError") return;
        setBranch(null);
      }
    };

    void fetchGit();

    // Poll so branch/modified counts don't go stale after edits or commits —
    // everything else in the IDE stays live, this used to be a frozen snapshot.
    const timer = pollMs > 0 ? window.setInterval(() => void fetchGit(), pollMs) : undefined;

    return () => {
      cancelled = true;
      controller.abort();
      if (timer !== undefined) window.clearInterval(timer);
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
