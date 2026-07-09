import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/utils";
import { formatSize } from "./ideUtils";
import type { RuntimeModelStatus } from "./indexerModel";
import type {
  WorkspaceEmbeddingProviderOption,
  WorkspaceEmbeddingRuntimeModelStatus,
  WorkspaceEmbeddingRuntimeResponse,
  WorkspaceIndexerSettings,
  WorkspaceIndexerStatusResponse,
} from "./ideTypes";

interface IndexerSettingsPanelProps {
  indexStatus: WorkspaceIndexerStatusResponse | null;
  activeIndexSettings: WorkspaceIndexerSettings;
  embeddingProviders: WorkspaceEmbeddingProviderOption[];
  selectedEmbeddingProvider: WorkspaceEmbeddingProviderOption | undefined;
  selectedEmbeddingModelOptions: string[];
  embeddingModelCustom: boolean;
  runtimeTargetProvider: string;
  runtimeTargetModel: string;
  runtimeModelStatus: RuntimeModelStatus;
  selectedTransformersRuntimeEntry: WorkspaceEmbeddingRuntimeModelStatus | null;
  effectiveRuntimeNote: string | null;
  embeddingRuntime: WorkspaceEmbeddingRuntimeResponse | null;
  embeddingCatalogLoading: boolean;
  embeddingRuntimeActionLoading: boolean;
  embeddingRuntimeLoading: boolean;
  canManageLocalRuntime: boolean;
  canUnloadLocalRuntime: boolean;
  indexActionLoading: boolean;
  indexSettingsDirty: boolean;
  effectiveWorkspacePath: string;
  setIndexSettingsDraft: (settings: WorkspaceIndexerSettings) => void;
  setIndexSettingsDirty: (value: boolean) => void;
  setEmbeddingModelCustom: (value: boolean) => void;
  setShowIndexerSettings: (value: boolean) => void;
  setIndexSettingsError: (value: string | null) => void;
  fetchEmbeddingCatalog: () => void;
  fetchEmbeddingRuntimeStatus: () => void;
  loadEmbeddingRuntime: () => void;
  stopEmbeddingRuntime: () => void;
  fetchIndexStatus: (path: string) => void;
  saveIndexSettings: () => void;
  runWorkspaceReindex: () => void;
  matchesIdeSettingsSearch: (...parts: string[]) => boolean;
}

export function IndexerSettingsPanel({
  indexStatus,
  activeIndexSettings,
  embeddingProviders,
  selectedEmbeddingProvider,
  selectedEmbeddingModelOptions,
  embeddingModelCustom,
  runtimeTargetProvider,
  runtimeTargetModel,
  runtimeModelStatus,
  selectedTransformersRuntimeEntry,
  effectiveRuntimeNote,
  embeddingRuntime,
  embeddingCatalogLoading,
  embeddingRuntimeActionLoading,
  embeddingRuntimeLoading,
  canManageLocalRuntime,
  canUnloadLocalRuntime,
  indexActionLoading,
  indexSettingsDirty,
  effectiveWorkspacePath,
  setIndexSettingsDraft,
  setIndexSettingsDirty,
  setEmbeddingModelCustom,
  setShowIndexerSettings,
  setIndexSettingsError,
  fetchEmbeddingCatalog,
  fetchEmbeddingRuntimeStatus,
  loadEmbeddingRuntime,
  stopEmbeddingRuntime,
  fetchIndexStatus,
  saveIndexSettings,
  runWorkspaceReindex,
  matchesIdeSettingsSearch,
}: IndexerSettingsPanelProps): React.ReactElement {
  return (
    <div className="space-y-3">
      <div className="rounded border border-white/10 bg-white/[0.02] px-3 py-2.5 text-xs">
        <div className="text-gray-200 font-medium">Workspace index status</div>
        <div className="mt-1 text-gray-500">
          {indexStatus?.state || "idle"} • {indexStatus?.filesIndexed?.toLocaleString() || "0"}{" "}
          files
        </div>
      </div>
      <div className="rounded border border-white/10 bg-white/[0.02] px-3 py-3 space-y-3">
        <div className="text-xs font-medium text-gray-200">Embedding Runtime</div>
        <div className="grid grid-cols-2 gap-3">
          <label className="text-xs text-gray-400 space-y-1">
            <span>Embedding provider</span>
            <select
              value={activeIndexSettings.embeddingProvider}
              onChange={(event) => {
                const nextProvider = event.target
                  .value as WorkspaceIndexerSettings["embeddingProvider"];
                const option = embeddingProviders.find(
                  (candidate) => candidate.id === nextProvider
                );
                const nextModel =
                  option && option.defaultModel
                    ? option.defaultModel
                    : activeIndexSettings.embeddingModel;
                setIndexSettingsDraft({
                  ...activeIndexSettings,
                  embeddingProvider: nextProvider,
                  embeddingModel: nextModel,
                });
                setIndexSettingsDirty(true);
              }}
              className="w-full rounded border border-white/10 bg-black/35 px-2 py-1.5 text-xs text-gray-100 !outline-none focus:border-indigo-500/50"
            >
              {embeddingProviders.length === 0 && (
                <option value={activeIndexSettings.embeddingProvider}>
                  {activeIndexSettings.embeddingProvider}
                </option>
              )}
              {embeddingProviders.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                  {!option.available ? " (unavailable)" : ""}
                </option>
              ))}
            </select>
            {selectedEmbeddingProvider?.reason && (
              <span className="block text-[11px] text-amber-300/90">
                {selectedEmbeddingProvider.reason}
              </span>
            )}
          </label>

          <label className="text-xs text-gray-400 space-y-1">
            <span>Embedding model</span>
            {(() => {
              const currentModel = activeIndexSettings.embeddingModel || "";
              const modelOptions = Array.from(
                new Set([...selectedEmbeddingModelOptions, currentModel].filter(Boolean))
              );
              const isCustom =
                embeddingModelCustom ||
                (currentModel !== "" && !modelOptions.includes(currentModel));
              return (
                <>
                  <select
                    value={isCustom ? "__custom__" : currentModel}
                    onChange={(event) => {
                      const next = event.target.value;
                      if (next === "__custom__") {
                        setEmbeddingModelCustom(true);
                        return;
                      }
                      setEmbeddingModelCustom(false);
                      setIndexSettingsDraft({
                        ...activeIndexSettings,
                        embeddingModel: next,
                      });
                      setIndexSettingsDirty(true);
                    }}
                    className="w-full rounded border border-white/10 bg-black/35 px-2 py-1.5 text-xs text-gray-100 !outline-none focus:border-indigo-500/50"
                  >
                    {modelOptions.length === 0 && <option value="">provider default</option>}
                    {modelOptions.map((model) => (
                      <option key={model} value={model}>
                        {model}
                      </option>
                    ))}
                    <option value="__custom__">Custom model…</option>
                  </select>
                  {isCustom && (
                    <input
                      type="text"
                      value={currentModel}
                      onChange={(event) => {
                        setIndexSettingsDraft({
                          ...activeIndexSettings,
                          embeddingModel: event.target.value,
                        });
                        setIndexSettingsDirty(true);
                      }}
                      placeholder={selectedEmbeddingProvider?.defaultModel || "org/model-id"}
                      className="mt-1 w-full rounded border border-white/10 bg-black/35 px-2 py-1.5 font-mono text-[11px] text-gray-100 !outline-none focus:border-indigo-500/50"
                    />
                  )}
                </>
              );
            })()}
          </label>
        </div>

        <div className="grid grid-cols-2 gap-3 text-xs">
          <div>
            <div className="text-gray-500">Runtime target</div>
            <div className="text-gray-200 truncate">
              {runtimeTargetProvider}
              {runtimeTargetModel ? ` · ${runtimeTargetModel}` : ""}
            </div>
          </div>
          <div>
            <div className="text-gray-500">Model status</div>
            <div
              className={cn(
                "flex items-center gap-1.5 font-medium",
                runtimeModelStatus.tone === "loaded"
                  ? "text-emerald-300"
                  : runtimeModelStatus.tone === "loading"
                    ? "text-indigo-300"
                    : runtimeModelStatus.tone === "error"
                      ? "text-red-300"
                      : "text-gray-400"
              )}
            >
              {runtimeModelStatus.tone === "loading" ? (
                <Loader2 className="w-3 h-3 animate-spin" />
              ) : (
                <span
                  className={cn(
                    "inline-block w-2 h-2 rounded-full",
                    runtimeModelStatus.tone === "loaded"
                      ? "bg-emerald-400"
                      : runtimeModelStatus.tone === "error"
                        ? "bg-red-400"
                        : "bg-gray-500"
                  )}
                />
              )}
              <span>{runtimeModelStatus.label}</span>
            </div>
          </div>
        </div>

        {runtimeTargetProvider === "transformers_js" && selectedTransformersRuntimeEntry && (
          <div className="grid grid-cols-2 gap-2 rounded-lg border border-white/5 bg-black/20 p-2 text-[11px] text-gray-300 md:grid-cols-4">
            <div>
              <div className="text-gray-500">Device</div>
              <div className="truncate">
                {selectedTransformersRuntimeEntry.device || "auto"} ·{" "}
                {selectedTransformersRuntimeEntry.dtype || "q8"}
              </div>
            </div>
            <div>
              <div className="text-gray-500">Model memory</div>
              <div className="truncate">
                {selectedTransformersRuntimeEntry.estimatedModelBytes
                  ? formatSize(selectedTransformersRuntimeEntry.estimatedModelBytes)
                  : "Not loaded"}
              </div>
            </div>
            <div>
              <div className="text-gray-500">
                {selectedTransformersRuntimeEntry.device === "webgpu" ? "VRAM" : "VRAM (GPU only)"}
              </div>
              <div className="truncate">
                {selectedTransformersRuntimeEntry.vramBytes
                  ? formatSize(selectedTransformersRuntimeEntry.vramBytes)
                  : selectedTransformersRuntimeEntry.device === "webgpu"
                    ? "Measuring…"
                    : "— (CPU/RAM)"}
              </div>
            </div>
            <div>
              <div className="text-gray-500">Gateway RSS</div>
              <div className="truncate">
                {selectedTransformersRuntimeEntry.residentMemoryBytes
                  ? formatSize(selectedTransformersRuntimeEntry.residentMemoryBytes)
                  : "Unavailable"}
              </div>
            </div>
          </div>
        )}

        {effectiveRuntimeNote && (
          <div
            className={cn(
              "rounded px-2 py-1.5 text-[11px]",
              runtimeTargetProvider === "transformers_js" &&
                embeddingRuntime?.transformers?.selectedState === "error"
                ? "border border-red-500/25 bg-red-500/10 text-red-300"
                : "border border-amber-500/25 bg-amber-500/10 text-amber-200"
            )}
          >
            Runtime note: {effectiveRuntimeNote}
          </div>
        )}

        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => fetchEmbeddingCatalog()}
            disabled={
              embeddingCatalogLoading || embeddingRuntimeActionLoading || embeddingRuntimeLoading
            }
            className="h-7 px-2 text-xs"
          >
            Refresh Models
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => fetchEmbeddingRuntimeStatus()}
            disabled={embeddingRuntimeLoading || embeddingRuntimeActionLoading}
            className="h-7 px-2 text-xs"
          >
            {embeddingRuntimeLoading ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              "Refresh Runtime"
            )}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => loadEmbeddingRuntime()}
            disabled={
              !canManageLocalRuntime || embeddingRuntimeActionLoading || embeddingRuntimeLoading
            }
            className="h-7 px-2 text-xs"
          >
            {embeddingRuntimeActionLoading ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              "Load Runtime"
            )}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => stopEmbeddingRuntime()}
            disabled={
              !canUnloadLocalRuntime || embeddingRuntimeActionLoading || embeddingRuntimeLoading
            }
            className="h-7 px-2 text-xs"
          >
            Unload Runtime
          </Button>
        </div>
      </div>
      {matchesIdeSettingsSearch("indexer", "open", "advanced") && (
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setShowIndexerSettings(true);
              setIndexSettingsError(null);
              setIndexSettingsDirty(false);
              fetchIndexStatus(effectiveWorkspacePath);
            }}
            className="h-7 px-2 text-xs"
          >
            Open Advanced Indexer Settings
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => saveIndexSettings()}
            disabled={indexActionLoading || !indexSettingsDirty}
            className="h-7 px-2 text-xs"
          >
            Save Index Settings
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => runWorkspaceReindex()}
            disabled={indexActionLoading}
            className="h-7 px-2 text-xs"
          >
            Reindex Workspace
          </Button>
        </div>
      )}
    </div>
  );
}
