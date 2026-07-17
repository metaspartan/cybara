import { apiFetch } from "@/lib/auth";
import {
  type Dispatch,
  type SetStateAction,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { DEFAULT_INDEXER_SETTINGS_DRAFT } from "./ideConstants";
import type {
  IdeSettingsSectionId,
  WorkspaceEmbeddingCatalogResponse,
  WorkspaceEmbeddingProviderOption,
  WorkspaceEmbeddingRuntimeModelStatus,
  WorkspaceEmbeddingRuntimeResponse,
  WorkspaceIndexerSettings,
  WorkspaceIndexerStatusResponse,
} from "./ideTypes";
import {
  computeRuntimeModelStatus,
  resolveEmbeddingRuntimeSelection as resolveEmbeddingRuntimeSelectionModel,
  type RuntimeModelStatus,
} from "./indexerModel";

interface UseIDEIndexerOptions {
  currentPath: string;
  effectiveWorkspacePath: string;
  showIdeSettings: boolean;
  ideSettingsSection: IdeSettingsSectionId;
}

interface IDEIndexerController {
  showIndexerSettings: boolean;
  setShowIndexerSettings: Dispatch<SetStateAction<boolean>>;
  indexStatus: WorkspaceIndexerStatusResponse | null;
  setIndexSettingsDraft: Dispatch<SetStateAction<WorkspaceIndexerSettings | null>>;
  indexSettingsDirty: boolean;
  setIndexSettingsDirty: Dispatch<SetStateAction<boolean>>;
  indexStatusLoading: boolean;
  indexActionLoading: boolean;
  indexSettingsError: string | null;
  setIndexSettingsError: Dispatch<SetStateAction<string | null>>;
  indexSettingsMessage: string | null;
  embeddingProviders: WorkspaceEmbeddingProviderOption[];
  embeddingCatalogLoading: boolean;
  embeddingRuntime: WorkspaceEmbeddingRuntimeResponse | null;
  embeddingRuntimeLoading: boolean;
  embeddingRuntimeActionLoading: boolean;
  embeddingModelCustom: boolean;
  setEmbeddingModelCustom: Dispatch<SetStateAction<boolean>>;
  fetchIndexStatus: (workspacePath?: string, options?: { silent?: boolean }) => Promise<void>;
  fetchEmbeddingCatalog: () => Promise<void>;
  fetchEmbeddingRuntimeStatus: (options?: { silent?: boolean }) => Promise<void>;
  saveIndexSettings: () => Promise<void>;
  runWorkspaceReindex: () => Promise<void>;
  stopWorkspaceIndexing: () => Promise<void>;
  loadEmbeddingRuntime: () => Promise<void>;
  stopEmbeddingRuntime: () => Promise<void>;
  indexStatusLabel: string | null;
  activeIndexSettings: WorkspaceIndexerSettings;
  selectedEmbeddingProvider: WorkspaceEmbeddingProviderOption | null;
  selectedEmbeddingModelOptions: string[];
  runtimeTargetProvider: Exclude<WorkspaceIndexerSettings["embeddingProvider"], "auto">;
  runtimeTargetModel: string;
  canManageLocalRuntime: boolean;
  canUnloadLocalRuntime: boolean;
  selectedTransformersRuntimeEntry: WorkspaceEmbeddingRuntimeModelStatus | null;
  effectiveRuntimeNote: string | null;
  runtimeModelStatus: RuntimeModelStatus;
}

export function useIDEIndexer({
  currentPath,
  effectiveWorkspacePath,
  showIdeSettings,
  ideSettingsSection,
}: UseIDEIndexerOptions): IDEIndexerController {
  const [showIndexerSettings, setShowIndexerSettings] = useState(false);
  const [indexStatus, setIndexStatus] = useState<WorkspaceIndexerStatusResponse | null>(null);
  const [indexSettingsDraft, setIndexSettingsDraft] = useState<WorkspaceIndexerSettings | null>(
    null
  );
  const [indexSettingsDirty, setIndexSettingsDirty] = useState(false);
  const [indexStatusLoading, setIndexStatusLoading] = useState(false);
  const [indexActionLoading, setIndexActionLoading] = useState(false);
  const [indexSettingsError, setIndexSettingsError] = useState<string | null>(null);
  const [indexSettingsMessage, setIndexSettingsMessage] = useState<string | null>(null);
  const [embeddingProviders, setEmbeddingProviders] = useState<WorkspaceEmbeddingProviderOption[]>(
    []
  );
  const [embeddingCatalogLoading, setEmbeddingCatalogLoading] = useState(false);
  const [embeddingRuntime, setEmbeddingRuntime] =
    useState<WorkspaceEmbeddingRuntimeResponse | null>(null);
  const [embeddingRuntimeLoading, setEmbeddingRuntimeLoading] = useState(false);
  const [embeddingRuntimeActionLoading, setEmbeddingRuntimeActionLoading] = useState(false);
  const [embeddingModelCustom, setEmbeddingModelCustom] = useState(false);
  const lastIndexedWorkspaceAssignmentRef = useRef<string | null>(null);

  const fetchIndexStatus = useCallback(
    async (workspacePath?: string, options?: { silent?: boolean }) => {
      const targetPath = workspacePath || effectiveWorkspacePath;
      const silent = options?.silent === true;
      if (!silent) {
        setIndexStatusLoading(true);
      }
      try {
        const params = new URLSearchParams();
        if (targetPath) params.set("workspacePath", targetPath);
        const query = params.toString();
        const response = await apiFetch(`/api/ide/index/status${query ? `?${query}` : ""}`);
        const data: WorkspaceIndexerStatusResponse = await response.json();
        if (data.success) {
          setIndexStatus(data);
          if (!indexSettingsDirty) {
            setIndexSettingsDraft(data.settings);
          }
          if (!silent) {
            setIndexSettingsError(null);
          }
        } else {
          if (!silent) {
            setIndexSettingsError(data.error || "Failed to load indexer status");
          }
        }
      } catch (error) {
        if (!silent && (error as Error)?.name !== "AbortError") {
          setIndexSettingsError(String(error));
        }
      } finally {
        if (!silent) {
          setIndexStatusLoading(false);
        }
      }
    },
    [effectiveWorkspacePath, indexSettingsDirty]
  );

  const fetchEmbeddingCatalog = useCallback(async () => {
    setEmbeddingCatalogLoading(true);
    try {
      const response = await apiFetch("/api/ide/index/embeddings");
      const data: WorkspaceEmbeddingCatalogResponse = await response.json();
      if (data.success) {
        setEmbeddingProviders(Array.isArray(data.providers) ? data.providers : []);
      } else {
        setEmbeddingProviders([]);
        setIndexSettingsError(data.error || "Failed to load embedding providers");
      }
    } catch (error) {
      setEmbeddingProviders([]);
      setIndexSettingsError(String(error));
    } finally {
      setEmbeddingCatalogLoading(false);
    }
  }, []);

  const resolveEmbeddingRuntimeSelection = useCallback(() => {
    const activeSettings =
      indexSettingsDraft || indexStatus?.settings || DEFAULT_INDEXER_SETTINGS_DRAFT;
    return resolveEmbeddingRuntimeSelectionModel(activeSettings, embeddingRuntime);
  }, [embeddingRuntime, indexSettingsDraft, indexStatus?.settings]);

  const fetchEmbeddingRuntimeStatus = useCallback(
    async (options?: { silent?: boolean }) => {
      const selection = resolveEmbeddingRuntimeSelection();
      const silent = options?.silent === true;
      if (!silent) setEmbeddingRuntimeLoading(true);
      try {
        const params = new URLSearchParams();
        if (selection.provider) params.set("provider", selection.provider);
        if (selection.model) params.set("model", selection.model);
        const query = params.toString();
        const response = await apiFetch(
          `/api/ide/index/embedding/runtime${query ? `?${query}` : ""}`
        );
        const data: WorkspaceEmbeddingRuntimeResponse = await response.json();
        if (data.success) {
          setEmbeddingRuntime(data);
          if (!silent) {
            setIndexSettingsError(null);
          }
        } else if (!silent) {
          setIndexSettingsError(data.error || "Failed to load embedding runtime status");
        }
      } catch (error) {
        if (!silent) {
          setIndexSettingsError(String(error));
        }
      } finally {
        if (!silent) setEmbeddingRuntimeLoading(false);
      }
    },
    [resolveEmbeddingRuntimeSelection]
  );

  const assignWorkspaceToIndexer = useCallback(
    async (workspacePath: string) => {
      try {
        const response = await apiFetch("/api/ide/index/workspace", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ workspacePath }),
        });
        const data: WorkspaceIndexerStatusResponse = await response.json();
        if (data.success) {
          setIndexStatus(data);
          if (!indexSettingsDirty) {
            setIndexSettingsDraft(data.settings);
          }
        } else {
          setIndexSettingsError(data.error || "Failed to start workspace indexing");
        }
      } catch (error) {
        setIndexSettingsError(String(error));
      }
    },
    [indexSettingsDirty]
  );

  const saveIndexSettings = useCallback(async () => {
    if (!indexSettingsDraft) return;
    setIndexActionLoading(true);
    setIndexSettingsError(null);
    setIndexSettingsMessage(null);
    try {
      const response = await apiFetch("/api/ide/index/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(indexSettingsDraft),
      });
      const data: WorkspaceIndexerStatusResponse = await response.json();
      if (data.success) {
        setIndexStatus(data);
        setIndexSettingsDraft(data.settings);
        setIndexSettingsDirty(false);
        setIndexSettingsMessage("Indexer settings saved.");
        void fetchEmbeddingCatalog();
      } else {
        setIndexSettingsError(data.error || "Failed to save indexer settings");
      }
    } catch (error) {
      setIndexSettingsError(String(error));
    } finally {
      setIndexActionLoading(false);
    }
  }, [fetchEmbeddingCatalog, indexSettingsDraft]);

  const runWorkspaceReindex = useCallback(async () => {
    setIndexActionLoading(true);
    setIndexSettingsError(null);
    setIndexSettingsMessage(null);
    try {
      const response = await apiFetch("/api/ide/index/reindex", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspacePath: effectiveWorkspacePath }),
      });
      const data: WorkspaceIndexerStatusResponse = await response.json();
      if (data.success) {
        setIndexStatus(data);
        setIndexSettingsMessage("Workspace reindex started.");
      } else {
        setIndexSettingsError(data.error || "Failed to reindex workspace");
      }
    } catch (error) {
      setIndexSettingsError(String(error));
    } finally {
      setIndexActionLoading(false);
    }
  }, [effectiveWorkspacePath]);

  const stopWorkspaceIndexing = useCallback(async () => {
    setIndexActionLoading(true);
    setIndexSettingsError(null);
    setIndexSettingsMessage(null);
    try {
      const response = await apiFetch("/api/ide/index/stop", {
        method: "POST",
      });
      const data: WorkspaceIndexerStatusResponse = await response.json();
      if (data.success) {
        setIndexStatus(data);
        setIndexSettingsMessage("Workspace indexing stopped.");
      } else {
        setIndexSettingsError(data.error || "Failed to stop workspace indexer");
      }
    } catch (error) {
      setIndexSettingsError(String(error));
    } finally {
      setIndexActionLoading(false);
    }
  }, []);

  const loadEmbeddingRuntime = useCallback(async () => {
    const selection = resolveEmbeddingRuntimeSelection();
    setEmbeddingRuntimeActionLoading(true);
    setIndexSettingsError(null);
    setIndexSettingsMessage(null);
    try {
      const response = await apiFetch("/api/ide/index/embedding/load", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(selection),
      });
      const data = (await response.json()) as {
        success: boolean;
        message?: string;
        status?: WorkspaceIndexerStatusResponse;
        runtime?: WorkspaceEmbeddingRuntimeResponse;
        error?: string;
      };
      if (data.success) {
        if (data.status) setIndexStatus(data.status);
        if (data.runtime) setEmbeddingRuntime(data.runtime);
        setIndexSettingsMessage(data.message || "Local embedding runtime loaded.");
      } else {
        setIndexSettingsError(data.error || data.message || "Failed to load embedding runtime");
      }
    } catch (error) {
      setIndexSettingsError(String(error));
    } finally {
      setEmbeddingRuntimeActionLoading(false);
    }
  }, [resolveEmbeddingRuntimeSelection]);

  const stopEmbeddingRuntime = useCallback(async () => {
    const selection = resolveEmbeddingRuntimeSelection();
    setEmbeddingRuntimeActionLoading(true);
    setIndexSettingsError(null);
    setIndexSettingsMessage(null);
    try {
      const response = await apiFetch("/api/ide/index/embedding/stop", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(selection),
      });
      const data = (await response.json()) as {
        success: boolean;
        message?: string;
        status?: WorkspaceIndexerStatusResponse;
        runtime?: WorkspaceEmbeddingRuntimeResponse;
        error?: string;
      };
      if (data.success) {
        if (data.status) {
          setIndexStatus(data.status);
        }
        if (data.runtime) {
          setEmbeddingRuntime(data.runtime);
        }
        setIndexSettingsMessage(data.message || "Local embedding runtime stopped.");
      } else {
        setIndexSettingsError(data.error || data.message || "Failed to stop embedding runtime");
      }
    } catch (error) {
      setIndexSettingsError(String(error));
    } finally {
      setEmbeddingRuntimeActionLoading(false);
    }
  }, [resolveEmbeddingRuntimeSelection]);

  const autoAssignIndexerWorkspace = Boolean(
    (indexSettingsDraft || indexStatus?.settings || DEFAULT_INDEXER_SETTINGS_DRAFT).enabled &&
      (indexSettingsDraft || indexStatus?.settings || DEFAULT_INDEXER_SETTINGS_DRAFT)
        .autoReindexOnWorkspaceSet
  );

  useEffect(() => {
    if (!effectiveWorkspacePath) return;
    if (!autoAssignIndexerWorkspace) return;
    if (lastIndexedWorkspaceAssignmentRef.current === effectiveWorkspacePath) return;
    lastIndexedWorkspaceAssignmentRef.current = effectiveWorkspacePath;
    setIndexSettingsError(null);
    void assignWorkspaceToIndexer(effectiveWorkspacePath);
  }, [assignWorkspaceToIndexer, autoAssignIndexerWorkspace, effectiveWorkspacePath]);

  useEffect(() => {
    void fetchIndexStatus(currentPath);
  }, [currentPath, fetchIndexStatus]);

  useEffect(() => {
    const indexingSettingsVisible =
      showIndexerSettings || (showIdeSettings && ideSettingsSection === "indexing");
    if (!indexingSettingsVisible && !indexStatus?.isIndexing) return;
    const interval = window.setInterval(() => {
      void fetchIndexStatus(effectiveWorkspacePath, { silent: true });
      if (indexingSettingsVisible) {
        void fetchEmbeddingRuntimeStatus({ silent: true });
      }
    }, 1200);
    return () => window.clearInterval(interval);
  }, [
    effectiveWorkspacePath,
    fetchEmbeddingRuntimeStatus,
    fetchIndexStatus,
    ideSettingsSection,
    indexStatus?.isIndexing,
    showIdeSettings,
    showIndexerSettings,
  ]);

  useEffect(() => {
    const indexingSettingsVisible =
      showIndexerSettings || (showIdeSettings && ideSettingsSection === "indexing");
    if (!indexingSettingsVisible) return;
    void fetchIndexStatus(effectiveWorkspacePath);
  }, [
    effectiveWorkspacePath,
    fetchIndexStatus,
    ideSettingsSection,
    showIdeSettings,
    showIndexerSettings,
  ]);

  useEffect(() => {
    const indexingSettingsVisible =
      showIndexerSettings || (showIdeSettings && ideSettingsSection === "indexing");
    if (!indexingSettingsVisible) return;
    void fetchEmbeddingCatalog();
  }, [fetchEmbeddingCatalog, ideSettingsSection, showIdeSettings, showIndexerSettings]);

  useEffect(() => {
    const indexingSettingsVisible =
      showIndexerSettings || (showIdeSettings && ideSettingsSection === "indexing");
    if (!indexingSettingsVisible) return;
    void fetchEmbeddingRuntimeStatus();
  }, [fetchEmbeddingRuntimeStatus, ideSettingsSection, showIdeSettings, showIndexerSettings]);

  const indexStatusLabel = useMemo(() => {
    if (!indexStatus) return null;
    if (indexStatus.isIndexing) {
      return `Indexing ${indexStatus.filesIndexed.toLocaleString()} files`;
    }
    if (indexStatus.state === "ready") {
      return `Indexed ${indexStatus.filesIndexed.toLocaleString()} files`;
    }
    if (indexStatus.state === "error") {
      return "Index error";
    }
    if (!indexStatus.settings.enabled) {
      return "Index disabled";
    }
    if (indexStatus.state === "stopped") {
      return "Index stopped";
    }
    return "Index idle";
  }, [indexStatus]);
  const activeIndexSettings =
    indexSettingsDraft || indexStatus?.settings || DEFAULT_INDEXER_SETTINGS_DRAFT;
  const selectedEmbeddingProvider = useMemo(
    () =>
      embeddingProviders.find((option) => option.id === activeIndexSettings.embeddingProvider) ||
      null,
    [activeIndexSettings.embeddingProvider, embeddingProviders]
  );
  const selectedEmbeddingModelOptions = useMemo(() => {
    if (!selectedEmbeddingProvider) return [];
    return selectedEmbeddingProvider.models || [];
  }, [selectedEmbeddingProvider]);
  const runtimeTargetProvider = useMemo(() => {
    if (activeIndexSettings.embeddingProvider !== "auto") {
      return activeIndexSettings.embeddingProvider;
    }
    if (
      embeddingRuntime?.vectorProvider === "transformers_js" ||
      embeddingRuntime?.vectorProvider === "ollama"
    ) {
      return embeddingRuntime.vectorProvider;
    }
    return "transformers_js";
  }, [activeIndexSettings.embeddingProvider, embeddingRuntime?.vectorProvider]);
  const runtimeTargetModel = useMemo(() => {
    if (activeIndexSettings.embeddingModel.trim()) {
      return activeIndexSettings.embeddingModel.trim();
    }
    if (runtimeTargetProvider === "transformers_js") {
      return (
        embeddingRuntime?.transformers?.selectedModel ||
        selectedEmbeddingProvider?.defaultModel ||
        ""
      );
    }
    return embeddingRuntime?.vectorModel || selectedEmbeddingProvider?.defaultModel || "";
  }, [
    activeIndexSettings.embeddingModel,
    embeddingRuntime?.transformers?.selectedModel,
    embeddingRuntime?.vectorModel,
    runtimeTargetProvider,
    selectedEmbeddingProvider?.defaultModel,
  ]);
  const canManageLocalRuntime =
    runtimeTargetProvider === "transformers_js" || runtimeTargetProvider === "ollama";
  const canUnloadLocalRuntime =
    canManageLocalRuntime &&
    (runtimeTargetProvider !== "transformers_js"
      ? true
      : embeddingRuntime?.transformers?.selectedState === "ready" ||
        embeddingRuntime?.transformers?.selectedState === "loading" ||
        (embeddingRuntime?.transformers?.loadedModels?.length || 0) > 0);
  const selectedTransformersRuntimeError = useMemo(() => {
    if (!embeddingRuntime?.transformers) return null;
    const selectedModel = embeddingRuntime.transformers.selectedModel;
    const selectedEntry = embeddingRuntime.transformers.loadedModels.find(
      (entry) => entry.model === selectedModel
    );
    return selectedEntry?.lastError || null;
  }, [embeddingRuntime?.transformers]);
  const selectedTransformersRuntimeEntry = useMemo(() => {
    if (!embeddingRuntime?.transformers) return null;
    const selectedModel = embeddingRuntime.transformers.selectedModel;
    return (
      embeddingRuntime.transformers.loadedModels.find((entry) => entry.model === selectedModel) ||
      null
    );
  }, [embeddingRuntime?.transformers]);
  const effectiveRuntimeNote = useMemo(() => {
    if (runtimeTargetProvider === "transformers_js" && selectedTransformersRuntimeError) {
      return selectedTransformersRuntimeError;
    }
    if (
      runtimeTargetProvider === "transformers_js" &&
      embeddingRuntime?.transformers?.selectedState === "ready"
    ) {
      return null;
    }
    if (runtimeTargetProvider === "ollama" && embeddingRuntime?.vectorProvider === "ollama") {
      return null;
    }
    return embeddingRuntime?.vectorFallbackReason || null;
  }, [
    embeddingRuntime?.transformers?.selectedState,
    embeddingRuntime?.vectorFallbackReason,
    embeddingRuntime?.vectorProvider,
    runtimeTargetProvider,
    selectedTransformersRuntimeError,
  ]);

  const runtimeModelStatus = useMemo(
    () =>
      computeRuntimeModelStatus(
        runtimeTargetProvider,
        embeddingRuntime,
        selectedTransformersRuntimeEntry
      ),
    [embeddingRuntime, runtimeTargetProvider, selectedTransformersRuntimeEntry]
  );

  useEffect(() => {
    const indexingSettingsVisible =
      showIndexerSettings || (showIdeSettings && ideSettingsSection === "indexing");
    if (!indexingSettingsVisible) return;
    const timeout = window.setTimeout(() => {
      void fetchEmbeddingRuntimeStatus({ silent: true });
    }, 180);
    return () => window.clearTimeout(timeout);
  }, [
    activeIndexSettings.embeddingModel,
    activeIndexSettings.embeddingProvider,
    fetchEmbeddingRuntimeStatus,
    ideSettingsSection,
    showIdeSettings,
    showIndexerSettings,
  ]);

  return {
    showIndexerSettings,
    setShowIndexerSettings,
    indexStatus,
    setIndexSettingsDraft,
    indexSettingsDirty,
    setIndexSettingsDirty,
    indexStatusLoading,
    indexActionLoading,
    indexSettingsError,
    setIndexSettingsError,
    indexSettingsMessage,
    embeddingProviders,
    embeddingCatalogLoading,
    embeddingRuntime,
    embeddingRuntimeLoading,
    embeddingRuntimeActionLoading,
    embeddingModelCustom,
    setEmbeddingModelCustom,
    fetchIndexStatus,
    fetchEmbeddingCatalog,
    fetchEmbeddingRuntimeStatus,
    saveIndexSettings,
    runWorkspaceReindex,
    stopWorkspaceIndexing,
    loadEmbeddingRuntime,
    stopEmbeddingRuntime,
    indexStatusLabel,
    activeIndexSettings,
    selectedEmbeddingProvider,
    selectedEmbeddingModelOptions,
    runtimeTargetProvider,
    runtimeTargetModel,
    canManageLocalRuntime,
    canUnloadLocalRuntime,
    selectedTransformersRuntimeEntry,
    effectiveRuntimeNote,
    runtimeModelStatus,
  };
}
