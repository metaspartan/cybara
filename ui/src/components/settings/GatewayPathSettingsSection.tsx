import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { openDesktopDirectoryDialog } from "@/lib/desktopHost";
import { settingsApi } from "@/lib/api";
import { useUIStore } from "@/stores/uiStore";
import type { InfoData } from "@/hooks/useApi";
import { Database, Folder, RefreshCw, Save } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

function readString(record: Record<string, unknown>, key: string, fallback = ""): string {
  const value = record[key];
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function readBoolean(record: Record<string, unknown>, key: string, fallback = false): boolean {
  const value = record[key];
  return typeof value === "boolean" ? value : fallback;
}

export function GatewayPathSettingsSection({ infoData }: { infoData: InfoData }) {
  const { addToast } = useUIStore();
  const [defaultWorkspaceDir, setDefaultWorkspaceDir] = useState("");
  const [cybaraDataDirDraft, setCybaraDataDirDraft] = useState("");
  const [configuredCybaraDataDir, setConfiguredCybaraDataDir] = useState("");
  const [activeCybaraDataDir, setActiveCybaraDataDir] = useState("");
  const [cybaraDataDirSource, setCybaraDataDirSource] = useState("default");
  const [cybaraDataDirForced, setCybaraDataDirForced] = useState(false);
  const [cybaraDataDirRestartRequired, setCybaraDataDirRestartRequired] = useState(false);
  const [cybaraDataDirOverrideFile, setCybaraDataDirOverrideFile] = useState("");
  const [defaultCybaraDataDir, setDefaultCybaraDataDir] = useState("");
  const [loading, setLoading] = useState(true);
  const [savingWorkspace, setSavingWorkspace] = useState(false);
  const [savingDataDir, setSavingDataDir] = useState(false);
  const detectedWorkspace =
    typeof infoData.defaultWorkspaceDir === "string" && infoData.defaultWorkspaceDir.trim()
      ? infoData.defaultWorkspaceDir.trim()
      : typeof infoData.homeDir === "string" && infoData.homeDir.trim()
        ? infoData.homeDir.trim()
        : "";
  const infoActiveDataDir =
    typeof infoData.cybaraDataDir === "string" && infoData.cybaraDataDir.trim()
      ? infoData.cybaraDataDir.trim()
      : "~/.cybara";
  const infoConfiguredDataDir =
    typeof infoData.configuredCybaraDataDir === "string" && infoData.configuredCybaraDataDir.trim()
      ? infoData.configuredCybaraDataDir.trim()
      : infoActiveDataDir;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await settingsApi.getConfig();
      if (res.success && res.data) {
        const data = res.data;
        const workspaceDir = readString(data, "default_workspace_dir", detectedWorkspace);
        const activeDataDir = readString(data, "cybara_data_dir", infoActiveDataDir);
        const configuredDataDir = readString(
          data,
          "configured_cybara_data_dir",
          readString(data, "cybara_data_dir", infoConfiguredDataDir)
        );
        setDefaultWorkspaceDir(workspaceDir);
        setActiveCybaraDataDir(activeDataDir);
        setConfiguredCybaraDataDir(configuredDataDir);
        setCybaraDataDirDraft(configuredDataDir);
        setCybaraDataDirSource(readString(data, "cybara_data_dir_source", "default"));
        setCybaraDataDirForced(readBoolean(data, "cybara_data_dir_forced"));
        setCybaraDataDirRestartRequired(
          readBoolean(data, "cybara_data_dir_restart_required", activeDataDir !== configuredDataDir)
        );
        setCybaraDataDirOverrideFile(readString(data, "cybara_data_dir_override_file"));
        setDefaultCybaraDataDir(readString(data, "default_cybara_data_dir", infoActiveDataDir));
      } else {
        setDefaultWorkspaceDir(detectedWorkspace);
        setActiveCybaraDataDir(infoActiveDataDir);
        setConfiguredCybaraDataDir(infoConfiguredDataDir);
        setCybaraDataDirDraft(infoConfiguredDataDir);
      }
    } finally {
      setLoading(false);
    }
  }, [detectedWorkspace, infoActiveDataDir, infoConfiguredDataDir]);

  useEffect(() => {
    void load();
  }, [load]);

  async function chooseWorkspaceDir() {
    const selected = await openDesktopDirectoryDialog({
      defaultPath: defaultWorkspaceDir || detectedWorkspace,
      title: "Choose Default Workspace",
    });
    if (selected) setDefaultWorkspaceDir(selected);
  }

  async function chooseCybaraDataDir() {
    const selected = await openDesktopDirectoryDialog({
      defaultPath: cybaraDataDirDraft || configuredCybaraDataDir || activeCybaraDataDir,
      title: "Choose Cybara Data Directory",
    });
    if (selected) setCybaraDataDirDraft(selected);
  }

  async function saveWorkspaceDir() {
    setSavingWorkspace(true);
    try {
      const res = await settingsApi.updateConfig({
        default_workspace_dir: defaultWorkspaceDir.trim(),
      });
      if (!res.success) {
        throw new Error(res.error || "Failed to save default workspace");
      }
      addToast("success", "Default workspace saved");
      await load();
    } catch (error) {
      addToast(
        "error",
        error instanceof Error ? error.message : "Failed to save default workspace"
      );
    } finally {
      setSavingWorkspace(false);
    }
  }

  async function saveCybaraDataDir() {
    setSavingDataDir(true);
    try {
      const res = await settingsApi.updateConfig({
        cybara_data_dir: cybaraDataDirDraft.trim(),
      });
      if (!res.success) {
        throw new Error(res.error || "Failed to save data directory");
      }
      await load();
      addToast(
        "success",
        res.data?.restartRequired
          ? "Data directory saved. Restart the gateway to apply it."
          : "Data directory saved"
      );
    } catch (error) {
      addToast("error", error instanceof Error ? error.message : "Failed to save data directory");
    } finally {
      setSavingDataDir(false);
    }
  }

  const dataDirDirty = cybaraDataDirDraft.trim() !== configuredCybaraDataDir;
  const saveDataDisabled =
    loading || savingDataDir || cybaraDataDirForced || !cybaraDataDirDraft.trim();

  return (
    <Card variant="liquid">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Folder className="w-5 h-5 text-cyan-400" />
          Gateway Paths
        </CardTitle>
        <CardDescription>
          Choose where new sessions start and where the gateway keeps its local data.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="space-y-3">
          <div>
            <div className="text-sm font-medium text-gray-200">Default Workspace</div>
            <p className="mt-1 text-xs text-gray-500">
              New chats and agent prompts use this directory when no session workspace is selected.
            </p>
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-[1fr_auto_auto] gap-3 items-end">
            <Input
              label="Workspace directory"
              value={defaultWorkspaceDir}
              placeholder={detectedWorkspace || "/Users/you"}
              disabled={loading || savingWorkspace}
              onChange={(event) => setDefaultWorkspaceDir(event.target.value)}
            />
            <Button
              variant="secondary"
              onClick={() => void chooseWorkspaceDir()}
              disabled={savingWorkspace}
            >
              Browse
            </Button>
            <Button
              leftIcon={
                savingWorkspace ? (
                  <RefreshCw className="w-4 h-4 animate-spin" />
                ) : (
                  <Save className="w-4 h-4" />
                )
              }
              onClick={() => void saveWorkspaceDir()}
              disabled={loading || savingWorkspace}
            >
              Save
            </Button>
          </div>
        </div>

        <div className="rounded-lg border border-white/10 bg-black/20 px-3 py-3">
          <div className="flex items-start gap-3">
            <Database className="mt-0.5 w-4 h-4 shrink-0 text-indigo-300" />
            <div className="min-w-0 flex-1 space-y-3">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium text-gray-200">Data Directory</span>
                  {cybaraDataDirRestartRequired && (
                    <span className="rounded-full border border-amber-400/30 bg-amber-500/10 px-2 py-0.5 text-[11px] font-medium text-amber-200">
                      Restart required
                    </span>
                  )}
                  {cybaraDataDirForced && (
                    <span className="rounded-full border border-cyan-400/30 bg-cyan-500/10 px-2 py-0.5 text-[11px] font-medium text-cyan-200">
                      Environment forced
                    </span>
                  )}
                </div>
                <p className="mt-1 text-xs text-gray-500">
                  Stores config, database, API keys, memory, logs, skills, and local media.
                </p>
              </div>
              <div className="grid grid-cols-1 lg:grid-cols-[1fr_auto_auto] gap-3 items-end">
                <Input
                  label="Configured data directory"
                  value={cybaraDataDirDraft}
                  placeholder={defaultCybaraDataDir || "~/.cybara"}
                  disabled={loading || savingDataDir || cybaraDataDirForced}
                  onChange={(event) => setCybaraDataDirDraft(event.target.value)}
                />
                <Button
                  variant="secondary"
                  onClick={() => void chooseCybaraDataDir()}
                  disabled={savingDataDir || cybaraDataDirForced}
                >
                  Browse
                </Button>
                <Button
                  leftIcon={
                    savingDataDir ? (
                      <RefreshCw className="w-4 h-4 animate-spin" />
                    ) : (
                      <Save className="w-4 h-4" />
                    )
                  }
                  onClick={() => void saveCybaraDataDir()}
                  disabled={saveDataDisabled || (!dataDirDirty && !cybaraDataDirRestartRequired)}
                >
                  Save
                </Button>
              </div>
              <div className="grid gap-1 text-xs text-gray-500">
                <div>
                  Active now:{" "}
                  <span className="font-mono text-gray-300 break-all">{activeCybaraDataDir}</span>
                </div>
                {configuredCybaraDataDir !== activeCybaraDataDir && (
                  <div>
                    After restart:{" "}
                    <span className="font-mono text-gray-300 break-all">
                      {configuredCybaraDataDir}
                    </span>
                  </div>
                )}
                <div>Source: {cybaraDataDirSource}</div>
                {cybaraDataDirOverrideFile && !cybaraDataDirForced && (
                  <div>
                    Override file:{" "}
                    <span className="font-mono text-gray-400 break-all">
                      {cybaraDataDirOverrideFile}
                    </span>
                  </div>
                )}
                {cybaraDataDirForced && (
                  <div>Unset CYBARA_HOME before launch to manage this path from Settings.</div>
                )}
              </div>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
