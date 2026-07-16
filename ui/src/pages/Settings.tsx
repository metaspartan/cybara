import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { EmbeddedPageLayout, PageLayout } from "@/components/layout";
import { GatewayPathSettingsSection } from "@/components/settings/GatewayPathSettingsSection";
import { GatewayRemoteAccessSection } from "@/components/settings/GatewayRemoteAccessSection";
import { NearbySettingsSection } from "@/components/settings/NearbySettingsSection";
import { SystemBackupSettingsSection } from "@/components/settings/SystemBackupSettingsSection";
import { SystemMonitorPanel } from "@/components/settings/SystemMonitorPanel";
import { AiFeatureSettings } from "./settings/AiFeatureSettings";
import { ChatAccessibilitySettings } from "./settings/ChatAccessibilitySettings";
import { HotkeySettings } from "./settings/HotkeySettings";
import { FeatureSettings } from "./settings/FeatureSettings";
import { ToolCapabilitySettings } from "./settings/ToolCapabilitySettings";
import { ExternalTelemetrySettings } from "./settings/ExternalTelemetrySettings";
import { BrowserSupervisionSettings } from "./settings/BrowserSupervisionSettings";
import { MemoryBehaviorSettings } from "./settings/MemoryBehaviorSettings";
import { LabSettingsSection } from "./settings/LabSettings";
import {
  ComputerUseSettings,
  LlmTimeoutSettingsSection,
  SandboxBrowserSettings,
} from "./settings/RuntimeSettings";
import { SpeechSettingsSection } from "./settings/SpeechSettingsSection";
import { ThemeSettings } from "./settings/ThemeSettings";
import { WebToolPolicySettings } from "./settings/WebToolPolicySettings";
import { WebResearchSettings } from "./settings/WebResearchSettings";
import { SystemPromptSection } from "./settings/SystemPromptSection";
import { SidebarNavigationSettings } from "./settings/SidebarNavigationSettings";
import { DesktopUpdateSettings } from "./settings/DesktopUpdateSettings";
import { WalletSettings } from "./settings/WalletSettings";
import { asSettingsRecord, readIntegerSetting } from "./settings/settingsValueReaders";
import { Agents as AgentsSettings } from "./Agents";
import { Channels as ChannelsSettings } from "./Channels";
import { Logs as LogsSettings } from "./Logs";
import { MCPServers as MCPSettings } from "./MCPServers";
import { Memory as MemorySettings } from "./Memory";
import { Mobile as MobileSettings } from "./Mobile";
import { Plugins as PluginsSettings } from "./Plugins";
import { Providers as ProvidersSettings } from "./Providers";
import { RouterSettings as RouterSettingsPanel } from "./RouterSettings";
import { Skills as SkillsSettings } from "./Skills";
import { Tools as ToolsSettings } from "./Tools";
import {
  useHealth,
  useInfo,
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
  getDesktopHostRuntime,
  openDesktopDirectoryDialog,
  openDesktopFileDialog,
} from "@/lib/desktopHost";
import { Input, Textarea, Select } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import {
  defaultThemeAccentForMode,
  readThemeAccentFromConfig,
  readThemeModeFromIdentity,
  themeAccentKeys,
  themeAccents,
  themeConfigPayload,
  themeModeOptions,
  useUIStore,
  type ThemeAccent,
  type ThemeMode,
} from "@/stores/uiStore";
import { resolveSettingsSectionId } from "@/lib/settingsNavigation";
import { dashboardHealthColor, getDashboardCheckStatus } from "@/pages/dashboard/dashboardStatus";
import { persistPetEnabled, readPetEnabled } from "@/lib/petPreferences";
import { languageOptions, useI18n } from "@/lib/i18n";
import { cn } from "@/lib/settingsFormat";
import {
  Activity,
  AlertTriangle,
  Server,
  Database,
  Clock,
  Bot,
  Cloud,
  HardDrive,
  Eye,
  Palette,
  RefreshCw,
  Shield,
  FolderSync,
  Monitor,
  Network,
  Radio,
} from "lucide-react";
import { useState, useRef, useEffect, useCallback } from "react";
import { useSearchParams } from "react-router-dom";

function SettingsSurface({ children }: { children: React.ReactNode }) {
  return <EmbeddedPageLayout>{children}</EmbeddedPageLayout>;
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
      title: "Choose legacy agent directory",
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
            Import legacy agent data
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
              placeholder="Path on the gateway host"
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

type GatewaySettingsPanel = "overview" | "connection" | "storage" | "telemetry" | "nearby";

const gatewaySettingsPanels: Array<{
  id: GatewaySettingsPanel;
  label: string;
  icon: typeof Server;
}> = [
  { id: "overview", label: "Overview", icon: Activity },
  { id: "connection", label: "Connection", icon: Shield },
  { id: "storage", label: "Storage", icon: Database },
  { id: "telemetry", label: "Telemetry", icon: Radio },
  { id: "nearby", label: "Nearby", icon: Network },
];

function GatewaySettingsContent({ infoData }: { infoData: InfoData }) {
  const [panel, setPanel] = useState<GatewaySettingsPanel>("overview");

  return (
    <div className="space-y-5">
      <div
        role="tablist"
        aria-label="Gateway settings"
        className="grid grid-cols-2 rounded-lg bg-[var(--surface-panel)] p-1 sm:grid-cols-5"
      >
        {gatewaySettingsPanels.map((item) => {
          const Icon = item.icon;
          const selected = panel === item.id;
          return (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={selected}
              onClick={() => setPanel(item.id)}
              className={cn(
                "flex min-w-0 items-center justify-center gap-2 rounded-md px-3 py-2 text-sm transition-colors",
                selected
                  ? "bg-[rgba(var(--accent-primary),0.12)] text-[rgb(var(--accent-primary))]"
                  : "text-[var(--text-muted)] hover:bg-[var(--surface-elevated)] hover:text-[var(--text-primary)]"
              )}
            >
              <Icon className="h-4 w-4 shrink-0" />
              <span className="truncate">{item.label}</span>
            </button>
          );
        })}
      </div>

      {panel === "overview" ? <GatewayControlSection /> : null}
      {panel === "connection" ? <GatewayAuthSettingsSection /> : null}
      {panel === "storage" ? <GatewayPathSettingsSection infoData={infoData} /> : null}
      {panel === "telemetry" ? <ExternalTelemetrySettings /> : null}
      {panel === "nearby" ? <NearbySettingsSection /> : null}
    </div>
  );
}

export function Settings() {
  const { t } = useI18n();
  const { data: health } = useHealth();
  const { data: info } = useInfo();
  const [searchParams, setSearchParams] = useSearchParams();
  const sectionParam = searchParams.get("section");
  const activeSection = resolveSettingsSectionId(sectionParam) ?? "general";

  useEffect(() => {
    const resolvedSection = resolveSettingsSectionId(sectionParam);
    if (!resolvedSection) return;
    if (sectionParam !== resolvedSection) {
      setSearchParams(resolvedSection === "general" ? {} : { section: resolvedSection }, {
        replace: true,
      });
    }
  }, [sectionParam, setSearchParams]);

  const healthData = (health || {}) as HealthData;
  const infoData = (info || {}) as InfoData;

  const checks = healthData.checks
    ? Object.entries(healthData.checks as Record<string, unknown>).filter(
        ([key]) => key !== "memory" && key !== "system"
      )
    : [];

  return (
    <PageLayout title={t("settings.title")}>
      <div className="mx-auto w-full max-w-6xl min-w-0 space-y-6">
        {activeSection === "general" && (
          <>
            <ThemeSettings />
            <SidebarNavigationSettings />
            <HotkeySettings />
          </>
        )}

        {activeSection === "accessibility" && <ChatAccessibilitySettings />}

        {activeSection === "gateway" && <GatewaySettingsContent infoData={infoData} />}

        {activeSection === "ai" && (
          <>
            <AiFeatureSettings />
            <SystemPromptSection />
            <LlmTimeoutSettingsSection />
          </>
        )}

        {activeSection === "agents" && (
          <SettingsSurface>
            <AgentsSettings />
          </SettingsSurface>
        )}

        {activeSection === "providers" && (
          <SettingsSurface>
            <ProvidersSettings />
          </SettingsSurface>
        )}

        {activeSection === "router" && (
          <SettingsSurface>
            <RouterSettingsPanel />
          </SettingsSurface>
        )}

        {activeSection === "channels" && (
          <SettingsSurface>
            <ChannelsSettings />
          </SettingsSurface>
        )}

        {activeSection === "mobile" && (
          <SettingsSurface>
            <MobileSettings />
          </SettingsSurface>
        )}

        {activeSection === "plugins" && (
          <SettingsSurface>
            <PluginsSettings />
          </SettingsSurface>
        )}

        {activeSection === "mcp" && (
          <SettingsSurface>
            <MCPSettings />
          </SettingsSurface>
        )}

        {activeSection === "skills" && (
          <SettingsSurface>
            <SkillsSettings />
          </SettingsSurface>
        )}

        {activeSection === "tools" && (
          <SettingsSurface>
            <ToolsSettings />
          </SettingsSurface>
        )}

        {activeSection === "memory" && (
          <>
            <MemoryBehaviorSettings />
            <SettingsSurface>
              <MemorySettings />
            </SettingsSurface>
          </>
        )}

        {activeSection === "lab" && <LabSettingsSection />}

        {activeSection === "voice" && <SpeechSettingsSection />}

        {activeSection === "safety" && (
          <>
            <FeatureSettings />
            <ToolCapabilitySettings />
            <WebResearchSettings />
            <WebToolPolicySettings />
            <SandboxBrowserSettings />
            <BrowserSupervisionSettings />
            <ComputerUseSettings />
          </>
        )}

        {activeSection === "wallet" && <WalletSettings />}

        {activeSection === "migration" && <MigrationSettingsSection />}

        {activeSection === "logs" && (
          <SettingsSurface>
            <LogsSettings />
          </SettingsSurface>
        )}

        {activeSection === "updates" && (
          <DesktopUpdateSettings
            currentVersion={String(infoData.version || "unknown")}
            releaseRepositoryUrl={infoData.releaseRepositoryUrl}
          />
        )}

        {activeSection === "system" && (
          <>
            <SystemBackupSettingsSection />
            <SystemMonitorPanel />

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <Card variant="liquid">
                <CardHeader>
                  <CardTitle>System Information</CardTitle>
                  <CardDescription>Platform details and version info</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex justify-between border-b border-[var(--surface-border)] py-2">
                    <span className="text-[var(--text-muted)]">Platform Name</span>
                    <span className="text-[var(--text-primary)]">{infoData?.name || "Cybara"}</span>
                  </div>
                  <div className="flex justify-between border-b border-[var(--surface-border)] py-2">
                    <span className="text-[var(--text-muted)]">Version</span>
                    <span className="text-[var(--text-primary)]">
                      {infoData?.version || "unknown"}
                    </span>
                  </div>
                  <div className="flex justify-between border-b border-[var(--surface-border)] py-2">
                    <span className="text-[var(--text-muted)]">Setup Complete</span>
                    <Badge variant={infoData?.setupComplete ? "success" : "warning"}>
                      {infoData?.setupComplete ? "Yes" : "No"}
                    </Badge>
                  </div>
                  <div className="flex justify-between border-b border-[var(--surface-border)] py-2">
                    <span className="text-[var(--text-muted)]">Server Time</span>
                    <span className="text-[var(--text-primary)]">
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
                    <div className="py-8 text-center text-[var(--text-muted)]">
                      <Activity className="w-8 h-8 mx-auto mb-2" />
                      <p>No health checks available</p>
                    </div>
                  ) : (
                    checks.map(([key, value]) => {
                      const check = getDashboardCheckStatus(value);
                      const color = dashboardHealthColor(check.status);
                      const icons: Record<string, React.ReactNode> = {
                        database: <Database className="w-5 h-5" />,
                        agents: <Bot className="w-5 h-5" />,
                        providers: <Cloud className="w-5 h-5" />,
                        memory: <HardDrive className="w-5 h-5" />,
                      };

                      return (
                        <div
                          key={key}
                          className="flex items-center justify-between rounded-lg bg-[var(--surface-hover)] p-3"
                        >
                          <div className="flex items-center gap-3">
                            <div
                              className="flex h-10 w-10 items-center justify-center rounded-lg"
                              style={{
                                color,
                                background: `color-mix(in srgb, ${color} 14%, transparent)`,
                              }}
                            >
                              {icons[key] || <Server className="w-5 h-5" />}
                            </div>
                            <div>
                              <span className="capitalize text-[var(--text-primary)]">{key}</span>
                              {check.details && (
                                <p className="text-xs text-[var(--text-muted)]">{check.details}</p>
                              )}
                            </div>
                          </div>
                          <Badge
                            variant={
                              check.status === "healthy"
                                ? "success"
                                : check.status === "warning"
                                  ? "warning"
                                  : "error"
                            }
                          >
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
