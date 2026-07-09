import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { PageLayout } from "@/components/layout";
import { GatewayPathSettingsSection } from "@/components/settings/GatewayPathSettingsSection";
import { GatewayRemoteAccessSection } from "@/components/settings/GatewayRemoteAccessSection";
import { SettingsNavigation } from "@/components/settings/SettingsNavigation";
import { FeatureSettings } from "./settings/FeatureSettings";
import { MemoryBehaviorSettings } from "./settings/MemoryBehaviorSettings";
import { SpeechSettingsSection } from "./settings/SpeechSettingsSection";
import { SystemPromptSection } from "./settings/SystemPromptSection";
import { asSettingsRecord, readIntegerSetting } from "./settings/settingsValueReaders";
import {
  useHealth,
  useInfo,
  useSystemMonitor,
  useIdentity,
  useUpdateIdentity,
  type IdentityConfig,
  type HealthData,
  type InfoData,
} from "@/hooks/useApi";
import {
  extractApiError,
  settingsApi,
  computerUseApi,
  sandboxBrowserApi,
  walletApi,
  authApi,
  systemApi,
  logsApi,
  migrationApi,
  type ComputerUseStatus,
  type SandboxBrowserStatus,
  type WalletAgentPolicy,
  type WalletRpcStatus,
  type WalletStatus,
  type GatewayAuthSettings,
  type LogPageEntry,
  type MigrationItem,
  type MigrationPreset,
  type MigrationSkillConflictMode,
  type MigrationSourceCandidate,
  type MigrationSourceKind,
  type SourceMigrationReport,
} from "@/lib/api";
import { clearGatewayAccessPassword, setApiAuthToken, setGatewayAccessPassword } from "@/lib/auth";
import { Modal } from "@/components/ui/Modal";
import { Switch } from "@/components/ui/Switch";
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
  openDesktopDirectoryDialog,
  openDesktopFileDialog,
} from "@/lib/desktopHost";
import { Input, Textarea, Select } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import {
  readThemeAccentFromConfig,
  readThemeModeFromIdentity,
  themeAccentKeys,
  themeAccents,
  themeConfigPayload,
  useUIStore,
  type ThemeAccent,
  type ThemeMode,
} from "@/stores/uiStore";
import { resolveSettingsSectionId, type SettingsSectionId } from "@/lib/settingsNavigation";
import { languageOptions, useI18n } from "@/lib/i18n";
import {
  cn,
  formatByteCount,
  formatBytes,
  formatPct,
  formatStorageBytes,
  formatUptime,
} from "@/lib/settingsFormat";
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
  Eye,
  Palette,
  RefreshCw,
  Shield,
  Download,
  ExternalLink,
  FolderSync,
  MonitorUp,
  Monitor,
  Moon,
  Sun,
} from "lucide-react";
import { useState, useRef, useEffect, useCallback } from "react";
import { useSearchParams } from "react-router-dom";
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

function ThemeSettings() {
  const { accent, setAccent, mode, setMode, addToast } = useUIStore();
  const { locale, mode: languageMode, setMode: setLanguageMode, t } = useI18n();
  const [savingAccent, setSavingAccent] = useState<ThemeAccent | null>(null);
  const { data: identity, isLoading: identityLoading } = useIdentity();
  const updateIdentity = useUpdateIdentity();

  useEffect(() => {
    const nextMode = readThemeModeFromIdentity(
      identity as unknown as Record<string, unknown> | undefined
    );
    setMode(nextMode);
  }, [identity, setMode]);

  const updateThemeMode = async (next: ThemeMode) => {
    if (next === mode) return;
    const previous = mode;
    setMode(next);
    try {
      const current = (identity as IdentityConfig | undefined) ?? {};
      await updateIdentity.mutateAsync({ ...current, theme: next });
      addToast("success", `${t("settings.theme")} set to ${next}`);
    } catch (error) {
      setMode(previous);
      addToast("error", error instanceof Error ? error.message : "Failed to update theme");
    }
  };

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
      } catch {}
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
      addToast("success", `${t("settings.accent")} changed to ${themeAccents[key].name}`);
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
          {t("settings.theme")}
        </CardTitle>
        <CardDescription>{t("settings.themeHelp")}</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="mb-5 grid gap-5 lg:grid-cols-[1fr_260px]">
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-medium text-gray-200">{t("settings.theme")}</p>
                <p className="text-xs text-gray-500">{t("settings.themeHelp")}</p>
              </div>
            </div>
            <div
              role="radiogroup"
              aria-label={t("settings.theme")}
              className="grid grid-cols-3 gap-1 rounded-xl border border-white/10 bg-black/20 p-1"
            >
              {[
                {
                  value: "system" as const,
                  label: t("settings.themeSystem"),
                  icon: Monitor,
                },
                {
                  value: "light" as const,
                  label: t("settings.themeLight"),
                  icon: Sun,
                },
                {
                  value: "dark" as const,
                  label: t("settings.themeDark"),
                  icon: Moon,
                },
              ].map((option) => {
                const selected = mode === option.value;
                const Icon = option.icon;
                return (
                  <button
                    key={option.value}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    disabled={updateIdentity.isPending || identityLoading}
                    onClick={() => void updateThemeMode(option.value)}
                    className={cn(
                      "flex min-h-10 items-center justify-center gap-2 rounded-lg px-3 text-sm font-medium transition-colors",
                      selected
                        ? "border border-white/10 bg-white/10 text-white shadow-sm"
                        : "text-gray-400 hover:bg-white/5 hover:text-gray-200",
                      (updateIdentity.isPending || identityLoading) &&
                        "cursor-not-allowed opacity-60"
                    )}
                  >
                    <Icon className="h-4 w-4" />
                    {option.label}
                  </button>
                );
              })}
            </div>
          </div>
          <div className="space-y-2">
            <div>
              <p className="text-sm font-medium text-gray-200">{t("settings.language")}</p>
              <p className="text-xs text-gray-500">{t("settings.languageHelp")}</p>
            </div>
            <Select
              value={languageMode}
              onChange={(value) => setLanguageMode(value as typeof languageMode)}
              options={languageOptions(locale).map((option) => ({
                value: option.value,
                label: option.label,
              }))}
            />
          </div>
        </div>
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
        <p className="text-xs text-gray-500 mt-3">
          {t("settings.accent")}: {themeAccents[accent].name}
        </p>
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

type LlmTimeoutSettingsState = {
  firstTokenSeconds: number;
  stallSeconds: number;
  totalSeconds: number;
  nonStreamingSeconds: number;
};

const defaultLlmTimeoutSettings: LlmTimeoutSettingsState = {
  firstTokenSeconds: 300,
  stallSeconds: 300,
  totalSeconds: 0,
  nonStreamingSeconds: 1800,
};

function readLlmTimeoutSettings(value: unknown): LlmTimeoutSettingsState {
  const record = asSettingsRecord(value);
  return {
    firstTokenSeconds: readIntegerSetting(
      record.firstTokenSeconds,
      defaultLlmTimeoutSettings.firstTokenSeconds,
      10,
      7200
    ),
    stallSeconds: readIntegerSetting(
      record.stallSeconds,
      defaultLlmTimeoutSettings.stallSeconds,
      0,
      7200
    ),
    totalSeconds: readIntegerSetting(
      record.totalSeconds,
      defaultLlmTimeoutSettings.totalSeconds,
      0,
      86400
    ),
    nonStreamingSeconds: readIntegerSetting(
      record.nonStreamingSeconds,
      defaultLlmTimeoutSettings.nonStreamingSeconds,
      60,
      86400
    ),
  };
}

function LlmTimeoutSettingsSection() {
  const { addToast } = useUIStore();
  const [timeouts, setTimeouts] = useState<LlmTimeoutSettingsState>(defaultLlmTimeoutSettings);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let mounted = true;
    void settingsApi.getConfig().then((result) => {
      if (!mounted) return;
      if (result.success) {
        setTimeouts(readLlmTimeoutSettings(result.data?.llm_timeouts));
      }
      setLoading(false);
    });
    return () => {
      mounted = false;
    };
  }, []);

  const update = (patch: Partial<LlmTimeoutSettingsState>) =>
    setTimeouts((current) => ({ ...current, ...patch }));

  async function save() {
    setSaving(true);
    try {
      const result = await settingsApi.updateConfig({ llm_timeouts: timeouts });
      if (!result.success) throw new Error(result.error || "Failed to save watchdog settings");
      addToast("success", "Agent watchdog settings saved");
    } catch (error) {
      addToast(
        "error",
        error instanceof Error ? error.message : "Failed to save watchdog settings"
      );
    } finally {
      setSaving(false);
    }
  }

  const numberField = (
    label: string,
    key: keyof LlmTimeoutSettingsState,
    helper: string,
    min: number
  ) => (
    <Input
      label={label}
      type="number"
      min={min}
      value={timeouts[key]}
      helperText={helper}
      disabled={loading || saving}
      onChange={(event) =>
        update({ [key]: readIntegerSetting(event.target.value, timeouts[key], min, 86400) })
      }
    />
  );

  return (
    <Card variant="liquid">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Clock className="w-5 h-5 text-cyan-400" />
          Agent Turn Watchdogs
        </CardTitle>
        <CardDescription>
          Timeouts trigger on provider silence, never on how long an agent works — a healthy
          multi-hour run streams continuously and is never cut off. Local model endpoints auto-relax
          these limits. Environment variables (CYBARA_LLM_*) override saved values.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
          {numberField(
            "First token (seconds)",
            "firstTokenSeconds",
            "Max wait for any output at all",
            10
          )}
          {numberField(
            "Stall (seconds)",
            "stallSeconds",
            "Max silent gap mid-stream · 0 disables",
            0
          )}
          {numberField(
            "Total cap (seconds)",
            "totalSeconds",
            "Absolute limit per call · 0 = unlimited",
            0
          )}
          {numberField(
            "Non-streaming ceiling (seconds)",
            "nonStreamingSeconds",
            "For providers that cannot stream",
            60
          )}
        </div>
        <div className="flex justify-end">
          <Button onClick={() => void save()} disabled={loading || saving} isLoading={saving}>
            Save Watchdogs
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function parseWalletAllowlistInput(value: string): string[] {
  return value
    .split(/[\n,]/)
    .map((item) => item.trim())
    .filter(Boolean);
}
function WalletSettings() {
  const { addToast } = useUIStore();
  const [status, setStatus] = useState<WalletStatus | null>(null);
  const [rpcStatus, setRpcStatus] = useState<WalletRpcStatus | null>(null);
  const [agentPolicy, setAgentPolicy] = useState<WalletAgentPolicy | null>(null);
  const [rpcEth, setRpcEth] = useState("");
  const [rpcSol, setRpcSol] = useState("");
  const [rpcBtc, setRpcBtc] = useState("");
  const [ethAllowlistInput, setEthAllowlistInput] = useState("");
  const [solAllowlistInput, setSolAllowlistInput] = useState("");
  const [sendRecipientAllowlistInput, setSendRecipientAllowlistInput] = useState("");
  const [dappHostAllowlistInput, setDappHostAllowlistInput] = useState("");
  const [x402NetworkAllowlistInput, setX402NetworkAllowlistInput] = useState("");
  const [maxSendAmountInput, setMaxSendAmountInput] = useState("");
  const [x402MaxAmountInput, setX402MaxAmountInput] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deletePassword, setDeletePassword] = useState("");
  const [deleteConfirmText, setDeleteConfirmText] = useState("");

  const syncWalletPolicyInputs = useCallback((policy: WalletAgentPolicy) => {
    setAgentPolicy(policy);
    setEthAllowlistInput(policy.allowedEthContracts.join("\n"));
    setSolAllowlistInput(policy.allowedSolPrograms.join("\n"));
    setSendRecipientAllowlistInput(policy.allowedSendRecipients.join("\n"));
    setDappHostAllowlistInput(policy.allowedDappHosts.join("\n"));
    setX402NetworkAllowlistInput(policy.allowedX402Networks.join("\n"));
    setMaxSendAmountInput(policy.maxSendAmount);
    setX402MaxAmountInput(policy.x402MaxAmountAtomic);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [statusRes, rpcRes, rpcStatusRes, policyRes] = await Promise.all([
        walletApi.status(),
        walletApi.rpc(),
        walletApi.rpcStatus(),
        walletApi.getAgentPolicy(),
      ]);
      if (statusRes.success && statusRes.data) setStatus(statusRes.data);
      if (rpcRes.success && rpcRes.data) {
        setRpcEth(rpcRes.data.ethRpc);
        setRpcSol(rpcRes.data.solRpc);
        setRpcBtc(rpcRes.data.btcApi);
      }
      setRpcStatus(rpcStatusRes.success && rpcStatusRes.data ? rpcStatusRes.data : null);
      if (policyRes.success && policyRes.data) {
        syncWalletPolicyInputs(policyRes.data);
      }
    } catch {
      addToast("error", "Failed to load wallet settings");
    } finally {
      setLoading(false);
    }
  }, [addToast, syncWalletPolicyInputs]);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => {
      if (document.hidden) return;
      void walletApi.rpcStatus().then((res) => {
        if (res.success && res.data) setRpcStatus(res.data);
      });
    }, 60_000);
    return () => window.clearInterval(timer);
  }, [load]);

  async function handleToggleAgentAccess(enabled: boolean) {
    setBusy(true);
    try {
      const response = await walletApi.setAgentAccess(enabled);
      if (!response.success) throw new Error(response.error || "Failed to update agent access");
      addToast("success", `Agent wallet access ${enabled ? "enabled" : "disabled"}`);
      const statusRes = await walletApi.status();
      if (statusRes.success && statusRes.data) setStatus(statusRes.data);
    } catch (error) {
      addToast("error", error instanceof Error ? error.message : "Failed to update agent access");
    } finally {
      setBusy(false);
    }
  }

  async function handleSaveRpc() {
    setBusy(true);
    try {
      const response = await walletApi.updateRpc({
        ethRpc: rpcEth.trim(),
        solRpc: rpcSol.trim(),
        btcApi: rpcBtc.trim(),
      });
      if (!response.success || !response.data) {
        throw new Error(response.error || "Failed to save RPC settings");
      }
      addToast("success", "RPC settings updated");
      const rpcStatusRes = await walletApi.rpcStatus();
      setRpcStatus(rpcStatusRes.success && rpcStatusRes.data ? rpcStatusRes.data : null);
    } catch (error) {
      addToast("error", error instanceof Error ? error.message : "Failed to save RPC settings");
    } finally {
      setBusy(false);
    }
  }

  async function handleSavePolicy() {
    if (!agentPolicy) return;
    setBusy(true);
    try {
      const response = await walletApi.updateAgentPolicy({
        allowNativeSend: agentPolicy.allowNativeSend,
        allowTokenSend: agentPolicy.allowTokenSend,
        allowEthContractWrite: agentPolicy.allowEthContractWrite,
        allowSolProgramInstruction: agentPolicy.allowSolProgramInstruction,
        allowEthSwaps: agentPolicy.allowEthSwaps,
        allowDappInteraction: agentPolicy.allowDappInteraction,
        allowX402Payments: agentPolicy.allowX402Payments,
        allowedEthContracts: parseWalletAllowlistInput(ethAllowlistInput),
        allowedSolPrograms: parseWalletAllowlistInput(solAllowlistInput),
        allowedSendRecipients: parseWalletAllowlistInput(sendRecipientAllowlistInput),
        allowedDappHosts: parseWalletAllowlistInput(dappHostAllowlistInput),
        allowedX402Networks: parseWalletAllowlistInput(x402NetworkAllowlistInput),
        maxSendAmount: maxSendAmountInput.trim(),
        x402MaxAmountAtomic: x402MaxAmountInput.trim(),
      });
      if (!response.success || !response.data) {
        throw new Error(response.error || "Failed to save agent policy");
      }
      syncWalletPolicyInputs(response.data.policy);
      addToast("success", "Agent wallet policy updated");
    } catch (error) {
      addToast("error", error instanceof Error ? error.message : "Failed to save agent policy");
    } finally {
      setBusy(false);
    }
  }

  async function handleDeleteWallet() {
    if (deleteConfirmText.trim().toUpperCase() !== "DELETE") {
      addToast("error", "Type DELETE to confirm wallet deletion");
      return;
    }
    const passwordForDelete = deletePassword.trim();
    if (!status?.unlocked && !passwordForDelete) {
      addToast("error", "Password is required while wallet is locked");
      return;
    }
    setBusy(true);
    try {
      const response = await walletApi.deleteWallet(passwordForDelete || undefined);
      if (!response.success) throw new Error(response.error || "Failed to delete wallet");
      setDeleteDialogOpen(false);
      setDeletePassword("");
      setDeleteConfirmText("");
      addToast("success", "Wallet deleted");
      await load();
    } catch (error) {
      addToast("error", error instanceof Error ? error.message : "Failed to delete wallet");
    } finally {
      setBusy(false);
    }
  }

  const policyToggles: Array<{ key: keyof WalletAgentPolicy; label: string; description: string }> =
    [
      { key: "allowNativeSend", label: "Native sends", description: "ETH, BTC, and SOL transfers" },
      { key: "allowTokenSend", label: "Token sends", description: "ERC-20 and SPL transfers" },
      {
        key: "allowEthContractWrite",
        label: "ETH contract writes",
        description: "Contract writes",
      },
      {
        key: "allowSolProgramInstruction",
        label: "Solana program instructions",
        description: "Program calls",
      },
      { key: "allowEthSwaps", label: "Swaps", description: "Uniswap and Jupiter swaps" },
      {
        key: "allowDappInteraction",
        label: "Dapp interaction",
        description: "Dapp adapters",
      },
      { key: "allowX402Payments", label: "x402 payments", description: "Paid HTTP requests" },
    ];

  return (
    <div className="space-y-6">
      <Card variant="liquid">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Shield className="w-5 h-5 text-amber-400" />
            Agent Access
          </CardTitle>
          <CardDescription>
            Agent access is off by default; write actions are gated by policy.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Switch
            label="Allow agents to use the wallet"
            description={
              status?.unlocked
                ? "Agents can read balances and, per policy, sign transactions"
                : "Unlock the wallet on the Wallet page to change this"
            }
            checked={Boolean(status?.agentAccessEnabled)}
            disabled={loading || busy || !status?.unlocked}
            onChange={(checked) => void handleToggleAgentAccess(checked)}
          />
          {agentPolicy && (
            <div className="space-y-3 pt-3 border-t border-white/10">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {policyToggles.map((toggle) => (
                  <Switch
                    key={toggle.key}
                    label={toggle.label}
                    description={toggle.description}
                    checked={Boolean(agentPolicy[toggle.key])}
                    disabled={loading || busy}
                    onChange={(checked) =>
                      setAgentPolicy((current) =>
                        current ? { ...current, [toggle.key]: checked } : current
                      )
                    }
                  />
                ))}
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <Textarea
                  label="Allowlisted ETH contracts (one per line)"
                  placeholder="0x..."
                  rows={3}
                  value={ethAllowlistInput}
                  onChange={(e) => setEthAllowlistInput(e.target.value)}
                />
                <Textarea
                  label="Allowlisted Solana programs (one per line)"
                  placeholder="Program pubkey"
                  rows={3}
                  value={solAllowlistInput}
                  onChange={(e) => setSolAllowlistInput(e.target.value)}
                />
                <Textarea
                  label="Allowlisted send recipients (one per line)"
                  placeholder="Wallet address"
                  rows={3}
                  value={sendRecipientAllowlistInput}
                  onChange={(e) => setSendRecipientAllowlistInput(e.target.value)}
                />
                <Textarea
                  label="Allowlisted dapp hosts (one per line)"
                  placeholder="merchant.example"
                  rows={3}
                  value={dappHostAllowlistInput}
                  onChange={(e) => setDappHostAllowlistInput(e.target.value)}
                />
                <Textarea
                  label="Allowlisted x402 networks (one per line)"
                  placeholder="eip155:1"
                  rows={3}
                  value={x402NetworkAllowlistInput}
                  onChange={(e) => setX402NetworkAllowlistInput(e.target.value)}
                />
                <div className="grid grid-cols-1 gap-3">
                  <Input
                    label="Max send amount"
                    placeholder="No cap"
                    value={maxSendAmountInput}
                    onChange={(e) => setMaxSendAmountInput(e.target.value)}
                  />
                  <Input
                    label="x402 max amount (atomic units)"
                    value={x402MaxAmountInput}
                    onChange={(e) => setX402MaxAmountInput(e.target.value)}
                  />
                </div>
              </div>
              <div className="flex justify-end">
                <Button onClick={() => void handleSavePolicy()} disabled={loading || busy}>
                  Save Agent Policy
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card variant="liquid">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Server className="w-5 h-5 text-cyan-400" />
            Network Endpoints
          </CardTitle>
          <CardDescription>
            RPC endpoints for balances, history, and sending. Prices also use Pyth, Hermes,
            Chainlink, and Jupiter.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <Input
              label="Ethereum RPC"
              value={rpcEth}
              onChange={(e) => setRpcEth(e.target.value)}
            />
            <Input label="Solana RPC" value={rpcSol} onChange={(e) => setRpcSol(e.target.value)} />
            <Input label="Bitcoin API" value={rpcBtc} onChange={(e) => setRpcBtc(e.target.value)} />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={() => void handleSaveRpc()} disabled={loading || busy}>
              Save Endpoints
            </Button>
          </div>
          {rpcStatus?.services?.length ? (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {rpcStatus.services.map((service) => (
                <div
                  key={service.chain}
                  className="rounded-lg border border-white/10 bg-white/[0.02] p-3 text-xs"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium text-white uppercase">{service.chain}</span>
                    <Badge variant={service.healthy ? "success" : "error"}>
                      {service.healthy ? "healthy" : "down"}
                    </Badge>
                  </div>
                  <p className="mt-1 truncate text-gray-400" title={service.endpoint}>
                    {service.endpoint}
                  </p>
                  <p className="mt-1 text-gray-500">
                    {service.latencyMs}ms
                    {service.latestHeight ? ` · height ${service.latestHeight}` : ""}
                  </p>
                  {service.error ? <p className="mt-1 text-red-300">{service.error}</p> : null}
                </div>
              ))}
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Card variant="liquid">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 text-red-400" />
            Danger Zone
          </CardTitle>
          <CardDescription>
            Permanently remove the encrypted wallet from this device. Back up your seed phrase
            first.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button
            variant="danger"
            onClick={() => setDeleteDialogOpen(true)}
            disabled={loading || busy || !status?.exists}
          >
            Delete Wallet
          </Button>
        </CardContent>
      </Card>

      <Modal
        isOpen={deleteDialogOpen}
        onClose={() => {
          if (!busy) setDeleteDialogOpen(false);
        }}
        title="Delete Wallet"
        description="This permanently removes your encrypted wallet from this device."
        size="sm"
      >
        <div className="space-y-4">
          <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-100">
            This action cannot be undone. Ensure your seed phrase backup is stored offline before
            deleting.
          </div>
          <Input
            type="password"
            label={status?.unlocked ? "Wallet password (optional)" : "Wallet password"}
            value={deletePassword}
            onChange={(e) => setDeletePassword(e.target.value)}
            placeholder={
              status?.unlocked
                ? "Optional verification password"
                : "Required while wallet is locked"
            }
          />
          <Input
            label='Type "DELETE" to confirm'
            value={deleteConfirmText}
            onChange={(e) => setDeleteConfirmText(e.target.value)}
            placeholder="DELETE"
          />
          <div className="flex justify-end gap-3">
            <Button variant="ghost" onClick={() => setDeleteDialogOpen(false)} disabled={busy}>
              Cancel
            </Button>
            <Button variant="danger" onClick={() => void handleDeleteWallet()} isLoading={busy}>
              Delete Wallet
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

function migrationStatusClass(status: MigrationItem["status"]): string {
  switch (status) {
    case "migrated":
      return "text-emerald-300";
    case "planned":
      return "text-blue-300";
    case "conflict":
    case "error":
      return "text-red-300";
    case "archived":
      return "text-amber-300";
    default:
      return "text-gray-400";
  }
}

function MigrationSettingsSection() {
  const { addToast } = useUIStore();
  const [sources, setSources] = useState<MigrationSourceCandidate[]>([]);
  const [sourceKind, setSourceKind] = useState<MigrationSourceKind>("openclaw");
  const [sourcePath, setSourcePath] = useState("");
  const [preset, setPreset] = useState<MigrationPreset>("user-data");
  const [skillConflict, setSkillConflict] = useState<MigrationSkillConflictMode>("skip");
  const [workspaceTarget, setWorkspaceTarget] = useState("");
  const [migrateSecrets, setMigrateSecrets] = useState(false);
  const [overwrite, setOverwrite] = useState(false);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [report, setReport] = useState<SourceMigrationReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadSources = useCallback(async () => {
    setLoading(true);
    const res = await migrationApi.sources();
    if (res.success && res.data?.sources) {
      setSources(res.data.sources);
      const detected = res.data.sources.find((source) => source.exists);
      if (detected && !sourcePath) {
        setSourceKind(detected.kind);
        setSourcePath(detected.path);
      }
    } else {
      setError(extractApiError(res, "Could not detect migration sources"));
    }
    setLoading(false);
  }, [sourcePath]);

  useEffect(() => {
    void loadSources();
  }, [loadSources]);

  const payload = useCallback(
    () => ({
      sourceKind,
      sourcePath: sourcePath.trim() || undefined,
      preset,
      migrateSecrets,
      overwrite,
      skillConflict,
      workspaceTarget: workspaceTarget.trim() || undefined,
    }),
    [migrateSecrets, overwrite, preset, skillConflict, sourceKind, sourcePath, workspaceTarget]
  );

  const pickSource = useCallback(async () => {
    const selected = await openDesktopDirectoryDialog({
      defaultPath: sourcePath,
      title: "Choose OpenClaw or Hermes directory",
    });
    if (selected) setSourcePath(selected);
  }, [sourcePath]);

  const pickWorkspaceTarget = useCallback(async () => {
    const selected = await openDesktopDirectoryDialog({
      defaultPath: workspaceTarget,
      title: "Choose workspace for AGENTS.md import",
    });
    if (selected) setWorkspaceTarget(selected);
  }, [workspaceTarget]);

  const runPreview = useCallback(async () => {
    setRunning(true);
    setError(null);
    const res = await migrationApi.preview(payload());
    if (res.success && res.data) {
      setReport(res.data);
      addToast("success", "Migration preview ready");
    } else {
      setError(extractApiError(res, "Migration preview failed"));
    }
    setRunning(false);
  }, [addToast, payload]);

  const runMigration = useCallback(async () => {
    setRunning(true);
    setError(null);
    const res = await migrationApi.run(payload());
    if (res.success && res.data) {
      setReport(res.data);
      addToast("success", "Migration complete");
    } else {
      setError(extractApiError(res, "Migration failed"));
    }
    setRunning(false);
  }, [addToast, payload]);

  const detectedOptions = sources.filter((source) => source.exists);

  return (
    <div className="space-y-6">
      <Card variant="liquid">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FolderSync className="w-5 h-5 text-indigo-300" />
            Import from OpenClaw or Hermes
          </CardTitle>
          <CardDescription>
            Preview settings, memories, skills, workspace instructions, and optional provider keys
            before anything is written.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          {detectedOptions.length > 0 && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {detectedOptions.map((source) => (
                <button
                  key={`${source.kind}-${source.path}`}
                  type="button"
                  onClick={() => {
                    setSourceKind(source.kind);
                    setSourcePath(source.path);
                  }}
                  className={cn(
                    "rounded-xl border p-4 text-left transition-colors",
                    sourcePath === source.path
                      ? "border-indigo-400/60 bg-indigo-500/10"
                      : "border-white/10 bg-white/[0.03] hover:bg-white/[0.06]"
                  )}
                >
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-sm font-semibold text-white">{source.label}</span>
                    <Badge variant={source.exists ? "success" : "default"}>Detected</Badge>
                  </div>
                  <p className="mt-2 truncate font-mono text-xs text-gray-400">{source.path}</p>
                  <div className="mt-3 flex flex-wrap gap-2 text-xs text-gray-400">
                    <span>{source.detected.memoryFiles} memories</span>
                    <span>{source.detected.skillCount} skills</span>
                    <span>{source.detected.configFiles} config files</span>
                  </div>
                </button>
              ))}
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-[180px_1fr_auto] gap-3">
            <Select
              label="Source"
              value={sourceKind}
              options={[
                { value: "openclaw", label: "OpenClaw" },
                { value: "hermes", label: "Hermes" },
              ]}
              onChange={(value) => setSourceKind(value as MigrationSourceKind)}
            />
            <Input
              label="Source directory"
              value={sourcePath}
              onChange={(event) => setSourcePath(event.target.value)}
              placeholder="~/.openclaw or ~/.hermes"
            />
            <div className="flex items-end">
              <Button variant="secondary" onClick={() => void pickSource()}>
                Browse
              </Button>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <Select
              label="Preset"
              value={preset}
              options={[
                { value: "user-data", label: "User data" },
                { value: "full", label: "Full" },
              ]}
              helperText="Full includes provider credentials only when secret import is enabled."
              onChange={(value) => setPreset(value as MigrationPreset)}
            />
            <Select
              label="Skill conflicts"
              value={skillConflict}
              options={[
                { value: "skip", label: "Skip" },
                { value: "rename", label: "Rename" },
                { value: "overwrite", label: "Overwrite" },
              ]}
              onChange={(value) => setSkillConflict(value as MigrationSkillConflictMode)}
            />
            <div className="space-y-2">
              <Switch
                checked={migrateSecrets}
                onChange={setMigrateSecrets}
                label="Import provider keys"
                description="Off by default. Reports never show key values."
              />
              <Switch
                checked={overwrite}
                onChange={setOverwrite}
                label="Allow overwrite"
                description="Required for existing prompts, providers, or workspace files."
              />
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-[1fr_auto] gap-3">
            <Input
              label="Workspace target for AGENTS.md"
              value={workspaceTarget}
              onChange={(event) => setWorkspaceTarget(event.target.value)}
              placeholder="Optional project folder"
            />
            <div className="flex items-end">
              <Button variant="secondary" onClick={() => void pickWorkspaceTarget()}>
                Browse
              </Button>
            </div>
          </div>

          {error && (
            <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200">
              {error}
            </div>
          )}

          <div className="flex flex-wrap gap-3">
            <Button variant="secondary" onClick={() => void loadSources()} isLoading={loading}>
              Refresh Sources
            </Button>
            <Button variant="secondary" onClick={() => void runPreview()} isLoading={running}>
              Preview
            </Button>
            <Button onClick={() => void runMigration()} isLoading={running}>
              Run Migration
            </Button>
          </div>
        </CardContent>
      </Card>

      {report && (
        <Card variant="liquid">
          <CardHeader>
            <CardTitle>{report.dryRun ? "Preview Report" : "Migration Report"}</CardTitle>
            <CardDescription>
              {report.sourceKind} {"->"} {report.targetRoot}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
              {(["total", "planned", "migrated", "conflict", "skipped", "error"] as const).map(
                (key) => (
                  <div key={key} className="rounded-lg border border-white/10 bg-white/[0.03] p-3">
                    <p className="text-xs uppercase tracking-wide text-gray-500">{key}</p>
                    <p className="mt-1 text-xl font-semibold text-white">{report.summary[key]}</p>
                  </div>
                )
              )}
            </div>

            {report.warnings.length > 0 && (
              <div className="rounded-lg border border-amber-400/25 bg-amber-500/10 p-3 text-sm text-amber-100">
                {report.warnings.join(" ")}
              </div>
            )}

            <div className="rounded-lg border border-white/10 overflow-hidden">
              <div className="grid grid-cols-[110px_120px_1fr] gap-3 bg-white/[0.04] px-3 py-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
                <span>Status</span>
                <span>Area</span>
                <span>Item</span>
              </div>
              <div className="max-h-96 overflow-y-auto divide-y divide-white/10">
                {report.items.map((entry) => (
                  <div
                    key={entry.id}
                    className="grid grid-cols-[110px_120px_1fr] gap-3 px-3 py-2 text-sm"
                  >
                    <span className={cn("font-medium", migrationStatusClass(entry.status))}>
                      {entry.status}
                    </span>
                    <span className="text-gray-400">{entry.category}</span>
                    <span className="min-w-0">
                      <span className="block truncate text-gray-200">{entry.name}</span>
                      {entry.detail && (
                        <span className="block truncate text-xs text-gray-500">{entry.detail}</span>
                      )}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {report.reportPath && (
              <p className="font-mono text-xs text-gray-500">Report saved to {report.reportPath}</p>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function GatewayControlSection() {
  const { addToast } = useUIStore();
  const [restarting, setRestarting] = useState(false);
  const [logs, setLogs] = useState<LogPageEntry[]>([]);
  const [logsUnavailable, setLogsUnavailable] = useState(false);

  const loadLogs = useCallback(async () => {
    const res = await logsApi.getPage(30, 0);
    if (res.success && res.data?.logs) {
      setLogs(res.data.logs);
      setLogsUnavailable(false);
    } else {
      setLogsUnavailable(true);
    }
  }, []);

  useEffect(() => {
    void loadLogs();
    const timer = window.setInterval(() => {
      if (!document.hidden) void loadLogs();
    }, 15_000);
    return () => window.clearInterval(timer);
  }, [loadLogs]);

  async function waitForGateway(timeoutMs = 45_000): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 1_500));
      try {
        const res = await systemApi.health();
        if (res.success) return true;
      } catch {}
    }
    return false;
  }

  async function handleRestart() {
    setRestarting(true);
    try {
      const res = await systemApi.restart();
      if (!res.success) {
        throw new Error(res.error || "Restart endpoint unavailable — restart the gateway manually");
      }
      addToast("info", "Gateway restarting…");
      const backUp = await waitForGateway();
      if (backUp) {
        addToast("success", "Gateway is back online");
        void loadLogs();
      } else {
        addToast("error", "Gateway did not come back within 45s — check its logs");
      }
    } catch (error) {
      addToast("error", error instanceof Error ? error.message : "Failed to restart gateway");
    } finally {
      setRestarting(false);
    }
  }

  return (
    <Card variant="liquid">
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Server className="w-5 h-5 text-emerald-400" />
              Gateway
            </CardTitle>
            <CardDescription>
              Restart the gateway process and watch its recent activity. Restarting picks up new
              gateway code and settings.
            </CardDescription>
          </div>
          <Button
            variant="secondary"
            leftIcon={
              restarting ? (
                <RefreshCw className="w-4 h-4 animate-spin" />
              ) : (
                <RefreshCw className="w-4 h-4" />
              )
            }
            onClick={() => void handleRestart()}
            disabled={restarting}
          >
            {restarting ? "Restarting…" : "Restart Gateway"}
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <p className="text-xs text-gray-500 mb-2">Recent gateway logs (live)</p>
        <div className="rounded-lg border border-white/10 bg-black/30 p-3 max-h-64 overflow-y-auto space-y-1">
          {logsUnavailable ? (
            <p className="text-xs text-gray-500">Logs unavailable.</p>
          ) : logs.length === 0 ? (
            <p className="text-xs text-gray-500">No recent log entries.</p>
          ) : (
            logs.map((entry) => (
              <div key={entry.id} className="flex items-start gap-2 text-[11px] font-mono">
                <span className="shrink-0 text-gray-600">
                  {new Date(entry.created_at).toLocaleTimeString()}
                </span>
                <span
                  className={`shrink-0 uppercase ${
                    entry.level === "error"
                      ? "text-red-400"
                      : entry.level === "warn"
                        ? "text-amber-300"
                        : "text-gray-500"
                  }`}
                >
                  {entry.level}
                </span>
                <span className="shrink-0 text-gray-500">[{entry.source}]</span>
                <span className="text-gray-300 break-all">{entry.message}</span>
              </div>
            ))
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function GatewayAuthSettingsSection() {
  const { addToast } = useUIStore();
  const [settings, setSettings] = useState<GatewayAuthSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [unsupported, setUnsupported] = useState(false);
  const [busy, setBusy] = useState(false);
  const [revealedKey, setRevealedKey] = useState<string | null>(null);
  const [rotateConfirmOpen, setRotateConfirmOpen] = useState(false);
  const [basePathInput, setBasePathInput] = useState("");
  const basePathTouchedRef = useRef(false);
  const [portInput, setPortInput] = useState("");
  const portTouchedRef = useRef(false);
  const [applyingHost, setApplyingHost] = useState(false);
  const [restartingForPort, setRestartingForPort] = useState(false);
  const [gatewayPassword, setGatewayPassword] = useState("");
  const [gatewayPasswordConfirm, setGatewayPasswordConfirm] = useState("");

  const load = useCallback(
    async (silent = false) => {
      if (!silent) setLoading(true);
      try {
        const res = await authApi.settings();
        if (res.success && res.data?.success) {
          setSettings(res.data);
          if (!basePathTouchedRef.current) {
            setBasePathInput(res.data.basePath || "");
          }
          if (!portTouchedRef.current) {
            setPortInput(String(res.data.configuredPort || res.data.port || 4269));
          }
          setUnsupported(false);
        } else if (/not found/i.test(res.error || "")) {
          setUnsupported(true);
        } else if (!silent) {
          addToast("error", res.error || "Failed to load auth settings");
        }
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [addToast]
  );

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => {
      if (!document.hidden) void load(true);
    }, 30_000);
    return () => window.clearInterval(timer);
  }, [load]);

  async function handleSaveBasePath() {
    setBusy(true);
    try {
      const res = await authApi.updateSettings({ basePath: basePathInput.trim() });
      if (!res.success || !res.data?.success) {
        throw new Error(res.error || "Failed to update base path");
      }
      setSettings(res.data);
      basePathTouchedRef.current = false;
      setBasePathInput(res.data.basePath || "");
      const nextUrl = `${window.location.origin}${res.data.basePath || "/"}`;
      addToast("success", `Base path saved — dashboard now lives at ${nextUrl}`);
    } catch (error) {
      addToast("error", error instanceof Error ? error.message : "Failed to update base path");
    } finally {
      setBusy(false);
    }
  }

  async function handleToggleLanAccess(enabled: boolean) {
    const host = enabled ? "0.0.0.0" : "127.0.0.1";
    const expectedRuntimeHost = (value?: string) => {
      const normalized = (value || "").trim().toLowerCase();
      if (enabled) return normalized === "0.0.0.0" || normalized === "::" || normalized === "[::]";
      return normalized === "127.0.0.1" || normalized === "localhost" || normalized === "::1";
    };
    setBusy(true);
    setApplyingHost(true);
    try {
      const res = await authApi.updateSettings({ host, applyHostNow: true });
      if (!res.success || !res.data?.success) {
        throw new Error(res.error || "Failed to update host");
      }
      if (res.data.hostApplyError) {
        throw new Error(res.data.hostApplyError);
      }
      const firewallResult = res.data.gatewayFirewall;
      let latest = res.data;
      for (let attempt = 0; attempt < 8 && !expectedRuntimeHost(latest.host); attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 350));
        const next = await authApi.settings();
        if (!next.success || !next.data?.success) {
          throw new Error(next.error || "Failed to confirm gateway listener");
        }
        latest = next.data;
        if (latest.hostApplyError) {
          throw new Error(latest.hostApplyError);
        }
      }
      if (firewallResult) latest = { ...latest, gatewayFirewall: firewallResult };
      if (!expectedRuntimeHost(latest.host)) {
        throw new Error(
          enabled
            ? `Gateway did not start listening on local network. Current listener is ${latest.host || "unknown"}. Check gateway logs and Windows Firewall.`
            : `Gateway did not return to private localhost mode. Current listener is ${latest.host || "unknown"}.`
        );
      }
      setSettings(latest);
      if (enabled && firewallResult?.required && !firewallResult.configured) {
        addToast("warning", firewallResult.message);
        return;
      }
      addToast(
        "success",
        enabled && firewallResult?.configured
          ? "LAN access enabled and Windows Firewall allows the gateway"
          : enabled
            ? "LAN access enabled for trusted devices"
            : "Gateway is private to this computer"
      );
    } catch (error) {
      addToast("error", error instanceof Error ? error.message : "Failed to update host");
    } finally {
      setBusy(false);
      setApplyingHost(false);
    }
  }

  async function handleSavePortAndRestart() {
    const port = Number(portInput.trim());
    if (!Number.isInteger(port) || port < 1024 || port > 65535) {
      addToast("error", "Port must be an integer between 1024 and 65535");
      return;
    }
    setBusy(true);
    setRestartingForPort(true);
    try {
      const res = await authApi.updateSettings({ port });
      if (!res.success || !res.data?.success) {
        throw new Error(res.error || "Failed to update port");
      }
      portTouchedRef.current = false;
      const nextOrigin = `${window.location.protocol}//${window.location.hostname}:${port}`;
      const nextUrl = `${nextOrigin}${res.data.basePath || ""}/`;
      addToast("info", `Port saved — restarting gateway on ${port}…`);
      await systemApi.restart();
      const deadline = Date.now() + 45_000;
      while (Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 1_500));
        try {
          const probe = await fetch(`${nextOrigin}${res.data.basePath || ""}/api/health`, {
            mode: "cors",
          });
          if (probe.ok) {
            window.location.href = nextUrl;
            return;
          }
        } catch {}
      }
      addToast(
        "error",
        `Gateway did not come back on port ${port} within 45s — open ${nextUrl} manually`
      );
    } catch (error) {
      addToast("error", error instanceof Error ? error.message : "Failed to update port");
    } finally {
      setBusy(false);
      setRestartingForPort(false);
    }
  }

  async function handleToggleRequireAuth(checked: boolean) {
    setBusy(true);
    try {
      const res = await authApi.updateSettings({ requireAuthForLocalhost: checked });
      if (!res.success || !res.data?.success) {
        throw new Error(res.error || "Failed to update auth settings");
      }
      setSettings(res.data);
      addToast(
        "success",
        checked
          ? "Localhost requests now require the API key"
          : "Localhost browser requests no longer require the API key"
      );
    } catch (error) {
      addToast("error", error instanceof Error ? error.message : "Failed to update auth settings");
    } finally {
      setBusy(false);
    }
  }

  async function handleSaveGatewayPassword() {
    const password = gatewayPassword.trim();
    if (password.length < 12) {
      addToast("error", "Gateway password must be at least 12 characters");
      return;
    }
    if (password !== gatewayPasswordConfirm.trim()) {
      addToast("error", "Gateway password confirmation does not match");
      return;
    }
    setBusy(true);
    try {
      const res = await authApi.updateSettings({ gatewayPassword: password });
      if (!res.success || !res.data?.success) {
        throw new Error(res.error || "Failed to save gateway password");
      }
      setGatewayAccessPassword(password);
      setSettings(res.data);
      setGatewayPassword("");
      setGatewayPasswordConfirm("");
      addToast("success", "Gateway password enabled for remote root access");
    } catch (error) {
      addToast("error", error instanceof Error ? error.message : "Failed to save gateway password");
    } finally {
      setBusy(false);
    }
  }

  async function handleClearGatewayPassword() {
    setBusy(true);
    try {
      const res = await authApi.updateSettings({ clearGatewayPassword: true });
      if (!res.success || !res.data?.success) {
        throw new Error(res.error || "Failed to clear gateway password");
      }
      clearGatewayAccessPassword();
      setSettings(res.data);
      addToast("success", "Gateway password cleared");
    } catch (error) {
      addToast(
        "error",
        error instanceof Error ? error.message : "Failed to clear gateway password"
      );
    } finally {
      setBusy(false);
    }
  }

  async function handleReveal() {
    if (revealedKey) {
      setRevealedKey(null);
      return;
    }
    setBusy(true);
    try {
      const res = await authApi.revealKey();
      if (!res.success || !res.data?.apiKey) {
        throw new Error(res.error || "No API key available");
      }
      setRevealedKey(res.data.apiKey);
    } catch (error) {
      addToast("error", error instanceof Error ? error.message : "Failed to reveal API key");
    } finally {
      setBusy(false);
    }
  }

  async function handleCopyKey() {
    try {
      let key = revealedKey;
      if (!key) {
        const res = await authApi.revealKey();
        key = res.success ? res.data?.apiKey || null : null;
      }
      if (!key) throw new Error("No API key available");
      await navigator.clipboard.writeText(key);
      addToast("success", "API key copied");
    } catch (error) {
      addToast("error", error instanceof Error ? error.message : "Failed to copy API key");
    }
  }

  async function handleRotate() {
    setBusy(true);
    try {
      const res = await authApi.rotateKey();
      if (!res.success || !res.data?.apiKey) {
        throw new Error(res.error || "Failed to rotate API key");
      }
      setRevealedKey(res.data.apiKey);
      setApiAuthToken(res.data.apiKey);
      setRotateConfirmOpen(false);
      addToast("success", "API key rotated — desktop apps pick it up automatically");
      await load();
    } catch (error) {
      addToast("error", error instanceof Error ? error.message : "Failed to rotate API key");
    } finally {
      setBusy(false);
    }
  }

  const controlsDisabled = loading || busy || unsupported;
  const configuredHost = (settings?.configuredHost || settings?.host || "127.0.0.1").toLowerCase();
  const lanHostEnabled = configuredHost === "0.0.0.0" || configuredHost === "::";

  return (
    <div className="space-y-6">
      {unsupported && (
        <div className="rounded-xl border border-amber-400/30 bg-amber-400/10 px-4 py-3 text-sm text-amber-100">
          The running gateway predates auth management — restart it (Settings &gt; System &gt;
          Restart Gateway) to enable these controls. Your API key already exists at
          ~/.cybara/api_key and keeps working.
        </div>
      )}
      <Card variant="liquid">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Shield className="w-5 h-5 text-amber-400" />
            Gateway API Key
          </CardTitle>
          <CardDescription>
            The root credential for this gateway. Native apps, the CLI, and remote clients
            authenticate with it as a Bearer token. Paired mobile devices use their own scoped
            tokens instead.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="rounded-lg border border-white/10 bg-white/[0.02] p-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="font-mono text-sm text-white break-all">
                  {revealedKey || settings?.apiKeyPreview || "No API key configured"}
                </p>
                <p className="mt-1 text-xs text-gray-500">
                  {settings?.apiKeySource === "env"
                    ? "Provided via CYBARA_API_KEY environment variable"
                    : `Stored at ${settings?.apiKeyPath || "~/.cybara/api_key"}`}
                </p>
              </div>
              <div className="flex gap-2 shrink-0">
                <Button
                  size="sm"
                  variant="ghost"
                  leftIcon={<Eye className="w-4 h-4" />}
                  onClick={() => void handleReveal()}
                  disabled={controlsDisabled || !settings?.apiKeyConfigured}
                >
                  {revealedKey ? "Hide" : "Reveal"}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => void handleCopyKey()}
                  disabled={controlsDisabled || !settings?.apiKeyConfigured}
                >
                  Copy
                </Button>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              leftIcon={<RefreshCw className="w-4 h-4" />}
              onClick={() => setRotateConfirmOpen(true)}
              disabled={controlsDisabled || settings?.apiKeySource === "env"}
            >
              Rotate API Key
            </Button>
            {settings?.apiKeySource === "env" && (
              <p className="text-xs text-gray-500">
                Managed by CYBARA_API_KEY — unset the variable to rotate here.
              </p>
            )}
          </div>
        </CardContent>
      </Card>

      <Card variant="liquid">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Server className="w-5 h-5 text-cyan-400" />
            Access Rules
          </CardTitle>
          <CardDescription>
            How requests to the gateway are authenticated and rate limited.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="rounded-lg border border-white/10 bg-white/[0.03] p-3">
            <Switch
              label="Listen on local network"
              description="Allow phones and trusted devices on this Wi-Fi to reach the gateway. Remote devices still need a valid token."
              checked={lanHostEnabled}
              disabled={controlsDisabled || applyingHost}
              onChange={(checked) => void handleToggleLanAccess(checked)}
            />
            <p className="mt-3 text-xs text-gray-500">
              Current listener: <span className="font-mono">{settings?.host || "unknown"}</span>.
              {applyingHost ? " Applying network change…" : ""}
              {settings?.hostForced
                ? " Launch default came from CYBARA_HOST or --expose; this toggle can still rebind the running gateway."
                : " Keep this off on public or untrusted networks."}
            </p>
            {settings?.gatewayFirewall?.required && (
              <div
                className={`mt-3 rounded-lg border px-3 py-2 text-xs ${
                  settings.gatewayFirewall.configured
                    ? "border-emerald-400/25 bg-emerald-400/10 text-emerald-100"
                    : "border-amber-400/30 bg-amber-400/10 text-amber-100"
                }`}
              >
                <p>{settings.gatewayFirewall.message}</p>
                {!settings.gatewayFirewall.configured && settings.gatewayFirewall.command && (
                  <code className="mt-2 block overflow-x-auto rounded-md bg-black/30 px-2 py-1 font-mono text-[11px] text-amber-50">
                    {settings.gatewayFirewall.command}
                  </code>
                )}
              </div>
            )}
          </div>

          <GatewayRemoteAccessSection
            disabled={controlsDisabled}
            settings={settings}
            onUpdated={setSettings}
          />

          <div className="space-y-2">
            <div className="flex flex-wrap items-end gap-2">
              <div className="w-40">
                <Input
                  label="Gateway port"
                  placeholder="4269"
                  value={portInput}
                  disabled={controlsDisabled || Boolean(settings?.portForced) || restartingForPort}
                  onChange={(e) => {
                    portTouchedRef.current = true;
                    setPortInput(e.target.value);
                  }}
                />
              </div>
              <Button
                variant="secondary"
                onClick={() => void handleSavePortAndRestart()}
                disabled={
                  controlsDisabled ||
                  Boolean(settings?.portForced) ||
                  restartingForPort ||
                  portInput.trim() === String(settings?.configuredPort || settings?.port || "")
                }
              >
                {restartingForPort ? "Restarting…" : "Save Port & Restart"}
              </Button>
            </div>
            <p className="text-xs text-gray-500">
              Changing the port restarts the gateway and this page follows it to the new address.
              Native apps and paired devices must update their gateway URL to the new port.
              {settings?.portForced ? " Currently forced by the PORT environment variable." : ""}
            </p>
          </div>

          <div className="space-y-2">
            <div className="flex flex-wrap items-end gap-2">
              <div className="flex-1 min-w-[220px]">
                <Input
                  label="Base path (optional)"
                  placeholder="/cybara"
                  value={basePathInput}
                  disabled={controlsDisabled || Boolean(settings?.basePathForced)}
                  onChange={(e) => {
                    basePathTouchedRef.current = true;
                    setBasePathInput(e.target.value);
                  }}
                />
              </div>
              <Button
                variant="secondary"
                onClick={() => void handleSaveBasePath()}
                disabled={
                  controlsDisabled ||
                  Boolean(settings?.basePathForced) ||
                  basePathInput.trim() === (settings?.basePath || "")
                }
              >
                Save Base Path
              </Button>
            </div>
            <p className="text-xs text-gray-500">
              Serve the gateway under a URL prefix (useful behind a reverse proxy or as an extra
              hurdle on a shared network). Takes effect immediately — the dashboard moves to{" "}
              <span className="font-mono">{`${window.location.origin}${basePathInput.trim() || "/"}`}</span>
              . Native apps just add the prefix to their gateway URL. /api/health stays reachable
              without the prefix for health checks.
            </p>
          </div>

          <div className="rounded-lg border border-white/10 bg-white/[0.03] p-3">
            <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-sm font-medium text-gray-200">Gateway password</p>
                <p className="mt-1 text-xs text-gray-500">
                  Optional second factor for remote root/UI access when the gateway is reachable
                  outside this machine.
                </p>
              </div>
              <Badge variant={settings?.gatewayPasswordEnabled ? "success" : "default"}>
                {settings?.gatewayPasswordEnabled ? "Enabled" : "Off"}
              </Badge>
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <Input
                type="password"
                label="New password"
                value={gatewayPassword}
                disabled={controlsDisabled}
                onChange={(event) => setGatewayPassword(event.target.value)}
                placeholder="At least 12 characters"
              />
              <Input
                type="password"
                label="Confirm password"
                value={gatewayPasswordConfirm}
                disabled={controlsDisabled}
                onChange={(event) => setGatewayPasswordConfirm(event.target.value)}
                placeholder="Repeat password"
              />
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button
                variant="secondary"
                onClick={() => void handleSaveGatewayPassword()}
                disabled={
                  controlsDisabled ||
                  gatewayPassword.trim().length === 0 ||
                  gatewayPasswordConfirm.trim().length === 0
                }
              >
                {settings?.gatewayPasswordEnabled ? "Update Password" : "Enable Password"}
              </Button>
              <Button
                variant="outline"
                onClick={() => void handleClearGatewayPassword()}
                disabled={controlsDisabled || !settings?.gatewayPasswordEnabled}
              >
                Clear Password
              </Button>
            </div>
          </div>

          <Switch
            label="Require API key for localhost"
            description={
              settings?.requireAuthForLocalhostForced
                ? "Forced on by CYBARA_REQUIRE_AUTH or production mode"
                : "When off, same-origin browser requests from this machine skip the API key"
            }
            checked={Boolean(settings?.requireAuthForLocalhost)}
            disabled={controlsDisabled || Boolean(settings?.requireAuthForLocalhostForced)}
            onChange={(checked) => void handleToggleRequireAuth(checked)}
          />
          {settings?.rateLimits && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {Object.entries(settings.rateLimits).map(([name, limit]) => (
                <div
                  key={name}
                  className="rounded-lg border border-white/10 bg-white/[0.02] px-3 py-2"
                >
                  <p className="text-xs text-gray-500 capitalize">{name}</p>
                  <p className="mt-1 text-sm text-gray-200">
                    {limit.maxRequests} / {Math.round(limit.windowMs / 1000)}s
                  </p>
                </div>
              ))}
            </div>
          )}
          <p className="text-xs text-gray-500">
            Paired mobile devices authenticate with scoped tokens — manage them on the Mobile page.
          </p>
        </CardContent>
      </Card>

      <Modal
        isOpen={rotateConfirmOpen}
        onClose={() => {
          if (!busy) setRotateConfirmOpen(false);
        }}
        title="Rotate API Key"
        size="sm"
      >
        <div className="space-y-4">
          <p className="text-sm text-gray-300">
            The new key takes effect immediately — no gateway restart needed. This browser and the
            desktop apps adopt it automatically; only scripts or remote clients holding the old key
            need updating. Paired mobile devices are unaffected.
          </p>
          <div className="flex justify-end gap-3">
            <Button variant="ghost" onClick={() => setRotateConfirmOpen(false)} disabled={busy}>
              Cancel
            </Button>
            <Button variant="danger" onClick={() => void handleRotate()} isLoading={busy}>
              Rotate Key
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

export function Settings() {
  const { t } = useI18n();
  const { data: health } = useHealth();
  const { data: info } = useInfo();
  const { data: systemMonitor } = useSystemMonitor();
  const [searchParams, setSearchParams] = useSearchParams();
  const sectionParam = searchParams.get("section");
  const [activeSection, setActiveSection] = useState<SettingsSectionId>(
    resolveSettingsSectionId(sectionParam) ?? "general"
  );

  useEffect(() => {
    const resolvedSection = resolveSettingsSectionId(sectionParam);
    if (!resolvedSection) return;
    if (resolvedSection !== activeSection) {
      setActiveSection(resolvedSection);
    }
    if (sectionParam !== resolvedSection) {
      setSearchParams(resolvedSection === "general" ? {} : { section: resolvedSection }, {
        replace: true,
      });
    }
  }, [activeSection, sectionParam, setSearchParams]);

  const selectSection = (section: SettingsSectionId) => {
    setActiveSection(section);
    setSearchParams(section === "general" ? {} : { section }, { replace: true });
  };

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
    <PageLayout title={t("settings.title")}>
      <div className="grid gap-6 lg:grid-cols-[260px_minmax(0,1fr)]">
        <SettingsNavigation activeSection={activeSection} onSelect={selectSection} />

        <div className="min-w-0 space-y-6">
          {activeSection === "general" && <ThemeSettings />}

          {activeSection === "gateway" && (
            <>
              <GatewayPathSettingsSection infoData={infoData} />
              <GatewayAuthSettingsSection />
              <GatewayControlSection />
            </>
          )}

          {activeSection === "ai" && (
            <>
              <SystemPromptSection />
              <LlmTimeoutSettingsSection />
            </>
          )}

          {activeSection === "memory" && <MemoryBehaviorSettings />}

          {activeSection === "voice" && <SpeechSettingsSection />}

          {activeSection === "safety" && (
            <>
              <FeatureSettings />
              <SandboxBrowserSettings />
              <ComputerUseSettings />
            </>
          )}

          {activeSection === "wallet" && <WalletSettings />}

          {activeSection === "migration" && <MigrationSettingsSection />}

          {activeSection === "system" && (
            <>
              <DesktopUpdateSettings
                currentVersion={String(infoData.version || "unknown")}
                releaseRepositoryUrl={infoData.releaseRepositoryUrl}
              />
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
                          <p className="text-xl font-semibold text-white capitalize">
                            {stat.value}
                          </p>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>

              <Card variant="liquid">
                <CardHeader>
                  <CardTitle>System Monitor</CardTitle>
                  <CardDescription>
                    Live host resource usage from the Cybara gateway
                  </CardDescription>
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
      </div>
    </PageLayout>
  );
}
