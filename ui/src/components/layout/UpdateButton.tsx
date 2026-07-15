import { Check, Download } from "lucide-react";
import { useDesktopUpdate } from "@/hooks/useDesktopUpdate";
import { cn } from "@/lib/utils";

function ProgressDonut({ progress }: { progress: number }) {
  const radius = 7;
  const circumference = 2 * Math.PI * radius;
  const clamped = Math.max(0, Math.min(1, progress));
  const indeterminate = clamped <= 0;
  return (
    <svg
      viewBox="0 0 18 18"
      className={cn("h-3.5 w-3.5 -rotate-90", indeterminate && "update-spin")}
    >
      <circle
        cx="9"
        cy="9"
        r={radius}
        fill="none"
        stroke="currentColor"
        strokeOpacity={0.25}
        strokeWidth={2}
      />
      <circle
        cx="9"
        cy="9"
        r={radius}
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeDasharray={circumference}
        strokeDashoffset={indeterminate ? circumference * 0.75 : circumference * (1 - clamped)}
        style={{ transition: "stroke-dashoffset 0.3s ease" }}
      />
    </svg>
  );
}

export function UpdateButton({ collapsed }: { collapsed?: boolean }) {
  const { phase, available, progress, downloadedBytes, totalBytes, error, startUpdate } =
    useDesktopUpdate();

  const busy = phase === "downloading" || phase === "installing";
  const done = phase === "done";

  if (phase !== "available" && !busy && !done) return null;

  const label = done
    ? "Updated"
    : phase === "installing"
      ? "Installing"
      : phase === "downloading"
        ? progress > 0
          ? `${Math.round(progress * 100)}%`
          : "Downloading"
        : error
          ? "Retry Update"
          : "Update";
  const byteProgress =
    downloadedBytes > 0
      ? totalBytes && totalBytes > 0
        ? `${Math.round(downloadedBytes / 1024 / 1024)} of ${Math.round(totalBytes / 1024 / 1024)} MB`
        : `${Math.round(downloadedBytes / 1024 / 1024)} MB downloaded`
      : null;
  const title = error
    ? `Update failed: ${error}`
    : byteProgress
      ? `${label} · ${byteProgress}`
      : available
        ? `Update to ${available.version}`
        : label;

  return (
    <button
      type="button"
      onClick={() => phase === "available" && void startUpdate()}
      disabled={busy || done}
      aria-label={available ? `Update to ${available.version}` : "Update"}
      title={title}
      className={cn(
        "update-pill group flex h-8 flex-shrink-0 items-center justify-center overflow-hidden rounded-lg border text-[11px] font-medium transition-all duration-300",
        done ? "update-pop-shell" : "",
        done
          ? "border-emerald-500/40 bg-emerald-500/15 text-emerald-300"
          : error
            ? "border-red-500/40 bg-red-500/10 text-red-300 hover:bg-red-500/15"
            : "border-[rgba(var(--accent-primary),0.4)] bg-[rgba(var(--accent-primary),0.14)] text-[var(--text-primary)] hover:bg-[rgba(var(--accent-primary),0.22)]",
        collapsed ? "w-8" : "px-2",
        busy && "cursor-default"
      )}
    >
      <span className="relative flex h-3.5 w-3.5 flex-shrink-0 items-center justify-center">
        {busy ? (
          <ProgressDonut progress={progress} />
        ) : done ? (
          <Check className="update-pop h-3.5 w-3.5" />
        ) : (
          <Download className="h-3.5 w-3.5" />
        )}
      </span>
      {!collapsed && (
        <span
          className={cn(
            "whitespace-nowrap transition-all duration-300",
            phase === "available"
              ? "max-w-0 opacity-0 group-hover:ml-2 group-hover:max-w-[140px] group-hover:opacity-100"
              : "ml-2 max-w-[160px] opacity-100"
          )}
        >
          {label}
        </span>
      )}
    </button>
  );
}
