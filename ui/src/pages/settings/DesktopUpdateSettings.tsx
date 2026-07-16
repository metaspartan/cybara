import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/Card";
import { useDesktopUpdate } from "@/hooks/useDesktopUpdate";
import { systemApi, type SystemBuildInfo } from "@/lib/api";
import {
  getDesktopHostRuntime,
  getDesktopRuntimeLabel,
  isDesktopUpdaterSupported,
} from "@/lib/desktopHost";
import { checkForUpdate, getUpdateState, startUpdateInstall } from "@/lib/updateStore";
import { formatByteCount } from "@/lib/settingsFormat";
import { useUIStore } from "@/stores/uiStore";
import { openExternal } from "@/utils/openExternal";
import {
  Clipboard,
  Download,
  ExternalLink,
  GitCommitHorizontal,
  MonitorUp,
  RefreshCw,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";

type UpdateStatus = "idle" | "checking" | "current" | "available" | "installing" | "error";

function BuildValue({ label, value }: { label: string; value: string | null | undefined }) {
  const { addToast } = useUIStore();
  const displayValue = value || "Unavailable";
  const copy = useCallback(async () => {
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      addToast("success", `${label} copied`);
    } catch {
      addToast("error", `Could not copy ${label.toLowerCase()}`);
    }
  }, [addToast, label, value]);

  return (
    <div className="grid gap-2 border-b border-[var(--surface-border)] py-3 last:border-b-0 sm:grid-cols-[160px_minmax(0,1fr)_32px] sm:items-center">
      <span className="text-sm text-[var(--text-muted)]">{label}</span>
      <code className="min-w-0 break-all font-mono text-xs text-[var(--text-primary)]">
        {displayValue}
      </code>
      <Button
        size="sm"
        variant="ghost"
        className="h-8 w-8 p-0"
        aria-label={`Copy ${label}`}
        title={`Copy ${label}`}
        disabled={!value}
        onClick={() => void copy()}
      >
        <Clipboard className="h-4 w-4" />
      </Button>
    </div>
  );
}

export function DesktopUpdateSettings({
  currentVersion,
  releaseRepositoryUrl,
}: {
  currentVersion: string;
  releaseRepositoryUrl?: string;
}) {
  const { addToast } = useUIStore();
  const [buildInfo, setBuildInfo] = useState<SystemBuildInfo | null>(null);
  const [buildInfoLoading, setBuildInfoLoading] = useState(true);
  const desktopRuntime = getDesktopHostRuntime();
  const isDesktopRuntime = desktopRuntime !== null;
  const supportsUpdater = isDesktopUpdaterSupported();
  const runtimeLabel = getDesktopRuntimeLabel(desktopRuntime);
  const {
    phase,
    available: availableUpdate,
    downloadedBytes,
    totalBytes,
    lastCheckedAt,
    error: updateError,
  } = useDesktopUpdate();

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      const response = await systemApi.buildInfo();
      if (!mounted) return;
      if (response.success && response.data) setBuildInfo(response.data);
      setBuildInfoLoading(false);
    };
    void load();
    return () => {
      mounted = false;
    };
  }, []);

  const status: UpdateStatus = !isDesktopRuntime
    ? "idle"
    : !supportsUpdater
      ? "current"
      : phase === "downloading" || phase === "installing" || phase === "done"
        ? "installing"
        : phase;

  const statusMessage = !isDesktopRuntime
    ? "Desktop updates are managed by the installed Cybara application. This browser is connected to the gateway build shown below."
    : !supportsUpdater
      ? "This desktop host checks and installs releases through its native application updater."
      : phase === "done"
        ? `Installed ${availableUpdate?.version ?? "update"}. Restarting Cybara...`
        : phase === "downloading" || phase === "installing"
          ? `Downloading and installing ${availableUpdate?.version ?? "update"}...`
          : phase === "available"
            ? (updateError ?? `Version ${availableUpdate?.version} is available to install.`)
            : phase === "error"
              ? (updateError ?? "Desktop update check failed.")
              : phase === "current"
                ? "This desktop build is already on the latest published release."
                : phase === "checking"
                  ? "Checking GitHub Releases for a newer desktop build..."
                  : "Check for signed Cybara desktop updates published to GitHub Releases.";

  const handleCheck = useCallback(async () => {
    if (!isDesktopRuntime || !supportsUpdater) return;
    await checkForUpdate();
    const latest = getUpdateState();
    if (latest.phase === "available" && latest.available) {
      addToast("success", `Desktop update ${latest.available.version} is ready to install`);
    } else if (latest.phase === "current") {
      addToast("success", "Cybara desktop is already up to date");
    } else if (latest.error) {
      addToast("error", latest.error);
    }
  }, [addToast, isDesktopRuntime, supportsUpdater]);

  const handleInstall = useCallback(async () => {
    await startUpdateInstall();
    const latest = getUpdateState();
    if (latest.error && latest.phase === "available") addToast("error", latest.error);
  }, [addToast]);

  const repositoryUrl = buildInfo?.release_repository_url || releaseRepositoryUrl;
  const releasesUrl = repositoryUrl ? `${repositoryUrl}/releases` : null;
  const commitUrl =
    repositoryUrl && buildInfo?.commit ? `${repositoryUrl}/commit/${buildInfo.commit}` : null;
  const updateBodyPreview = availableUpdate?.body?.trim()
    ? availableUpdate.body.trim().slice(0, 280)
    : null;
  const progressLabel =
    status === "installing"
      ? totalBytes && totalBytes > 0
        ? `${formatByteCount(downloadedBytes)} / ${formatByteCount(totalBytes)}`
        : `${formatByteCount(downloadedBytes)} downloaded`
      : null;
  const statusVariant =
    status === "available"
      ? "warning"
      : status === "current"
        ? "success"
        : status === "error"
          ? "error"
          : "default";
  const statusLabel =
    status === "available"
      ? "Update Available"
      : status === "current"
        ? "Up To Date"
        : status === "installing"
          ? "Installing"
          : status === "error"
            ? "Unavailable"
            : status === "checking"
              ? "Checking"
              : "Gateway Build";

  return (
    <div className="space-y-6">
      <Card variant="liquid">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <MonitorUp className="h-5 w-5 text-[rgb(var(--accent-primary))]" />
            Updates
          </CardTitle>
          <CardDescription>Version status and signed desktop releases</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={statusVariant}>{statusLabel}</Badge>
            <Badge variant="info">{runtimeLabel}</Badge>
            <span className="text-xs text-[var(--text-muted)]">
              Current version:{" "}
              <span className="text-[var(--text-primary)]">{currentVersion || "unknown"}</span>
            </span>
            {availableUpdate ? (
              <span className="text-xs text-[rgb(var(--accent-primary))]">
                Latest: {availableUpdate.version}
              </span>
            ) : null}
          </div>

          <div className="rounded-lg border border-[var(--surface-border)] bg-[var(--surface-subtle)] p-3">
            <p className="text-sm text-[var(--text-primary)]">{statusMessage}</p>
            {progressLabel ? (
              <p className="mt-1 text-xs text-[rgb(var(--accent-primary))]">{progressLabel}</p>
            ) : null}
            {lastCheckedAt ? (
              <p className="mt-1 text-[11px] text-[var(--text-subtle)]">
                Last checked {new Date(lastCheckedAt).toLocaleString()}
              </p>
            ) : null}
            {updateBodyPreview ? (
              <p className="mt-2 whitespace-pre-wrap break-words text-xs text-[var(--text-muted)]">
                {updateBodyPreview}
                {availableUpdate?.body &&
                availableUpdate.body.trim().length > updateBodyPreview.length
                  ? "..."
                  : ""}
              </p>
            ) : null}
          </div>

          <div className="flex flex-wrap gap-2">
            {isDesktopRuntime ? (
              <Button
                variant="outline"
                onClick={() => void handleCheck()}
                disabled={status === "checking" || status === "installing" || !supportsUpdater}
              >
                <RefreshCw className={`h-4 w-4 ${status === "checking" ? "animate-spin" : ""}`} />
                {supportsUpdater ? "Check Now" : "Native Updater"}
              </Button>
            ) : null}
            {availableUpdate && supportsUpdater ? (
              <Button
                variant="primary"
                onClick={() => void handleInstall()}
                disabled={status === "installing"}
              >
                <Download className="h-4 w-4" />
                Install And Restart
              </Button>
            ) : null}
            {releasesUrl ? (
              <Button
                variant="ghost"
                onClick={() => void openExternal(releasesUrl)}
                disabled={status === "installing"}
              >
                <ExternalLink className="h-4 w-4" />
                View Releases
              </Button>
            ) : null}
          </div>
        </CardContent>
      </Card>

      <Card variant="liquid">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <GitCommitHorizontal className="h-5 w-5 text-[rgb(var(--accent-primary))]" />
            Build Provenance
          </CardTitle>
          <CardDescription>Exact source revision and executable integrity hash</CardDescription>
        </CardHeader>
        <CardContent>
          <BuildValue label="Release commit" value={buildInfo?.commit} />
          <BuildValue label="SHA-256" value={buildInfo?.executable_sha256} />
          <BuildValue label="Executable" value={buildInfo?.executable_name} />
          {buildInfoLoading ? (
            <p className="pt-3 text-xs text-[var(--text-subtle)]">
              Calculating executable SHA-256...
            </p>
          ) : null}
          {commitUrl ? (
            <Button className="mt-3" variant="ghost" onClick={() => void openExternal(commitUrl)}>
              <ExternalLink className="h-4 w-4" />
              View Commit
            </Button>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
