import { X } from "lucide-react";
import type { ReactElement } from "react";
import { Button } from "@/components/ui/Button";
import { Switch } from "@/components/ui/Switch";
import { cn } from "@/lib/utils";
import type { WorkspaceIndexerSettings, WorkspaceIndexerStatusResponse } from "./ideTypes";
import { formatDurationMs } from "./ideUtils";

interface AdvancedIndexerSettingsModalProps {
  activeSettings: WorkspaceIndexerSettings;
  actionLoading: boolean;
  catalogLoading: boolean;
  error: string | null;
  message: string | null;
  status: WorkspaceIndexerStatusResponse | null;
  statusLoading: boolean;
  workspacePath: string;
  onChangeSettings: (settings: WorkspaceIndexerSettings) => void;
  onClose: () => void;
  onRefreshModels: () => void;
  onReindex: () => void;
  onSave: () => void;
  onStop: () => void;
  settingsDirty: boolean;
}

function parseCommaList(value: string, normalizeExtension: boolean): string[] {
  return value
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean)
    .map((item) => (normalizeExtension && !item.startsWith(".") ? `.${item}` : item));
}

export function AdvancedIndexerSettingsModal({
  activeSettings,
  actionLoading,
  catalogLoading,
  error,
  message,
  status,
  statusLoading,
  workspacePath,
  onChangeSettings,
  onClose,
  onRefreshModels,
  onReindex,
  onSave,
  onStop,
  settingsDirty,
}: AdvancedIndexerSettingsModalProps): ReactElement {
  const changeSettings = (patch: Partial<WorkspaceIndexerSettings>): void => {
    onChangeSettings({ ...activeSettings, ...patch });
  };

  return (
    <div
      className="absolute inset-0 z-50 flex items-start justify-center bg-black/45 pt-14"
      onMouseDown={onClose}
    >
      <div
        className="w-[760px] max-w-[94vw] overflow-hidden rounded-xl border border-white/15 bg-[#0b0b12] shadow-2xl"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
          <div>
            <div className="text-sm font-semibold text-gray-100">Workspace Indexer</div>
            <div className="text-xs text-gray-500">
              Index workspace files for faster quick-open and IDE navigation.
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-gray-500 hover:bg-white/5 hover:text-gray-200"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="max-h-[70vh] space-y-4 overflow-y-auto p-4">
          <div className="rounded-lg border border-white/10 bg-white/[0.02] p-3">
            <div className="grid grid-cols-2 gap-3 text-xs">
              <div>
                <div className="text-gray-500">Workspace</div>
                <div className="truncate text-gray-200" title={workspacePath}>
                  {workspacePath}
                </div>
              </div>
              <div>
                <div className="text-gray-500">State</div>
                <div
                  className={cn(
                    "font-medium",
                    status?.state === "error"
                      ? "text-red-300"
                      : status?.isIndexing
                        ? "text-indigo-300"
                        : status?.state === "ready"
                          ? "text-emerald-300"
                          : "text-gray-300"
                  )}
                >
                  {status?.state || "idle"}
                  {status?.isIndexing && " (running)"}
                </div>
              </div>
              <div>
                <div className="text-gray-500">Indexed Files</div>
                <div className="tabular-nums text-gray-200">
                  {status?.filesIndexed?.toLocaleString() || "0"}
                </div>
              </div>
              <div>
                <div className="text-gray-500">Last Duration</div>
                <div className="tabular-nums text-gray-200">
                  {formatDurationMs(status?.durationMs)}
                </div>
              </div>
              <div>
                <div className="text-gray-500">Progress</div>
                <div className="tabular-nums text-gray-200">
                  {typeof status?.progress === "number" ? `${status.progress}%` : "0%"}
                </div>
              </div>
              <div>
                <div className="text-gray-500">Last Indexed</div>
                <div className="text-gray-200">
                  {status?.lastIndexedAt
                    ? new Date(status.lastIndexedAt).toLocaleString()
                    : "Never"}
                </div>
              </div>
              <div>
                <div className="text-gray-500">Semantic Index</div>
                <div
                  className={cn(
                    "font-medium",
                    status?.semanticReady ? "text-emerald-300" : "text-gray-300"
                  )}
                >
                  {status?.semanticReady ? "ready" : "disabled/unavailable"}
                </div>
              </div>
              <div>
                <div className="text-gray-500">Semantic Chunks</div>
                <div className="tabular-nums text-gray-200">
                  {status?.semanticIndexedChunks?.toLocaleString() || "0"}
                </div>
              </div>
              <div>
                <div className="text-gray-500">Embedding Provider</div>
                <div className="truncate text-gray-200">
                  {status?.semanticProvider && status.semanticProvider !== "none"
                    ? `${status.semanticProvider}${status.semanticModel ? ` · ${status.semanticModel}` : ""}`
                    : "none"}
                </div>
              </div>
              <div>
                <div className="text-gray-500">Configured Embedding</div>
                <div className="truncate text-gray-200">
                  {activeSettings.embeddingProvider}
                  {activeSettings.embeddingModel ? ` · ${activeSettings.embeddingModel}` : ""}
                </div>
              </div>
            </div>
            <div className="mt-3 h-1.5 w-full overflow-hidden rounded bg-white/10">
              <div
                className={cn(
                  "h-full transition-all",
                  status?.state === "error" ? "bg-red-500/80" : "bg-indigo-500/80"
                )}
                style={{ width: `${Math.max(0, Math.min(status?.progress || 0, 100))}%` }}
              />
            </div>
            {status?.semanticError && (
              <div className="mt-2 text-[11px] text-amber-300/90">
                Semantic index note: {status.semanticError}
              </div>
            )}
          </div>

          <div className="space-y-3 rounded-lg border border-white/10 bg-white/[0.02] p-3">
            <div className="flex items-center justify-between gap-3 text-xs text-gray-200">
              Enable workspace indexer
              <Switch
                checked={activeSettings.enabled}
                onChange={(enabled) => changeSettings({ enabled })}
              />
            </div>
            <div className="flex items-center justify-between gap-3 text-xs text-gray-300">
              Auto-reindex when workspace is set
              <Switch
                checked={activeSettings.autoReindexOnWorkspaceSet}
                onChange={(autoReindexOnWorkspaceSet) =>
                  changeSettings({ autoReindexOnWorkspaceSet })
                }
              />
            </div>
            <div className="flex items-center justify-between gap-3 text-xs text-gray-300">
              Include hidden files/folders
              <Switch
                checked={activeSettings.includeHidden}
                onChange={(includeHidden) => changeSettings({ includeHidden })}
              />
            </div>
            <div className="flex items-center justify-between gap-3 text-xs text-gray-300">
              Enable semantic vector index
              <Switch
                checked={activeSettings.semanticEnabled}
                onChange={(semanticEnabled) => changeSettings({ semanticEnabled })}
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <label className="space-y-1 text-xs text-gray-400">
                <span>Max files</span>
                <input
                  type="number"
                  min={100}
                  max={1000000}
                  value={activeSettings.maxFiles}
                  onChange={(event) => {
                    const parsed = Number.parseInt(event.target.value || "", 10);
                    changeSettings({
                      maxFiles: Number.isFinite(parsed) ? Math.max(100, parsed) : 100,
                    });
                  }}
                  className="w-full rounded border border-white/10 bg-black/35 px-2 py-1.5 text-xs text-gray-100 !outline-none focus:border-indigo-500/50"
                />
              </label>
              <label className="space-y-1 text-xs text-gray-400">
                <span>Max file size (MB)</span>
                <input
                  type="number"
                  min={0.1}
                  max={100}
                  step={0.1}
                  value={(activeSettings.maxFileSizeBytes / (1024 * 1024)).toFixed(1)}
                  onChange={(event) => {
                    const parsed = Number.parseFloat(event.target.value || "");
                    const megabytes = Number.isFinite(parsed) ? Math.max(0.1, parsed) : 0.1;
                    changeSettings({ maxFileSizeBytes: Math.round(megabytes * 1024 * 1024) });
                  }}
                  className="w-full rounded border border-white/10 bg-black/35 px-2 py-1.5 text-xs text-gray-100 !outline-none focus:border-indigo-500/50"
                />
              </label>
              <label className="space-y-1 text-xs text-gray-400">
                <span>Semantic max files</span>
                <input
                  type="number"
                  min={100}
                  max={50000}
                  value={activeSettings.semanticMaxFiles}
                  onChange={(event) => {
                    const parsed = Number.parseInt(event.target.value || "", 10);
                    changeSettings({
                      semanticMaxFiles: Number.isFinite(parsed) ? Math.max(100, parsed) : 100,
                    });
                  }}
                  className="w-full rounded border border-white/10 bg-black/35 px-2 py-1.5 text-xs text-gray-100 !outline-none focus:border-indigo-500/50"
                />
              </label>
              <label className="space-y-1 text-xs text-gray-400">
                <span>Semantic min score</span>
                <input
                  type="number"
                  min={0.05}
                  max={0.99}
                  step={0.05}
                  value={activeSettings.semanticMinScore}
                  onChange={(event) => {
                    const parsed = Number.parseFloat(event.target.value || "");
                    const score = Number.isFinite(parsed)
                      ? Math.min(0.99, Math.max(0.05, parsed))
                      : 0.45;
                    changeSettings({ semanticMinScore: Number(score.toFixed(2)) });
                  }}
                  className="w-full rounded border border-white/10 bg-black/35 px-2 py-1.5 text-xs text-gray-100 !outline-none focus:border-indigo-500/50"
                />
              </label>
            </div>

            <label className="block space-y-1 text-xs text-gray-400">
              <span>Ignored directories (comma separated)</span>
              <input
                type="text"
                value={activeSettings.ignoreDirs.join(", ")}
                onChange={(event) =>
                  changeSettings({ ignoreDirs: parseCommaList(event.target.value, false) })
                }
                className="w-full rounded border border-white/10 bg-black/35 px-2 py-1.5 text-xs text-gray-100 !outline-none focus:border-indigo-500/50"
                placeholder=".git, node_modules, dist"
              />
            </label>

            <label className="block space-y-1 text-xs text-gray-400">
              <span>Include extensions (optional, comma separated)</span>
              <input
                type="text"
                value={activeSettings.includeExtensions.join(", ")}
                onChange={(event) =>
                  changeSettings({ includeExtensions: parseCommaList(event.target.value, true) })
                }
                className="w-full rounded border border-white/10 bg-black/35 px-2 py-1.5 text-xs text-gray-100 !outline-none focus:border-indigo-500/50"
                placeholder=".ts, .tsx, .js"
              />
            </label>
          </div>

          {message && (
            <div className="rounded border border-emerald-500/25 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-300">
              {message}
            </div>
          )}
          {error && (
            <div className="rounded border border-red-500/25 bg-red-500/10 px-3 py-2 text-xs text-red-300">
              {error}
            </div>
          )}
        </div>

        <div className="flex items-center justify-between gap-2 border-t border-white/10 px-4 py-3">
          <div className="text-[11px] text-gray-500">
            {statusLoading ? "Refreshing status..." : "Status updates while indexing."}
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={onReindex}
              disabled={actionLoading || status?.isIndexing}
              className="h-7 px-2 text-xs"
            >
              Reindex Now
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={onStop}
              disabled={actionLoading || !status?.isIndexing}
              className="h-7 px-2 text-xs"
            >
              Stop
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={onRefreshModels}
              disabled={catalogLoading || actionLoading}
              className="h-7 px-2 text-xs"
            >
              Refresh Models
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={onSave}
              disabled={actionLoading || !settingsDirty}
              className="h-7 px-2 text-xs"
            >
              Save Settings
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
