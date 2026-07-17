import { type IdeTerminalPanelState } from "@/components/ide/EmbeddedTerminalPanel";
import { apiFetch } from "@/lib/auth";
import {
  lazy,
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { treeBrowseCache } from "./ide/FileTree";
import { IDE_TERMINAL_MIN_HEIGHT } from "./ide/ideConstants";
import { isSameIdePath } from "./ide/ideDiffHelpers";
import { bindingFromEvent, type IdeActionId, resolveKeymap } from "./ide/ideKeymap";
import {
  clampChatWidth,
  clampSidebarWidth,
  clampTerminalHeight,
  persistChatOpen,
  persistChatWidth,
  persistOpenTabs,
  persistSidebarWidth,
  persistTerminalOpen,
  persistWorkspacePath,
  readPersistedChatOpen,
  readPersistedChatWidth,
  readPersistedIdePreferences,
  readPersistedOpenTabs,
  readPersistedSidebarWidth,
  readPersistedTerminalOpen,
  readPersistedWorkspacePath,
} from "./ide/idePersistence";
import type {
  BrowseResult,
  FileEntry,
  GitHistoryStatus,
  IdeBreadcrumb,
  IdeCommandItem,
  IdeOutlineResponse,
  IdeOutlineSymbol,
  IdePendingFileDiff,
  IdePendingFileDiffController,
  IdeReplacePreviewResult,
  IdeReplaceResult,
  IdeSearchResult,
  IdeTab,
  IdeTopMenuId,
  TreeContextMenuState,
  WorkspaceIndexerSearchResult,
} from "./ide/ideTypes";
import {
  fileEntryFromPath,
  flattenOutlineSymbols,
  getPrismLanguage,
  scoreQuickOpenResult,
  splitPathForBreadcrumbs,
} from "./ide/ideUtils";
import { IDEView } from "./ide/IDEView";
import { useIDEAgents } from "./ide/useIDEAgents";
import { useIDEIndexer } from "./ide/useIDEIndexer";
import { useIDESettings } from "./ide/useIDESettings";
import { useIDETopMenus } from "./ide/useIDETopMenus";

const IDEChatPanel = lazy(() =>
  import("./ide/IDEChatPanel").then((module) => ({
    default: module.IDEChatPanel,
  }))
);

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
  const [cursorPosition, setCursorPosition] = useState<{
    line: number;
    column: number;
  } | null>(null);
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
  const [commandQuery, setCommandQuery] = useState("");
  const [commandSelectedIndex, setCommandSelectedIndex] = useState(0);
  const [outlineSymbols, setOutlineSymbols] = useState<IdeOutlineSymbol[]>([]);
  const [outlineLoading, setOutlineLoading] = useState(false);
  const [outlineError, setOutlineError] = useState<string | null>(null);
  const [outlineFilter, setOutlineFilter] = useState("");
  const [explorerScrollTop, setExplorerScrollTop] = useState(0);
  const [explorerViewportHeight, setExplorerViewportHeight] = useState(0);
  const [treeContextMenu, setTreeContextMenu] = useState<TreeContextMenuState | null>(null);
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
  const pendingCursorPositionRef = useRef<{
    line: number;
    column: number;
  } | null>(null);
  const cursorPublishTimeoutRef = useRef<number | null>(null);
  const effectiveWorkspacePath = rootInfo?.path || currentPath;

  const {
    keymapOverrides,
    recordingActionId,
    setRecordingActionId,
    isMacPlatform,
    showIdeSettings,
    setShowIdeSettings,
    ideSettingsSection,
    setIdeSettingsSection,
    ideSettingsSearch,
    setIdeSettingsSearch,
    idePreferences,
    setIdePreferences,
    settingsSearchRef,
    openIdeSettings,
    updateIdePreferences,
    resetKeymapAction,
    resetAllKeymap,
    normalizedSettingsSearch,
    matchesIdeSettingsSearch,
    settingsSections,
    visibleSettingsSectionIds,
  } = useIDESettings();

  const { ideChatSelectedAgentId, setIdeChatSelectedAgentId, ideAgentOptions } = useIDEAgents({
    idePreferences,
    updateIdePreferences,
  });

  const {
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
  } = useIDEIndexer({
    currentPath,
    effectiveWorkspacePath,
    showIdeSettings,
    ideSettingsSection,
  });

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
      openFileInEditor(fileEntryFromPath(filePath), line, {
        previewMode: previewMode === true,
      });

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
  const topMenus = useIDETopMenus({
    currentPath,
    workspacePath: rootInfo?.path,
    isIdeChatOpen,
    isTerminalPanelOpen,
    setSaveRequestToken,
    setCreateParentPath,
    setCreateType,
    handlePromptOpenWorkspace,
    handleRefresh,
    openIdeSettings,
    openCommandPalette,
    openQuickOpenPalette,
    openGlobalSearchPanel,
    setSidebarMode,
    outlineInputRef,
    setIsIdeChatOpen,
    toggleTerminalPanel,
    openNewTerminal,
    handleCycleTabs,
    handleGoHome,
  });

  return (
    <IDEView
      model={{
        IDEChatPanel,
        formatIdeScannedFiles,
        navigate,
        currentPath,
        selectedFile,
        setSelectedFile,
        openTabs,
        activeTabPath,
        setActiveTabPath,
        expandedDirs,
        treeFilterDraft,
        isTreeFilterPending,
        deferredTreeFilter,
        rootInfo,
        createType,
        setCreateType,
        createParentPath,
        setCreateParentPath,
        refreshKey,
        setRefreshKey,
        saveRequestToken,
        requestedJumpLine,
        setRequestedJumpLine,
        cursorPosition,
        gitHistoryStatus,
        setGitHistoryStatus,
        sidebarWidth,
        sidebarMode,
        openMenu,
        setOpenMenu,
        globalSearchQuery,
        setGlobalSearchQuery,
        globalSearchReplace,
        setGlobalSearchReplace,
        globalSearchCaseSensitive,
        setGlobalSearchCaseSensitive,
        globalSearchWholeWord,
        setGlobalSearchWholeWord,
        globalSearchResults,
        globalReplacePreview,
        globalSearchLoading,
        globalSearchError,
        globalReplaceLoading,
        globalPreviewLoading,
        showQuickOpen,
        quickOpenQuery,
        setQuickOpenQuery,
        quickOpenResults,
        quickOpenLoading,
        quickOpenError,
        quickOpenNotice,
        quickOpenSelectedIndex,
        setQuickOpenSelectedIndex,
        showCommandPalette,
        keymapOverrides,
        recordingActionId,
        setRecordingActionId,
        isMacPlatform,
        commandQuery,
        setCommandQuery,
        commandSelectedIndex,
        setCommandSelectedIndex,
        outlineLoading,
        outlineError,
        outlineFilter,
        setOutlineFilter,
        explorerScrollTop,
        setExplorerScrollTop,
        explorerViewportHeight,
        setExplorerViewportHeight,
        treeContextMenu,
        setTreeContextMenu,
        ideChatSelectedAgentId,
        setIdeChatSelectedAgentId,
        ideAgentOptions,
        showIdeSettings,
        setShowIdeSettings,
        ideSettingsSection,
        setIdeSettingsSection,
        ideSettingsSearch,
        setIdeSettingsSearch,
        idePreferences,
        setIdePreferences,
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
        isIdeChatOpen,
        setIsIdeChatOpen,
        idePendingFileDiffs,
        setIdePendingFileDiffs,
        idePendingFileDiffController,
        setIdePendingFileDiffController,
        isTerminalPanelOpen,
        setIsTerminalPanelOpen,
        terminalPanelHeight,
        setTerminalPanelHeight,
        terminalCreateRequestToken,
        terminalPanelState,
        setTerminalPanelState,
        chatPanelWidth,
        workspacePaneRef,
        globalSearchInputRef,
        treeFilterInputRef,
        outlineInputRef,
        quickOpenInputRef,
        commandInputRef,
        menuRef,
        explorerScrollRef,
        settingsSearchRef,
        effectiveWorkspacePath,
        handleCursorPositionChange,
        updateTreeFilter,
        fetchIndexStatus,
        fetchEmbeddingCatalog,
        fetchEmbeddingRuntimeStatus,
        saveIndexSettings,
        runWorkspaceReindex,
        stopWorkspaceIndexing,
        loadEmbeddingRuntime,
        stopEmbeddingRuntime,
        handleToggleDir,
        openFileInEditor,
        handleCloseTab,
        handleSelectFile,
        handleTreeContextMenu,
        handleRevealInExplorer,
        handleSetWorkspacePath,
        handlePromptOpenWorkspace,
        handleRenameEntry,
        handleGoHome,
        handleGoUp,
        handleRefresh,
        handleExpandTopLevel,
        handleCollapseAll,
        openFileAtPath,
        handleNavigateToBreadcrumb,
        runGlobalSearch,
        openGlobalSearchMatch,
        closeQuickOpenPalette,
        openCommandPalette,
        closeCommandPalette,
        openIdeSettings,
        updateIdePreferences,
        toggleTerminalPanel,
        openNewTerminal,
        handleQuickOpenConfirm,
        filteredCommandItems,
        handleCommandConfirm,
        handleGlobalPreviewReplace,
        handleGlobalReplaceAll,
        resetKeymapAction,
        resetAllKeymap,
        handleSidebarResizeStart,
        handleChatResizeStart,
        handleTerminalResizeStart,
        activeTab,
        pendingEditorFiles,
        activePendingEditorFileIndex,
        activePendingEditorFile,
        resolvedCompletionAgentId,
        openPendingEditorFile,
        handleAcceptActivePendingEditorFile,
        handleRejectActivePendingEditorFile,
        breadcrumbs,
        flattenedOutlineRows,
        filteredOutlineRows,
        statusLanguage,
        statusEncoding,
        statusEol,
        statusIndent,
        gitHistoryStatusLabel,
        contextMenuPosition,
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
        normalizedSettingsSearch,
        matchesIdeSettingsSearch,
        settingsSections,
        visibleSettingsSectionIds,
        topMenus,
      }}
    />
  );
}

export default IDE;
