import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { PageLayout } from "@/components/layout";
import {
  useHealth,
  useInfo,
  useSystemMonitor,
  useSystemPrompt,
  useSystemPromptPreview,
  useUpdateSystemPrompt,
  useIdentity,
  useUpdateIdentity,
  useProviders,
  type SystemPromptConfig,
  type IdentityConfig,
  type HealthData,
  type InfoData,
} from "@/hooks/useApi";
import {
  extractApiError,
  settingsApi,
  computerUseApi,
  sandboxBrowserApi,
  type ComputerUseStatus,
  type SandboxBrowserStatus,
} from "@/lib/api";
import { openExternal } from "@/utils/openExternal";
import {
  checkForDesktopUpdate,
  describeDesktopUpdaterError,
  installDesktopUpdate,
  relaunchDesktopApp,
} from "@/lib/desktopUpdater";
import {
  getDesktopHostRuntime,
  getDesktopRuntimeLabel,
  isDesktopUpdaterSupported,
  openDesktopFileDialog,
} from "@/lib/desktopHost";
import { Input, Textarea, Select } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import {
  readThemeAccentFromConfig,
  themeAccentKeys,
  themeAccents,
  themeConfigPayload,
  useUIStore,
  type ThemeAccent,
} from "@/stores/uiStore";
import {
  Activity,
  AlertTriangle,
  Server,
  Database,
  Cpu,
  Clock,
  CheckCircle,
  Bot,
  Cloud,
  HardDrive,
  Brain,
  User,
  Save,
  Sparkles,
  Eye,
  Palette,
  RefreshCw,
  Shield,
  Download,
  ExternalLink,
  MonitorUp,
  Mic,
  Volume2,
} from "lucide-react";
import { useState, useRef, useEffect, useCallback } from "react";
import type { Update, DownloadEvent } from "@tauri-apps/plugin-updater";

function getCheckStatus(value: unknown): {
  status: "healthy" | "warning" | "error";
  details?: string;
} {
  if (typeof value === "string") {
    return { status: value === "healthy" ? "healthy" : "error" };
  }
  if (typeof value === "object" && value !== null) {
    const obj = value as Record<string, unknown>;
    if (obj.status === "healthy") return { status: "healthy" };
    if (obj.status) return { status: obj.status as "error" };
    if ("total" in obj) {
      const running = obj.running !== undefined ? `, ${obj.running} running` : "";
      return { status: "healthy", details: `${obj.total} total${running}` };
    }
    if ("heapUsed" in obj) {
      return { status: "healthy", details: `${obj.heapUsed}MB / ${obj.heapTotal}MB` };
    }
  }
  return { status: "healthy" };
}

function formatBytes(bytes?: number): string {
  const value = Number(bytes || 0);
  if (value >= 1024 * 1024 * 1024) return `${(value / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  if (value >= 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(1)} MB`;
  if (value >= 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${Math.round(value)} B`;
}

function formatStorageBytes(bytes?: number): string {
  const value = Number(bytes || 0);
  if (value >= 1000 * 1000 * 1000) return `${(value / (1000 * 1000 * 1000)).toFixed(2)} GB`;
  if (value >= 1000 * 1000) return `${(value / (1000 * 1000)).toFixed(1)} MB`;
  if (value >= 1000) return `${(value / 1000).toFixed(1)} KB`;
  return `${Math.round(value)} B`;
}

function formatPct(value?: number | null): string {
  return typeof value === "number" && Number.isFinite(value) ? `${value.toFixed(1)}%` : "n/a";
}

function ThemeSettings() {
  const { accent, setAccent, addToast } = useUIStore();
  const [savingAccent, setSavingAccent] = useState<ThemeAccent | null>(null);

  const accentColors: Record<ThemeAccent, string> = {
    indigo: "bg-indigo-500",
    blue: "bg-blue-500",
    cyan: "bg-cyan-500",
    teal: "bg-teal-500",
    emerald: "bg-emerald-500",
    amber: "bg-amber-500",
    orange: "bg-orange-500",
    rose: "bg-rose-500",
    pink: "bg-pink-500",
    purple: "bg-purple-500",
  };

  useEffect(() => {
    let mounted = true;
    const loadGatewayTheme = async () => {
      try {
        const result = await settingsApi.getConfig();
        if (!mounted || !result.success) return;
        const configAccent = readThemeAccentFromConfig(result.data);
        if (configAccent) setAccent(configAccent);
      } catch {
        // Keep the locally persisted accent if the gateway is unavailable.
      }
    };
    void loadGatewayTheme();
    return () => {
      mounted = false;
    };
  }, [setAccent]);

  const updateAccent = async (key: ThemeAccent) => {
    if (savingAccent || key === accent) return;
    const previous = accent;
    setAccent(key);
    setSavingAccent(key);
    try {
      const result = await settingsApi.updateConfig(themeConfigPayload(key));
      if (!result.success || !result.data?.success) {
        throw new Error(result.error || "Config update failed");
      }
      addToast("success", `Theme changed to ${themeAccents[key].name}`);
    } catch {
      setAccent(previous);
      addToast("error", "Failed to update theme");
    } finally {
      setSavingAccent(null);
    }
  };

  return (
    <Card variant="liquid">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Palette className="w-5 h-5 text-indigo-400" />
          Theme Settings
        </CardTitle>
        <CardDescription>Customize the UI accent color</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex flex-wrap gap-3">
          {themeAccentKeys.map((key) => (
            <button
              key={key}
              aria-pressed={accent === key}
              disabled={savingAccent !== null}
              onClick={() => void updateAccent(key)}
              className={cn(
                "w-12 h-12 rounded-xl transition-all cursor-pointer",
                accentColors[key],
                accent === key
                  ? "ring-2 ring-white ring-offset-2 ring-offset-[#0a0a0f] scale-110"
                  : "hover:scale-105 opacity-70 hover:opacity-100",
                savingAccent !== null && "cursor-not-allowed"
              )}
              title={themeAccents[key].name}
            />
          ))}
        </div>
        <p className="text-xs text-gray-500 mt-3">Selected: {themeAccents[accent].name}</p>
      </CardContent>
    </Card>
  );
}

function DesktopUpdateSettings({
  currentVersion,
  releaseRepositoryUrl,
}: {
  currentVersion: string;
  releaseRepositoryUrl?: string;
}) {
  const { addToast } = useUIStore();
  const desktopRuntime = getDesktopHostRuntime();
  const isDesktopRuntime = desktopRuntime !== null;
  const supportsUpdater = isDesktopUpdaterSupported();
  const runtimeLabel = getDesktopRuntimeLabel(desktopRuntime);
  const [status, setStatus] = useState<
    "idle" | "checking" | "current" | "available" | "installing" | "error"
  >("idle");
  const [statusMessage, setStatusMessage] = useState(
    "Check for signed Cybara desktop updates published to GitHub Releases."
  );
  const [availableUpdate, setAvailableUpdate] = useState<Update | null>(null);
  const [lastCheckedAt, setLastCheckedAt] = useState<string | null>(null);
  const [downloadedBytes, setDownloadedBytes] = useState(0);
  const [totalBytes, setTotalBytes] = useState<number | null>(null);
  const checkedOnMountRef = useRef(false);

  const handleCheck = useCallback(
    async (silent = false) => {
      if (!isDesktopRuntime) return;
      if (!supportsUpdater) {
        setStatus("current");
        setAvailableUpdate(null);
        setLastCheckedAt(new Date().toISOString());
        setStatusMessage(
          "This native Cybara macOS app uses the same local gateway on http://127.0.0.1:4269, but in-app signed updater installs are not wired for this host yet. Use GitHub Releases or rebuild from source."
        );
        return;
      }

      setStatus("checking");
      setDownloadedBytes(0);
      setTotalBytes(null);
      if (!silent) {
        setStatusMessage("Checking GitHub Releases for a newer desktop build...");
      }

      try {
        const update = await checkForDesktopUpdate();
        setLastCheckedAt(new Date().toISOString());

        if (update) {
          setAvailableUpdate(update);
          setStatus("available");
          setStatusMessage(`Version ${update.version} is available to install.`);
          if (!silent) {
            addToast("success", `Desktop update ${update.version} is ready to install`);
          }
          return;
        }

        setAvailableUpdate(null);
        setStatus("current");
        setStatusMessage("This desktop build is already on the latest published release.");
        if (!silent) {
          addToast("success", "Cybara desktop is already up to date");
        }
      } catch (error) {
        const message = describeDesktopUpdaterError(error);
        setAvailableUpdate(null);
        setStatus("error");
        setStatusMessage(message);
        if (!silent) {
          addToast("error", message);
        }
      }
    },
    [addToast, isDesktopRuntime, supportsUpdater]
  );

  const handleInstall = useCallback(async () => {
    if (!availableUpdate) return;

    setStatus("installing");
    setDownloadedBytes(0);
    setTotalBytes(null);
    setStatusMessage(`Downloading and installing ${availableUpdate.version}...`);

    try {
      await installDesktopUpdate(availableUpdate, (event: DownloadEvent) => {
        if (event.event === "Started") {
          setDownloadedBytes(0);
          setTotalBytes(event.data.contentLength || null);
          return;
        }
        if (event.event === "Progress") {
          setDownloadedBytes((previous) => previous + event.data.chunkLength);
          return;
        }
        if (event.event === "Finished") {
          setStatusMessage(`Installed ${availableUpdate.version}. Restarting Cybara...`);
        }
      });
      addToast("success", `Installed ${availableUpdate.version}. Restarting Cybara...`);
      await relaunchDesktopApp();
    } catch (error) {
      const message = describeDesktopUpdaterError(error);
      setStatus("available");
      setStatusMessage(message);
      addToast("error", message);
    }
  }, [addToast, availableUpdate]);

  useEffect(() => {
    if (!isDesktopRuntime || checkedOnMountRef.current) return;
    checkedOnMountRef.current = true;
    void handleCheck(true);
  }, [handleCheck, isDesktopRuntime]);

  if (!isDesktopRuntime) {
    return null;
  }

  const releasesUrl = releaseRepositoryUrl ? `${releaseRepositoryUrl}/releases` : null;
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
              : "Idle";

  return (
    <Card variant="liquid">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <MonitorUp className="w-5 h-5 text-emerald-400" />
          Desktop Updates
        </CardTitle>
        <CardDescription>
          {supportsUpdater
            ? `Signed updates for the ${runtimeLabel}`
            : `${runtimeLabel} runtime attached to the local Cybara gateway`}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={statusVariant}>{statusLabel}</Badge>
          <Badge variant="info">{runtimeLabel}</Badge>
          <span className="text-xs text-gray-400">
            Current version: <span className="text-white">{currentVersion || "unknown"}</span>
          </span>
          {availableUpdate && (
            <span className="text-xs text-emerald-300">Latest: {availableUpdate.version}</span>
          )}
        </div>

        <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
          <p className="text-sm text-white">{statusMessage}</p>
          {progressLabel && <p className="mt-1 text-xs text-emerald-300">{progressLabel}</p>}
          {lastCheckedAt && (
            <p className="mt-1 text-[11px] text-gray-500">
              Last checked {new Date(lastCheckedAt).toLocaleString()}
            </p>
          )}
          {updateBodyPreview && (
            <p className="mt-2 text-xs text-gray-300 whitespace-pre-wrap break-words">
              {updateBodyPreview}
              {availableUpdate?.body &&
              availableUpdate.body.trim().length > updateBodyPreview.length
                ? "..."
                : ""}
            </p>
          )}
        </div>

        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            onClick={() => void handleCheck()}
            disabled={status === "checking" || status === "installing" || !supportsUpdater}
          >
            <RefreshCw className={`w-4 h-4 ${status === "checking" ? "animate-spin" : ""}`} />
            {supportsUpdater ? "Check Now" : "Built From Source"}
          </Button>
          {availableUpdate && supportsUpdater && (
            <Button
              variant="primary"
              onClick={() => void handleInstall()}
              disabled={status === "installing"}
            >
              <Download className="w-4 h-4" />
              Install And Restart
            </Button>
          )}
          {releasesUrl && (
            <Button
              variant="ghost"
              onClick={() => void openExternal(releasesUrl)}
              disabled={status === "installing"}
            >
              <ExternalLink className="w-4 h-4" />
              View Releases
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

type SandboxProviderOption = "auto" | "apple_sandbox" | "podman" | "docker";
type SettingsSectionId = "general" | "ai-memory" | "voice" | "safety" | "desktop" | "system";

const settingsSections: Array<{ id: SettingsSectionId; label: string }> = [
  { id: "general", label: "General" },
  { id: "ai-memory", label: "AI & Memory" },
  { id: "voice", label: "Voice" },
  { id: "safety", label: "Safety" },
  { id: "desktop", label: "Desktop" },
  { id: "system", label: "System" },
];

interface SandboxStatusView {
  enabled: boolean;
  configuredProvider: SandboxProviderOption;
  network: "allow" | "deny";
  resolvedProvider: "apple_sandbox" | "podman" | "docker" | null;
  available: boolean;
  reason?: string;
  providers: Array<{
    provider: "apple_sandbox" | "podman" | "docker";
    supported: boolean;
    installed: boolean;
    available: boolean;
    reason?: string;
  }>;
  checkedAt: string;
  lastEvent: {
    phase: "prepared" | "disabled" | "error";
    provider: "apple_sandbox" | "podman" | "docker" | "host" | null;
    commandPreview?: string;
    cwd?: string;
    network?: "allow" | "deny";
    reason?: string;
    timestamp: string;
  } | null;
}

function ComputerUseSettings() {
  const [status, setStatus] = useState<ComputerUseStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [granting, setGranting] = useState(false);
  const [savingDriverPath, setSavingDriverPath] = useState(false);
  const [driverPathInput, setDriverPathInput] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const canBrowseForDriver = getDesktopHostRuntime() === "tauri";

  const load = useCallback(async () => {
    setLoading(true);
    const res = await computerUseApi.getStatus();
    if (res.success && res.data) {
      setStatus(res.data);
      setDriverPathInput(res.data.configuredCommand || "");
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const grant = useCallback(async () => {
    setGranting(true);
    setNote(null);
    const res = await computerUseApi.grantPermissions();
    if (res.success && res.data) setNote(res.data.message);
    setGranting(false);
    await load();
  }, [load]);

  const saveDriverPath = useCallback(
    async (nextPath = driverPathInput) => {
      setSavingDriverPath(true);
      setNote(null);
      const trimmed = nextPath.trim();
      const res = await settingsApi.updateConfig({
        computer_use: { driverCommand: trimmed },
      });
      if (res.success) {
        setNote(trimmed ? "Saved cua-driver path override." : "Cleared cua-driver path override.");
        await load();
      } else {
        setNote(`Could not save cua-driver path: ${extractApiError(res, "Config update failed")}`);
      }
      setSavingDriverPath(false);
    },
    [driverPathInput, load]
  );

  const browseDriverPath = useCallback(async () => {
    const selected = await openDesktopFileDialog({
      defaultPath: driverPathInput || status?.command,
      title: "Choose cua-driver executable",
      filters:
        status?.platform === "win32"
          ? [{ name: "Windows executables", extensions: ["exe", "cmd", "bat"] }]
          : undefined,
    });
    if (selected) {
      setDriverPathInput(selected);
    }
  }, [driverPathInput, status?.command, status?.platform]);

  const yesNo = (v?: boolean) =>
    v === undefined ? (
      <Badge variant="default">n/a</Badge>
    ) : v ? (
      <Badge variant="success">Yes</Badge>
    ) : (
      <Badge variant="error">No</Badge>
    );
  const driverSourceLabel = (source?: ComputerUseStatus["driverSource"]) => {
    switch (source) {
      case "env":
        return "Environment";
      case "config":
        return "Saved override";
      case "path":
        return "PATH";
      case "known-install-dir":
        return "Known install directory";
      case "default":
        return "Default command";
      default:
        return "Unknown";
    }
  };

  return (
    <Card variant="liquid">
      <CardHeader>
        <CardTitle>Computer Use</CardTitle>
        <CardDescription>
          Background desktop control via the cua-driver engine.{" "}
          {status?.platform === "darwin"
            ? "Install it and grant macOS Accessibility + Screen Recording permissions to let agents see and control the screen."
            : status?.platform === "win32"
              ? "Windows computer use runs on the active desktop, so keep the target app visible while agents work."
              : "Install the cua-driver engine to let agents see and control the screen."}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {loading ? (
          <p className="text-sm text-gray-400">Checking status…</p>
        ) : status ? (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
              <span className="flex items-center gap-2">Installed {yesNo(status.available)}</span>
              {status.version && <span className="text-gray-400">v{status.version}</span>}
              {status.platform === "darwin" && (
                <>
                  <span className="flex items-center gap-2">
                    Accessibility {yesNo(status.accessibility)}
                  </span>
                  <span className="flex items-center gap-2">
                    Screen Recording {yesNo(status.screenRecording)}
                  </span>
                </>
              )}
              <span className="flex items-center gap-2">
                Ready{" "}
                {status.ready ? (
                  <Badge variant="success">Yes</Badge>
                ) : (
                  <Badge variant="error">No</Badge>
                )}
              </span>
            </div>
            <p className="text-sm text-gray-400">{status.message}</p>
            {status.available && (
              <p className="break-all text-xs text-gray-500">
                Driver: {status.command}
                {status.driverSource ? ` (${driverSourceLabel(status.driverSource)})` : ""}
              </p>
            )}
            <div className="rounded-lg border border-white/10 bg-white/[0.03] p-3">
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-sm font-medium text-gray-200">Driver path override</p>
                  <p className="text-xs text-gray-500">
                    Use this when Windows/Tauri starts before the installer PATH update is visible,
                    or when cua-driver is installed outside the default Cua folders.
                  </p>
                </div>
                {status.driverSource === "config" && (
                  <Badge variant="success">Using override</Badge>
                )}
              </div>
              <div className="flex flex-col gap-2 md:flex-row">
                <Input
                  value={driverPathInput}
                  onChange={(event) => setDriverPathInput(event.target.value)}
                  placeholder={
                    status.platform === "win32"
                      ? "C:\\Users\\you\\AppData\\Local\\Programs\\Cua\\cua-driver\\bin\\cua-driver.exe"
                      : "/Users/you/.local/bin/cua-driver"
                  }
                  className="font-mono text-xs"
                  aria-label="cua-driver executable path"
                />
                {canBrowseForDriver && (
                  <Button variant="secondary" onClick={() => void browseDriverPath()}>
                    Browse
                  </Button>
                )}
                <Button
                  variant="primary"
                  onClick={() => void saveDriverPath()}
                  disabled={savingDriverPath}
                >
                  {savingDriverPath ? "Saving…" : "Save"}
                </Button>
                <Button
                  variant="ghost"
                  onClick={() => {
                    setDriverPathInput("");
                    void saveDriverPath("");
                  }}
                  disabled={savingDriverPath || !driverPathInput.trim()}
                >
                  Clear
                </Button>
              </div>
              {status.configuredCommand && status.driverSource !== "config" && (
                <p className="mt-2 text-xs text-amber-300">
                  A path override is saved, but {driverSourceLabel(status.driverSource)} is taking
                  precedence.
                </p>
              )}
            </div>
            {!status.available && status.searchedPaths && status.searchedPaths.length > 0 && (
              <details className="rounded-lg border border-white/10 bg-black/20 p-3 text-xs text-gray-400">
                <summary className="cursor-pointer text-gray-300">Checked paths</summary>
                <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap">
                  {status.searchedPaths.join("\n")}
                </pre>
              </details>
            )}
            {note && <p className="text-sm text-indigo-300">{note}</p>}
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" onClick={() => void load()}>
                Recheck
              </Button>
              {!status.available && (
                <Button
                  variant="secondary"
                  onClick={() => openExternal("https://github.com/trycua/cua")}
                >
                  Install cua-driver
                </Button>
              )}
              {status.platform === "darwin" && status.available && !status.ready && (
                <Button variant="primary" onClick={() => void grant()} disabled={granting}>
                  {granting ? "Requesting…" : "Grant Permissions"}
                </Button>
              )}
            </div>
          </div>
        ) : (
          <p className="text-sm text-red-400">Could not load computer-use status.</p>
        )}
      </CardContent>
    </Card>
  );
}

function SandboxBrowserSettings() {
  const [status, setStatus] = useState<SandboxBrowserStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await sandboxBrowserApi.getStatus();
    if (res.success && res.data) setStatus(res.data);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const start = useCallback(async () => {
    setBusy(true);
    setNote("Starting sandbox (first run builds the image, this can take a few minutes)…");
    const res = await sandboxBrowserApi.start();
    if (res.success && res.data) {
      if (!res.data.success) setNote(res.data.error || "Failed to start sandbox browser");
      else setNote(null);
    }
    setBusy(false);
    await load();
  }, [load]);

  const stop = useCallback(async () => {
    setBusy(true);
    await sandboxBrowserApi.stop();
    setBusy(false);
    setNote(null);
    await load();
  }, [load]);

  return (
    <Card variant="liquid">
      <CardHeader>
        <CardTitle>Sandbox Browser (cross-platform)</CardTitle>
        <CardDescription>
          Runs Chromium inside an isolated Linux container (viewable in your browser via noVNC) and
          drives it over the DevTools Protocol. Works the same on macOS, Windows, and Linux.
          Requires Docker.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {loading ? (
          <p className="text-sm text-gray-400">Checking status…</p>
        ) : status ? (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
              <span className="flex items-center gap-2">
                Docker{" "}
                {status.dockerAvailable ? (
                  <Badge variant="success">Yes</Badge>
                ) : (
                  <Badge variant="error">No</Badge>
                )}
              </span>
              <span className="flex items-center gap-2">
                Image{" "}
                {status.imageBuilt ? (
                  <Badge variant="success">Built</Badge>
                ) : (
                  <Badge variant="default">Not built</Badge>
                )}
              </span>
              <span className="flex items-center gap-2">
                Running{" "}
                {status.running ? (
                  <Badge variant="success">Yes</Badge>
                ) : (
                  <Badge variant="default">No</Badge>
                )}
              </span>
            </div>
            {status.reason && <p className="text-sm text-amber-300">{status.reason}</p>}
            {note && <p className="text-sm text-indigo-300">{note}</p>}
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" onClick={() => void load()} disabled={busy}>
                Recheck
              </Button>
              {status.dockerAvailable && !status.running && (
                <Button variant="primary" onClick={() => void start()} isLoading={busy}>
                  Start sandbox
                </Button>
              )}
              {status.running && (
                <>
                  <Button variant="secondary" onClick={() => openExternal(status.novncUrl)}>
                    Open viewer
                  </Button>
                  <Button variant="ghost" onClick={() => void stop()} disabled={busy}>
                    Stop
                  </Button>
                </>
              )}
            </div>
          </div>
        ) : (
          <p className="text-sm text-red-400">Could not load sandbox browser status.</p>
        )}
      </CardContent>
    </Card>
  );
}

type MemoryBehaviorSettingsState = {
  backgroundReviewEnabled: boolean;
  backgroundReviewMinIntervalMs: number;
  backgroundReviewTimeoutSeconds: number;
  memoryFlushEnabled: boolean;
  memoryFlushSoftThresholdTokens: number;
  memoryFlushPrompt: string;
  memoryFlushSystemPrompt: string;
};

type MemoryRecallProvider = "auto" | "transformers_js" | "openai" | "gemini" | "ollama";

type MemoryRecallSettingsState = {
  enabled: boolean;
  semanticEnabled: boolean;
  includeHidden: boolean;
  autoReindexOnWorkspaceSet: boolean;
  maxFiles: number;
  maxFileSizeMb: number;
  semanticMaxFiles: number;
  semanticMinScore: number;
  embeddingProvider: MemoryRecallProvider;
  embeddingModel: string;
};

const defaultMemoryBehaviorSettings: MemoryBehaviorSettingsState = {
  backgroundReviewEnabled: true,
  backgroundReviewMinIntervalMs: 300000,
  backgroundReviewTimeoutSeconds: 90,
  memoryFlushEnabled: true,
  memoryFlushSoftThresholdTokens: 4000,
  memoryFlushPrompt:
    "Pre-compaction memory flush. Store durable memories now (use memory/YYYY-MM-DD.md via write tool; create memory/ if needed). If nothing to store, reply with [SILENT].",
  memoryFlushSystemPrompt:
    "Pre-compaction memory flush turn. The session is near auto-compaction; capture durable memories to disk. You may reply, but usually [SILENT] is correct.",
};

const defaultMemoryRecallSettings: MemoryRecallSettingsState = {
  enabled: true,
  semanticEnabled: true,
  includeHidden: false,
  autoReindexOnWorkspaceSet: true,
  maxFiles: 25000,
  maxFileSizeMb: 1,
  semanticMaxFiles: 2000,
  semanticMinScore: 0.45,
  embeddingProvider: "auto",
  embeddingModel: "",
};

const memoryRecallProviderOptions: Array<{ value: MemoryRecallProvider; label: string }> = [
  { value: "auto", label: "Auto" },
  { value: "transformers_js", label: "Local Transformers.js" },
  { value: "openai", label: "OpenAI" },
  { value: "gemini", label: "Gemini" },
  { value: "ollama", label: "Ollama" },
];

function asSettingsRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function readBooleanSetting(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function readNumberSetting(value: unknown, fallback: number, min: number, max: number): number {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim().length > 0
        ? Number(value)
        : Number.NaN;
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function readIntegerSetting(value: unknown, fallback: number, min: number, max: number): number {
  return Math.floor(readNumberSetting(value, fallback, min, max));
}

function readMemoryRecallProvider(value: unknown): MemoryRecallProvider {
  if (typeof value !== "string") return defaultMemoryRecallSettings.embeddingProvider;
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
  if (
    normalized === "auto" ||
    normalized === "transformers_js" ||
    normalized === "openai" ||
    normalized === "gemini" ||
    normalized === "ollama"
  ) {
    return normalized;
  }
  if (normalized === "transformers") return "transformers_js";
  return defaultMemoryRecallSettings.embeddingProvider;
}

function readMemoryBehaviorSettings(value: unknown): MemoryBehaviorSettingsState {
  const record = asSettingsRecord(value);
  return {
    backgroundReviewEnabled:
      typeof record.backgroundReviewEnabled === "boolean"
        ? record.backgroundReviewEnabled
        : defaultMemoryBehaviorSettings.backgroundReviewEnabled,
    backgroundReviewMinIntervalMs:
      typeof record.backgroundReviewMinIntervalMs === "number" &&
      Number.isFinite(record.backgroundReviewMinIntervalMs)
        ? record.backgroundReviewMinIntervalMs
        : defaultMemoryBehaviorSettings.backgroundReviewMinIntervalMs,
    backgroundReviewTimeoutSeconds:
      typeof record.backgroundReviewTimeoutSeconds === "number" &&
      Number.isFinite(record.backgroundReviewTimeoutSeconds)
        ? record.backgroundReviewTimeoutSeconds
        : defaultMemoryBehaviorSettings.backgroundReviewTimeoutSeconds,
    memoryFlushEnabled:
      typeof record.memoryFlushEnabled === "boolean"
        ? record.memoryFlushEnabled
        : defaultMemoryBehaviorSettings.memoryFlushEnabled,
    memoryFlushSoftThresholdTokens:
      typeof record.memoryFlushSoftThresholdTokens === "number" &&
      Number.isFinite(record.memoryFlushSoftThresholdTokens)
        ? record.memoryFlushSoftThresholdTokens
        : defaultMemoryBehaviorSettings.memoryFlushSoftThresholdTokens,
    memoryFlushPrompt:
      typeof record.memoryFlushPrompt === "string"
        ? record.memoryFlushPrompt
        : defaultMemoryBehaviorSettings.memoryFlushPrompt,
    memoryFlushSystemPrompt:
      typeof record.memoryFlushSystemPrompt === "string"
        ? record.memoryFlushSystemPrompt
        : defaultMemoryBehaviorSettings.memoryFlushSystemPrompt,
  };
}

function readMemoryRecallSettings(value: unknown): MemoryRecallSettingsState {
  const record = asSettingsRecord(value);
  const maxFileSizeBytes = readIntegerSetting(
    record.maxFileSizeBytes,
    defaultMemoryRecallSettings.maxFileSizeMb * 1024 * 1024,
    8 * 1024,
    100 * 1024 * 1024
  );
  return {
    enabled: readBooleanSetting(record.enabled, defaultMemoryRecallSettings.enabled),
    semanticEnabled: readBooleanSetting(
      record.semanticEnabled,
      defaultMemoryRecallSettings.semanticEnabled
    ),
    includeHidden: readBooleanSetting(
      record.includeHidden,
      defaultMemoryRecallSettings.includeHidden
    ),
    autoReindexOnWorkspaceSet: readBooleanSetting(
      record.autoReindexOnWorkspaceSet,
      defaultMemoryRecallSettings.autoReindexOnWorkspaceSet
    ),
    maxFiles: readIntegerSetting(
      record.maxFiles,
      defaultMemoryRecallSettings.maxFiles,
      100,
      1_000_000
    ),
    maxFileSizeMb: Number((maxFileSizeBytes / (1024 * 1024)).toFixed(2)),
    semanticMaxFiles: readIntegerSetting(
      record.semanticMaxFiles,
      defaultMemoryRecallSettings.semanticMaxFiles,
      100,
      50_000
    ),
    semanticMinScore: Number(
      readNumberSetting(
        record.semanticMinScore,
        defaultMemoryRecallSettings.semanticMinScore,
        0.05,
        0.99
      ).toFixed(2)
    ),
    embeddingProvider: readMemoryRecallProvider(record.embeddingProvider),
    embeddingModel:
      typeof record.embeddingModel === "string" ? record.embeddingModel.trim().slice(0, 160) : "",
  };
}

function memoryRecallConfigPayload(recall: MemoryRecallSettingsState): Record<string, unknown> {
  return {
    enabled: recall.enabled,
    autoReindexOnWorkspaceSet: recall.autoReindexOnWorkspaceSet,
    includeHidden: recall.includeHidden,
    maxFileSizeBytes: Math.round(
      readNumberSetting(
        recall.maxFileSizeMb,
        defaultMemoryRecallSettings.maxFileSizeMb,
        0.01,
        100
      ) *
        1024 *
        1024
    ),
    maxFiles: readIntegerSetting(
      recall.maxFiles,
      defaultMemoryRecallSettings.maxFiles,
      100,
      1_000_000
    ),
    semanticEnabled: recall.semanticEnabled,
    semanticMaxFiles: readIntegerSetting(
      recall.semanticMaxFiles,
      defaultMemoryRecallSettings.semanticMaxFiles,
      100,
      50_000
    ),
    semanticMinScore: readNumberSetting(
      recall.semanticMinScore,
      defaultMemoryRecallSettings.semanticMinScore,
      0.05,
      0.99
    ),
    embeddingProvider: recall.embeddingProvider,
    embeddingModel: recall.embeddingModel.trim().slice(0, 160),
  };
}

function MemoryBehaviorSettings() {
  const { addToast } = useUIStore();
  const [memory, setMemory] = useState<MemoryBehaviorSettingsState>(defaultMemoryBehaviorSettings);
  const [recall, setRecall] = useState<MemoryRecallSettingsState>(defaultMemoryRecallSettings);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savingRecall, setSavingRecall] = useState(false);

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      try {
        const result = await settingsApi.getConfig();
        if (!mounted || !result.success) return;
        setMemory(readMemoryBehaviorSettings(result.data?.memory));
        setRecall(readMemoryRecallSettings(result.data?.workspace_indexer));
      } catch {
        // Keep defaults available while the gateway is unavailable.
      } finally {
        if (mounted) setLoading(false);
      }
    };
    void load();
    return () => {
      mounted = false;
    };
  }, []);

  const updateMemory = (patch: Partial<MemoryBehaviorSettingsState>) => {
    setMemory((current) => ({ ...current, ...patch }));
  };

  const updateRecall = (patch: Partial<MemoryRecallSettingsState>) => {
    setRecall((current) => ({ ...current, ...patch }));
  };

  const save = async () => {
    setSaving(true);
    try {
      const result = await settingsApi.updateConfig({ memory });
      if (!result.success || result.data?.success === false) {
        throw new Error(result.error || "Memory settings were not saved");
      }
      addToast("success", "Memory settings saved");
    } catch (error) {
      addToast("error", error instanceof Error ? error.message : "Failed to save memory settings");
    } finally {
      setSaving(false);
    }
  };

  const saveRecall = async () => {
    setSavingRecall(true);
    try {
      const result = await settingsApi.updateConfig({
        workspace_indexer: memoryRecallConfigPayload(recall),
      });
      if (!result.success || result.data?.success === false) {
        throw new Error(result.error || "Recall settings were not saved");
      }
      addToast("success", "Recall settings saved");
    } catch (error) {
      addToast("error", error instanceof Error ? error.message : "Failed to save recall settings");
    } finally {
      setSavingRecall(false);
    }
  };

  return (
    <Card variant="liquid">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Brain className="w-5 h-5 text-indigo-400" />
          Memory Behavior
        </CardTitle>
        <CardDescription>
          Controls when agents learn durable facts and when long chats flush memory before
          compaction.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="rounded-xl bg-white/5 border border-white/10 p-4 space-y-4">
          <div>
            <h3 className="text-sm font-semibold text-white">Recall search</h3>
            <p className="text-xs text-gray-400 mt-1">
              Controls the semantic index used by memory search, workspace search, and contextual
              recall.
            </p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <label className="flex items-center justify-between gap-3 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2">
              <span className="text-sm text-gray-300">Build recall index</span>
              <input
                type="checkbox"
                checked={recall.enabled}
                disabled={loading || savingRecall}
                onChange={(event) => updateRecall({ enabled: event.currentTarget.checked })}
                className="h-4 w-4 accent-indigo-500"
              />
            </label>
            <label className="flex items-center justify-between gap-3 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2">
              <span className="text-sm text-gray-300">Semantic recall</span>
              <input
                type="checkbox"
                checked={recall.semanticEnabled}
                disabled={loading || savingRecall}
                onChange={(event) => updateRecall({ semanticEnabled: event.currentTarget.checked })}
                className="h-4 w-4 accent-indigo-500"
              />
            </label>
            <label className="flex items-center justify-between gap-3 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2">
              <span className="text-sm text-gray-300">Include hidden files</span>
              <input
                type="checkbox"
                checked={recall.includeHidden}
                disabled={loading || savingRecall}
                onChange={(event) => updateRecall({ includeHidden: event.currentTarget.checked })}
                className="h-4 w-4 accent-indigo-500"
              />
            </label>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
            <Select
              label="Embedding provider"
              options={memoryRecallProviderOptions}
              value={recall.embeddingProvider}
              disabled={loading || savingRecall}
              onChange={(value) =>
                updateRecall({ embeddingProvider: value as MemoryRecallProvider })
              }
            />
            <Input
              label="Model override"
              placeholder="Auto"
              value={recall.embeddingModel}
              disabled={loading || savingRecall}
              onChange={(event) => updateRecall({ embeddingModel: event.target.value })}
            />
            <Input
              label="Max files"
              type="number"
              min={100}
              value={recall.maxFiles}
              disabled={loading || savingRecall}
              onChange={(event) =>
                updateRecall({
                  maxFiles: readIntegerSetting(
                    event.target.value,
                    defaultMemoryRecallSettings.maxFiles,
                    100,
                    1_000_000
                  ),
                })
              }
            />
            <Input
              label="Max file size (MB)"
              type="number"
              min={0.01}
              max={100}
              step={0.1}
              value={recall.maxFileSizeMb}
              disabled={loading || savingRecall}
              onChange={(event) =>
                updateRecall({
                  maxFileSizeMb: readNumberSetting(
                    event.target.value,
                    defaultMemoryRecallSettings.maxFileSizeMb,
                    0.01,
                    100
                  ),
                })
              }
            />
            <Input
              label="Semantic files"
              type="number"
              min={100}
              max={50000}
              value={recall.semanticMaxFiles}
              disabled={loading || savingRecall}
              onChange={(event) =>
                updateRecall({
                  semanticMaxFiles: readIntegerSetting(
                    event.target.value,
                    defaultMemoryRecallSettings.semanticMaxFiles,
                    100,
                    50_000
                  ),
                })
              }
            />
            <Input
              label="Semantic min score"
              type="number"
              min={0.05}
              max={0.99}
              step={0.05}
              value={recall.semanticMinScore}
              disabled={loading || savingRecall}
              onChange={(event) =>
                updateRecall({
                  semanticMinScore: Number(
                    readNumberSetting(
                      event.target.value,
                      defaultMemoryRecallSettings.semanticMinScore,
                      0.05,
                      0.99
                    ).toFixed(2)
                  ),
                })
              }
            />
            <label className="flex items-center justify-between gap-3 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 md:col-span-2">
              <span className="text-sm text-gray-300">Auto reindex when workspace changes</span>
              <input
                type="checkbox"
                checked={recall.autoReindexOnWorkspaceSet}
                disabled={loading || savingRecall}
                onChange={(event) =>
                  updateRecall({ autoReindexOnWorkspaceSet: event.currentTarget.checked })
                }
                className="h-4 w-4 accent-indigo-500"
              />
            </label>
          </div>
          <div className="flex justify-end">
            <Button
              leftIcon={
                savingRecall ? (
                  <RefreshCw className="w-4 h-4 animate-spin" />
                ) : (
                  <Save className="w-4 h-4" />
                )
              }
              onClick={() => void saveRecall()}
              disabled={loading || savingRecall}
            >
              Save Recall Settings
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          <div className="rounded-xl bg-white/5 border border-white/10 p-4 space-y-4">
            <div>
              <h3 className="text-sm font-semibold text-white">Learning loop</h3>
              <p className="text-xs text-gray-400 mt-1">
                After substantial responses, Cybara can run a silent reviewer that saves durable
                preferences, corrections, and project facts.
              </p>
            </div>
            <label className="flex items-center justify-between gap-3 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2">
              <span className="text-sm text-gray-300">Background memory review</span>
              <input
                type="checkbox"
                checked={memory.backgroundReviewEnabled}
                disabled={loading || saving}
                onChange={(event) =>
                  updateMemory({ backgroundReviewEnabled: event.currentTarget.checked })
                }
                className="h-4 w-4 accent-indigo-500"
              />
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Input
                label="Minimum interval (minutes)"
                min={1}
                max={1440}
                type="number"
                value={Math.round(memory.backgroundReviewMinIntervalMs / 60000)}
                disabled={loading || saving}
                onChange={(event) =>
                  updateMemory({
                    backgroundReviewMinIntervalMs:
                      Math.max(1, Number(event.target.value) || 5) * 60000,
                  })
                }
              />
              <Input
                label="Timeout (seconds)"
                min={10}
                max={600}
                type="number"
                value={memory.backgroundReviewTimeoutSeconds}
                disabled={loading || saving}
                onChange={(event) =>
                  updateMemory({
                    backgroundReviewTimeoutSeconds: Math.max(10, Number(event.target.value) || 90),
                  })
                }
              />
            </div>
          </div>

          <div className="rounded-xl bg-white/5 border border-white/10 p-4 space-y-4">
            <div>
              <h3 className="text-sm font-semibold text-white">Pre-compaction flush</h3>
              <p className="text-xs text-gray-400 mt-1">
                Before a long chat compacts, the agent gets one chance to save durable memory so
                important details are not lost.
              </p>
            </div>
            <label className="flex items-center justify-between gap-3 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2">
              <span className="text-sm text-gray-300">Flush before compaction</span>
              <input
                type="checkbox"
                checked={memory.memoryFlushEnabled}
                disabled={loading || saving}
                onChange={(event) =>
                  updateMemory({ memoryFlushEnabled: event.currentTarget.checked })
                }
                className="h-4 w-4 accent-indigo-500"
              />
            </label>
            <Input
              label="Soft threshold reserve (tokens)"
              min={500}
              max={200000}
              type="number"
              value={memory.memoryFlushSoftThresholdTokens}
              disabled={loading || saving}
              onChange={(event) =>
                updateMemory({
                  memoryFlushSoftThresholdTokens: Math.max(500, Number(event.target.value) || 4000),
                })
              }
            />
          </div>
        </div>

        <details className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
          <summary className="cursor-pointer text-sm font-medium text-gray-200">
            Advanced memory prompts
          </summary>
          <div className="mt-4 grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Textarea
              label="Flush prompt"
              value={memory.memoryFlushPrompt}
              disabled={loading || saving}
              rows={5}
              onChange={(event) => updateMemory({ memoryFlushPrompt: event.target.value })}
            />
            <Textarea
              label="Flush system prompt"
              value={memory.memoryFlushSystemPrompt}
              disabled={loading || saving}
              rows={5}
              onChange={(event) => updateMemory({ memoryFlushSystemPrompt: event.target.value })}
            />
          </div>
        </details>

        <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3 text-sm text-gray-300">
          <p className="font-medium text-white">Active memory stack</p>
          <p className="mt-1 text-xs text-gray-400">
            Built-in durable memory, daily memory files, session search, semantic recall, and
            self-improving skills are available today. External memory providers such as Honcho,
            Mem0, OpenViking, Hindsight, and Supermemory need backend provider adapters before they
            can be safely selected here.
          </p>
        </div>

        <div className="flex justify-end">
          <Button
            leftIcon={
              saving ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />
            }
            onClick={() => void save()}
            disabled={loading || saving}
          >
            Save Memory Settings
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function FeatureSettings() {
  const [terminalEnabled, setTerminalEnabled] = useState(false);
  const [selfImprovingSkills, setSelfImprovingSkills] = useState(true);
  const [dangerousToolPolicyEnabled, setDangerousToolPolicyEnabled] = useState(false);
  const [dangerousToolPolicyMode, setDangerousToolPolicyMode] = useState<"audit" | "block">(
    "audit"
  );
  const [toolApprovalMode, setToolApprovalMode] = useState<"always_allow" | "ask">("always_allow");
  const [sandboxEnabled, setSandboxEnabled] = useState(false);
  const [sandboxProvider, setSandboxProvider] = useState<SandboxProviderOption>("auto");
  const [sandboxNetwork, setSandboxNetwork] = useState<"allow" | "deny">("deny");
  const [savingToolApprovalMode, setSavingToolApprovalMode] = useState(false);
  const [reasoningEffort, setReasoningEffort] = useState("");
  const [savingReasoningEffort, setSavingReasoningEffort] = useState(false);
  const [savingDangerousPolicy, setSavingDangerousPolicy] = useState(false);
  const [savingSandboxRuntime, setSavingSandboxRuntime] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingSandboxStatus, setLoadingSandboxStatus] = useState(true);
  const [refreshingSandboxStatus, setRefreshingSandboxStatus] = useState(false);
  const [sandboxStatus, setSandboxStatus] = useState<SandboxStatusView | null>(null);
  const { addToast } = useUIStore();

  const providerLabel = (provider: SandboxProviderOption | "host" | null): string => {
    if (provider === "apple_sandbox") return "Apple Sandbox";
    if (provider === "podman") return "Podman";
    if (provider === "docker") return "Docker";
    if (provider === "host") return "Host";
    if (provider === "auto") return "Auto Detect";
    return "None";
  };

  const refreshSandboxStatus = useCallback(
    async (silent = false): Promise<SandboxStatusView | null> => {
      if (!silent) {
        setRefreshingSandboxStatus(true);
      } else {
        setLoadingSandboxStatus(true);
      }
      try {
        const result = await settingsApi.getSandboxStatus();
        if (result.success && result.data) {
          const nextStatus = result.data as SandboxStatusView;
          setSandboxStatus(nextStatus);
          return nextStatus;
        }
        return null;
      } catch {
        // Ignore status refresh errors.
        return null;
      } finally {
        setLoadingSandboxStatus(false);
        if (!silent) setRefreshingSandboxStatus(false);
      }
    },
    []
  );

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      try {
        const [configResult, sandboxResult] = await Promise.all([
          settingsApi.getConfig(),
          settingsApi.getSandboxStatus(),
        ]);
        if (!mounted) return;

        const data = configResult.success ? configResult.data : undefined;
        setTerminalEnabled(data?.terminal_enabled === true);
        setSelfImprovingSkills(data?.self_improving_skills_enabled !== false);
        const policy = data?.dangerous_tool_policy as
          { enabled?: boolean; mode?: string } | undefined;
        const modeRaw = typeof data?.tool_approval_mode === "string" ? data.tool_approval_mode : "";
        const sandboxRaw = data?.sandbox_runtime as
          { enabled?: boolean; provider?: string; network?: string } | undefined;
        setDangerousToolPolicyEnabled(policy?.enabled === true);
        setDangerousToolPolicyMode(policy?.mode === "block" ? "block" : "audit");
        setToolApprovalMode(modeRaw === "ask" ? "ask" : "always_allow");
        setSandboxEnabled(sandboxRaw?.enabled === true);
        setSandboxProvider(
          sandboxRaw?.provider === "apple_sandbox" ||
            sandboxRaw?.provider === "podman" ||
            sandboxRaw?.provider === "docker"
            ? sandboxRaw.provider
            : "auto"
        );
        setSandboxNetwork(sandboxRaw?.network === "allow" ? "allow" : "deny");
        setReasoningEffort(typeof data?.reasoning_effort === "string" ? data.reasoning_effort : "");
        if (sandboxResult.success && sandboxResult.data) {
          setSandboxStatus(sandboxResult.data as SandboxStatusView);
        }
      } finally {
        if (mounted) {
          setLoading(false);
          setLoadingSandboxStatus(false);
        }
      }
    };
    void load();
    return () => {
      mounted = false;
    };
  }, []);

  const toggleTerminal = async (enabled: boolean) => {
    setTerminalEnabled(enabled);
    try {
      const result = await settingsApi.updateConfig({ terminal_enabled: enabled });
      if (!result.success || !result.data?.success) {
        throw new Error(extractApiError(result, "Config update failed"));
      }
      addToast("success", `Web terminal ${enabled ? "enabled" : "disabled"}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to update terminal setting";
      addToast("error", message);
      setTerminalEnabled(!enabled);
    }
  };

  const toggleSelfImprovingSkills = async (enabled: boolean) => {
    setSelfImprovingSkills(enabled);
    try {
      const result = await settingsApi.updateConfig({ self_improving_skills_enabled: enabled });
      if (!result.success || !result.data?.success) {
        throw new Error(result.error || "Config update failed");
      }
      addToast("success", `Self-improving skills ${enabled ? "enabled" : "disabled"}`);
    } catch {
      addToast("error", "Failed to update self-improving skills setting");
      setSelfImprovingSkills(!enabled);
    }
  };

  const updateDangerousPolicy = async (next: { enabled: boolean; mode: "audit" | "block" }) => {
    const previous = {
      enabled: dangerousToolPolicyEnabled,
      mode: dangerousToolPolicyMode,
    };

    setDangerousToolPolicyEnabled(next.enabled);
    setDangerousToolPolicyMode(next.mode);
    setSavingDangerousPolicy(true);
    try {
      const result = await settingsApi.updateConfig({ dangerous_tool_policy: next });
      if (!result.success || !result.data?.success) {
        throw new Error(result.error || "Config update failed");
      }
      addToast(
        "success",
        `Dangerous tool policy ${next.enabled ? `${next.mode} mode` : "disabled"}`
      );
    } catch {
      setDangerousToolPolicyEnabled(previous.enabled);
      setDangerousToolPolicyMode(previous.mode);
      addToast("error", "Failed to update dangerous tool policy");
    } finally {
      setSavingDangerousPolicy(false);
    }
  };

  const updateToolApprovalMode = async (nextMode: "always_allow" | "ask") => {
    const previousMode = toolApprovalMode;
    setToolApprovalMode(nextMode);
    setSavingToolApprovalMode(true);
    try {
      const result = await settingsApi.updateConfig({ tool_approval_mode: nextMode });
      if (!result.success || !result.data?.success) {
        throw new Error(result.error || "Config update failed");
      }
      addToast(
        "success",
        nextMode === "ask" ? "Tool approvals set to Ask Me" : "Tool approvals set to Always Allow"
      );
    } catch {
      setToolApprovalMode(previousMode);
      addToast("error", "Failed to update tool approval mode");
    } finally {
      setSavingToolApprovalMode(false);
    }
  };

  const updateReasoningEffort = async (next: string) => {
    const previous = reasoningEffort;
    setReasoningEffort(next);
    setSavingReasoningEffort(true);
    try {
      const result = await settingsApi.updateConfig({ reasoning_effort: next });
      if (!result.success || !result.data?.success) {
        throw new Error(result.error || "Config update failed");
      }
      addToast(
        "success",
        next ? `Reasoning effort set to ${next}` : "Reasoning effort set to default"
      );
    } catch {
      setReasoningEffort(previous);
      addToast("error", "Failed to update reasoning effort");
    } finally {
      setSavingReasoningEffort(false);
    }
  };

  const updateSandboxRuntime = async (next: {
    enabled: boolean;
    provider: SandboxProviderOption;
    network: "allow" | "deny";
  }) => {
    const previous = {
      enabled: sandboxEnabled,
      provider: sandboxProvider,
      network: sandboxNetwork,
    };

    setSandboxEnabled(next.enabled);
    setSandboxProvider(next.provider);
    setSandboxNetwork(next.network);
    setSavingSandboxRuntime(true);
    try {
      const result = await settingsApi.updateConfig({ sandbox_runtime: next });
      if (!result.success || !result.data?.success) {
        throw new Error(result.error || "Config update failed");
      }
      const refreshedStatus = await refreshSandboxStatus(true);
      if (next.enabled && refreshedStatus && !refreshedStatus.available) {
        addToast(
          "error",
          `Sandbox unavailable: ${refreshedStatus.reason || "No compatible provider on this machine"}`
        );
      } else {
        addToast("success", next.enabled ? "Sandbox runtime enabled" : "Sandbox runtime disabled");
      }
    } catch {
      setSandboxEnabled(previous.enabled);
      setSandboxProvider(previous.provider);
      setSandboxNetwork(previous.network);
      addToast("error", "Failed to update sandbox runtime");
    } finally {
      setSavingSandboxRuntime(false);
    }
  };

  return (
    <Card variant="liquid">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Server className="w-5 h-5" />
          Features
        </CardTitle>
        <CardDescription>Enable or disable platform features</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between py-3 border-b border-white/10">
          <div>
            <p className="text-sm text-white font-medium">Web Terminal</p>
            <p className="text-xs text-gray-400 mt-0.5">
              Enable browser-based terminal access. Also available via{" "}
              <code className="text-indigo-400">--enable-terminal</code> flag.
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={terminalEnabled}
            disabled={loading}
            onClick={() => toggleTerminal(!terminalEnabled)}
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
              terminalEnabled ? "bg-indigo-500" : "bg-white/10"
            } ${loading ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}`}
          >
            <span
              className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                terminalEnabled ? "translate-x-6" : "translate-x-1"
              }`}
            />
          </button>
        </div>

        <div className="flex items-center justify-between py-3 border-b border-white/10">
          <div>
            <p className="text-sm text-white font-medium">Self-Improving Skills</p>
            <p className="text-xs text-gray-400 mt-0.5">
              Let agents save reusable skills with{" "}
              <code className="text-indigo-400">skill_save</code> after completing complex tasks, so
              future sessions can reuse the procedure. When off, the tool is withheld.
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={selfImprovingSkills}
            disabled={loading}
            onClick={() => toggleSelfImprovingSkills(!selfImprovingSkills)}
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
              selfImprovingSkills ? "bg-indigo-500" : "bg-white/10"
            } ${loading ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}`}
          >
            <span
              className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                selfImprovingSkills ? "translate-x-6" : "translate-x-1"
              }`}
            />
          </button>
        </div>

        <div className="py-3 border-b border-white/10">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-white font-medium">Dangerous Tool Policy</p>
              <p className="text-xs text-gray-400 mt-0.5">
                Guardrails for high-impact tools like shell execution, wallet signing, and external
                actions.
              </p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={dangerousToolPolicyEnabled}
              disabled={loading || savingDangerousPolicy}
              onClick={() =>
                updateDangerousPolicy({
                  enabled: !dangerousToolPolicyEnabled,
                  mode: dangerousToolPolicyMode,
                })
              }
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                dangerousToolPolicyEnabled ? "bg-amber-500" : "bg-white/10"
              } ${loading || savingDangerousPolicy ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}`}
            >
              <span
                className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                  dangerousToolPolicyEnabled ? "translate-x-6" : "translate-x-1"
                }`}
              />
            </button>
          </div>
          {dangerousToolPolicyEnabled && (
            <div className="mt-3 max-w-xs">
              <label className="block text-xs text-gray-400 mb-1">Mode</label>
              <Select
                value={dangerousToolPolicyMode}
                onChange={(value) =>
                  updateDangerousPolicy({
                    enabled: true,
                    mode: value === "block" ? "block" : "audit",
                  })
                }
                options={[
                  { value: "audit", label: "Audit (log only)" },
                  { value: "block", label: "Block dangerous tools" },
                ]}
              />
            </div>
          )}
        </div>

        <div className="py-3 border-b border-white/10">
          <p className="text-sm text-white font-medium">Tool Approvals</p>
          <p className="text-xs text-gray-400 mt-0.5">
            Choose how dangerous tools are handled across chat, Telegram, Discord, Slack, Signal,
            iMessage, and WhatsApp.
          </p>
          <div className="mt-3 max-w-xs">
            <Select
              value={toolApprovalMode}
              onChange={(value) =>
                void updateToolApprovalMode(value === "ask" ? "ask" : "always_allow")
              }
              options={[
                { value: "always_allow", label: "Always Allow" },
                { value: "ask", label: "Ask Me First" },
              ]}
              disabled={loading || savingToolApprovalMode}
            />
          </div>
          <p className="text-[11px] text-gray-500 mt-2">
            Channel shortcut: <code className="text-indigo-400">/permissions ask</code> or{" "}
            <code className="text-indigo-400">/permissions allow</code>
          </p>
        </div>

        <div className="py-3 border-b border-white/10">
          <p className="text-sm text-white font-medium">Reasoning Effort</p>
          <p className="text-xs text-gray-400 mt-0.5">
            Default thinking depth for reasoning-capable models. Applied when an agent does not set
            its own reasoning effort. Ignored by models without reasoning support.
          </p>
          <div className="mt-3 max-w-xs">
            <Select
              value={reasoningEffort}
              onChange={(value) => void updateReasoningEffort(value)}
              options={[
                { value: "", label: "Default (provider setting)" },
                { value: "minimal", label: "Minimal" },
                { value: "low", label: "Low" },
                { value: "medium", label: "Medium" },
                { value: "high", label: "High" },
                { value: "xhigh", label: "Max" },
              ]}
              disabled={loading || savingReasoningEffort}
            />
          </div>
        </div>

        <div className="py-3">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-white font-medium">Command Sandbox</p>
              <p className="text-xs text-gray-400 mt-0.5">
                Isolate `exec` and `git` tools with host/container sandboxing.
              </p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={sandboxEnabled}
              disabled={loading || savingSandboxRuntime}
              onClick={() =>
                updateSandboxRuntime({
                  enabled: !sandboxEnabled,
                  provider: sandboxProvider,
                  network: sandboxNetwork,
                })
              }
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                sandboxEnabled ? "bg-emerald-500" : "bg-white/10"
              } ${loading || savingSandboxRuntime ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}`}
            >
              <span
                className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                  sandboxEnabled ? "translate-x-6" : "translate-x-1"
                }`}
              />
            </button>
          </div>
          {sandboxEnabled && (
            <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-3 max-w-xl">
              <div>
                <label className="block text-xs text-gray-400 mb-1">Provider</label>
                <Select
                  value={sandboxProvider}
                  onChange={(value) =>
                    updateSandboxRuntime({
                      enabled: true,
                      provider:
                        value === "apple_sandbox" || value === "podman" || value === "docker"
                          ? value
                          : "auto",
                      network: sandboxNetwork,
                    })
                  }
                  options={[
                    { value: "auto", label: "Auto Detect" },
                    { value: "apple_sandbox", label: "Apple Sandbox" },
                    { value: "podman", label: "Podman" },
                    { value: "docker", label: "Docker" },
                  ]}
                  disabled={savingSandboxRuntime}
                />
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1">Network</label>
                <Select
                  value={sandboxNetwork}
                  onChange={(value) =>
                    updateSandboxRuntime({
                      enabled: true,
                      provider: sandboxProvider,
                      network: value === "allow" ? "allow" : "deny",
                    })
                  }
                  options={[
                    { value: "deny", label: "Deny Network" },
                    { value: "allow", label: "Allow Network" },
                  ]}
                  disabled={savingSandboxRuntime}
                />
              </div>
            </div>
          )}
          <div className="mt-4 rounded-xl border border-white/10 bg-white/[0.03] p-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-semibold text-white flex items-center gap-2">
                  <Shield className="w-3.5 h-3.5 text-emerald-300" />
                  Sandbox Diagnostics
                </p>
                <p className="text-[11px] text-gray-400 mt-1">
                  Real-time provider checks. Docker/Podman must be installed locally to be used.
                </p>
              </div>
              <button
                type="button"
                onClick={() => void refreshSandboxStatus()}
                className={`inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded border border-white/10 hover:bg-white/5 ${
                  refreshingSandboxStatus ? "opacity-70 cursor-not-allowed" : "cursor-pointer"
                }`}
                disabled={refreshingSandboxStatus}
              >
                <RefreshCw className={`w-3 h-3 ${refreshingSandboxStatus ? "animate-spin" : ""}`} />
                Refresh
              </button>
            </div>
            {loadingSandboxStatus ? (
              <p className="text-[11px] text-gray-500 mt-3">Checking sandbox runtime...</p>
            ) : sandboxStatus ? (
              <div className="mt-3 space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge
                    variant={
                      !sandboxStatus.enabled
                        ? "default"
                        : sandboxStatus.available
                          ? "success"
                          : "error"
                    }
                  >
                    {!sandboxStatus.enabled
                      ? "Disabled"
                      : sandboxStatus.available
                        ? "Ready"
                        : "Unavailable"}
                  </Badge>
                  <span className="text-[11px] text-gray-400">
                    Configured:{" "}
                    <span className="text-white">
                      {providerLabel(sandboxStatus.configuredProvider)}
                    </span>
                  </span>
                  <span className="text-[11px] text-gray-400">
                    Resolved:{" "}
                    <span className="text-white">
                      {providerLabel(sandboxStatus.resolvedProvider)}
                    </span>
                  </span>
                  <span className="text-[11px] text-gray-400">
                    Network:{" "}
                    <span className="text-white">
                      {sandboxStatus.network === "allow" ? "Allow" : "Deny"}
                    </span>
                  </span>
                </div>
                {sandboxStatus.reason && (
                  <div className="text-[11px] text-amber-200 bg-amber-500/10 border border-amber-500/20 rounded px-2 py-1 inline-flex items-start gap-1.5">
                    <AlertTriangle className="w-3 h-3 mt-0.5" />
                    <span>{sandboxStatus.reason}</span>
                  </div>
                )}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-2 pt-1">
                  {sandboxStatus.providers.map((entry) => (
                    <div
                      key={entry.provider}
                      className="rounded border border-white/10 px-2 py-1.5"
                    >
                      <p className="text-[11px] text-white">{providerLabel(entry.provider)}</p>
                      <p className="text-[10px] text-gray-400 mt-0.5">
                        {entry.available
                          ? "Available"
                          : entry.reason || (!entry.installed ? "Not installed" : "Unavailable")}
                      </p>
                    </div>
                  ))}
                </div>
                {sandboxStatus.lastEvent && (
                  <div className="pt-1">
                    <p className="text-[10px] uppercase tracking-wide text-gray-500">
                      Last sandbox event
                    </p>
                    <p className="text-[11px] text-gray-300 mt-0.5">
                      {providerLabel(sandboxStatus.lastEvent.provider)} ·{" "}
                      {sandboxStatus.lastEvent.phase} ·{" "}
                      {new Date(sandboxStatus.lastEvent.timestamp).toLocaleTimeString()}
                    </p>
                    {sandboxStatus.lastEvent.commandPreview && (
                      <p className="text-[10px] text-gray-500 mt-0.5 font-mono truncate">
                        {sandboxStatus.lastEvent.commandPreview}
                      </p>
                    )}
                  </div>
                )}
              </div>
            ) : (
              <p className="text-[11px] text-gray-500 mt-3">Sandbox diagnostics unavailable.</p>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

type SpeechSettingsState = {
  tts: {
    provider: "auto" | "system" | "elevenlabs" | "openai";
    providerId: string;
    model: string;
    voice: string;
    outputFormat: "mp3" | "m4a" | "wav" | "aiff" | "opus" | "aac";
    speed: number;
    maxTextLength: number;
    fallbackToSystem: boolean;
  };
  stt: {
    provider: "auto" | "openai";
    providerId: string;
    model: string;
    language: string;
  };
};

const defaultSpeechSettings: SpeechSettingsState = {
  tts: {
    provider: "auto",
    providerId: "",
    model: "",
    voice: "",
    outputFormat: "mp3",
    speed: 1,
    maxTextLength: 8000,
    fallbackToSystem: true,
  },
  stt: {
    provider: "auto",
    providerId: "",
    model: "",
    language: "",
  },
};

function speechRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function readSpeechSettings(value: unknown): SpeechSettingsState {
  const root = speechRecord(value);
  const tts = speechRecord(root.tts);
  const stt = speechRecord(root.stt);
  const ttsProvider =
    tts.provider === "system" || tts.provider === "elevenlabs" || tts.provider === "openai"
      ? tts.provider
      : "auto";
  const sttProvider = stt.provider === "openai" ? "openai" : "auto";
  const outputFormat =
    tts.outputFormat === "m4a" ||
    tts.outputFormat === "wav" ||
    tts.outputFormat === "aiff" ||
    tts.outputFormat === "opus" ||
    tts.outputFormat === "aac"
      ? tts.outputFormat
      : "mp3";
  return {
    tts: {
      provider: ttsProvider,
      providerId: typeof tts.providerId === "string" ? tts.providerId : "",
      model: typeof tts.model === "string" ? tts.model : "",
      voice: typeof tts.voice === "string" ? tts.voice : "",
      outputFormat,
      speed: typeof tts.speed === "number" && Number.isFinite(tts.speed) ? tts.speed : 1,
      maxTextLength:
        typeof tts.maxTextLength === "number" && Number.isFinite(tts.maxTextLength)
          ? tts.maxTextLength
          : 8000,
      fallbackToSystem: typeof tts.fallbackToSystem === "boolean" ? tts.fallbackToSystem : true,
    },
    stt: {
      provider: sttProvider,
      providerId: typeof stt.providerId === "string" ? stt.providerId : "",
      model: typeof stt.model === "string" ? stt.model : "",
      language: typeof stt.language === "string" ? stt.language : "",
    },
  };
}

function SpeechSettingsSection() {
  const { data: providers } = useProviders();
  const { addToast } = useUIStore();
  const [speech, setSpeech] = useState<SpeechSettingsState>(defaultSpeechSettings);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      try {
        const result = await settingsApi.getConfig();
        if (!mounted || !result.success) return;
        setSpeech(readSpeechSettings(result.data?.speech));
      } catch {
        // Settings page remains usable with defaults until the gateway is reachable.
      } finally {
        if (mounted) setLoading(false);
      }
    };
    void load();
    return () => {
      mounted = false;
    };
  }, []);

  const providerOptions = [
    { value: "", label: "Auto select" },
    ...((providers || [])
      .filter((provider) => {
        const type = provider.provider || provider.type || "";
        return type === "elevenlabs" || type === "openai" || type === "openai-codex";
      })
      .map((provider) => ({
        value: provider.id,
        label: `${provider.name} (${provider.provider || provider.type})`,
      })) || []),
  ];
  const sttProviderOptions = [
    { value: "", label: "Auto select" },
    ...((providers || [])
      .filter((provider) => {
        const type = provider.provider || provider.type || "";
        return type === "openai" || type === "openai-codex";
      })
      .map((provider) => ({
        value: provider.id,
        label: `${provider.name} (${provider.provider || provider.type})`,
      })) || []),
  ];

  const save = async () => {
    setSaving(true);
    try {
      const result = await settingsApi.updateConfig({ speech });
      if (!result.success || result.data?.success === false) {
        throw new Error(result.error || "Speech settings were not saved");
      }
      addToast("success", "Speech settings saved");
    } catch (error) {
      addToast("error", error instanceof Error ? error.message : "Failed to save speech settings");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card variant="liquid">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Volume2 className="w-5 h-5 text-cyan-400" />
          Speech
        </CardTitle>
        <CardDescription>
          TTS and dictation defaults shared by Web, Tauri, mobile, and native apps
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          <div className="rounded-xl bg-white/5 border border-white/10 p-4 space-y-3">
            <div className="flex items-center gap-2">
              <Volume2 className="w-4 h-4 text-cyan-300" />
              <h3 className="text-sm font-semibold text-white">Text to Speech</h3>
            </div>
            <Select
              label="Provider"
              options={[
                { value: "auto", label: "Auto" },
                { value: "elevenlabs", label: "ElevenLabs" },
                { value: "openai", label: "OpenAI" },
                { value: "system", label: "System voice" },
              ]}
              value={speech.tts.provider}
              onChange={(provider) =>
                setSpeech((current) => ({
                  ...current,
                  tts: {
                    ...current.tts,
                    provider: provider as SpeechSettingsState["tts"]["provider"],
                  },
                }))
              }
            />
            <Select
              label="Provider account"
              options={providerOptions}
              value={speech.tts.providerId}
              onChange={(providerId) =>
                setSpeech((current) => ({ ...current, tts: { ...current.tts, providerId } }))
              }
            />
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Input
                label="Model"
                placeholder="eleven_multilingual_v2"
                value={speech.tts.model}
                onChange={(event) =>
                  setSpeech((current) => ({
                    ...current,
                    tts: { ...current.tts, model: event.target.value },
                  }))
                }
              />
              <Input
                label="Voice"
                placeholder="Voice ID or name"
                value={speech.tts.voice}
                onChange={(event) =>
                  setSpeech((current) => ({
                    ...current,
                    tts: { ...current.tts, voice: event.target.value },
                  }))
                }
              />
              <Select
                label="Format"
                options={[
                  { value: "mp3", label: "MP3" },
                  { value: "m4a", label: "M4A" },
                  { value: "wav", label: "WAV" },
                  { value: "opus", label: "Opus" },
                  { value: "aac", label: "AAC" },
                  { value: "aiff", label: "AIFF" },
                ]}
                value={speech.tts.outputFormat}
                onChange={(outputFormat) =>
                  setSpeech((current) => ({
                    ...current,
                    tts: {
                      ...current.tts,
                      outputFormat: outputFormat as SpeechSettingsState["tts"]["outputFormat"],
                    },
                  }))
                }
              />
              <Input
                label="Max characters"
                min={1}
                max={50000}
                type="number"
                value={speech.tts.maxTextLength}
                onChange={(event) =>
                  setSpeech((current) => ({
                    ...current,
                    tts: {
                      ...current.tts,
                      maxTextLength: Number(event.target.value) || 8000,
                    },
                  }))
                }
              />
            </div>
            <div className="flex flex-col sm:flex-row gap-3">
              <Input
                label="Speed"
                min={0.5}
                max={2}
                step={0.05}
                type="number"
                value={speech.tts.speed}
                onChange={(event) =>
                  setSpeech((current) => ({
                    ...current,
                    tts: { ...current.tts, speed: Number(event.target.value) || 1 },
                  }))
                }
              />
              <label className="flex items-center gap-3 rounded-xl bg-white/5 border border-white/10 px-4 py-3 mt-6">
                <input
                  type="checkbox"
                  checked={speech.tts.fallbackToSystem}
                  onChange={(event) =>
                    setSpeech((current) => ({
                      ...current,
                      tts: { ...current.tts, fallbackToSystem: event.target.checked },
                    }))
                  }
                  className="w-4 h-4 rounded border-white/20 bg-white/5 text-indigo-500 focus:ring-indigo-500"
                />
                <span className="text-sm text-gray-300">Fallback to macOS system voice</span>
              </label>
            </div>
          </div>

          <div className="rounded-xl bg-white/5 border border-white/10 p-4 space-y-3">
            <div className="flex items-center gap-2">
              <Mic className="w-4 h-4 text-emerald-300" />
              <h3 className="text-sm font-semibold text-white">Speech to Text</h3>
            </div>
            <Select
              label="Provider"
              options={[
                { value: "auto", label: "Auto" },
                { value: "openai", label: "OpenAI compatible" },
              ]}
              value={speech.stt.provider}
              onChange={(provider) =>
                setSpeech((current) => ({
                  ...current,
                  stt: {
                    ...current.stt,
                    provider: provider as SpeechSettingsState["stt"]["provider"],
                  },
                }))
              }
            />
            <Select
              label="Provider account"
              options={sttProviderOptions}
              value={speech.stt.providerId}
              onChange={(providerId) =>
                setSpeech((current) => ({ ...current, stt: { ...current.stt, providerId } }))
              }
            />
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Input
                label="Model"
                placeholder="gpt-4o-mini-transcribe"
                value={speech.stt.model}
                onChange={(event) =>
                  setSpeech((current) => ({
                    ...current,
                    stt: { ...current.stt, model: event.target.value },
                  }))
                }
              />
              <Input
                label="Language"
                placeholder="en"
                value={speech.stt.language}
                onChange={(event) =>
                  setSpeech((current) => ({
                    ...current,
                    stt: { ...current.stt, language: event.target.value },
                  }))
                }
              />
            </div>
            <p className="text-xs text-gray-500">
              Dictation uses the saved provider when the chat composer does not send an explicit
              provider.
            </p>
          </div>
        </div>
        <div className="flex justify-end">
          <Button
            leftIcon={
              saving ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />
            }
            onClick={() => void save()}
            disabled={saving || loading}
          >
            Save Speech Settings
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

export function Settings() {
  const { data: health } = useHealth();
  const { data: info } = useInfo();
  const { data: systemMonitor } = useSystemMonitor();
  const [activeSection, setActiveSection] = useState<SettingsSectionId>("general");

  const healthData = (health || {}) as HealthData;
  const infoData = (info || {}) as InfoData;

  const stats = [
    {
      label: "System Status",
      value: healthData.status || "Unknown",
      icon: Activity,
      color: healthData.status === "healthy" ? "text-emerald-400" : "text-red-400",
    },
    {
      label: "Uptime",
      value: formatUptime(Number(healthData.uptime) || 0),
      icon: Clock,
      color: "text-blue-400",
    },
    {
      label: "Version",
      value: String(infoData.version || "unknown"),
      icon: CheckCircle,
      color: "text-amber-400",
    },
    {
      label: "CPU",
      value: formatPct(systemMonitor?.cpu.usagePct),
      icon: Cpu,
      color: "text-cyan-400",
    },
    {
      label: "Memory",
      value: formatPct(systemMonitor?.memory.usedPct),
      icon: HardDrive,
      color: "text-emerald-400",
    },
  ];

  const checks = healthData.checks
    ? Object.entries(healthData.checks as Record<string, unknown>).filter(
        ([key]) => key !== "memory" && key !== "system"
      )
    : [];

  return (
    <PageLayout title="Settings" subtitle="Platform configuration and system information">
      <div className="space-y-6">
        <div className="flex flex-wrap gap-2 rounded-xl border border-white/10 bg-white/[0.03] p-1">
          {settingsSections.map((section) => (
            <button
              key={section.id}
              type="button"
              onClick={() => setActiveSection(section.id)}
              className={cn(
                "rounded-lg px-3 py-2 text-sm transition-colors",
                activeSection === section.id
                  ? "bg-white/10 text-white"
                  : "text-gray-400 hover:bg-white/5 hover:text-gray-200"
              )}
            >
              {section.label}
            </button>
          ))}
        </div>

        {activeSection === "general" && <ThemeSettings />}

        {activeSection === "ai-memory" && (
          <>
            <MemoryBehaviorSettings />
            <SystemPromptSection />
          </>
        )}

        {activeSection === "voice" && <SpeechSettingsSection />}

        {activeSection === "safety" && (
          <>
            <FeatureSettings />
            <SandboxBrowserSettings />
          </>
        )}

        {activeSection === "desktop" && (
          <>
            <ComputerUseSettings />
            <DesktopUpdateSettings
              currentVersion={String(infoData.version || "unknown")}
              releaseRepositoryUrl={infoData.releaseRepositoryUrl}
            />
          </>
        )}

        {activeSection === "system" && (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
              {stats.map((stat) => (
                <Card key={stat.label} variant="liquid">
                  <CardContent>
                    <div className="flex items-center gap-3">
                      <div
                        className={cn(
                          "w-12 h-12 rounded-xl flex items-center justify-center bg-white/5",
                          stat.color
                        )}
                      >
                        <stat.icon className="w-6 h-6" />
                      </div>
                      <div>
                        <p className="text-sm text-gray-400">{stat.label}</p>
                        <p className="text-xl font-semibold text-white capitalize">{stat.value}</p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>

            <Card variant="liquid">
              <CardHeader>
                <CardTitle>System Monitor</CardTitle>
                <CardDescription>Live host resource usage from the Cybara gateway</CardDescription>
              </CardHeader>
              <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="rounded-xl bg-white/5 p-4">
                  <p className="text-sm text-gray-400">CPU</p>
                  <p className="mt-1 text-2xl font-semibold text-white">
                    {formatPct(systemMonitor?.cpu.usagePct)}
                  </p>
                  <p className="mt-1 text-xs text-gray-500">
                    {systemMonitor?.cpu.cores || 0} cores -{" "}
                    {systemMonitor?.cpu.model || "Loading CPU"}
                  </p>
                </div>
                <div className="rounded-xl bg-white/5 p-4">
                  <p className="text-sm text-gray-400">Memory</p>
                  <p className="mt-1 text-2xl font-semibold text-white">
                    {formatPct(systemMonitor?.memory.usedPct)}
                  </p>
                  <p className="mt-1 text-xs text-gray-500">
                    {formatBytes(systemMonitor?.memory.usedBytes)} /{" "}
                    {formatBytes(systemMonitor?.memory.totalBytes)} used
                  </p>
                </div>
                {systemMonitor?.memory.swap ? (
                  <div className="rounded-xl bg-white/5 p-4">
                    <p className="text-sm text-gray-400">Swap</p>
                    <p className="mt-1 text-2xl font-semibold text-white">
                      {formatPct(systemMonitor.memory.swap.usedPct)}
                    </p>
                    <p className="mt-1 text-xs text-gray-500">
                      {formatBytes(systemMonitor.memory.swap.usedBytes)} /{" "}
                      {formatBytes(systemMonitor.memory.swap.totalBytes)} used
                    </p>
                  </div>
                ) : null}
                <div className="rounded-xl bg-white/5 p-4">
                  <p className="text-sm text-gray-400">Cybara process</p>
                  <p className="mt-1 text-2xl font-semibold text-white">
                    {formatPct(systemMonitor?.process.cpuUsagePct)}
                  </p>
                  <p className="mt-1 text-xs text-gray-500">
                    {formatBytes(systemMonitor?.process.memory.rssBytes)} RSS - PID{" "}
                    {systemMonitor?.process.pid || "n/a"}
                  </p>
                </div>
                <div className="rounded-xl bg-white/5 p-4">
                  <p className="text-sm text-gray-400">Disk</p>
                  <p className="mt-1 text-2xl font-semibold text-white">
                    {formatPct(systemMonitor?.disk?.usedPct)}
                  </p>
                  <p className="mt-1 text-xs text-gray-500">
                    {systemMonitor?.disk
                      ? `${formatStorageBytes(systemMonitor.disk.freeBytes)} free at ${systemMonitor.disk.path}`
                      : "Disk telemetry unavailable"}
                  </p>
                </div>
              </CardContent>
            </Card>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <Card variant="liquid">
                <CardHeader>
                  <CardTitle>System Information</CardTitle>
                  <CardDescription>Platform details and version info</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex justify-between py-2 border-b border-white/10">
                    <span className="text-gray-400">Platform Name</span>
                    <span className="text-white">{infoData?.name || "Cybara"}</span>
                  </div>
                  <div className="flex justify-between py-2 border-b border-white/10">
                    <span className="text-gray-400">Version</span>
                    <span className="text-white">{infoData?.version || "unknown"}</span>
                  </div>
                  <div className="flex justify-between py-2 border-b border-white/10">
                    <span className="text-gray-400">Setup Complete</span>
                    <Badge variant={infoData?.setupComplete ? "success" : "warning"}>
                      {infoData?.setupComplete ? "Yes" : "No"}
                    </Badge>
                  </div>
                  <div className="flex justify-between py-2 border-b border-white/10">
                    <span className="text-gray-400">Server Time</span>
                    <span className="text-white">
                      {healthData?.timestamp
                        ? new Date(healthData.timestamp).toLocaleString()
                        : "N/A"}
                    </span>
                  </div>
                </CardContent>
              </Card>

              <Card variant="liquid">
                <CardHeader>
                  <CardTitle>Health Checks</CardTitle>
                  <CardDescription>Component status overview</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  {checks.length === 0 ? (
                    <div className="text-center py-8 text-gray-500">
                      <Activity className="w-8 h-8 mx-auto mb-2" />
                      <p>No health checks available</p>
                    </div>
                  ) : (
                    checks.map(([key, value]) => {
                      const check = getCheckStatus(value);
                      const icons: Record<string, React.ReactNode> = {
                        database: <Database className="w-5 h-5" />,
                        agents: <Bot className="w-5 h-5" />,
                        providers: <Cloud className="w-5 h-5" />,
                        memory: <HardDrive className="w-5 h-5" />,
                      };

                      return (
                        <div
                          key={key}
                          className="flex items-center justify-between p-3 rounded-xl bg-white/5"
                        >
                          <div className="flex items-center gap-3">
                            <div
                              className={cn(
                                "w-10 h-10 rounded-lg flex items-center justify-center",
                                check.status === "healthy"
                                  ? "bg-emerald-500/20 text-emerald-400"
                                  : "bg-red-500/20 text-red-400"
                              )}
                            >
                              {icons[key] || <Server className="w-5 h-5" />}
                            </div>
                            <div>
                              <span className="text-white capitalize">{key}</span>
                              {check.details && (
                                <p className="text-xs text-gray-500">{check.details}</p>
                              )}
                            </div>
                          </div>
                          <Badge variant={check.status === "healthy" ? "success" : "error"}>
                            {check.status}
                          </Badge>
                        </div>
                      );
                    })
                  )}
                </CardContent>
              </Card>
            </div>
          </>
        )}
      </div>
    </PageLayout>
  );
}

function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);

  if (days > 0) return `${days}d ${hours}h ${minutes}m`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

function formatByteCount(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let unitIndex = 0;
  let amount = value;
  while (amount >= 1024 && unitIndex < units.length - 1) {
    amount /= 1024;
    unitIndex += 1;
  }
  return `${amount >= 10 || unitIndex === 0 ? amount.toFixed(0) : amount.toFixed(1)} ${units[unitIndex]}`;
}

function cn(...classes: (string | boolean | undefined)[]) {
  return classes.filter(Boolean).join(" ");
}

function SystemPromptSection() {
  const { data: systemPrompt, isLoading: loadingPrompt } = useSystemPrompt();
  const { data: identity, isLoading: loadingIdentity } = useIdentity();
  const updateSystemPrompt = useUpdateSystemPrompt();
  const updateIdentity = useUpdateIdentity();
  const { addToast } = useUIStore();

  const initialized = useRef(false);

  const [identityForm, setIdentityForm] = useState<Partial<IdentityConfig>>({
    name: "",
    emoji: "",
    creature: "",
    vibe: "",
    theme: "dark",
  });

  const [customPrompt, setCustomPrompt] = useState("");
  const [features, setFeatures] = useState({
    memoryEnabled: true,
    skillsEnabled: true,
    messagingEnabled: true,
    replyTagsEnabled: true,
  });

  useEffect(() => {
    if (loadingPrompt || loadingIdentity) return;
    if (initialized.current) return;

    const typedSystemPrompt = systemPrompt as SystemPromptConfig | undefined;
    const typedIdentity = identity as IdentityConfig | undefined;

    if (typedIdentity) {
      setIdentityForm({
        name: typedIdentity.name || "",
        emoji: typedIdentity.emoji || "",
        creature: typedIdentity.creature || "",
        vibe: typedIdentity.vibe || "",
        theme: typedIdentity.theme || "dark",
      });
    }

    if (typedSystemPrompt) {
      setCustomPrompt(typedSystemPrompt.customPrompt || "");
      setFeatures(
        typedSystemPrompt.features || {
          memoryEnabled: true,
          skillsEnabled: true,
          messagingEnabled: true,
          replyTagsEnabled: true,
        }
      );
    }

    initialized.current = true;
  }, [systemPrompt, identity, loadingPrompt, loadingIdentity]);

  const handleSaveIdentity = async () => {
    try {
      await updateIdentity.mutateAsync(identityForm);
      addToast("success", "Identity settings saved");
    } catch (error) {
      addToast("error", error instanceof Error ? error.message : "Failed to save identity");
    }
  };

  const handleSaveSystemPrompt = async () => {
    try {
      await updateSystemPrompt.mutateAsync({
        customPrompt,
        features,
      });
      addToast("success", "System prompt settings saved");
    } catch (error) {
      addToast("error", error instanceof Error ? error.message : "Failed to save system prompt");
    }
  };

  const featureLabels: Record<string, { label: string; desc: string }> = {
    memoryEnabled: { label: "Memory Recall", desc: "Search memory before answering" },
    skillsEnabled: { label: "Skills", desc: "Read and use skill files" },
    messagingEnabled: { label: "Messaging", desc: "Multi-channel messaging" },
    replyTagsEnabled: { label: "Reply Tags", desc: "Special reply behaviors" },
  };

  const isLoading = loadingPrompt || loadingIdentity;

  return (
    <Card variant="liquid" className="lg:col-span-2">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Brain className="w-5 h-5 text-indigo-400" />
          System Prompt & Identity
        </CardTitle>
        <CardDescription>
          Customize how the AI assistant presents itself and behaves
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {isLoading ? (
          <div className="text-center py-8 text-gray-500">
            <Sparkles className="w-8 h-8 mx-auto mb-2 animate-pulse" />
            <p>Loading configuration...</p>
          </div>
        ) : (
          <>
            <div className="p-4 rounded-xl bg-white/5">
              <h4 className="flex items-center gap-2 text-white font-medium mb-4">
                <User className="w-4 h-4 text-emerald-400" />
                AI Identity
              </h4>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm text-gray-400 mb-1">Name</label>
                  <Input
                    value={identityForm.name}
                    onChange={(e) => setIdentityForm({ ...identityForm, name: e.target.value })}
                    placeholder="Cybara"
                  />
                </div>
                <div>
                  <label className="block text-sm text-gray-400 mb-1">Emoji</label>
                  <Input
                    value={identityForm.emoji}
                    onChange={(e) => setIdentityForm({ ...identityForm, emoji: e.target.value })}
                    placeholder="🧠"
                  />
                </div>
                <div>
                  <label className="block text-sm text-gray-400 mb-1">Creature Type</label>
                  <Input
                    value={identityForm.creature}
                    onChange={(e) => setIdentityForm({ ...identityForm, creature: e.target.value })}
                    placeholder="AI assistant"
                  />
                </div>
                <div>
                  <label className="block text-sm text-gray-400 mb-1">Vibe</label>
                  <Input
                    value={identityForm.vibe}
                    onChange={(e) => setIdentityForm({ ...identityForm, vibe: e.target.value })}
                    placeholder="Professional, helpful, and concise"
                  />
                </div>
                <div>
                  <label className="block text-sm text-gray-400 mb-1">Theme</label>
                  <Select
                    value={identityForm.theme}
                    onChange={(value) => setIdentityForm({ ...identityForm, theme: value })}
                    options={[
                      { value: "dark", label: "Dark" },
                      { value: "light", label: "Light" },
                    ]}
                  />
                </div>
              </div>
              <div className="mt-4 flex justify-end">
                <Button
                  onClick={handleSaveIdentity}
                  disabled={updateIdentity.isPending}
                  variant="primary"
                >
                  <Save className="w-4 h-4 mr-2" />
                  {updateIdentity.isPending ? "Saving..." : "Save Identity"}
                </Button>
              </div>
            </div>

            <div className="p-4 rounded-xl bg-white/5">
              <h4 className="flex items-center gap-2 text-white font-medium mb-4">
                <Sparkles className="w-4 h-4 text-amber-400" />
                Prompt Features
              </h4>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                {(Object.keys(features) as Array<keyof typeof features>).map((key) => (
                  <label key={key} className="flex items-start gap-3 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={features[key]}
                      onChange={(e) => setFeatures({ ...features, [key]: e.target.checked })}
                      className="mt-1 w-4 h-4 rounded border-gray-600 bg-gray-700 text-indigo-500 focus:ring-indigo-500"
                    />
                    <div>
                      <span className="text-white block">{featureLabels[key]?.label}</span>
                      <span className="text-xs text-gray-500">{featureLabels[key]?.desc}</span>
                    </div>
                  </label>
                ))}
              </div>
            </div>

            <div className="p-4 rounded-xl bg-white/5">
              <h4 className="flex items-center gap-2 text-white font-medium mb-4">
                <Bot className="w-4 h-4 text-blue-400" />
                Custom System Prompt
              </h4>
              <p className="text-sm text-gray-400 mb-3">
                This text is appended to the default system prompt. Use it to add custom
                instructions or override behaviors.
              </p>
              <Textarea
                value={customPrompt}
                onChange={(e) => setCustomPrompt(e.target.value)}
                placeholder="You are a helpful coding assistant that specializes in Rust..."
                rows={6}
                className="font-mono text-sm"
              />
              <div className="mt-4 flex justify-end">
                <Button
                  onClick={handleSaveSystemPrompt}
                  disabled={updateSystemPrompt.isPending}
                  variant="primary"
                >
                  <Save className="w-4 h-4 mr-2" />
                  {updateSystemPrompt.isPending ? "Saving..." : "Save System Prompt"}
                </Button>
              </div>
            </div>

            <SystemPromptPreviewSection />
          </>
        )}
      </CardContent>
    </Card>
  );
}

function SystemPromptPreviewSection() {
  const { data: preview, isLoading: loadingPreview } = useSystemPromptPreview();

  return (
    <div className="p-4 rounded-xl bg-white/5">
      <h4 className="flex items-center gap-2 text-white font-medium mb-4">
        <Eye className="w-4 h-4 text-cyan-400" />
        Current System Prompt Preview
      </h4>
      <p className="text-sm text-gray-400 mb-3">
        This is the current system prompt that will be sent to agents based on your configuration.
      </p>
      {loadingPreview ? (
        <div className="text-center py-4 text-gray-500">
          <Sparkles className="w-6 h-6 mx-auto mb-2 animate-pulse" />
          <p>Generating preview...</p>
        </div>
      ) : (
        <div className="bg-[#0a0a0f] rounded-xl p-4 max-h-96 overflow-y-auto">
          <pre className="text-xs text-gray-300 whitespace-pre-wrap font-mono">
            {preview?.preview || "No preview available"}
          </pre>
        </div>
      )}
    </div>
  );
}
