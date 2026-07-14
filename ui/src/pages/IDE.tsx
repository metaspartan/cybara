import {
  useState,
  useEffect,
  useCallback,
  useMemo,
  useRef,
  useDeferredValue,
  useTransition,
  memo,
  type CSSProperties,
} from "react";
import { useLocation, useNavigate } from "react-router-dom";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { Button } from "@/components/ui/Button";
import { Switch } from "@/components/ui/Switch";
import { Highlight, themes } from "prism-react-renderer";
import {
  Folder,
  FolderOpen,
  FileCode,
  FileText,
  FileJson,
  File,
  FilePlus,
  FolderPlus,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  Home,
  Eye,
  Code,
  Loader2,
  AlertCircle,
  AlertTriangle,
  Info,
  X,
  Check,
  CheckCircle2,
  Zap,
  GitBranch,
  Search,
  MessageSquare,
  ExternalLink,
  Copy,
  RotateCcw,
  Sparkles,
  Square,
  ListTree,
  Settings2,
  TerminalSquare,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { apiFetch } from "@/lib/auth";
import { chatApi, agentsApi } from "@/lib/api";
import { connectStatusStream } from "@/lib/status-stream";
import {
  buildActivitiesFromToolCalls,
  finalizeCompletedActivities,
  mergeActivityLists,
  normalizeActivityTextForPhase,
  type LiveActivityItem,
  type ToolCallLike,
} from "@/lib/chatActivities";
import {
  countGitDiffLineChanges,
  buildPendingInlinePreviewRows,
  emptyIdePendingDiffDecorations,
  mergeGitDiffDecorations,
  parseGitDiffDecorations,
  type IdePendingInlinePreviewRow,
  type IdePendingDeletedBlock,
  type IdePendingDiffDecorations,
  type IdePendingLineState,
} from "@/lib/idePendingDiffDecorations";
import EmbeddedTerminalPanel, {
  type IdeTerminalPanelState,
} from "@/components/ide/EmbeddedTerminalPanel";
import { useStopAgent } from "@/hooks/useApi";
import type {
  FileEntry,
  BrowseResult,
  ReadResult,
  Diagnostic,
  LspActiveServer,
  IdeSearchMatch,
  IdeSearchFileResult,
  IdeSearchResult,
  IdeReplaceResult,
  IdeReplacePreviewFile,
  IdeReplacePreviewResult,
  IdeListFilesResult,
  WorkspaceIndexerSettings,
  IdeBlameLine,
  IdeBlameResult,
  GitHistoryStatus,
  IdeTab,
  IdeChatMessage,
  IdeChatAgentOption,
  IdeProcessActivity,
  IdeFileChangeItem,
  IdeFileChangeSummary,
  IdePendingFileDiff,
  IdePendingFileDiffController,
  TreeContextMenuState,
  IdeCommandItem,
  IdeOutlineSymbol,
  IdeOutlineResponse,
  IdeCompletionItem,
  IdeCompletionResponse,
  IdeInlineCompletionResponse,
  FlattenedOutlineSymbol,
  IdeBreadcrumb,
  IdeSettingsSectionId,
  IdeTopMenuId,
  IdePreferences,
  WorkspaceEmbeddingProviderOption,
  WorkspaceEmbeddingCatalogResponse,
  WorkspaceEmbeddingRuntimeResponse,
  WorkspaceIndexerStatusResponse,
  WorkspaceIndexerSearchResult,
} from "./ide/ideTypes";
import {
  IDE_SIDEBAR_WIDTH_STORAGE_KEY,
  IDE_SIDEBAR_DEFAULT_WIDTH,
  IDE_SIDEBAR_MIN_WIDTH,
  IDE_SIDEBAR_MAX_WIDTH,
  IDE_CHAT_WIDTH_STORAGE_KEY,
  IDE_CHAT_OPEN_STORAGE_KEY,
  IDE_CHAT_DEFAULT_WIDTH,
  IDE_CHAT_MIN_WIDTH,
  IDE_CHAT_MAX_WIDTH,
  IDE_WORKSPACE_PATH_STORAGE_KEY,
  IDE_CHAT_AGENT_STORAGE_KEY,
  IDE_TERMINAL_OPEN_STORAGE_KEY,
  IDE_SETTINGS_STORAGE_KEY,
  EXPLORER_VIRTUALIZATION_MIN_ENTRIES,
  EXPLORER_VIRTUALIZATION_ROW_HEIGHT,
  EXPLORER_VIRTUALIZATION_OVERSCAN,
  EDITOR_LARGE_FILE_CHAR_THRESHOLD,
  EDITOR_LARGE_FILE_LINE_THRESHOLD,
  COMPLETION_LOCAL_SCAN_BEFORE,
  COMPLETION_LOCAL_SCAN_AFTER,
  COMPLETION_CACHE_TTL_MS,
  COMPLETION_CACHE_MAX_ENTRIES,
  EDITOR_TYPING_BURST_MS,
  EDITOR_FONT_SIZE_PX,
  EDITOR_LINE_HEIGHT_PX,
  IDE_TERMINAL_DEFAULT_HEIGHT,
  IDE_TERMINAL_MIN_HEIGHT,
  IDE_TERMINAL_MAX_HEIGHT,
  IDE_DEFAULT_PREFERENCES,
  DEFAULT_INDEXER_SETTINGS_DRAFT,
} from "./ide/ideConstants";
import {
  clampSidebarWidth,
  readPersistedSidebarWidth,
  persistSidebarWidth,
  clampChatWidth,
  readPersistedChatWidth,
  persistChatWidth,
  readPersistedChatOpen,
  persistChatOpen,
  readPersistedWorkspacePath,
  persistWorkspacePath,
  readPersistedIdeChatAgentId,
  persistIdeChatAgentId,
  clampTerminalHeight,
  readPersistedTerminalOpen,
  persistTerminalOpen,
  readPersistedIdePreferences,
  persistIdePreferences,
  readPersistedOpenTabs,
  persistOpenTabs,
} from "./ide/idePersistence";
import {
  IDE_ACTIONS,
  type IdeActionId,
  bindingFromEvent,
  formatBinding,
  loadKeymapOverrides,
  persistKeymapOverrides,
  resolveKeymap,
} from "./ide/ideKeymap";
import {
  computeRuntimeModelStatus,
  resolveEmbeddingRuntimeSelection as resolveEmbeddingRuntimeSelectionModel,
} from "./ide/indexerModel";
import { IndexerSettingsPanel } from "./ide/IndexerSettingsPanel";
import {
  getFileIcon,
  formatSize,
  formatDurationMs,
  getLineAndColumn,
  getPrismLanguage,
  splitPathForBreadcrumbs,
  flattenOutlineSymbols,
  getSymbolKindLabel,
  fileEntryFromPath,
  isMarkdownExtension,
  ideMarkdownComponents,
  formatBlameStamp,
  formatBlameDateTime,
  scoreQuickOpenResult,
  getSeverityIcon,
} from "./ide/ideUtils";
import { getActiveLanguageFromExtension } from "./ide/ideLanguageMaps";
import {
  isPlainRecord,
  normalizeIdePath,
  getIdePendingFileDecisionKey,
  isSameIdePath,
  countDiffLines,
  truncateDiffPreview,
  shouldHydratePendingFileDiffFromGit,
  getPendingLineTextClass,
  getPendingLineDecorationStyle,
  summarizePendingDeletedBlocks,
  parseIdePatchFileChanges,
  parseIdeChangeRecord,
  summarizeIdeFileChanges,
  summarizeIdeTextFileChanges,
  summarizeIdeMessageFileChanges,
  summarizeIdeActivityFileChanges,
  mergeIdeFileChangeSummaries,
  reverseUnifiedDiff,
  getPendingLineContainerClass,
  isIdeToolCallLike,
  getIdeToolCallsInTimelineOrder,
} from "./ide/ideDiffHelpers";
import {
  getIdeToolCallArgs,
  getIdeToolCallCommand,
  getIdeToolCallResultSummary,
  getIdeToolCallExitCode,
  parseIdeTimestampMs,
  normalizeIdeSandboxProviderValue,
  formatIdeSandboxProviderLabel,
  isGenericIdeStatusLabel,
  isMeaningfulIdeThoughtDetail,
  getLatestIdeInFlightStep,
  toIdeLiveActivityItems,
  formatIdeStatusEventText,
  getIdeHeaderTitle,
} from "./ide/ideActivityHelpers";
import { CodeViewer } from "./ide/CodeViewer";
import { FileTree, treeBrowseCache } from "./ide/FileTree";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { CreateDialog } from "./ide/CreateDialog";
import { LSPStatus } from "./ide/LSPStatus";
import { GitStatus } from "./ide/GitStatus";
import {
  IdeActivityText,
  IdeProcessActivityList,
  IdeLiveActivityTimeline,
} from "./ide/IdeActivityTimeline";
import { IDEChatPanel } from "./ide/IDEChatPanel";
import { IDEWelcomeScreen } from "./ide/IDEWelcomeScreen";

function formatIdeScannedFiles(value?: number): string | null {
  if (!Number.isFinite(value)) return null;
  return `${Math.max(0, value as number).toLocaleString()} scanned`;
}

function readWorkspacePathFromUrl(): string | null {
  if (typeof window === "undefined") return null;
  const raw = new URLSearchParams(window.location.search).get("workspacePath")?.trim();
  return raw || null;
}

export function IDE() {
  const navigate = useNavigate();
  const location = useLocation();
  const [currentPath, setCurrentPath] = useState<string>(
    () => readWorkspacePathFromUrl() || readPersistedWorkspacePath()
  );
  const [selectedFile, setSelectedFile] = useState<FileEntry | null>(null);
  const [openTabs, setOpenTabs] = useState<IdeTab[]>(() => {
    if (typeof window === "undefined") return [];
    const restored = readPersistedOpenTabs();
    return restored.tabs;
  });
  const [activeTabPath, setActiveTabPath] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    return readPersistedOpenTabs().activeTabPath;
  });
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set());
  const [treeFilterDraft, setTreeFilterDraft] = useState("");
  const [treeFilter, setTreeFilter] = useState("");
  const [isTreeFilterPending, startTreeFilterTransition] = useTransition();
  const deferredTreeFilter = useDeferredValue(treeFilter);
  const [rootInfo, setRootInfo] = useState<BrowseResult | null>(null);
  const [createType, setCreateType] = useState<"file" | "directory" | null>(null);
  const [createParentPath, setCreateParentPath] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [saveRequestToken, setSaveRequestToken] = useState(0);
  const [requestedJumpLine, setRequestedJumpLine] = useState<number | null>(null);
  const [cursorPosition, setCursorPosition] = useState<{ line: number; column: number } | null>(
    null
  );
  const [gitHistoryStatus, setGitHistoryStatus] = useState<GitHistoryStatus>("idle");
  const [sidebarWidth, setSidebarWidth] = useState<number>(() => readPersistedSidebarWidth());
  const [sidebarMode, setSidebarMode] = useState<"explorer" | "search" | "outline">("explorer");
  const [openMenu, setOpenMenu] = useState<IdeTopMenuId | null>(null);
  const [globalSearchQuery, setGlobalSearchQuery] = useState("");
  const [globalSearchReplace, setGlobalSearchReplace] = useState("");
  const [globalSearchCaseSensitive, setGlobalSearchCaseSensitive] = useState(false);
  const [globalSearchWholeWord, setGlobalSearchWholeWord] = useState(false);
  const [globalSearchResults, setGlobalSearchResults] = useState<IdeSearchResult | null>(null);
  const [globalReplacePreview, setGlobalReplacePreview] = useState<IdeReplacePreviewResult | null>(
    null
  );
  const [globalSearchLoading, setGlobalSearchLoading] = useState(false);
  const [globalSearchError, setGlobalSearchError] = useState<string | null>(null);
  const [globalReplaceLoading, setGlobalReplaceLoading] = useState(false);
  const [globalPreviewLoading, setGlobalPreviewLoading] = useState(false);
  const [showQuickOpen, setShowQuickOpen] = useState(false);
  const [quickOpenQuery, setQuickOpenQuery] = useState("");
  const [quickOpenResults, setQuickOpenResults] = useState<
    Array<{ path: string; relativePath: string }>
  >([]);
  const [quickOpenLoading, setQuickOpenLoading] = useState(false);
  const [quickOpenError, setQuickOpenError] = useState<string | null>(null);
  const [quickOpenNotice, setQuickOpenNotice] = useState<string | null>(null);
  const [quickOpenSelectedIndex, setQuickOpenSelectedIndex] = useState(0);
  const [showCommandPalette, setShowCommandPalette] = useState(false);
  const [keymapOverrides, setKeymapOverrides] = useState<Record<string, string>>(() =>
    loadKeymapOverrides()
  );
  const [recordingActionId, setRecordingActionId] = useState<IdeActionId | null>(null);
  const isMacPlatform =
    typeof navigator !== "undefined" &&
    /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent || "");
  const [commandQuery, setCommandQuery] = useState("");
  const [commandSelectedIndex, setCommandSelectedIndex] = useState(0);
  const [outlineSymbols, setOutlineSymbols] = useState<IdeOutlineSymbol[]>([]);
  const [outlineLoading, setOutlineLoading] = useState(false);
  const [outlineError, setOutlineError] = useState<string | null>(null);
  const [outlineFilter, setOutlineFilter] = useState("");
  const [explorerScrollTop, setExplorerScrollTop] = useState(0);
  const [explorerViewportHeight, setExplorerViewportHeight] = useState(0);
  const [treeContextMenu, setTreeContextMenu] = useState<TreeContextMenuState | null>(null);
  const [ideChatSelectedAgentId, setIdeChatSelectedAgentId] = useState<string>(() =>
    readPersistedIdeChatAgentId()
  );
  const [ideAgentOptions, setIdeAgentOptions] = useState<IdeChatAgentOption[]>([]);
  const [showIdeSettings, setShowIdeSettings] = useState(false);
  const [ideSettingsSection, setIdeSettingsSection] = useState<IdeSettingsSectionId>("general");
  const [ideSettingsSearch, setIdeSettingsSearch] = useState("");
  const [idePreferences, setIdePreferences] = useState<IdePreferences>(() =>
    readPersistedIdePreferences()
  );
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
  const [isIdeChatOpen, setIsIdeChatOpen] = useState<boolean>(() => readPersistedChatOpen());
  const [idePendingFileDiffs, setIdePendingFileDiffs] = useState<IdePendingFileDiff[]>([]);
  const [idePendingFileDiffController, setIdePendingFileDiffController] =
    useState<IdePendingFileDiffController | null>(null);
  const [isTerminalPanelOpen, setIsTerminalPanelOpen] = useState<boolean>(() =>
    readPersistedTerminalOpen(readPersistedIdePreferences().openTerminalOnStartup)
  );
  const [terminalPanelHeight, setTerminalPanelHeight] = useState<number>(() =>
    clampTerminalHeight(readPersistedIdePreferences().terminalPanelHeight)
  );
  const [terminalCreateRequestToken, setTerminalCreateRequestToken] = useState(0);
  const [terminalPanelState, setTerminalPanelState] = useState<IdeTerminalPanelState>({
    capability: "checking",
    sessionCount: 0,
    activeSessionId: null,
  });
  const [chatPanelWidth, setChatPanelWidth] = useState<number>(() => readPersistedChatWidth());
  const workspacePaneRef = useRef<HTMLDivElement | null>(null);
  const sidebarResizeCleanupRef = useRef<(() => void) | null>(null);
  const chatResizeCleanupRef = useRef<(() => void) | null>(null);
  const terminalResizeCleanupRef = useRef<(() => void) | null>(null);
  const globalSearchInputRef = useRef<HTMLInputElement | null>(null);
  const treeFilterInputRef = useRef<HTMLInputElement | null>(null);
  const outlineInputRef = useRef<HTMLInputElement | null>(null);
  const quickOpenInputRef = useRef<HTMLInputElement | null>(null);
  const commandInputRef = useRef<HTMLInputElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const explorerScrollRef = useRef<HTMLDivElement | null>(null);
  const lastIndexedWorkspaceAssignmentRef = useRef<string | null>(null);
  const pendingCursorPositionRef = useRef<{ line: number; column: number } | null>(null);
  const cursorPublishTimeoutRef = useRef<number | null>(null);
  const settingsSearchRef = useRef<HTMLInputElement | null>(null);
  const effectiveWorkspacePath = rootInfo?.path || currentPath;

  const handleCursorPositionChange = useCallback(
    (position: { line: number; column: number } | null) => {
      pendingCursorPositionRef.current = position;
      if (cursorPublishTimeoutRef.current !== null) return;
      cursorPublishTimeoutRef.current = window.setTimeout(() => {
        cursorPublishTimeoutRef.current = null;
        const next = pendingCursorPositionRef.current;
        pendingCursorPositionRef.current = null;
        setCursorPosition((previous) => {
          if (!previous && !next) return previous;
          if (!previous || !next) return next;
          if (previous.line === next.line && previous.column === next.column) return previous;
          return next;
        });
      }, 75);
    },
    []
  );

  const updateTreeFilter = useCallback(
    (nextFilter: string) => {
      setTreeFilterDraft(nextFilter);
      startTreeFilterTransition(() => setTreeFilter(nextFilter));
    },
    [startTreeFilterTransition]
  );

  useEffect(() => {
    let isCancelled = false;
    const loadAgents = async () => {
      try {
        const response = await agentsApi.summaries();
        if (!response.success || !response.data || isCancelled) return;
        const options = (response.data || [])
          .map((agent) => ({
            id: typeof agent.id === "string" ? agent.id : "",
            name: typeof agent.name === "string" ? agent.name : "Agent",
            model: typeof agent.model === "string" ? agent.model : "",
            provider: typeof agent.provider === "string" ? agent.provider : "",
            provider_id: typeof agent.provider_id === "string" ? agent.provider_id : undefined,
            fallback_provider_id:
              typeof agent.fallback_provider_id === "string"
                ? agent.fallback_provider_id
                : undefined,
            status: typeof agent.status === "string" ? agent.status : undefined,
          }))
          .filter((agent) => agent.id);
        setIdeAgentOptions(options);
      } catch {
        void 0;
      }
    };
    void loadAgents();
    return () => {
      isCancelled = true;
    };
  }, []);

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

  const resolveEmbeddingRuntimeSelectionRef = useRef(resolveEmbeddingRuntimeSelection);
  resolveEmbeddingRuntimeSelectionRef.current = resolveEmbeddingRuntimeSelection;

  const fetchEmbeddingRuntimeStatus = useCallback(async (options?: { silent?: boolean }) => {
    const selection = resolveEmbeddingRuntimeSelectionRef.current();
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
  }, []);

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

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    const fetchRoot = async (): Promise<void> => {
      try {
        const res = await apiFetch(`/api/ide/browse?path=${encodeURIComponent(currentPath)}`, {
          signal: controller.signal,
        });
        const data: BrowseResult = await res.json();
        if (cancelled) return;
        if (data.success) {
          setRootInfo(data);
          return;
        }
        setRootInfo(null);
        if (currentPath !== "~") {
          setCurrentPath("~");
        }
      } catch {
        if (!cancelled) setRootInfo(null);
      }
    };
    void fetchRoot();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [currentPath, refreshKey]);

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

  useEffect(() => {
    const updateViewport = () => {
      const container = explorerScrollRef.current;
      if (!container) return;
      setExplorerViewportHeight(container.clientHeight);
      setExplorerScrollTop(container.scrollTop);
    };

    updateViewport();
    window.addEventListener("resize", updateViewport);
    return () => window.removeEventListener("resize", updateViewport);
  }, []);

  useEffect(() => {
    return () => {
      if (cursorPublishTimeoutRef.current !== null) {
        window.clearTimeout(cursorPublishTimeoutRef.current);
        cursorPublishTimeoutRef.current = null;
      }
      pendingCursorPositionRef.current = null;
    };
  }, []);

  useEffect(() => {
    const selectedPath = selectedFile?.path;
    if (!selectedPath || selectedFile?.type !== "file") {
      setOutlineSymbols([]);
      setOutlineError(null);
      setOutlineLoading(false);
      return;
    }

    let cancelled = false;
    const fetchOutline = async () => {
      setOutlineLoading(true);
      setOutlineError(null);
      try {
        const response = await apiFetch(
          `/api/lsp/symbols?path=${encodeURIComponent(selectedPath)}`
        );
        const data: IdeOutlineResponse = await response.json();
        if (cancelled) return;
        if (data.success) {
          setOutlineSymbols(Array.isArray(data.symbols) ? data.symbols : []);
        } else {
          setOutlineSymbols([]);
          setOutlineError(data.error || "Failed to load symbols");
        }
      } catch (errorValue) {
        if (cancelled) return;
        setOutlineSymbols([]);
        setOutlineError(String(errorValue));
      } finally {
        if (!cancelled) {
          setOutlineLoading(false);
        }
      }
    };

    void fetchOutline();
    return () => {
      cancelled = true;
    };
  }, [refreshKey, selectedFile?.path, selectedFile?.type]);

  const handleToggleDir = useCallback((path: string) => {
    setExpandedDirs((prev) => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  }, []);

  const openFileInEditor = useCallback(
    (entry: FileEntry, line?: number | null, options?: { previewMode?: boolean }) => {
      if (entry.type !== "file") return;
      const resolvedLine =
        typeof line === "number" && Number.isFinite(line) && line > 0 ? Math.floor(line) : null;
      const previewMode = options?.previewMode === true;
      setRequestedJumpLine(resolvedLine);
      setSelectedFile(entry);
      setActiveTabPath(entry.path);
      setOpenTabs((previous) => {
        const exists = previous.some((tab) => tab.path === entry.path);
        const nextTab: IdeTab = {
          path: entry.path,
          name: entry.name,
          extension: entry.extension,
          previewMode,
        };
        if (exists) {
          return previous.map((tab) => (tab.path === entry.path ? nextTab : tab));
        }
        return [...previous, nextTab];
      });
    },
    []
  );

  const handleCloseTab = useCallback(
    (targetPath: string) => {
      setOpenTabs((previous) => {
        const closingIndex = previous.findIndex((tab) => tab.path === targetPath);
        if (closingIndex === -1) return previous;
        const nextTabs = previous.filter((tab) => tab.path !== targetPath);
        if (activeTabPath === targetPath) {
          const fallback = nextTabs[Math.min(closingIndex, nextTabs.length - 1)];
          if (fallback) {
            const fallbackEntry = fileEntryFromPath(fallback.path);
            setSelectedFile(fallbackEntry);
            setActiveTabPath(fallback.path);
            setRequestedJumpLine(null);
          } else {
            setSelectedFile(null);
            setActiveTabPath(null);
            setRequestedJumpLine(null);
          }
        }
        return nextTabs;
      });
    },
    [activeTabPath]
  );

  const handleCycleTabs = useCallback(
    (direction: 1 | -1) => {
      if (openTabs.length === 0) return;
      const activePath = activeTabPath || selectedFile?.path || openTabs[0]?.path || null;
      const currentIndex = activePath ? openTabs.findIndex((tab) => tab.path === activePath) : 0;
      const normalizedIndex = currentIndex >= 0 ? currentIndex : 0;
      const nextIndex =
        (normalizedIndex + direction + openTabs.length) % Math.max(openTabs.length, 1);
      const nextTab = openTabs[nextIndex];
      if (!nextTab) return;
      setSelectedFile(fileEntryFromPath(nextTab.path));
      setActiveTabPath(nextTab.path);
      setRequestedJumpLine(null);
    },
    [activeTabPath, openTabs, selectedFile?.path]
  );

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const rawPath = params.get("path");
    if (!rawPath) return;
    const targetPath = rawPath.trim();
    if (!targetPath) return;

    const lineRaw = params.get("line");
    const parsedLine = lineRaw ? Number.parseInt(lineRaw, 10) : Number.NaN;
    const targetLine = Number.isFinite(parsedLine) && parsedLine > 0 ? parsedLine : null;
    const targetEntry = fileEntryFromPath(targetPath);
    const separatorIndex = Math.max(targetPath.lastIndexOf("/"), targetPath.lastIndexOf("\\"));
    const directoryPath = separatorIndex >= 0 ? targetPath.slice(0, separatorIndex) : "";
    openFileInEditor(targetEntry, targetLine);
    updateTreeFilter("");

    if (directoryPath) {
      setCurrentPath((previous) => (previous === directoryPath ? previous : directoryPath));
      setExpandedDirs((previous) => {
        const next = new Set(previous);
        next.add(directoryPath);
        return next;
      });
    }
  }, [location.search, openFileInEditor, updateTreeFilter]);

  const handleSelectFile = useCallback(
    (entry: FileEntry) => {
      openFileInEditor(entry, null, { previewMode: false });
    },
    [openFileInEditor]
  );

  const handleTreeContextMenu = useCallback(
    (entry: FileEntry, event: React.MouseEvent<HTMLDivElement>) => {
      setTreeContextMenu({
        x: event.clientX,
        y: event.clientY,
        entry,
      });
    },
    []
  );

  const handleRevealInExplorer = useCallback(async (pathValue: string) => {
    await apiFetch("/api/ide/reveal", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: pathValue }),
    });
  }, []);

  const handleSetWorkspacePath = useCallback(
    (nextPath: string) => {
      setCurrentPath(nextPath);
      setSelectedFile(null);
      setActiveTabPath(null);
      setRequestedJumpLine(null);
      setExpandedDirs(new Set());
      updateTreeFilter("");
      treeBrowseCache.clear();
      setRefreshKey((previous) => previous + 1);
      setIndexSettingsError(null);
    },
    [updateTreeFilter]
  );

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const rawWorkspacePath = params.get("workspacePath");
    const targetWorkspacePath = rawWorkspacePath?.trim();
    if (!targetWorkspacePath || targetWorkspacePath === currentPath) return;
    handleSetWorkspacePath(targetWorkspacePath);
  }, [currentPath, handleSetWorkspacePath, location.search]);

  const handlePromptOpenWorkspace = useCallback(async () => {
    const suggested = rootInfo?.path || currentPath || "~";
    const rawPath = window.prompt("Enter workspace folder path", suggested);
    if (rawPath === null) return;
    const targetPath = rawPath.trim();
    if (!targetPath) return;

    try {
      const response = await apiFetch(`/api/ide/browse?path=${encodeURIComponent(targetPath)}`);
      const data: BrowseResult = await response.json();
      if (!data.success) {
        window.alert(data.error || "Unable to open workspace path");
        return;
      }
      if (!data.path) {
        window.alert("Workspace path is invalid");
        return;
      }
      handleSetWorkspacePath(data.path);
    } catch (error) {
      window.alert(String(error));
    }
  }, [currentPath, handleSetWorkspacePath, rootInfo?.path]);

  const handleRenameEntry = useCallback(async (entry: FileEntry) => {
    const proposed = window.prompt("Rename item", entry.name);
    if (proposed === null) return;
    const nextName = proposed.trim();
    if (!nextName || nextName === entry.name) return;

    const response = await apiFetch("/api/ide/rename", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: entry.path, newName: nextName }),
    });
    const data = await response.json();
    if (!data?.success || typeof data.path !== "string") {
      window.alert(data?.error || "Failed to rename item");
      return;
    }

    const oldPath = entry.path;
    const newPath = data.path as string;
    const mapPath = (value: string): string => {
      if (value === oldPath) return newPath;
      const slashPrefix = `${oldPath}/`;
      if (value.startsWith(slashPrefix)) {
        return `${newPath}${value.slice(oldPath.length)}`;
      }
      const backslashPrefix = `${oldPath}\\`;
      if (value.startsWith(backslashPrefix)) {
        return `${newPath}${value.slice(oldPath.length)}`;
      }
      return value;
    };

    setOpenTabs((previous) =>
      previous.map((tab) => {
        const mapped = mapPath(tab.path);
        if (mapped === tab.path) return tab;
        const mappedEntry = fileEntryFromPath(mapped);
        return {
          ...tab,
          path: mapped,
          name: mappedEntry.name,
          extension: mappedEntry.extension,
        };
      })
    );
    setSelectedFile((previous) => {
      if (!previous) return previous;
      const mapped = mapPath(previous.path);
      if (mapped === previous.path) return previous;
      return fileEntryFromPath(mapped);
    });
    setActiveTabPath((previous) => (previous ? mapPath(previous) : previous));
    setTreeContextMenu(null);
    setRefreshKey((previous) => previous + 1);
  }, []);

  const handleGoHome = useCallback(() => {
    setCurrentPath("~");
    setSelectedFile(null);
    setActiveTabPath(null);
    setRequestedJumpLine(null);
    setExpandedDirs(new Set());
    updateTreeFilter("");
    treeBrowseCache.clear();
  }, [updateTreeFilter]);

  const handleGoUp = useCallback(() => {
    if (rootInfo?.parent) {
      setCurrentPath(rootInfo.parent);
      setSelectedFile(null);
      setActiveTabPath(null);
      setRequestedJumpLine(null);
      setExpandedDirs(new Set());
      treeBrowseCache.clear();
    }
  }, [rootInfo?.parent]);

  const handleRefresh = useCallback(() => {
    treeBrowseCache.clear();
    setRefreshKey((k) => k + 1);
  }, []);

  const handleExpandTopLevel = useCallback(() => {
    if (!rootInfo) return;
    setExpandedDirs((prev) => {
      const next = new Set(prev);
      for (const entry of rootInfo.entries) {
        if (entry.type === "directory") next.add(entry.path);
      }
      return next;
    });
  }, [rootInfo]);

  const handleCollapseAll = useCallback(() => {
    setExpandedDirs(new Set());
  }, []);

  const workspaceSearchPath = rootInfo?.path || currentPath;
  const parseQuickOpenQuery = useCallback(
    (value: string): { query: string; line: number | null } => {
      const trimmed = value.trim();
      const lineMatch = trimmed.match(/^(.*?):(\d+)$/);
      if (!lineMatch) {
        return { query: trimmed, line: null };
      }
      const query = (lineMatch[1] || "").trim();
      const parsedLine = Number.parseInt(lineMatch[2] || "", 10);
      const line = Number.isFinite(parsedLine) && parsedLine > 0 ? parsedLine : null;
      return { query, line };
    },
    []
  );

  const openFileAtPath = useCallback(
    (filePath: string, line?: number | null, previewMode?: boolean) => {
      const separatorIndex = Math.max(filePath.lastIndexOf("/"), filePath.lastIndexOf("\\"));
      const directoryPath = separatorIndex >= 0 ? filePath.slice(0, separatorIndex) : "";
      openFileInEditor(fileEntryFromPath(filePath), line, { previewMode: previewMode === true });

      if (directoryPath) {
        setCurrentPath((previous) => (previous === directoryPath ? previous : directoryPath));
        setExpandedDirs((previous) => {
          const next = new Set(previous);
          next.add(directoryPath);
          return next;
        });
      }
    },
    [openFileInEditor]
  );

  const handleNavigateToBreadcrumb = useCallback(
    (crumb: IdeBreadcrumb) => {
      if (crumb.isFile) {
        openFileAtPath(crumb.path, null, false);
        return;
      }
      setCurrentPath(crumb.path);
      setExpandedDirs((previous) => {
        const next = new Set(previous);
        next.add(crumb.path);
        return next;
      });
    },
    [openFileAtPath]
  );

  const runGlobalSearch = useCallback(async () => {
    const query = globalSearchQuery.trim();
    if (!query) {
      setGlobalSearchResults({
        success: true,
        path: workspaceSearchPath,
        query: "",
        totalMatches: 0,
        truncated: false,
        files: [],
      });
      setGlobalSearchError(null);
      return;
    }

    setGlobalSearchLoading(true);
    setGlobalSearchError(null);
    try {
      const params = new URLSearchParams({
        path: workspaceSearchPath,
        query,
        caseSensitive: String(globalSearchCaseSensitive),
        wholeWord: String(globalSearchWholeWord),
      });
      const response = await apiFetch(`/api/ide/search?${params.toString()}`);
      const data: IdeSearchResult = await response.json();
      if (data.success) {
        setGlobalSearchResults(data);
      } else {
        setGlobalSearchResults(null);
        setGlobalSearchError(data.error || "Search failed");
      }
    } catch (error) {
      setGlobalSearchResults(null);
      setGlobalSearchError(String(error));
    } finally {
      setGlobalSearchLoading(false);
    }
  }, [globalSearchCaseSensitive, globalSearchQuery, globalSearchWholeWord, workspaceSearchPath]);

  const openGlobalSearchMatch = useCallback(
    (filePath: string, line: number) => {
      openFileAtPath(filePath, line);
    },
    [openFileAtPath]
  );

  const runQuickOpenSearch = useCallback(
    async (queryValue: string) => {
      const { query } = parseQuickOpenQuery(queryValue);
      setQuickOpenLoading(true);
      setQuickOpenError(null);
      setQuickOpenNotice(null);
      try {
        const params = new URLSearchParams({
          path: workspaceSearchPath,
          query,
          limit: "250",
        });
        const response = await apiFetch(`/api/ide/index/search?${params.toString()}`);
        const data: WorkspaceIndexerSearchResult = await response.json();
        if (data.success) {
          const rankedFiles = [...(data.files || [])].sort((left, right) => {
            const leftScore = scoreQuickOpenResult(left.relativePath, query);
            const rightScore = scoreQuickOpenResult(right.relativePath, query);
            if (leftScore !== rightScore) return leftScore - rightScore;
            if (left.relativePath.length !== right.relativePath.length) {
              return left.relativePath.length - right.relativePath.length;
            }
            return left.relativePath.localeCompare(right.relativePath);
          });
          setQuickOpenResults(rankedFiles);
          setQuickOpenSelectedIndex((previous) => {
            if (rankedFiles.length === 0) return 0;
            return Math.min(previous, rankedFiles.length - 1);
          });
          const scanned = formatIdeScannedFiles(data.filesScanned);
          const notices: string[] = [];
          if (data.source === "filesystem" && data.indexError) {
            notices.push(`Indexer unavailable (${data.indexError}); showing filesystem search.`);
          }
          if (data.scanTruncated) {
            notices.push(
              `Filesystem scan limited${scanned ? ` after ${scanned}` : ""}. Narrow the query or reindex this workspace.`
            );
          }
          setQuickOpenNotice(notices.length > 0 ? notices.join(" ") : null);
        } else {
          setQuickOpenResults([]);
          setQuickOpenError(data.error || "Quick open failed");
          setQuickOpenNotice(null);
        }
      } catch (error) {
        setQuickOpenResults([]);
        setQuickOpenError(String(error));
        setQuickOpenNotice(null);
      } finally {
        setQuickOpenLoading(false);
      }
    },
    [parseQuickOpenQuery, workspaceSearchPath]
  );

  useEffect(() => {
    if (!showQuickOpen) return;
    const timeout = window.setTimeout(() => {
      void runQuickOpenSearch(quickOpenQuery);
    }, 120);
    return () => window.clearTimeout(timeout);
  }, [quickOpenQuery, runQuickOpenSearch, showQuickOpen]);

  const openQuickOpenPalette = useCallback(() => {
    setShowQuickOpen(true);
    setQuickOpenError(null);
    setQuickOpenNotice(null);
    setQuickOpenSelectedIndex(0);
    window.requestAnimationFrame(() => {
      quickOpenInputRef.current?.focus();
      quickOpenInputRef.current?.select();
    });
  }, []);

  const closeQuickOpenPalette = useCallback(() => {
    setShowQuickOpen(false);
  }, []);

  const openCommandPalette = useCallback(() => {
    setShowCommandPalette(true);
    setCommandQuery("");
    setCommandSelectedIndex(0);
    window.requestAnimationFrame(() => {
      commandInputRef.current?.focus();
      commandInputRef.current?.select();
    });
  }, []);

  const closeCommandPalette = useCallback(() => {
    setShowCommandPalette(false);
  }, []);

  const openIdeSettings = useCallback((section: IdeSettingsSectionId = "general") => {
    setIdeSettingsSection(section);
    setShowIdeSettings(true);
    setIdeSettingsSearch("");
    window.requestAnimationFrame(() => {
      settingsSearchRef.current?.focus();
      settingsSearchRef.current?.select();
    });
  }, []);

  const updateIdePreferences = useCallback((patch: Partial<IdePreferences>) => {
    setIdePreferences((previous) => {
      const merged: IdePreferences = {
        ...previous,
        ...patch,
      };
      merged.editorFontSizePx = Math.max(11, Math.min(22, Math.round(merged.editorFontSizePx)));
      merged.editorLineHeightPx = Math.max(16, Math.min(38, Math.round(merged.editorLineHeightPx)));
      merged.completionDebounceMs = Math.max(
        30,
        Math.min(800, Math.round(merged.completionDebounceMs))
      );
      merged.ghostDebounceMs = Math.max(60, Math.min(1400, Math.round(merged.ghostDebounceMs)));
      merged.terminalPanelHeight = clampTerminalHeight(merged.terminalPanelHeight);
      return merged;
    });
  }, []);

  useEffect(() => {
    if (ideAgentOptions.length === 0) return;
    if (!ideChatSelectedAgentId) return;
    if (ideAgentOptions.some((agent) => agent.id === ideChatSelectedAgentId)) return;
    setIdeChatSelectedAgentId("");
  }, [ideAgentOptions, ideChatSelectedAgentId]);

  useEffect(() => {
    if (ideAgentOptions.length === 0) return;
    if (idePreferences.useChatAgentForCompletions) return;
    const selected = idePreferences.completionAgentId;
    if (!selected) return;
    if (ideAgentOptions.some((agent) => agent.id === selected)) return;
    updateIdePreferences({ completionAgentId: "" });
  }, [
    ideAgentOptions,
    idePreferences.completionAgentId,
    idePreferences.useChatAgentForCompletions,
    updateIdePreferences,
  ]);

  const toggleTerminalPanel = useCallback(() => {
    setIsTerminalPanelOpen((previous) => !previous);
  }, []);

  const openNewTerminal = useCallback(() => {
    setIsTerminalPanelOpen(true);
    setTerminalCreateRequestToken((previous) => previous + 1);
  }, []);

  const handleQuickOpenConfirm = useCallback(
    (index?: number) => {
      if (quickOpenResults.length === 0) return;
      const safeIndex =
        typeof index === "number"
          ? Math.min(Math.max(index, 0), quickOpenResults.length - 1)
          : Math.min(Math.max(quickOpenSelectedIndex, 0), quickOpenResults.length - 1);
      const selected = quickOpenResults[safeIndex];
      if (!selected) return;
      const { line } = parseQuickOpenQuery(quickOpenQuery);
      openFileAtPath(selected.path, line);
      closeQuickOpenPalette();
    },
    [
      closeQuickOpenPalette,
      openFileAtPath,
      parseQuickOpenQuery,
      quickOpenQuery,
      quickOpenResults,
      quickOpenSelectedIndex,
    ]
  );

  const commandItems = useMemo<IdeCommandItem[]>(
    () => [
      {
        id: "save",
        label: "Save Active File",
        shortcut: "Ctrl/Cmd+S",
        run: () => setSaveRequestToken((previous) => previous + 1),
      },
      {
        id: "quick-open",
        label: "Quick Open",
        shortcut: "Ctrl/Cmd+P",
        run: () => openQuickOpenPalette(),
      },
      {
        id: "ide-settings",
        label: "IDE Settings",
        shortcut: "Ctrl/Cmd+,",
        run: () => openIdeSettings("general"),
      },
      {
        id: "new-file",
        label: "New File",
        shortcut: "Ctrl/Cmd+N",
        run: () => {
          setCreateParentPath(rootInfo?.path || currentPath);
          setCreateType("file");
        },
      },
      {
        id: "new-folder",
        label: "New Folder",
        shortcut: "Ctrl/Cmd+Shift+N",
        run: () => {
          setCreateParentPath(rootInfo?.path || currentPath);
          setCreateType("directory");
        },
      },
      {
        id: "open-workspace",
        label: "Open Workspace Folder",
        shortcut: "Ctrl/Cmd+O",
        run: () => {
          void handlePromptOpenWorkspace();
        },
      },
      {
        id: "show-search",
        label: "Show Global Search",
        shortcut: "Ctrl/Cmd+Shift+F",
        run: () => {
          setSidebarMode("search");
          window.requestAnimationFrame(() => {
            globalSearchInputRef.current?.focus();
            globalSearchInputRef.current?.select();
          });
        },
      },
      {
        id: "show-explorer",
        label: "Show Explorer",
        shortcut: "Ctrl/Cmd+Shift+E",
        run: () => setSidebarMode("explorer"),
      },
      {
        id: "show-outline",
        label: "Show Outline",
        shortcut: "Ctrl/Cmd+Shift+O",
        run: () => {
          setSidebarMode("outline");
          window.requestAnimationFrame(() => {
            outlineInputRef.current?.focus();
            outlineInputRef.current?.select();
          });
        },
      },
      {
        id: "toggle-chat",
        label: isIdeChatOpen ? "Hide IDE Chat" : "Show IDE Chat",
        shortcut: "Ctrl/Cmd+\\",
        run: () => setIsIdeChatOpen((previous) => !previous),
      },
      {
        id: "new-terminal",
        label: "New Terminal",
        shortcut: "Ctrl/Cmd+Shift+`",
        run: () => openNewTerminal(),
      },
      {
        id: "toggle-terminal-panel",
        label: isTerminalPanelOpen ? "Hide Terminal Panel" : "Show Terminal Panel",
        shortcut: "Ctrl/Cmd+`",
        run: () => toggleTerminalPanel(),
      },
      {
        id: "refresh-workspace",
        label: "Refresh Workspace",
        run: () => handleRefresh(),
      },
      {
        id: "workspace-indexer",
        label: "Indexer Settings",
        run: () => {
          setShowIndexerSettings(true);
          setIndexSettingsError(null);
          setIndexSettingsDirty(false);
          void fetchIndexStatus(workspaceSearchPath);
        },
      },
      {
        id: "expand-folders",
        label: "Expand Top-Level Folders",
        run: () => handleExpandTopLevel(),
      },
      {
        id: "collapse-folders",
        label: "Collapse All Folders",
        run: () => handleCollapseAll(),
      },
      {
        id: "go-home",
        label: "Go Home Workspace",
        run: () => handleGoHome(),
      },
      {
        id: "cycle-tab-next",
        label: "Next Tab",
        shortcut: "Ctrl/Cmd+Tab",
        run: () => handleCycleTabs(1),
      },
      {
        id: "cycle-tab-prev",
        label: "Previous Tab",
        shortcut: "Ctrl/Cmd+Shift+Tab",
        run: () => handleCycleTabs(-1),
      },
    ],
    [
      currentPath,
      handleCollapseAll,
      handleCycleTabs,
      handleExpandTopLevel,
      handleGoHome,
      handleRefresh,
      handlePromptOpenWorkspace,
      fetchIndexStatus,
      isIdeChatOpen,
      isTerminalPanelOpen,
      openIdeSettings,
      openNewTerminal,
      openQuickOpenPalette,
      rootInfo?.path,
      toggleTerminalPanel,
      workspaceSearchPath,
    ]
  );

  const filteredCommandItems = useMemo(() => {
    const normalizedQuery = commandQuery.trim().toLowerCase();
    if (!normalizedQuery) return commandItems;
    return commandItems.filter((item) => {
      const haystack = `${item.label} ${item.detail || ""} ${item.shortcut || ""}`.toLowerCase();
      return haystack.includes(normalizedQuery);
    });
  }, [commandItems, commandQuery]);

  useEffect(() => {
    setCommandSelectedIndex((previous) =>
      filteredCommandItems.length ? Math.min(previous, filteredCommandItems.length - 1) : 0
    );
  }, [filteredCommandItems]);

  const handleCommandConfirm = useCallback(
    (index?: number) => {
      if (filteredCommandItems.length === 0) return;
      const safeIndex =
        typeof index === "number"
          ? Math.min(Math.max(index, 0), filteredCommandItems.length - 1)
          : Math.min(Math.max(commandSelectedIndex, 0), filteredCommandItems.length - 1);
      const selected = filteredCommandItems[safeIndex];
      if (!selected) return;
      selected.run();
      closeCommandPalette();
    },
    [closeCommandPalette, commandSelectedIndex, filteredCommandItems]
  );

  const handleGlobalPreviewReplace = useCallback(async () => {
    const query = globalSearchQuery.trim();
    if (!query || globalPreviewLoading) return;

    setGlobalPreviewLoading(true);
    setGlobalSearchError(null);
    try {
      const response = await apiFetch("/api/ide/replace/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          path: workspaceSearchPath,
          query,
          replacement: globalSearchReplace,
          caseSensitive: globalSearchCaseSensitive,
          wholeWord: globalSearchWholeWord,
          maxFiles: 120,
        }),
      });
      const data: IdeReplacePreviewResult = await response.json();
      if (!data.success) {
        setGlobalReplacePreview(null);
        setGlobalSearchError(data.error || "Preview failed");
      } else {
        setGlobalReplacePreview(data);
      }
    } catch (error) {
      setGlobalReplacePreview(null);
      setGlobalSearchError(String(error));
    } finally {
      setGlobalPreviewLoading(false);
    }
  }, [
    globalPreviewLoading,
    globalSearchCaseSensitive,
    globalSearchQuery,
    globalSearchReplace,
    globalSearchWholeWord,
    workspaceSearchPath,
  ]);

  const handleGlobalReplaceAll = useCallback(async () => {
    const query = globalSearchQuery.trim();
    if (!query || globalReplaceLoading) return;
    if (
      !globalReplacePreview ||
      globalReplacePreview.query !== query ||
      globalReplacePreview.replacement !== globalSearchReplace
    ) {
      setGlobalSearchError("Run Preview first, then Apply replace.");
      return;
    }

    setGlobalReplaceLoading(true);
    setGlobalSearchError(null);
    try {
      const response = await apiFetch("/api/ide/replace", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          path: workspaceSearchPath,
          query,
          replacement: globalSearchReplace,
          caseSensitive: globalSearchCaseSensitive,
          wholeWord: globalSearchWholeWord,
        }),
      });
      const data: IdeReplaceResult = await response.json();
      if (!data.success) {
        setGlobalSearchError(data.error || "Replace failed");
      } else {
        setRefreshKey((key) => key + 1);
        setGlobalReplacePreview(null);
      }
      await runGlobalSearch();
    } catch (error) {
      setGlobalSearchError(String(error));
    } finally {
      setGlobalReplaceLoading(false);
    }
  }, [
    globalReplaceLoading,
    globalReplacePreview,
    globalSearchCaseSensitive,
    globalSearchQuery,
    globalSearchReplace,
    globalSearchWholeWord,
    runGlobalSearch,
    workspaceSearchPath,
  ]);

  const openGlobalSearchPanel = useCallback(() => {
    setSidebarMode("search");
    window.requestAnimationFrame(() => {
      globalSearchInputRef.current?.focus();
      globalSearchInputRef.current?.select();
    });
  }, []);

  useEffect(() => {
    setGlobalReplacePreview(null);
  }, [
    globalSearchCaseSensitive,
    globalSearchQuery,
    globalSearchReplace,
    globalSearchWholeWord,
    workspaceSearchPath,
  ]);

  useEffect(() => {
    const handleGlobalSearchShortcut = (event: KeyboardEvent) => {
      if (showCommandPalette) {
        if (event.key === "ArrowDown") {
          event.preventDefault();
          setCommandSelectedIndex((previous) =>
            filteredCommandItems.length
              ? Math.min(previous + 1, filteredCommandItems.length - 1)
              : 0
          );
          return;
        }
        if (event.key === "ArrowUp") {
          event.preventDefault();
          setCommandSelectedIndex((previous) =>
            filteredCommandItems.length ? Math.max(previous - 1, 0) : 0
          );
          return;
        }
        if (event.key === "Enter") {
          event.preventDefault();
          handleCommandConfirm();
          return;
        }
        if (event.key === "Escape") {
          event.preventDefault();
          closeCommandPalette();
          return;
        }
        return;
      }

      const shellBinding = bindingFromEvent(event);
      const activeKeymap = resolveKeymap(keymapOverrides);
      const shellActions: Record<IdeActionId, () => void> = {
        commandPalette: openCommandPalette,
        quickOpen: openQuickOpenPalette,
        openSettings: () => openIdeSettings("general"),
        toggleTerminal: toggleTerminalPanel,
        newTerminal: openNewTerminal,
        searchInFiles: openGlobalSearchPanel,
        focusExplorer: () => setSidebarMode("explorer"),
        focusOutline: () => {
          setSidebarMode("outline");
          window.requestAnimationFrame(() => {
            outlineInputRef.current?.focus();
            outlineInputRef.current?.select();
          });
        },
        openWorkspace: () => {
          void handlePromptOpenWorkspace();
        },
        newFile: () => {
          setCreateParentPath(rootInfo?.path || currentPath);
          setCreateType("file");
        },
        toggleChat: () => setIsIdeChatOpen((previous) => !previous),
      };
      const matchedShellAction = (Object.keys(shellActions) as IdeActionId[]).find(
        (action) => activeKeymap[action] === shellBinding
      );
      if (matchedShellAction) {
        event.preventDefault();
        shellActions[matchedShellAction]();
        return;
      }

      if ((event.metaKey || event.ctrlKey) && event.key === "Tab") {
        event.preventDefault();
        if (event.shiftKey) {
          handleCycleTabs(-1);
        } else {
          handleCycleTabs(1);
        }
        return;
      }

      if ((event.metaKey || event.ctrlKey) && event.shiftKey && event.key.toLowerCase() === "n") {
        event.preventDefault();
        setCreateParentPath(rootInfo?.path || currentPath);
        setCreateType("directory");
        return;
      }

      if (event.key === "Escape" && openMenu) {
        event.preventDefault();
        setOpenMenu(null);
        return;
      }

      if (event.key === "Escape" && showQuickOpen) {
        event.preventDefault();
        closeQuickOpenPalette();
        return;
      }

      if (event.key === "Escape" && (sidebarMode === "search" || sidebarMode === "outline")) {
        event.preventDefault();
        setSidebarMode("explorer");
      }
    };

    window.addEventListener("keydown", handleGlobalSearchShortcut);
    return () => window.removeEventListener("keydown", handleGlobalSearchShortcut);
  }, [
    closeCommandPalette,
    closeQuickOpenPalette,
    currentPath,
    filteredCommandItems.length,
    handleCommandConfirm,
    handleCycleTabs,
    openMenu,
    openCommandPalette,
    openGlobalSearchPanel,
    handlePromptOpenWorkspace,
    openIdeSettings,
    openNewTerminal,
    openQuickOpenPalette,
    keymapOverrides,
    rootInfo?.path,
    sidebarMode,
    showCommandPalette,
    showQuickOpen,
    toggleTerminalPanel,
  ]);

  const applyKeymapOverride = useCallback((id: IdeActionId, binding: string) => {
    setKeymapOverrides((previous) => {
      const next = { ...previous, [id]: binding };
      persistKeymapOverrides(next);
      return next;
    });
  }, []);

  const resetKeymapAction = useCallback((id: IdeActionId) => {
    setKeymapOverrides((previous) => {
      if (!(id in previous)) return previous;
      const next = { ...previous };
      delete next[id];
      persistKeymapOverrides(next);
      return next;
    });
  }, []);

  const resetAllKeymap = useCallback(() => {
    setKeymapOverrides({});
    persistKeymapOverrides({});
  }, []);

  useEffect(() => {
    if (!recordingActionId) return;
    const capture = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopPropagation();
      if (event.key === "Escape") {
        setRecordingActionId(null);
        return;
      }
      if (["Shift", "Control", "Alt", "Meta"].includes(event.key)) return;
      applyKeymapOverride(recordingActionId, bindingFromEvent(event));
      setRecordingActionId(null);
    };
    window.addEventListener("keydown", capture, true);
    return () => window.removeEventListener("keydown", capture, true);
  }, [recordingActionId, applyKeymapOverride]);

  const handleSidebarResizeStart = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    const container = workspacePaneRef.current;
    if (!container) return;

    const onMouseMove = (moveEvent: MouseEvent) => {
      const bounds = container.getBoundingClientRect();
      const nextWidth = clampSidebarWidth(moveEvent.clientX - bounds.left);
      setSidebarWidth(nextWidth);
      persistSidebarWidth(nextWidth);
    };

    const onMouseUp = () => {
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
      document.body.style.userSelect = "";
      sidebarResizeCleanupRef.current = null;
    };

    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
    document.body.style.userSelect = "none";

    sidebarResizeCleanupRef.current = onMouseUp;
  }, []);

  const handleChatResizeStart = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    const container = workspacePaneRef.current;
    if (!container) return;

    const onMouseMove = (moveEvent: MouseEvent) => {
      const bounds = container.getBoundingClientRect();
      const nextWidth = clampChatWidth(bounds.right - moveEvent.clientX);
      setChatPanelWidth(nextWidth);
      persistChatWidth(nextWidth);
    };

    const onMouseUp = () => {
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
      document.body.style.userSelect = "";
      chatResizeCleanupRef.current = null;
    };

    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
    document.body.style.userSelect = "none";
    chatResizeCleanupRef.current = onMouseUp;
  }, []);

  const handleTerminalResizeStart = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      event.preventDefault();
      const container = workspacePaneRef.current;
      if (!container) return;

      const bounds = container.getBoundingClientRect();
      const startY = event.clientY;
      const startHeight = terminalPanelHeight;
      const maxHeight = Math.max(IDE_TERMINAL_MIN_HEIGHT, Math.floor(bounds.height * 0.72));

      const onMouseMove = (moveEvent: MouseEvent) => {
        const delta = startY - moveEvent.clientY;
        const nextHeight = Math.min(
          maxHeight,
          Math.max(IDE_TERMINAL_MIN_HEIGHT, startHeight + delta)
        );
        setTerminalPanelHeight(nextHeight);
        setIdePreferences((previous) => ({
          ...previous,
          terminalPanelHeight: clampTerminalHeight(nextHeight),
        }));
      };

      const onMouseUp = () => {
        document.removeEventListener("mousemove", onMouseMove);
        document.removeEventListener("mouseup", onMouseUp);
        document.body.style.userSelect = "";
        terminalResizeCleanupRef.current = null;
      };

      document.addEventListener("mousemove", onMouseMove);
      document.addEventListener("mouseup", onMouseUp);
      document.body.style.userSelect = "none";
      terminalResizeCleanupRef.current = onMouseUp;
    },
    [terminalPanelHeight]
  );

  useEffect(() => {
    return () => {
      sidebarResizeCleanupRef.current?.();
      chatResizeCleanupRef.current?.();
      terminalResizeCleanupRef.current?.();
    };
  }, []);

  useEffect(() => {
    persistChatOpen(isIdeChatOpen);
  }, [isIdeChatOpen]);

  useEffect(() => {
    persistWorkspacePath(currentPath);
  }, [currentPath]);

  useEffect(() => {
    if (!selectedFile?.path) {
      setGitHistoryStatus("idle");
    }
  }, [selectedFile?.path]);

  useEffect(() => {
    persistIdeChatAgentId(ideChatSelectedAgentId);
  }, [ideChatSelectedAgentId]);

  useEffect(() => {
    persistIdePreferences(idePreferences);
  }, [idePreferences]);

  useEffect(() => {
    persistOpenTabs(openTabs, activeTabPath);
  }, [openTabs, activeTabPath]);

  useEffect(() => {
    persistTerminalOpen(isTerminalPanelOpen);
  }, [isTerminalPanelOpen]);

  useEffect(() => {
    setTerminalPanelHeight(clampTerminalHeight(idePreferences.terminalPanelHeight));
  }, [idePreferences.terminalPanelHeight]);

  useEffect(() => {
    if (!openMenu) return;
    const handleClickAway = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (menuRef.current && target && !menuRef.current.contains(target)) {
        setOpenMenu(null);
      }
    };
    window.addEventListener("mousedown", handleClickAway);
    return () => window.removeEventListener("mousedown", handleClickAway);
  }, [openMenu]);

  useEffect(() => {
    if (!treeContextMenu) return;
    const handleClickAway = () => setTreeContextMenu(null);
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setTreeContextMenu(null);
      }
    };
    window.addEventListener("mousedown", handleClickAway);
    window.addEventListener("scroll", handleClickAway, true);
    window.addEventListener("keydown", handleEscape);
    return () => {
      window.removeEventListener("mousedown", handleClickAway);
      window.removeEventListener("scroll", handleClickAway, true);
      window.removeEventListener("keydown", handleEscape);
    };
  }, [treeContextMenu]);

  const activeTab = openTabs.find(
    (tab) => tab.path === (activeTabPath || selectedFile?.path || "")
  );
  const pendingEditorFiles = idePendingFileDiffController?.items || idePendingFileDiffs;
  const activePendingEditorFileIndex = useMemo(() => {
    if (pendingEditorFiles.length === 0) return -1;
    const activePath = selectedFile?.path || activeTabPath || null;
    if (!activePath) return 0;
    const matchingIndex = pendingEditorFiles.findIndex((file) =>
      isSameIdePath(activePath, file.path)
    );
    return matchingIndex >= 0 ? matchingIndex : 0;
  }, [activeTabPath, pendingEditorFiles, selectedFile?.path]);
  const activePendingEditorFile =
    activePendingEditorFileIndex >= 0
      ? pendingEditorFiles[activePendingEditorFileIndex] || null
      : null;
  const workspaceRootPath = rootInfo?.path || currentPath;
  const resolvedCompletionAgentId = useMemo(() => {
    if (idePreferences.useChatAgentForCompletions) {
      return ideChatSelectedAgentId || null;
    }
    const configuredAgentId = idePreferences.completionAgentId?.trim() || "";
    if (!configuredAgentId) return null;
    if (ideAgentOptions.some((agent) => agent.id === configuredAgentId)) {
      return configuredAgentId;
    }
    return null;
  }, [
    ideAgentOptions,
    ideChatSelectedAgentId,
    idePreferences.completionAgentId,
    idePreferences.useChatAgentForCompletions,
  ]);
  const openPendingEditorFile = useCallback(
    (nextIndex: number) => {
      if (pendingEditorFiles.length === 0) return;
      const boundedIndex = Math.max(0, Math.min(nextIndex, pendingEditorFiles.length - 1));
      const target = pendingEditorFiles[boundedIndex];
      if (!target?.path) return;
      openFileAtPath(target.path, null, false);
    },
    [openFileAtPath, pendingEditorFiles]
  );
  const getNeighborPendingEditorFile = useCallback(
    (currentIndex: number): IdePendingFileDiff | null =>
      pendingEditorFiles[currentIndex + 1] || pendingEditorFiles[currentIndex - 1] || null,
    [pendingEditorFiles]
  );
  const handleAcceptActivePendingEditorFile = useCallback(() => {
    if (!activePendingEditorFile || !idePendingFileDiffController) return;
    const nextTarget = getNeighborPendingEditorFile(activePendingEditorFileIndex);
    idePendingFileDiffController.acceptFile(activePendingEditorFile.key);
    if (nextTarget?.path) {
      openFileAtPath(nextTarget.path, null, false);
    }
  }, [
    activePendingEditorFile,
    activePendingEditorFileIndex,
    getNeighborPendingEditorFile,
    idePendingFileDiffController,
    openFileAtPath,
  ]);
  const handleRejectActivePendingEditorFile = useCallback(async () => {
    if (!activePendingEditorFile || !idePendingFileDiffController) return;
    const nextTarget = getNeighborPendingEditorFile(activePendingEditorFileIndex);
    await idePendingFileDiffController.rejectFile(activePendingEditorFile.key);
    if (nextTarget?.path) {
      openFileAtPath(nextTarget.path, null, false);
    }
  }, [
    activePendingEditorFile,
    activePendingEditorFileIndex,
    getNeighborPendingEditorFile,
    idePendingFileDiffController,
    openFileAtPath,
  ]);
  const breadcrumbs = useMemo<IdeBreadcrumb[]>(() => {
    if (!selectedFile?.path) return [];
    const filePath = selectedFile.path.replace(/\\/g, "/");
    const rootPath = (workspaceRootPath || "").replace(/\\/g, "/");

    if (rootPath && rootPath !== "~" && filePath.startsWith(rootPath)) {
      const relativePath = filePath.slice(rootPath.length).replace(/^\/+/, "");
      const segments = splitPathForBreadcrumbs(relativePath);
      const crumbs: IdeBreadcrumb[] = [
        {
          label: rootPath.split("/").filter(Boolean).pop() || rootPath,
          path: workspaceRootPath,
          isFile: false,
        },
      ];
      let cursorPath = rootPath;
      segments.forEach((segment, index) => {
        cursorPath = `${cursorPath}/${segment}`;
        crumbs.push({
          label: segment,
          path: cursorPath,
          isFile: index === segments.length - 1,
        });
      });
      return crumbs;
    }

    const segments = splitPathForBreadcrumbs(filePath);
    return segments.map((segment, index) => {
      const path = filePath
        .split("/")
        .slice(0, index + 1)
        .join("/");
      return {
        label: segment,
        path,
        isFile: index === segments.length - 1,
      };
    });
  }, [selectedFile?.path, workspaceRootPath]);
  const flattenedOutlineRows = useMemo(
    () => flattenOutlineSymbols(outlineSymbols),
    [outlineSymbols]
  );
  const filteredOutlineRows = useMemo(() => {
    const query = outlineFilter.trim().toLowerCase();
    if (!query) return flattenedOutlineRows;
    return flattenedOutlineRows.filter((row) => {
      const haystack = `${row.name} ${row.detail || ""}`.toLowerCase();
      return haystack.includes(query);
    });
  }, [flattenedOutlineRows, outlineFilter]);
  const statusLanguage = selectedFile?.extension ? getPrismLanguage(selectedFile.extension) : null;
  const statusEncoding = selectedFile ? "UTF-8" : null;
  const statusEol = selectedFile ? "LF" : null;
  const statusIndent = selectedFile ? "Spaces: 2" : null;
  const gitHistoryStatusLabel = useMemo(() => {
    if (!selectedFile?.path) return null;
    if (gitHistoryStatus === "loading") return "Git blame: loading";
    if (gitHistoryStatus === "ready") return "Git blame: ready";
    if (gitHistoryStatus === "unavailable") return "Git blame: not tracked";
    if (gitHistoryStatus === "error") return "Git blame: error";
    return null;
  }, [gitHistoryStatus, selectedFile?.path]);
  const contextMenuPosition = treeContextMenu
    ? {
        left:
          typeof window !== "undefined"
            ? Math.min(treeContextMenu.x, Math.max(window.innerWidth - 260, 8))
            : treeContextMenu.x,
        top:
          typeof window !== "undefined"
            ? Math.min(treeContextMenu.y, Math.max(window.innerHeight - 320, 8))
            : treeContextMenu.y,
      }
    : null;
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
  const normalizedSettingsSearch = ideSettingsSearch.trim().toLowerCase();
  const matchesIdeSettingsSearch = (...parts: string[]) => {
    if (!normalizedSettingsSearch) return true;
    return parts.join(" ").toLowerCase().includes(normalizedSettingsSearch);
  };
  const settingsSections: Array<{ id: IdeSettingsSectionId; label: string; description: string }> =
    [
      { id: "general", label: "General", description: "Workspace and layout defaults" },
      { id: "editor", label: "Editor", description: "Font, line-height, minimap" },
      { id: "indexing", label: "Indexing", description: "Workspace index and semantic search" },
      { id: "shortcuts", label: "Shortcuts", description: "Customize keyboard shortcuts" },
      { id: "terminal", label: "Terminal", description: "Integrated terminal behavior" },
    ];
  const visibleSettingsSectionIds = useMemo(() => {
    if (!normalizedSettingsSearch) return settingsSections.map((section) => section.id);
    return settingsSections
      .filter((section) =>
        [section.label, section.description]
          .join(" ")
          .toLowerCase()
          .includes(normalizedSettingsSearch)
      )
      .map((section) => section.id);
  }, [normalizedSettingsSearch, settingsSections]);
  const terminalCapabilityLabel =
    terminalPanelState.capability === "checking"
      ? "Checking..."
      : terminalPanelState.capability === "enabled"
        ? "Enabled"
        : "Disabled";

  useEffect(() => {
    if (!showIdeSettings) return;
    if (visibleSettingsSectionIds.length === 0) return;
    if (!visibleSettingsSectionIds.includes(ideSettingsSection)) {
      setIdeSettingsSection(visibleSettingsSectionIds[0] || "general");
    }
  }, [ideSettingsSection, showIdeSettings, visibleSettingsSectionIds]);

  const topMenus = useMemo<
    Array<{
      id: IdeTopMenuId;
      label: string;
      widthClassName?: string;
      items: Array<{
        id: string;
        label: string;
        shortcut?: string;
        dividerAbove?: boolean;
        run: () => void;
      }>;
    }>
  >(
    () => [
      {
        id: "file",
        label: "File",
        widthClassName: "w-72",
        items: [
          {
            id: "save",
            label: "Save",
            shortcut: "Ctrl/Cmd+S",
            run: () => setSaveRequestToken((previous) => previous + 1),
          },
          {
            id: "new-file",
            label: "New File",
            shortcut: "Ctrl/Cmd+N",
            dividerAbove: true,
            run: () => {
              setCreateParentPath(rootInfo?.path || currentPath);
              setCreateType("file");
            },
          },
          {
            id: "new-folder",
            label: "New Folder",
            shortcut: "Ctrl/Cmd+Shift+N",
            run: () => {
              setCreateParentPath(rootInfo?.path || currentPath);
              setCreateType("directory");
            },
          },
          {
            id: "open-workspace",
            label: "Open Workspace Folder",
            shortcut: "Ctrl/Cmd+O",
            run: () => {
              void handlePromptOpenWorkspace();
            },
          },
          {
            id: "refresh-workspace",
            label: "Refresh Workspace",
            dividerAbove: true,
            run: () => handleRefresh(),
          },
          {
            id: "ide-settings",
            label: "IDE Settings",
            shortcut: "Ctrl/Cmd+,",
            run: () => openIdeSettings("general"),
          },
        ],
      },
      {
        id: "edit",
        label: "Edit",
        widthClassName: "w-72",
        items: [
          {
            id: "command-palette",
            label: "Command Palette",
            shortcut: "Ctrl/Cmd+Shift+P",
            run: () => openCommandPalette(),
          },
          {
            id: "quick-open",
            label: "Quick Open",
            shortcut: "Ctrl/Cmd+P",
            run: () => openQuickOpenPalette(),
          },
          {
            id: "global-search",
            label: "Search in Workspace",
            shortcut: "Ctrl/Cmd+Shift+F",
            dividerAbove: true,
            run: () => openGlobalSearchPanel(),
          },
        ],
      },
      {
        id: "view",
        label: "View",
        widthClassName: "w-72",
        items: [
          {
            id: "show-explorer",
            label: "Show Explorer",
            shortcut: "Ctrl/Cmd+Shift+E",
            run: () => setSidebarMode("explorer"),
          },
          {
            id: "show-search",
            label: "Show Search",
            shortcut: "Ctrl/Cmd+Shift+F",
            run: () => openGlobalSearchPanel(),
          },
          {
            id: "show-outline",
            label: "Show Outline",
            shortcut: "Ctrl/Cmd+Shift+O",
            run: () => {
              setSidebarMode("outline");
              window.requestAnimationFrame(() => {
                outlineInputRef.current?.focus();
                outlineInputRef.current?.select();
              });
            },
          },
          {
            id: "toggle-chat",
            label: isIdeChatOpen ? "Hide IDE Chat" : "Show IDE Chat",
            shortcut: "Ctrl/Cmd+\\",
            dividerAbove: true,
            run: () => setIsIdeChatOpen((previous) => !previous),
          },
        ],
      },
      {
        id: "terminal",
        label: "Terminal",
        widthClassName: "w-72",
        items: [
          {
            id: "toggle-terminal",
            label: isTerminalPanelOpen ? "Hide Terminal Panel" : "Show Terminal Panel",
            shortcut: "Ctrl/Cmd+`",
            run: () => toggleTerminalPanel(),
          },
          {
            id: "new-terminal",
            label: "New Terminal",
            shortcut: "Ctrl/Cmd+Shift+`",
            run: () => openNewTerminal(),
          },
        ],
      },
      {
        id: "go",
        label: "Go",
        widthClassName: "w-72",
        items: [
          {
            id: "next-tab",
            label: "Next Tab",
            shortcut: "Ctrl/Cmd+Tab",
            run: () => handleCycleTabs(1),
          },
          {
            id: "previous-tab",
            label: "Previous Tab",
            shortcut: "Ctrl/Cmd+Shift+Tab",
            run: () => handleCycleTabs(-1),
          },
          {
            id: "go-home",
            label: "Go Home Workspace",
            dividerAbove: true,
            run: () => handleGoHome(),
          },
        ],
      },
    ],
    [
      currentPath,
      handleCycleTabs,
      handleGoHome,
      handlePromptOpenWorkspace,
      handleRefresh,
      isIdeChatOpen,
      isTerminalPanelOpen,
      openCommandPalette,
      openGlobalSearchPanel,
      openIdeSettings,
      openNewTerminal,
      openQuickOpenPalette,
      rootInfo?.path,
      toggleTerminalPanel,
    ]
  );

  return (
    <div className="h-screen max-md:h-[calc(100vh-3.5rem)] flex min-w-0 flex-col overflow-hidden bg-[#050508]">
      <div
        ref={menuRef}
        className="h-8 px-2 max-md:pr-14 border-b border-white/10 bg-white/[0.02] flex min-w-0 items-center justify-between text-xs"
      >
        <div className="hidden items-center gap-1 relative md:flex">
          {topMenus.map((menu) => (
            <div key={`top-menu:${menu.id}`} className="relative">
              <button
                type="button"
                onClick={() => setOpenMenu((previous) => (previous === menu.id ? null : menu.id))}
                className={cn(
                  "px-2 py-1 rounded text-gray-300 hover:bg-white/5",
                  openMenu === menu.id && "bg-white/10"
                )}
              >
                {menu.label}
              </button>
              {openMenu === menu.id && (
                <div
                  className={cn(
                    "absolute top-full left-0 mt-1 rounded-md border border-white/10 bg-[#0a0a10] shadow-xl z-40 overflow-hidden",
                    menu.widthClassName || "w-72"
                  )}
                >
                  {menu.items.map((item) => (
                    <div key={`top-menu-item:${menu.id}:${item.id}`}>
                      {item.dividerAbove && <div className="h-px bg-white/10" />}
                      <button
                        type="button"
                        onClick={() => {
                          item.run();
                          setOpenMenu(null);
                        }}
                        className="w-full text-left px-3 py-2 text-gray-200 hover:bg-white/5 text-sm flex items-center justify-between gap-3"
                      >
                        <span>{item.label}</span>
                        {item.shortcut ? (
                          <span className="text-xs text-gray-500">{item.shortcut}</span>
                        ) : (
                          <span />
                        )}
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
        <div className="ml-auto flex min-w-0 max-w-full items-center gap-1 md:gap-2 md:max-w-[70vw]">
          <div
            className="min-w-0 flex-1 truncate text-gray-500"
            title={rootInfo?.path || currentPath}
          >
            {(rootInfo?.path || currentPath)
              .replace(/^\/Users\/[^/]+/, "~")
              .replace(/^C:\\Users\\[^\\]+/, "~")}
          </div>
          <button
            type="button"
            onClick={() => toggleTerminalPanel()}
            className={cn(
              "px-2 py-1 rounded text-xs border transition-colors flex items-center justify-center gap-1 max-md:h-7 max-md:w-7 max-md:px-0",
              isTerminalPanelOpen
                ? "border-indigo-500/40 bg-indigo-500/20 text-indigo-200"
                : "border-white/10 text-gray-400 hover:text-gray-200 hover:bg-white/5"
            )}
            title={isTerminalPanelOpen ? "Hide terminal panel" : "Show terminal panel"}
          >
            <TerminalSquare className="w-3.5 h-3.5" />
            <span className="max-md:hidden">Terminal</span>
          </button>
          <button
            type="button"
            onClick={() => setIsIdeChatOpen((previous) => !previous)}
            className={cn(
              "px-2 py-1 rounded text-xs border transition-colors flex items-center justify-center gap-1 max-md:h-7 max-md:w-7 max-md:px-0",
              isIdeChatOpen
                ? "border-indigo-500/40 bg-indigo-500/20 text-indigo-200"
                : "border-white/10 text-gray-400 hover:text-gray-200 hover:bg-white/5"
            )}
            title={isIdeChatOpen ? "Hide IDE chat panel" : "Show IDE chat panel"}
          >
            <MessageSquare className="w-3.5 h-3.5" />
            <span className="max-md:hidden">Chat</span>
          </button>
          <button
            type="button"
            onClick={() => openIdeSettings("general")}
            className="px-2 py-1 rounded text-xs border border-white/10 text-gray-400 hover:text-gray-200 hover:bg-white/5 transition-colors flex items-center justify-center gap-1 max-md:h-7 max-md:w-7 max-md:px-0"
            title="Open IDE settings"
          >
            <Settings2 className="w-3.5 h-3.5" />
            <span className="max-md:hidden">Settings</span>
          </button>
        </div>
      </div>

      <div className="flex-1 flex min-w-0 overflow-hidden" ref={workspacePaneRef}>
        <div
          className="hidden border-r border-white/10 flex-col overflow-hidden bg-white/[0.01] relative md:flex"
          style={{ width: `${sidebarWidth}px` }}
        >
          <div className="px-3 py-2 border-b border-white/10 bg-white/5 text-xs uppercase tracking-wide text-gray-500">
            {sidebarMode === "search"
              ? "Search"
              : sidebarMode === "outline"
                ? "Outline"
                : "Explorer"}
          </div>

          {sidebarMode === "explorer" ? (
            <>
              <div className="px-3 py-2 border-b border-white/10 bg-white/5">
                <div className="flex items-center gap-2">
                  <Button variant="ghost" size="sm" onClick={handleGoHome} className="p-1 h-6 w-6">
                    <Home className="w-3.5 h-3.5" />
                  </Button>
                  {rootInfo?.parent && (
                    <Button variant="ghost" size="sm" onClick={handleGoUp} className="p-1">
                      <ChevronRight className="w-4 h-4 rotate-180" />
                    </Button>
                  )}
                  <span className="text-xs text-gray-400 truncate flex-1" title={rootInfo?.path}>
                    {rootInfo?.path
                      ?.replace(/^\/Users\/[^/]+/, "~")
                      .replace(/^C:\\Users\\[^\\]+/, "~") || currentPath}
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setCreateParentPath(rootInfo?.path || currentPath);
                      setCreateType("file");
                    }}
                    className="p-1"
                    title="New File"
                  >
                    <FilePlus className="w-4 h-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setCreateParentPath(rootInfo?.path || currentPath);
                      setCreateType("directory");
                    }}
                    className="p-1"
                    title="New Folder"
                  >
                    <FolderPlus className="w-4 h-4" />
                  </Button>
                </div>
                <div className="mt-2 flex items-center gap-1">
                  <div className="flex items-center flex-1 px-2 py-1 rounded-md border border-white/10 bg-black/20">
                    <Search className="w-3.5 h-3.5 text-gray-500 mr-1.5" />
                    <input
                      ref={treeFilterInputRef}
                      type="text"
                      value={treeFilterDraft}
                      onChange={(event) => updateTreeFilter(event.target.value)}
                      placeholder="Filter files"
                      className="w-full bg-transparent text-xs text-gray-200 placeholder-gray-600 !outline-none"
                    />
                    {isTreeFilterPending && (
                      <Loader2 className="h-3 w-3 animate-spin text-gray-500" />
                    )}
                    {treeFilterDraft.trim() && (
                      <button
                        type="button"
                        onClick={() => updateTreeFilter("")}
                        className="text-gray-500 hover:text-gray-300"
                        title="Clear filter"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    )}
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleExpandTopLevel}
                    className="p-1 h-7 w-7"
                    title="Expand top-level folders"
                  >
                    <FolderOpen className="w-3.5 h-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleCollapseAll}
                    className="p-1 h-7 w-7"
                    title="Collapse all folders"
                  >
                    <Folder className="w-3.5 h-3.5" />
                  </Button>
                </div>
              </div>

              <div
                ref={explorerScrollRef}
                className="flex-1 overflow-y-auto py-2"
                key={refreshKey}
                onScroll={(event) => {
                  const element = event.currentTarget;
                  setExplorerScrollTop(element.scrollTop);
                  setExplorerViewportHeight(element.clientHeight);
                }}
              >
                <FileTree
                  path={rootInfo?.path || currentPath}
                  selectedPath={selectedFile?.path || null}
                  onSelectFile={handleSelectFile}
                  onContextMenu={handleTreeContextMenu}
                  expandedDirs={expandedDirs}
                  onToggleDir={handleToggleDir}
                  filterQuery={deferredTreeFilter}
                  refreshToken={refreshKey}
                  rootScrollTop={explorerScrollTop}
                  rootViewportHeight={explorerViewportHeight}
                />
              </div>
            </>
          ) : sidebarMode === "outline" ? (
            <div className="flex-1 flex flex-col overflow-hidden bg-[#0a0a10]">
              <div className="p-3 border-b border-white/10 space-y-2">
                <input
                  ref={outlineInputRef}
                  type="text"
                  value={outlineFilter}
                  onChange={(event) => setOutlineFilter(event.target.value)}
                  placeholder="Filter symbols"
                  className="w-full px-2.5 py-1.5 rounded border border-white/10 bg-black/40 text-sm text-gray-200 !outline-none focus:border-indigo-500/40"
                />
                <div className="text-[11px] text-gray-500 flex items-center justify-between">
                  <span className="inline-flex items-center gap-1">
                    <ListTree className="w-3 h-3" />
                    {selectedFile?.name || "No file selected"}
                  </span>
                  <span>{flattenedOutlineRows.length} symbols</span>
                </div>
              </div>

              {outlineError && (
                <div className="px-3 py-2 border-b border-red-500/20 bg-red-500/10 text-xs text-red-300">
                  {outlineError}
                </div>
              )}

              <div className="flex-1 overflow-y-auto py-2">
                {outlineLoading ? (
                  <div className="text-center py-6 text-gray-500">
                    <Loader2 className="w-4 h-4 animate-spin mx-auto mb-2" />
                    Loading outline...
                  </div>
                ) : !selectedFile ? (
                  <div className="px-3 py-6 text-sm text-gray-500">
                    Open a file to view symbols.
                  </div>
                ) : filteredOutlineRows.length > 0 ? (
                  filteredOutlineRows.map((symbol) => (
                    <button
                      key={symbol.key}
                      type="button"
                      onClick={() => openFileAtPath(selectedFile.path, symbol.line)}
                      className="w-full text-left px-2 py-1.5 hover:bg-white/5 transition-colors"
                      style={{ paddingLeft: `${symbol.depth * 14 + 8}px` }}
                      title={`Line ${symbol.line}${symbol.detail ? ` · ${symbol.detail}` : ""}`}
                    >
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] px-1.5 py-0.5 rounded border border-white/10 text-gray-500">
                          {getSymbolKindLabel(symbol.kind)}
                        </span>
                        <span className="text-xs text-gray-200 truncate">{symbol.name}</span>
                      </div>
                      <div className="text-[10px] text-gray-500 truncate">
                        Ln {symbol.line}
                        {symbol.detail ? ` · ${symbol.detail}` : ""}
                      </div>
                    </button>
                  ))
                ) : (
                  <div className="px-3 py-6 text-sm text-gray-500">
                    {outlineFilter.trim()
                      ? "No matching symbols."
                      : "No symbols found for this file."}
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="flex-1 flex flex-col overflow-hidden bg-[#0a0a10]">
              <div className="p-3 border-b border-white/10 space-y-2">
                <input
                  ref={globalSearchInputRef}
                  type="text"
                  value={globalSearchQuery}
                  onChange={(event) => setGlobalSearchQuery(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      void runGlobalSearch();
                    }
                  }}
                  placeholder="Find in workspace"
                  className="w-full px-2.5 py-1.5 rounded border border-white/10 bg-black/40 text-sm text-gray-200 !outline-none focus:border-indigo-500/40"
                />
                <input
                  type="text"
                  value={globalSearchReplace}
                  onChange={(event) => setGlobalSearchReplace(event.target.value)}
                  placeholder="Replace with"
                  className="w-full px-2.5 py-1.5 rounded border border-white/10 bg-black/40 text-sm text-gray-200 !outline-none focus:border-indigo-500/40"
                />
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setGlobalSearchCaseSensitive((previous) => !previous)}
                    className={cn(
                      "px-2 py-1 rounded text-[11px] border transition-colors",
                      globalSearchCaseSensitive
                        ? "border-indigo-500/40 bg-indigo-500/20 text-indigo-300"
                        : "border-white/10 text-gray-500 hover:text-gray-300"
                    )}
                  >
                    Case
                  </button>
                  <button
                    type="button"
                    onClick={() => setGlobalSearchWholeWord((previous) => !previous)}
                    className={cn(
                      "px-2 py-1 rounded text-[11px] border transition-colors",
                      globalSearchWholeWord
                        ? "border-indigo-500/40 bg-indigo-500/20 text-indigo-300"
                        : "border-white/10 text-gray-500 hover:text-gray-300"
                    )}
                  >
                    Word
                  </button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => void runGlobalSearch()}
                    disabled={globalSearchLoading}
                    className="h-7 px-2"
                  >
                    {globalSearchLoading ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Search className="w-3.5 h-3.5" />
                    )}
                    <span className="ml-1 text-xs">Search</span>
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => void handleGlobalPreviewReplace()}
                    disabled={globalPreviewLoading || !globalSearchQuery.trim()}
                    className="h-7 px-2 text-indigo-300 hover:text-indigo-200"
                  >
                    {globalPreviewLoading ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Eye className="w-3.5 h-3.5" />
                    )}
                    <span className="ml-1 text-xs">Preview</span>
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => void handleGlobalReplaceAll()}
                    disabled={
                      globalReplaceLoading ||
                      !globalSearchQuery.trim() ||
                      !globalReplacePreview ||
                      globalReplacePreview.query !== globalSearchQuery.trim() ||
                      globalReplacePreview.replacement !== globalSearchReplace
                    }
                    className="h-7 px-2 text-amber-300 hover:text-amber-200 disabled:text-gray-600"
                  >
                    {globalReplaceLoading ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Zap className="w-3.5 h-3.5" />
                    )}
                    <span className="ml-1 text-xs">Apply</span>
                  </Button>
                </div>
              </div>

              <div className="px-3 py-2 border-b border-white/10 text-xs text-gray-500 flex items-center justify-between">
                <span>
                  {globalSearchResults
                    ? [
                        `${globalSearchResults.totalMatches} matches in ${globalSearchResults.files.length} files`,
                        formatIdeScannedFiles(globalSearchResults.filesScanned),
                      ]
                        .filter(Boolean)
                        .join(" · ")
                    : "No results"}
                </span>
                <div className="flex items-center gap-2">
                  {globalReplacePreview && (
                    <span className="text-indigo-300">
                      Preview: {globalReplacePreview.totalReplacements}
                    </span>
                  )}
                  {globalSearchResults?.scanTruncated && (
                    <span
                      className="text-amber-300"
                      title="The filesystem scan hit its safety limit before visiting every candidate file."
                    >
                      Scan limited
                    </span>
                  )}
                  {globalSearchResults?.truncated && !globalSearchResults.scanTruncated && (
                    <span className="text-amber-300">Match limit reached</span>
                  )}
                </div>
              </div>

              {globalSearchError && (
                <div className="px-3 py-2 border-b border-red-500/20 bg-red-500/10 text-xs text-red-300">
                  {globalSearchError}
                </div>
              )}

              <div className="flex-1 overflow-y-auto p-2 space-y-2">
                {globalReplacePreview && (
                  <div className="rounded border border-indigo-500/30 bg-indigo-500/10 overflow-hidden">
                    <div className="px-2 py-1 border-b border-indigo-500/20 text-[11px] text-indigo-200 flex items-center justify-between">
                      <span>
                        Replace Preview: {globalReplacePreview.totalReplacements} replacements in{" "}
                        {globalReplacePreview.files.length} files
                        {formatIdeScannedFiles(globalReplacePreview.filesScanned)
                          ? ` · ${formatIdeScannedFiles(globalReplacePreview.filesScanned)}`
                          : ""}
                      </span>
                      {globalReplacePreview.scanTruncated ? (
                        <span
                          className="text-amber-300"
                          title="The filesystem scan hit its safety limit before visiting every candidate file."
                        >
                          Scan limited
                        </span>
                      ) : globalReplacePreview.truncated ? (
                        <span className="text-amber-300">Preview limited</span>
                      ) : null}
                    </div>
                    <div className="max-h-56 overflow-y-auto divide-y divide-indigo-500/10">
                      {globalReplacePreview.files.map((file) => (
                        <div key={`preview:${file.file}`} className="px-2 py-1.5">
                          <div className="text-[11px] text-indigo-100 truncate" title={file.file}>
                            {file.file}{" "}
                            <span className="text-indigo-300">({file.replacements})</span>
                          </div>
                          <div className="mt-1 space-y-1">
                            {file.preview.map((line) => (
                              <div
                                key={`${file.file}:${line.line}:${line.before}`}
                                className="text-[11px] font-mono"
                              >
                                <div className="text-red-300 truncate">
                                  - Ln {line.line}: {line.before}
                                </div>
                                <div className="text-emerald-300 truncate">
                                  + Ln {line.line}: {line.after}
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {globalSearchLoading ? (
                  <div className="text-center py-6 text-gray-500">
                    <Loader2 className="w-4 h-4 animate-spin mx-auto mb-2" />
                    Searching...
                  </div>
                ) : globalSearchResults?.files?.length ? (
                  globalSearchResults.files.map((file) => (
                    <div
                      key={file.file}
                      className="rounded border border-white/10 bg-white/[0.02] overflow-hidden"
                    >
                      <div className="px-2 py-1 border-b border-white/10 text-[11px] text-gray-300 flex items-center justify-between gap-2">
                        <span className="truncate" title={file.file}>
                          {file.file}
                        </span>
                        <span className="text-gray-500">{file.count}</span>
                      </div>
                      <div className="divide-y divide-white/5">
                        {file.matches.map((match, index) => (
                          <button
                            key={`${file.file}:${match.line}:${match.column}:${index}`}
                            type="button"
                            onClick={() => openGlobalSearchMatch(file.file, match.line)}
                            className="w-full text-left px-2 py-1.5 hover:bg-white/5 transition-colors"
                          >
                            <div className="text-[11px] text-indigo-300">
                              Ln {match.line}, Col {match.column}
                            </div>
                            <div className="text-[12px] text-gray-300 font-mono truncate">
                              {match.text}
                            </div>
                          </button>
                        ))}
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="text-center py-6 text-gray-500 text-sm">
                    Run a search with <code>Ctrl/Cmd+Shift+F</code>.
                  </div>
                )}
              </div>
            </div>
          )}

          <div
            role="separator"
            aria-label="Resize file tree"
            aria-orientation="vertical"
            onMouseDown={handleSidebarResizeStart}
            className="absolute top-0 right-0 hidden h-full w-1.5 cursor-col-resize bg-transparent hover:bg-indigo-500/40 transition-colors md:block"
          />
        </div>

        <div className="flex-1 flex min-w-0 overflow-hidden bg-[#0d0d12]">
          <div className="flex-1 flex flex-col overflow-hidden min-w-0">
            <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
              <div
                className="h-9 border-b border-white/10 bg-black/20 flex items-center overflow-x-auto"
                style={{
                  fontFamily: "var(--font-zed-ui), var(--font-ui), Inter, system-ui, sans-serif",
                }}
              >
                {openTabs.length > 0 ? (
                  openTabs.map((tab) => {
                    const isActive = (activeTabPath || selectedFile?.path) === tab.path;
                    return (
                      <div
                        key={`tab:${tab.path}`}
                        className={cn(
                          "h-full min-w-[160px] max-w-[320px] px-3 border-r border-white/10 flex items-center gap-2 text-xs",
                          isActive
                            ? "bg-indigo-500/20 text-indigo-200"
                            : "bg-transparent text-gray-400 hover:text-gray-200 hover:bg-white/5"
                        )}
                      >
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedFile(fileEntryFromPath(tab.path));
                            setActiveTabPath(tab.path);
                            setRequestedJumpLine(null);
                          }}
                          className="flex-1 min-w-0 truncate text-left"
                          title={tab.path}
                        >
                          {tab.previewMode && (
                            <Eye className="w-3 h-3 text-indigo-300/80 flex-shrink-0" />
                          )}
                          {tab.name}
                        </button>
                        <button
                          type="button"
                          onClick={() => handleCloseTab(tab.path)}
                          className="p-0.5 rounded text-gray-500 hover:text-gray-300 hover:bg-white/10"
                          title="Close tab"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </div>
                    );
                  })
                ) : (
                  <div className="h-full min-w-[160px] max-w-[320px] px-3 border-r border-white/10 flex items-center gap-2 text-xs bg-indigo-500/20 text-indigo-200">
                    <Code className="w-3.5 h-3.5" />
                    <span>Welcome</span>
                  </div>
                )}
              </div>

              <div className="h-8 border-b border-white/10 bg-black/25 px-2 flex items-center gap-1 overflow-x-auto">
                {breadcrumbs.length > 0 ? (
                  breadcrumbs.map((crumb, index) => (
                    <div key={`crumb:${crumb.path}`} className="flex items-center gap-1 min-w-0">
                      {index > 0 && (
                        <ChevronRight className="w-3 h-3 text-gray-600 flex-shrink-0" />
                      )}
                      <button
                        type="button"
                        onClick={() => handleNavigateToBreadcrumb(crumb)}
                        className={cn(
                          "px-1.5 py-0.5 rounded text-xs truncate",
                          crumb.isFile
                            ? "text-indigo-200 bg-indigo-500/15"
                            : "text-gray-400 hover:text-gray-200 hover:bg-white/5"
                        )}
                        title={crumb.path}
                      >
                        {crumb.label}
                      </button>
                    </div>
                  ))
                ) : (
                  <span className="text-xs text-gray-600 px-1">No file selected</span>
                )}
              </div>

              {selectedFile?.path ? (
                <div className="relative flex-1 min-h-0 flex flex-col overflow-hidden">
                  <ErrorBoundary
                    onReset={() => {
                      setSelectedFile(null);
                      setRefreshKey((k) => k + 1);
                    }}
                  >
                    <CodeViewer
                      path={selectedFile.path}
                      previewMode={activeTab?.previewMode === true}
                      autoRefresh={true}
                      jumpToLineRequest={requestedJumpLine}
                      externalRefreshKey={refreshKey}
                      saveRequestToken={saveRequestToken}
                      onSaveSuccess={handleRefresh}
                      onCursorChange={handleCursorPositionChange}
                      onGitHistoryStatusChange={setGitHistoryStatus}
                      onOpenLocation={(filePath, line) => {
                        openFileAtPath(filePath, line, false);
                      }}
                      completionAgentId={resolvedCompletionAgentId}
                      editorFontSizePx={idePreferences.editorFontSizePx}
                      editorLineHeightPx={idePreferences.editorLineHeightPx}
                      showMinimap={idePreferences.showMinimap}
                      enableCompletions={false}
                      enableGhostCompletions={false}
                      pendingFileDiffs={idePendingFileDiffs}
                    />
                  </ErrorBoundary>
                  {activePendingEditorFile && idePendingFileDiffController && (
                    <div className="pointer-events-none absolute inset-x-0 bottom-4 z-30 flex justify-center px-4">
                      <div className="pointer-events-auto inline-flex max-w-[calc(100%-2rem)] items-center gap-2 rounded-full border border-white/10 bg-[#0b0f19]/95 px-3 py-2 shadow-[0_18px_45px_rgba(0,0,0,0.42)] backdrop-blur">
                        <button
                          type="button"
                          onClick={() => openPendingEditorFile(activePendingEditorFileIndex - 1)}
                          disabled={activePendingEditorFileIndex <= 0}
                          className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-white/10 text-gray-300 hover:bg-white/5 disabled:opacity-40"
                          title="Previous pending file"
                        >
                          <ChevronRight className="h-4 w-4 rotate-180" />
                        </button>
                        <div className="min-w-0 px-1 text-center">
                          <div
                            className="max-w-[32vw] truncate text-[11px] font-medium text-gray-100"
                            title={activePendingEditorFile.path}
                          >
                            {activePendingEditorFile.path}
                          </div>
                          <div className="text-[10px] text-gray-500">
                            File {activePendingEditorFileIndex + 1} of {pendingEditorFiles.length} ·{" "}
                            <span className="text-emerald-300">
                              +{activePendingEditorFile.added}
                            </span>{" "}
                            <span className="text-red-300">-{activePendingEditorFile.removed}</span>
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => void handleRejectActivePendingEditorFile()}
                          className="inline-flex h-8 items-center gap-1 rounded-full border border-red-500/30 bg-red-500/10 px-3 text-[11px] text-red-200 hover:bg-red-500/20"
                          title="Reject changes for this file"
                        >
                          <RotateCcw className="h-3.5 w-3.5" />
                          Reject Changes
                        </button>
                        <button
                          type="button"
                          onClick={handleAcceptActivePendingEditorFile}
                          className="inline-flex h-8 items-center gap-1 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 text-[11px] text-emerald-200 hover:bg-emerald-500/20"
                          title="Accept changes for this file"
                        >
                          <Check className="h-3.5 w-3.5" />
                          Accept Changes
                        </button>
                        <button
                          type="button"
                          onClick={() => openPendingEditorFile(activePendingEditorFileIndex + 1)}
                          disabled={
                            activePendingEditorFileIndex < 0 ||
                            activePendingEditorFileIndex >= pendingEditorFiles.length - 1
                          }
                          className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-white/10 text-gray-300 hover:bg-white/5 disabled:opacity-40"
                          title="Next pending file"
                        >
                          <ChevronRight className="h-4 w-4" />
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <IDEWelcomeScreen
                  workspacePath={effectiveWorkspacePath}
                  onNewFile={() => {
                    setCreateParentPath(rootInfo?.path || currentPath);
                    setCreateType("file");
                  }}
                  onOpenWorkspace={() => {
                    void handlePromptOpenWorkspace();
                  }}
                  onOpenCommandPalette={openCommandPalette}
                  onOpenSettings={() => openIdeSettings("general")}
                  onOpenAiSettings={() => navigate("/providers")}
                  onOpenIndexerSettings={() => {
                    openIdeSettings("indexing");
                  }}
                />
              )}
            </div>

            {isTerminalPanelOpen && (
              <div
                role="separator"
                aria-label="Resize terminal panel"
                aria-orientation="horizontal"
                onMouseDown={handleTerminalResizeStart}
                className="h-1.5 cursor-row-resize bg-transparent hover:bg-indigo-500/40 transition-colors"
              />
            )}

            <div
              className={cn(
                "border-t border-white/10 bg-[#050508] overflow-hidden transition-[height] duration-150",
                !isTerminalPanelOpen && "border-transparent"
              )}
              style={{ height: isTerminalPanelOpen ? `${terminalPanelHeight}px` : "0px" }}
            >
              <EmbeddedTerminalPanel
                workspacePath={effectiveWorkspacePath}
                visible={isTerminalPanelOpen}
                createRequestToken={terminalCreateRequestToken}
                autoCreateOnVisible={idePreferences.autoCreateTerminalOnOpen}
                onStateChange={setTerminalPanelState}
              />
            </div>
          </div>

          {isIdeChatOpen && (
            <>
              <div
                role="separator"
                aria-label="Resize IDE chat panel"
                aria-orientation="vertical"
                onMouseDown={handleChatResizeStart}
                className="hidden w-1.5 cursor-col-resize bg-transparent hover:bg-indigo-500/40 transition-colors md:block"
              />
              <div
                className="hidden border-l border-white/10 bg-[#0b0b12] h-full md:block"
                style={{ width: `${chatPanelWidth}px` }}
              >
                <IDEChatPanel
                  workspaceDir={rootInfo?.path || currentPath}
                  contextPath={selectedFile?.path || null}
                  terminalContext={{
                    isOpen: isTerminalPanelOpen,
                    sessionCount: terminalPanelState.sessionCount,
                    activeSessionId: terminalPanelState.activeSessionId,
                  }}
                  onWorkspaceMutated={handleRefresh}
                  onClose={() => setIsIdeChatOpen(false)}
                  selectedAgentId={ideChatSelectedAgentId}
                  onSelectedAgentIdChange={setIdeChatSelectedAgentId}
                  agents={ideAgentOptions}
                  onPendingFileDiffsChange={setIdePendingFileDiffs}
                  onPendingFileDiffControllerChange={setIdePendingFileDiffController}
                />
              </div>
            </>
          )}
        </div>
      </div>

      {showCommandPalette && (
        <div
          className="absolute inset-0 z-50 bg-black/40 flex items-start justify-center pt-16"
          onMouseDown={closeCommandPalette}
        >
          <div
            className="w-[640px] max-w-[92vw] rounded-xl border border-white/15 bg-[#0b0b12] shadow-2xl overflow-hidden"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="px-3 py-2 border-b border-white/10 flex items-center gap-2">
              <Zap className="w-4 h-4 text-indigo-300" />
              <input
                ref={commandInputRef}
                type="text"
                value={commandQuery}
                onChange={(event) => {
                  setCommandQuery(event.target.value);
                  setCommandSelectedIndex(0);
                }}
                onKeyDown={(event) => {
                  if (event.key === "ArrowDown") {
                    event.preventDefault();
                    setCommandSelectedIndex((previous) =>
                      filteredCommandItems.length
                        ? Math.min(previous + 1, filteredCommandItems.length - 1)
                        : 0
                    );
                    return;
                  }
                  if (event.key === "ArrowUp") {
                    event.preventDefault();
                    setCommandSelectedIndex((previous) =>
                      filteredCommandItems.length ? Math.max(previous - 1, 0) : 0
                    );
                    return;
                  }
                  if (event.key === "Enter") {
                    event.preventDefault();
                    handleCommandConfirm();
                    return;
                  }
                  if (event.key === "Escape") {
                    event.preventDefault();
                    closeCommandPalette();
                  }
                }}
                placeholder="Command Palette (Ctrl/Cmd+Shift+P)"
                className="flex-1 bg-transparent text-sm text-gray-100 placeholder-gray-500 !outline-none"
              />
              <button
                type="button"
                onClick={closeCommandPalette}
                className="p-1 rounded text-gray-500 hover:text-white hover:bg-white/5"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>

            <div className="max-h-[55vh] overflow-y-auto divide-y divide-white/5">
              {filteredCommandItems.length > 0 ? (
                filteredCommandItems.map((command, index) => (
                  <button
                    key={`command:${command.id}`}
                    type="button"
                    onClick={() => handleCommandConfirm(index)}
                    className={cn(
                      "w-full text-left px-3 py-2 transition-colors",
                      index === commandSelectedIndex
                        ? "bg-indigo-500/20 text-indigo-200"
                        : "hover:bg-white/5 text-gray-300"
                    )}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm truncate">{command.label}</span>
                      {command.shortcut && (
                        <span className="text-[11px] text-gray-500">{command.shortcut}</span>
                      )}
                    </div>
                    {command.detail && (
                      <div className="text-[11px] text-gray-500 truncate">{command.detail}</div>
                    )}
                  </button>
                ))
              ) : (
                <div className="px-3 py-6 text-center text-gray-500 text-sm">
                  No matching commands
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {showQuickOpen && (
        <div
          className="absolute inset-0 z-50 bg-black/40 flex items-start justify-center pt-16"
          onMouseDown={closeQuickOpenPalette}
        >
          <div
            className="w-[680px] max-w-[92vw] rounded-xl border border-white/15 bg-[#0b0b12] shadow-2xl overflow-hidden"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="px-3 py-2 border-b border-white/10 flex items-center gap-2">
              <Search className="w-4 h-4 text-indigo-300" />
              <input
                ref={quickOpenInputRef}
                type="text"
                value={quickOpenQuery}
                onChange={(event) => {
                  setQuickOpenQuery(event.target.value);
                  setQuickOpenSelectedIndex(0);
                }}
                onKeyDown={(event) => {
                  if (event.key === "ArrowDown") {
                    event.preventDefault();
                    setQuickOpenSelectedIndex((previous) =>
                      quickOpenResults.length
                        ? Math.min(previous + 1, quickOpenResults.length - 1)
                        : 0
                    );
                    return;
                  }
                  if (event.key === "ArrowUp") {
                    event.preventDefault();
                    setQuickOpenSelectedIndex((previous) =>
                      quickOpenResults.length ? Math.max(previous - 1, 0) : 0
                    );
                    return;
                  }
                  if (event.key === "Enter") {
                    event.preventDefault();
                    handleQuickOpenConfirm();
                    return;
                  }
                  if (event.key === "Escape") {
                    event.preventDefault();
                    closeQuickOpenPalette();
                  }
                }}
                placeholder="Quick Open (Ctrl/Cmd+P) — file or file:line"
                className="flex-1 bg-transparent text-sm text-gray-100 placeholder-gray-500 !outline-none"
              />
              {quickOpenLoading && <Loader2 className="w-4 h-4 animate-spin text-gray-400" />}
              <button
                type="button"
                onClick={closeQuickOpenPalette}
                className="p-1 rounded text-gray-500 hover:text-white hover:bg-white/5"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>

            {quickOpenError && (
              <div className="px-3 py-2 border-b border-red-500/20 bg-red-500/10 text-xs text-red-300">
                {quickOpenError}
              </div>
            )}
            {quickOpenNotice && !quickOpenError && (
              <div className="px-3 py-2 border-b border-amber-500/20 bg-amber-500/10 text-xs text-amber-200">
                {quickOpenNotice}
              </div>
            )}

            <div className="max-h-[55vh] overflow-y-auto divide-y divide-white/5">
              {quickOpenResults.length > 0 ? (
                quickOpenResults.map((file, index) => (
                  <button
                    key={`quick-open:${file.path}`}
                    type="button"
                    onClick={() => handleQuickOpenConfirm(index)}
                    className={cn(
                      "w-full text-left px-3 py-2 transition-colors",
                      index === quickOpenSelectedIndex
                        ? "bg-indigo-500/20 text-indigo-200"
                        : "hover:bg-white/5 text-gray-300"
                    )}
                  >
                    <div className="text-sm truncate">{file.relativePath}</div>
                    <div className="text-[11px] text-gray-500 truncate">{file.path}</div>
                  </button>
                ))
              ) : (
                <div className="px-3 py-6 text-center text-gray-500 text-sm">
                  {quickOpenLoading ? "Searching files..." : "No files found"}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {showIdeSettings && (
        <div
          className="absolute inset-0 z-50 bg-black/45 flex items-start justify-center pt-10"
          onMouseDown={() => setShowIdeSettings(false)}
        >
          <div
            className="w-[1040px] max-w-[96vw] max-h-[86vh] rounded-xl border border-white/15 bg-[#0b0b12] shadow-2xl overflow-hidden flex"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="w-64 border-r border-white/10 bg-black/20 flex flex-col">
              <div className="px-3 py-3 border-b border-white/10">
                <input
                  ref={settingsSearchRef}
                  type="text"
                  value={ideSettingsSearch}
                  onChange={(event) => setIdeSettingsSearch(event.target.value)}
                  placeholder="Search settings..."
                  className="w-full rounded border border-white/10 bg-black/40 px-2.5 py-1.5 text-xs text-gray-100 !outline-none focus:border-indigo-500/50"
                />
              </div>
              <div className="flex-1 overflow-y-auto p-2 space-y-1">
                {settingsSections
                  .filter(
                    (section) =>
                      visibleSettingsSectionIds.includes(section.id) ||
                      normalizedSettingsSearch.length === 0
                  )
                  .map((section) => (
                    <button
                      key={`ide-settings-section:${section.id}`}
                      type="button"
                      onClick={() => setIdeSettingsSection(section.id)}
                      className={cn(
                        "w-full rounded px-2.5 py-2 text-left transition-colors",
                        ideSettingsSection === section.id
                          ? "bg-indigo-500/20 text-indigo-200"
                          : "text-gray-300 hover:bg-white/5"
                      )}
                    >
                      <div className="text-xs font-medium">{section.label}</div>
                      <div className="text-[11px] text-gray-500 truncate">
                        {section.description}
                      </div>
                    </button>
                  ))}
              </div>
            </div>

            <div className="flex-1 flex flex-col min-w-0">
              <div className="px-4 py-3 border-b border-white/10 flex items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold text-gray-100">IDE Settings</div>
                  <div className="text-xs text-gray-500">
                    Editor, indexing, and terminal preferences.
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setShowIdeSettings(false)}
                  className="p-1 rounded text-gray-500 hover:text-gray-200 hover:bg-white/5"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto p-4 space-y-5">
                {ideSettingsSection === "general" && (
                  <div className="space-y-3">
                    {matchesIdeSettingsSearch("workspace", "remember", "path") && (
                      <div className="rounded border border-white/10 bg-white/[0.02] px-3 py-2.5 text-xs">
                        <div className="text-gray-200 font-medium">Workspace path persistence</div>
                        <div className="text-gray-500 mt-1">
                          Cybara restores your last workspace automatically.
                        </div>
                      </div>
                    )}
                    {matchesIdeSettingsSearch("chat", "panel", "startup") && (
                      <div className="flex items-start justify-between gap-3 text-xs text-gray-300">
                        <span>
                          <span className="text-gray-200 font-medium">Open IDE chat panel</span>
                          <span className="block text-gray-500 mt-0.5">
                            Persist this as your default chat panel state.
                          </span>
                        </span>
                        <Switch checked={isIdeChatOpen} onChange={setIsIdeChatOpen} />
                      </div>
                    )}
                    {matchesIdeSettingsSearch("settings", "providers") && (
                      <div className="flex items-center gap-2">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => navigate("/providers")}
                          className="h-7 px-2 text-xs"
                        >
                          Open AI Providers
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => navigate("/settings")}
                          className="h-7 px-2 text-xs"
                        >
                          Open Global App Settings
                        </Button>
                      </div>
                    )}
                  </div>
                )}

                {ideSettingsSection === "editor" && (
                  <div className="space-y-3">
                    {matchesIdeSettingsSearch("font", "size") && (
                      <label className="block text-xs text-gray-400 space-y-1.5">
                        <span>Editor font size</span>
                        <div className="flex items-center gap-3">
                          <input
                            type="range"
                            min={11}
                            max={22}
                            value={idePreferences.editorFontSizePx}
                            onChange={(event) =>
                              updateIdePreferences({
                                editorFontSizePx: Number.parseInt(event.target.value || "14", 10),
                              })
                            }
                            className="flex-1"
                          />
                          <span className="w-10 text-right text-gray-200 tabular-nums">
                            {idePreferences.editorFontSizePx}
                          </span>
                        </div>
                      </label>
                    )}
                    {matchesIdeSettingsSearch("line", "height", "spacing") && (
                      <label className="block text-xs text-gray-400 space-y-1.5">
                        <span>Editor line height</span>
                        <div className="flex items-center gap-3">
                          <input
                            type="range"
                            min={16}
                            max={38}
                            value={idePreferences.editorLineHeightPx}
                            onChange={(event) =>
                              updateIdePreferences({
                                editorLineHeightPx: Number.parseInt(event.target.value || "22", 10),
                              })
                            }
                            className="flex-1"
                          />
                          <span className="w-10 text-right text-gray-200 tabular-nums">
                            {idePreferences.editorLineHeightPx}
                          </span>
                        </div>
                      </label>
                    )}
                    {matchesIdeSettingsSearch("minimap") && (
                      <div className="flex items-start justify-between gap-3 text-xs text-gray-300">
                        <span>
                          <span className="text-gray-200 font-medium">Show minimap</span>
                          <span className="block text-gray-500 mt-0.5">
                            Display the minimap in the editor gutter.
                          </span>
                        </span>
                        <Switch
                          checked={idePreferences.showMinimap}
                          onChange={(next) => updateIdePreferences({ showMinimap: next })}
                        />
                      </div>
                    )}
                  </div>
                )}

                {ideSettingsSection === "indexing" && (
                  <IndexerSettingsPanel
                    indexStatus={indexStatus}
                    activeIndexSettings={activeIndexSettings}
                    embeddingProviders={embeddingProviders}
                    selectedEmbeddingProvider={selectedEmbeddingProvider}
                    selectedEmbeddingModelOptions={selectedEmbeddingModelOptions}
                    embeddingModelCustom={embeddingModelCustom}
                    runtimeTargetProvider={runtimeTargetProvider}
                    runtimeTargetModel={runtimeTargetModel}
                    runtimeModelStatus={runtimeModelStatus}
                    selectedTransformersRuntimeEntry={selectedTransformersRuntimeEntry}
                    effectiveRuntimeNote={effectiveRuntimeNote}
                    embeddingRuntime={embeddingRuntime}
                    embeddingCatalogLoading={embeddingCatalogLoading}
                    embeddingRuntimeActionLoading={embeddingRuntimeActionLoading}
                    embeddingRuntimeLoading={embeddingRuntimeLoading}
                    canManageLocalRuntime={canManageLocalRuntime}
                    canUnloadLocalRuntime={canUnloadLocalRuntime}
                    indexActionLoading={indexActionLoading}
                    indexSettingsDirty={indexSettingsDirty}
                    effectiveWorkspacePath={effectiveWorkspacePath}
                    setIndexSettingsDraft={setIndexSettingsDraft}
                    setIndexSettingsDirty={setIndexSettingsDirty}
                    setEmbeddingModelCustom={setEmbeddingModelCustom}
                    setShowIndexerSettings={setShowIndexerSettings}
                    setIndexSettingsError={setIndexSettingsError}
                    fetchEmbeddingCatalog={() => void fetchEmbeddingCatalog()}
                    fetchEmbeddingRuntimeStatus={() => void fetchEmbeddingRuntimeStatus()}
                    loadEmbeddingRuntime={() => void loadEmbeddingRuntime()}
                    stopEmbeddingRuntime={() => void stopEmbeddingRuntime()}
                    fetchIndexStatus={(path) => void fetchIndexStatus(path)}
                    saveIndexSettings={() => void saveIndexSettings()}
                    runWorkspaceReindex={() => void runWorkspaceReindex()}
                    matchesIdeSettingsSearch={matchesIdeSettingsSearch}
                  />
                )}

                {ideSettingsSection === "shortcuts" && (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="text-xs text-gray-400">
                        Click a shortcut to record a new key combination. Editor keys (save, find,
                        go to line) are handled in the editor.
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={resetAllKeymap}
                        disabled={Object.keys(keymapOverrides).length === 0}
                        className="h-7 px-2 text-xs"
                      >
                        Reset all
                      </Button>
                    </div>
                    {(() => {
                      const activeKeymap = resolveKeymap(keymapOverrides);
                      const categories = Array.from(
                        new Set(IDE_ACTIONS.map((action) => action.category))
                      );
                      return categories.map((category) => (
                        <div key={category} className="space-y-1">
                          <div className="text-[11px] font-medium uppercase tracking-wide text-gray-500">
                            {category}
                          </div>
                          {IDE_ACTIONS.filter((action) => action.category === category).map(
                            (action) => {
                              const isRecording = recordingActionId === action.id;
                              const customized = action.id in keymapOverrides;
                              return (
                                <div
                                  key={action.id}
                                  className="flex items-center justify-between rounded border border-white/10 bg-white/[0.02] px-3 py-1.5"
                                >
                                  <span className="text-xs text-gray-200">{action.label}</span>
                                  <div className="flex items-center gap-2">
                                    <button
                                      type="button"
                                      onClick={() =>
                                        setRecordingActionId(isRecording ? null : action.id)
                                      }
                                      className={cn(
                                        "min-w-[92px] rounded border px-2 py-1 text-center font-mono text-[11px]",
                                        isRecording
                                          ? "border-indigo-500/60 bg-indigo-500/15 text-indigo-200 animate-pulse"
                                          : "border-white/10 bg-black/35 text-gray-100 hover:border-indigo-500/40"
                                      )}
                                    >
                                      {isRecording
                                        ? "Press keys…"
                                        : formatBinding(activeKeymap[action.id], isMacPlatform)}
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => resetKeymapAction(action.id)}
                                      disabled={!customized}
                                      title="Reset to default"
                                      className={cn(
                                        "text-[11px]",
                                        customized
                                          ? "text-gray-400 hover:text-gray-200"
                                          : "cursor-default text-gray-700"
                                      )}
                                    >
                                      Reset
                                    </button>
                                  </div>
                                </div>
                              );
                            }
                          )}
                        </div>
                      ));
                    })()}
                  </div>
                )}

                {ideSettingsSection === "terminal" && (
                  <div className="space-y-3">
                    <div className="rounded border border-white/10 bg-white/[0.02] px-3 py-2.5 text-xs">
                      <div className="text-gray-200 font-medium">Terminal capability</div>
                      <div
                        className={cn(
                          "mt-1",
                          terminalPanelState.capability === "enabled"
                            ? "text-emerald-300"
                            : terminalPanelState.capability === "disabled"
                              ? "text-amber-300"
                              : "text-gray-400"
                        )}
                      >
                        {terminalCapabilityLabel}
                      </div>
                      {terminalPanelState.capability === "disabled" && (
                        <div className="mt-1 text-gray-500">
                          Enable it from Settings → Safety or from the terminal panel.
                        </div>
                      )}
                    </div>
                    <div className="flex items-start justify-between gap-3 text-xs text-gray-300">
                      <span>
                        <span className="text-gray-200 font-medium">
                          Open terminal panel on IDE startup
                        </span>
                        <span className="block text-gray-500 mt-0.5">
                          Uses the stored terminal panel visibility at startup.
                        </span>
                      </span>
                      <Switch
                        checked={idePreferences.openTerminalOnStartup}
                        onChange={(next) => {
                          updateIdePreferences({ openTerminalOnStartup: next });
                          setIsTerminalPanelOpen(next);
                        }}
                      />
                    </div>
                    <div className="flex items-start justify-between gap-3 text-xs text-gray-300">
                      <span>
                        <span className="text-gray-200 font-medium">
                          Auto-create terminal when panel opens
                        </span>
                        <span className="block text-gray-500 mt-0.5">
                          Create one terminal tab automatically.
                        </span>
                      </span>
                      <Switch
                        checked={idePreferences.autoCreateTerminalOnOpen}
                        onChange={(next) =>
                          updateIdePreferences({ autoCreateTerminalOnOpen: next })
                        }
                      />
                    </div>
                    <label className="block text-xs text-gray-400 space-y-1.5">
                      <span>Terminal panel height (px)</span>
                      <input
                        type="number"
                        min={IDE_TERMINAL_MIN_HEIGHT}
                        max={IDE_TERMINAL_MAX_HEIGHT}
                        value={idePreferences.terminalPanelHeight}
                        onChange={(event) =>
                          updateIdePreferences({
                            terminalPanelHeight: Number.parseInt(
                              event.target.value || String(IDE_TERMINAL_DEFAULT_HEIGHT),
                              10
                            ),
                          })
                        }
                        className="w-44 rounded border border-white/10 bg-black/35 px-2 py-1.5 text-xs text-gray-100 !outline-none focus:border-indigo-500/50"
                      />
                    </label>
                    <div className="flex items-center gap-2">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={openNewTerminal}
                        className="h-7 px-2 text-xs"
                        disabled={terminalPanelState.capability !== "enabled"}
                      >
                        New Terminal
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={toggleTerminalPanel}
                        className="h-7 px-2 text-xs"
                      >
                        {isTerminalPanelOpen ? "Hide Panel" : "Show Panel"}
                      </Button>
                    </div>
                  </div>
                )}
              </div>

              <div className="px-4 py-3 border-t border-white/10 flex items-center justify-between text-[11px] text-gray-500">
                <span>Settings are saved automatically.</span>
                <div className="flex items-center gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setIdePreferences(IDE_DEFAULT_PREFERENCES);
                      setTerminalPanelHeight(IDE_DEFAULT_PREFERENCES.terminalPanelHeight);
                    }}
                    className="h-7 px-2 text-xs"
                  >
                    Reset IDE Defaults
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setShowIdeSettings(false)}
                    className="h-7 px-2 text-xs"
                  >
                    Close
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {showIndexerSettings && (
        <div
          className="absolute inset-0 z-50 bg-black/45 flex items-start justify-center pt-14"
          onMouseDown={() => setShowIndexerSettings(false)}
        >
          <div
            className="w-[760px] max-w-[94vw] rounded-xl border border-white/15 bg-[#0b0b12] shadow-2xl overflow-hidden"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="px-4 py-3 border-b border-white/10 flex items-center justify-between">
              <div>
                <div className="text-sm font-semibold text-gray-100">Workspace Indexer</div>
                <div className="text-xs text-gray-500">
                  Auto-index workspace files for faster quick-open and IDE navigation.
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowIndexerSettings(false)}
                className="p-1 rounded text-gray-500 hover:text-gray-200 hover:bg-white/5"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-4 space-y-4 max-h-[70vh] overflow-y-auto">
              <div className="rounded-lg border border-white/10 bg-white/[0.02] p-3">
                <div className="grid grid-cols-2 gap-3 text-xs">
                  <div>
                    <div className="text-gray-500">Workspace</div>
                    <div className="text-gray-200 truncate" title={effectiveWorkspacePath}>
                      {effectiveWorkspacePath}
                    </div>
                  </div>
                  <div>
                    <div className="text-gray-500">State</div>
                    <div
                      className={cn(
                        "font-medium",
                        indexStatus?.state === "error"
                          ? "text-red-300"
                          : indexStatus?.isIndexing
                            ? "text-indigo-300"
                            : indexStatus?.state === "ready"
                              ? "text-emerald-300"
                              : "text-gray-300"
                      )}
                    >
                      {indexStatus?.state || "idle"}
                      {indexStatus?.isIndexing && " (running)"}
                    </div>
                  </div>
                  <div>
                    <div className="text-gray-500">Indexed Files</div>
                    <div className="text-gray-200 tabular-nums">
                      {indexStatus?.filesIndexed?.toLocaleString() || "0"}
                    </div>
                  </div>
                  <div>
                    <div className="text-gray-500">Last Duration</div>
                    <div className="text-gray-200 tabular-nums">
                      {formatDurationMs(indexStatus?.durationMs)}
                    </div>
                  </div>
                  <div>
                    <div className="text-gray-500">Progress</div>
                    <div className="text-gray-200 tabular-nums">
                      {typeof indexStatus?.progress === "number"
                        ? `${indexStatus.progress}%`
                        : "0%"}
                    </div>
                  </div>
                  <div>
                    <div className="text-gray-500">Last Indexed</div>
                    <div className="text-gray-200">
                      {indexStatus?.lastIndexedAt
                        ? new Date(indexStatus.lastIndexedAt).toLocaleString()
                        : "Never"}
                    </div>
                  </div>
                  <div>
                    <div className="text-gray-500">Semantic Index</div>
                    <div
                      className={cn(
                        "font-medium",
                        indexStatus?.semanticReady ? "text-emerald-300" : "text-gray-300"
                      )}
                    >
                      {indexStatus?.semanticReady ? "ready" : "disabled/unavailable"}
                    </div>
                  </div>
                  <div>
                    <div className="text-gray-500">Semantic Chunks</div>
                    <div className="text-gray-200 tabular-nums">
                      {indexStatus?.semanticIndexedChunks?.toLocaleString() || "0"}
                    </div>
                  </div>
                  <div>
                    <div className="text-gray-500">Embedding Provider</div>
                    <div className="text-gray-200 truncate">
                      {indexStatus?.semanticProvider && indexStatus?.semanticProvider !== "none"
                        ? `${indexStatus.semanticProvider}${indexStatus.semanticModel ? ` · ${indexStatus.semanticModel}` : ""}`
                        : "none"}
                    </div>
                  </div>
                  <div>
                    <div className="text-gray-500">Configured Embedding</div>
                    <div className="text-gray-200 truncate">
                      {activeIndexSettings.embeddingProvider}
                      {activeIndexSettings.embeddingModel
                        ? ` · ${activeIndexSettings.embeddingModel}`
                        : ""}
                    </div>
                  </div>
                </div>
                <div className="mt-3 h-1.5 w-full rounded bg-white/10 overflow-hidden">
                  <div
                    className={cn(
                      "h-full transition-all",
                      indexStatus?.state === "error" ? "bg-red-500/80" : "bg-indigo-500/80"
                    )}
                    style={{ width: `${Math.max(0, Math.min(indexStatus?.progress || 0, 100))}%` }}
                  />
                </div>
                {indexStatus?.semanticError && (
                  <div className="mt-2 text-[11px] text-amber-300/90">
                    Semantic index note: {indexStatus.semanticError}
                  </div>
                )}
              </div>

              <div className="rounded-lg border border-white/10 bg-white/[0.02] p-3 space-y-3">
                <div className="flex items-center justify-between gap-3 text-xs text-gray-200">
                  Enable workspace indexer
                  <Switch
                    checked={activeIndexSettings.enabled}
                    onChange={(next) => {
                      setIndexSettingsDraft({ ...activeIndexSettings, enabled: next });
                      setIndexSettingsDirty(true);
                    }}
                  />
                </div>
                <div className="flex items-center justify-between gap-3 text-xs text-gray-300">
                  Auto-reindex when workspace is set
                  <Switch
                    checked={activeIndexSettings.autoReindexOnWorkspaceSet}
                    onChange={(next) => {
                      setIndexSettingsDraft({
                        ...activeIndexSettings,
                        autoReindexOnWorkspaceSet: next,
                      });
                      setIndexSettingsDirty(true);
                    }}
                  />
                </div>
                <div className="flex items-center justify-between gap-3 text-xs text-gray-300">
                  Include hidden files/folders
                  <Switch
                    checked={activeIndexSettings.includeHidden}
                    onChange={(next) => {
                      setIndexSettingsDraft({ ...activeIndexSettings, includeHidden: next });
                      setIndexSettingsDirty(true);
                    }}
                  />
                </div>
                <div className="flex items-center justify-between gap-3 text-xs text-gray-300">
                  Enable semantic vector index (embeddings)
                  <Switch
                    checked={activeIndexSettings.semanticEnabled}
                    onChange={(next) => {
                      setIndexSettingsDraft({ ...activeIndexSettings, semanticEnabled: next });
                      setIndexSettingsDirty(true);
                    }}
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <label className="text-xs text-gray-400 space-y-1">
                    <span>Max files</span>
                    <input
                      type="number"
                      min={100}
                      max={1000000}
                      value={activeIndexSettings.maxFiles}
                      onChange={(event) => {
                        const parsed = Number.parseInt(event.target.value || "", 10);
                        setIndexSettingsDraft({
                          ...activeIndexSettings,
                          maxFiles: Number.isFinite(parsed) ? Math.max(100, parsed) : 100,
                        });
                        setIndexSettingsDirty(true);
                      }}
                      className="w-full rounded border border-white/10 bg-black/35 px-2 py-1.5 text-xs text-gray-100 !outline-none focus:border-indigo-500/50"
                    />
                  </label>
                  <label className="text-xs text-gray-400 space-y-1">
                    <span>Max file size (MB)</span>
                    <input
                      type="number"
                      min={0.1}
                      max={100}
                      step={0.1}
                      value={(activeIndexSettings.maxFileSizeBytes / (1024 * 1024)).toFixed(1)}
                      onChange={(event) => {
                        const parsed = Number.parseFloat(event.target.value || "");
                        const nextMb = Number.isFinite(parsed) ? Math.max(0.1, parsed) : 0.1;
                        setIndexSettingsDraft({
                          ...activeIndexSettings,
                          maxFileSizeBytes: Math.round(nextMb * 1024 * 1024),
                        });
                        setIndexSettingsDirty(true);
                      }}
                      className="w-full rounded border border-white/10 bg-black/35 px-2 py-1.5 text-xs text-gray-100 !outline-none focus:border-indigo-500/50"
                    />
                  </label>
                  <label className="text-xs text-gray-400 space-y-1">
                    <span>Semantic max files</span>
                    <input
                      type="number"
                      min={100}
                      max={50000}
                      value={activeIndexSettings.semanticMaxFiles}
                      onChange={(event) => {
                        const parsed = Number.parseInt(event.target.value || "", 10);
                        setIndexSettingsDraft({
                          ...activeIndexSettings,
                          semanticMaxFiles: Number.isFinite(parsed) ? Math.max(100, parsed) : 100,
                        });
                        setIndexSettingsDirty(true);
                      }}
                      className="w-full rounded border border-white/10 bg-black/35 px-2 py-1.5 text-xs text-gray-100 !outline-none focus:border-indigo-500/50"
                    />
                  </label>
                  <label className="text-xs text-gray-400 space-y-1">
                    <span>Semantic min score</span>
                    <input
                      type="number"
                      min={0.05}
                      max={0.99}
                      step={0.05}
                      value={activeIndexSettings.semanticMinScore}
                      onChange={(event) => {
                        const parsed = Number.parseFloat(event.target.value || "");
                        const nextValue = Number.isFinite(parsed)
                          ? Math.min(0.99, Math.max(0.05, parsed))
                          : 0.45;
                        setIndexSettingsDraft({
                          ...activeIndexSettings,
                          semanticMinScore: Number(nextValue.toFixed(2)),
                        });
                        setIndexSettingsDirty(true);
                      }}
                      className="w-full rounded border border-white/10 bg-black/35 px-2 py-1.5 text-xs text-gray-100 !outline-none focus:border-indigo-500/50"
                    />
                  </label>
                </div>

                <label className="block text-xs text-gray-400 space-y-1">
                  <span>Ignored directories (comma separated)</span>
                  <input
                    type="text"
                    value={activeIndexSettings.ignoreDirs.join(", ")}
                    onChange={(event) => {
                      const values = event.target.value
                        .split(",")
                        .map((item) => item.trim())
                        .filter(Boolean)
                        .map((item) => item.toLowerCase());
                      setIndexSettingsDraft({
                        ...activeIndexSettings,
                        ignoreDirs: values,
                      });
                      setIndexSettingsDirty(true);
                    }}
                    className="w-full rounded border border-white/10 bg-black/35 px-2 py-1.5 text-xs text-gray-100 !outline-none focus:border-indigo-500/50"
                    placeholder=".git, node_modules, dist"
                  />
                </label>

                <label className="block text-xs text-gray-400 space-y-1">
                  <span>Include extensions (optional, comma separated)</span>
                  <input
                    type="text"
                    value={activeIndexSettings.includeExtensions.join(", ")}
                    onChange={(event) => {
                      const values = event.target.value
                        .split(",")
                        .map((item) => item.trim().toLowerCase())
                        .filter(Boolean)
                        .map((item) => (item.startsWith(".") ? item : `.${item}`));
                      setIndexSettingsDraft({
                        ...activeIndexSettings,
                        includeExtensions: values,
                      });
                      setIndexSettingsDirty(true);
                    }}
                    className="w-full rounded border border-white/10 bg-black/35 px-2 py-1.5 text-xs text-gray-100 !outline-none focus:border-indigo-500/50"
                    placeholder=".ts, .tsx, .js"
                  />
                </label>
              </div>

              {indexSettingsMessage && (
                <div className="rounded border border-emerald-500/25 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-300">
                  {indexSettingsMessage}
                </div>
              )}
              {indexSettingsError && (
                <div className="rounded border border-red-500/25 bg-red-500/10 px-3 py-2 text-xs text-red-300">
                  {indexSettingsError}
                </div>
              )}
            </div>

            <div className="px-4 py-3 border-t border-white/10 flex items-center justify-between gap-2">
              <div className="text-[11px] text-gray-500">
                {indexStatusLoading ? "Refreshing status..." : "Status updates while indexing."}
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => void runWorkspaceReindex()}
                  disabled={indexActionLoading || indexStatus?.isIndexing}
                  className="h-7 px-2 text-xs"
                >
                  Reindex Now
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => void stopWorkspaceIndexing()}
                  disabled={indexActionLoading || !indexStatus?.isIndexing}
                  className="h-7 px-2 text-xs"
                >
                  Stop
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => void fetchEmbeddingCatalog()}
                  disabled={embeddingCatalogLoading || indexActionLoading}
                  className="h-7 px-2 text-xs"
                >
                  Refresh Models
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => void saveIndexSettings()}
                  disabled={indexActionLoading || !indexSettingsDirty}
                  className="h-7 px-2 text-xs"
                >
                  Save Settings
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {treeContextMenu &&
        contextMenuPosition &&
        (() => {
          const entry = treeContextMenu.entry;
          const separatorIndex = Math.max(
            entry.path.lastIndexOf("/"),
            entry.path.lastIndexOf("\\")
          );
          const parentPath =
            entry.type === "directory"
              ? entry.path
              : separatorIndex >= 0
                ? entry.path.slice(0, separatorIndex)
                : rootInfo?.path || currentPath;
          return (
            <div
              className="fixed z-[80] min-w-[220px] rounded-md border border-white/15 bg-[#0a0a10] p-1 shadow-2xl"
              style={{ left: `${contextMenuPosition.left}px`, top: `${contextMenuPosition.top}px` }}
              onMouseDown={(event) => event.stopPropagation()}
            >
              <button
                type="button"
                onClick={() => {
                  if (entry.type === "file") {
                    openFileInEditor(entry, null, { previewMode: false });
                  } else {
                    handleToggleDir(entry.path);
                  }
                  setTreeContextMenu(null);
                }}
                className="w-full rounded px-2 py-1.5 text-left text-xs text-gray-200 hover:bg-white/10"
              >
                {entry.type === "file"
                  ? "Open"
                  : expandedDirs.has(entry.path)
                    ? "Collapse"
                    : "Expand"}
              </button>
              <button
                type="button"
                onClick={() => {
                  void handleRenameEntry(entry);
                }}
                className="w-full rounded px-2 py-1.5 text-left text-xs text-gray-200 hover:bg-white/10"
              >
                Rename
              </button>
              {entry.type === "file" && isMarkdownExtension(entry.extension) && (
                <button
                  type="button"
                  onClick={() => {
                    openFileInEditor(entry, null, { previewMode: true });
                    setTreeContextMenu(null);
                  }}
                  className="w-full rounded px-2 py-1.5 text-left text-xs text-indigo-200 hover:bg-white/10"
                >
                  Open Preview
                </button>
              )}
              <button
                type="button"
                onClick={() => {
                  void handleRevealInExplorer(entry.path);
                  setTreeContextMenu(null);
                }}
                className="w-full rounded px-2 py-1.5 text-left text-xs text-gray-200 hover:bg-white/10 flex items-center gap-1.5"
              >
                <ExternalLink className="w-3 h-3" />
                <span>View in Explorer</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  if (navigator.clipboard?.writeText) {
                    void navigator.clipboard.writeText(entry.path);
                  }
                  setTreeContextMenu(null);
                }}
                className="w-full rounded px-2 py-1.5 text-left text-xs text-gray-200 hover:bg-white/10 flex items-center gap-1.5"
              >
                <Copy className="w-3 h-3" />
                <span>Copy Path</span>
              </button>
              {entry.type === "directory" && (
                <button
                  type="button"
                  onClick={() => {
                    handleSetWorkspacePath(entry.path);
                    setTreeContextMenu(null);
                  }}
                  className="w-full rounded px-2 py-1.5 text-left text-xs text-emerald-200 hover:bg-white/10"
                >
                  Set Folder as Workspace
                </button>
              )}
              <button
                type="button"
                onClick={() => {
                  handleRefresh();
                  setTreeContextMenu(null);
                }}
                className="w-full rounded px-2 py-1.5 text-left text-xs text-gray-200 hover:bg-white/10"
              >
                Refresh Explorer
              </button>
              <div className="my-1 h-px bg-white/10" />
              <button
                type="button"
                onClick={() => {
                  setCreateParentPath(parentPath);
                  setCreateType("file");
                  setTreeContextMenu(null);
                }}
                className="w-full rounded px-2 py-1.5 text-left text-xs text-gray-200 hover:bg-white/10"
              >
                New File Here
              </button>
              <button
                type="button"
                onClick={() => {
                  setCreateParentPath(parentPath);
                  setCreateType("directory");
                  setTreeContextMenu(null);
                }}
                className="w-full rounded px-2 py-1.5 text-left text-xs text-gray-200 hover:bg-white/10"
              >
                New Folder Here
              </button>
            </div>
          );
        })()}

      <div className="h-8 border-t border-white/10 bg-black/30 px-3 flex min-w-0 items-center justify-between gap-3 text-xs">
        <div className="flex min-w-0 items-center gap-3">
          <span className="text-gray-600">Ready</span>
          <GitStatus path={rootInfo?.path || currentPath} compact />
        </div>
        <div className="flex min-w-0 items-center justify-end gap-2 md:gap-3">
          <span className="shrink-0 text-gray-500 tabular-nums">
            {selectedFile
              ? `Ln ${cursorPosition?.line || 1}, Col ${cursorPosition?.column || 1}`
              : "Ln -, Col -"}
          </span>
          <span className="hidden text-gray-600 md:inline">{statusEncoding || "-"}</span>
          <span className="hidden text-gray-600 md:inline">{statusEol || "-"}</span>
          <span className="hidden text-gray-600 md:inline">{statusIndent || "-"}</span>
          <span className="hidden text-gray-500 md:inline">{statusLanguage || "-"}</span>
          {gitHistoryStatusLabel && (
            <span
              className={cn(
                "hidden items-center gap-1 md:inline-flex",
                gitHistoryStatus === "loading"
                  ? "text-indigo-300"
                  : gitHistoryStatus === "error"
                    ? "text-red-300"
                    : gitHistoryStatus === "ready"
                      ? "text-emerald-300"
                      : "text-gray-500"
              )}
              title="Git line history status for the active file"
            >
              {gitHistoryStatus === "loading" && <Loader2 className="w-3 h-3 animate-spin" />}
              {gitHistoryStatusLabel}
            </span>
          )}
          <span className="hidden text-gray-600 md:inline">
            {sidebarMode === "search"
              ? "Global Search"
              : sidebarMode === "outline"
                ? "Outline"
                : "Editor"}
          </span>
          <button
            type="button"
            onClick={() => toggleTerminalPanel()}
            className={cn(
              "inline-flex shrink-0 items-center gap-1 text-xs transition-colors",
              terminalPanelState.capability === "disabled"
                ? "text-amber-300 hover:text-amber-200"
                : isTerminalPanelOpen
                  ? "text-indigo-300 hover:text-indigo-200"
                  : "text-gray-500 hover:text-gray-300"
            )}
            title={
              terminalPanelState.capability === "disabled"
                ? "Terminal disabled"
                : isTerminalPanelOpen
                  ? "Hide terminal panel"
                  : "Show terminal panel"
            }
          >
            <TerminalSquare className="w-3.5 h-3.5" />
            {terminalPanelState.capability === "disabled"
              ? "Terminal off"
              : `Term ${terminalPanelState.sessionCount}`}
          </button>
          {indexStatusLabel && (
            <button
              type="button"
              onClick={() => {
                openIdeSettings("indexing");
              }}
              className={cn(
                "min-w-0 truncate text-xs transition-colors max-md:max-w-24",
                indexStatus?.state === "error"
                  ? "text-red-300 hover:text-red-200"
                  : indexStatus?.isIndexing
                    ? "text-indigo-300 hover:text-indigo-200"
                    : "text-gray-500 hover:text-gray-300"
              )}
              title="Open IDE indexing settings"
            >
              {indexStatusLabel}
            </button>
          )}
          <div className="hidden md:block">
            <LSPStatus
              compact
              activeFilePath={selectedFile?.path || null}
              activeExtension={selectedFile?.extension || null}
            />
          </div>
        </div>
      </div>

      <CreateDialog
        isOpen={createType !== null}
        type={createType || "file"}
        parentPath={createParentPath || rootInfo?.path || currentPath}
        onClose={() => {
          setCreateType(null);
          setCreateParentPath(null);
        }}
        onSuccess={handleRefresh}
      />
    </div>
  );
}

export default IDE;
