import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { getDesktopHostRuntime, openDesktopFileDialog } from "@/lib/desktopHost";
import {
  computerUseApi,
  extractApiError,
  sandboxBrowserApi,
  settingsApi,
  type ComputerUseStatus,
  type SandboxBrowserStatus,
} from "@/lib/api";
import { openExternal } from "@/utils/openExternal";
import { useUIStore } from "@/stores/uiStore";
import { asSettingsRecord, readIntegerSetting } from "./settingsValueReaders";
import { Clock } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

export function ComputerUseSettings() {
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
      case "bundled":
        return "Included with Cybara";
      case "managed-runtime":
        return "Managed by Cybara";
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
          Background desktop control with the computer-use engine included by Cybara.{" "}
          {status?.platform === "darwin"
            ? "Grant macOS Accessibility + Screen Recording permissions to let agents see and control the screen."
            : status?.platform === "win32"
              ? "Windows computer use runs on the active desktop, so keep the target app visible while agents work."
              : "Linux computer use runs in the active graphical session."}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {loading ? (
          <p className="text-sm text-gray-400">Checking status…</p>
        ) : status ? (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
              <span className="flex items-center gap-2">Available {yesNo(status.available)}</span>
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
                  <p className="text-sm font-medium text-gray-200">Custom driver</p>
                  <p className="text-xs text-gray-500">
                    Optional override for development builds or a separately managed driver.
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

export function SandboxBrowserSettings() {
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

export function LlmTimeoutSettingsSection() {
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
