import { ArrowUpCircle, Check, Download, ExternalLink, Loader2, RotateCcw, X } from "lucide-react";
import { useState } from "react";
import { useUpdateCheck } from "@/hooks/useApi";
import { useDesktopUpdate } from "@/hooks/useDesktopUpdate";
import { isTauriDesktopRuntime } from "@/lib/desktopHost";

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(0, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(bytes >= 10 * 1024 * 1024 ? 0 : 1)} MB`;
}

function DesktopUpdateBanner() {
  const { phase, available, progress, downloadedBytes, totalBytes, error, startUpdate } =
    useDesktopUpdate();
  const [dismissedVersion, setDismissedVersion] = useState<string | null>(null);
  const version = available?.version ?? null;
  const busy = phase === "downloading" || phase === "installing" || phase === "done";

  if (!version || (!busy && dismissedVersion === version)) return null;
  if (phase !== "available" && !busy) return null;

  const status =
    phase === "downloading"
      ? progress > 0
        ? `Downloading ${Math.round(progress * 100)}%`
        : "Starting download"
      : phase === "installing"
        ? "Installing update"
        : phase === "done"
          ? "Restarting Cybara"
          : error
            ? "Update failed"
            : `Version ${version} is ready`;
  const detail =
    downloadedBytes > 0
      ? totalBytes && totalBytes > 0
        ? `${formatBytes(downloadedBytes)} of ${formatBytes(totalBytes)}`
        : `${formatBytes(downloadedBytes)} downloaded`
      : error;
  const StatusIcon =
    phase === "done" ? Check : phase === "available" ? (error ? RotateCcw : Download) : Loader2;

  return (
    <div className="flex min-h-11 items-center gap-3 border-b border-[var(--surface-border)] bg-[var(--surface-panel)] px-4 py-2 text-sm text-[var(--text-primary)]">
      <StatusIcon
        className={`h-4 w-4 shrink-0 text-[rgb(var(--accent-primary))] ${busy && phase !== "done" ? "animate-spin" : ""}`}
      />
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium">{status}</p>
        {detail ? <p className="truncate text-xs text-[var(--text-muted)]">{detail}</p> : null}
      </div>
      {phase === "available" ? (
        <button
          type="button"
          onClick={() => void startUpdate()}
          className="rounded-md bg-[rgb(var(--accent-primary))] px-3 py-1.5 text-xs font-semibold text-white transition-opacity hover:opacity-90"
        >
          {error ? "Retry" : "Install and restart"}
        </button>
      ) : null}
      {!busy ? (
        <button
          type="button"
          onClick={() => setDismissedVersion(version)}
          className="rounded-md p-1 text-[var(--text-muted)] hover:bg-[var(--surface-elevated)] hover:text-[var(--text-primary)]"
          aria-label="Dismiss update banner"
        >
          <X className="h-4 w-4" />
        </button>
      ) : null}
    </div>
  );
}

function WebUpdateBanner() {
  const { data } = useUpdateCheck();
  const [dismissed, setDismissed] = useState(false);

  if (dismissed || !data?.updateAvailable || !data.latestVersion) return null;

  const releaseUrl =
    data.releaseUrl || `https://github.com/metaspartan/cybara/releases/tag/v${data.latestVersion}`;

  return (
    <div className="flex min-h-11 items-center gap-3 border-b border-[var(--surface-border)] bg-[var(--surface-panel)] px-4 py-2 text-sm text-[var(--text-primary)]">
      <ArrowUpCircle className="h-4 w-4 shrink-0 text-[rgb(var(--accent-primary))]" />
      <span className="min-w-0 flex-1 truncate">
        Cybara <span className="font-semibold">v{data.latestVersion}</span> is available. Run{" "}
        <code className="rounded bg-[var(--surface-elevated)] px-1 py-0.5">cybara update</code>.
      </span>
      <a
        href={releaseUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1 text-[rgb(var(--accent-primary))] hover:opacity-80"
      >
        Release notes <ExternalLink className="h-3 w-3" />
      </a>
      <button
        type="button"
        onClick={() => setDismissed(true)}
        className="rounded-md p-1 text-[var(--text-muted)] hover:bg-[var(--surface-elevated)] hover:text-[var(--text-primary)]"
        aria-label="Dismiss update banner"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}

export function UpdateBanner() {
  return isTauriDesktopRuntime() ? <DesktopUpdateBanner /> : <WebUpdateBanner />;
}
