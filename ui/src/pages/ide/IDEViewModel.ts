import { type IdeTerminalPanelState } from "@/components/ide/EmbeddedTerminalPanel";
import { type IdeActionId } from "./ideKeymap";
import type {
  BrowseResult,
  FileEntry,
  FlattenedOutlineSymbol,
  GitHistoryStatus,
  IdeBreadcrumb,
  IdeChatAgentOption,
  IdeCommandItem,
  IdePendingFileDiff,
  IdePendingFileDiffController,
  IdePreferences,
  IdeReplacePreviewResult,
  IdeSearchResult,
  IdeSettingsSectionId,
  IdeTab,
  IdeTopMenuId,
  TreeContextMenuState,
  WorkspaceEmbeddingProviderOption,
  WorkspaceEmbeddingRuntimeResponse,
  WorkspaceIndexerSettings,
  WorkspaceIndexerStatusResponse,
} from "./ideTypes";

export interface IDEViewModel {
  IDEChatPanel: import("react").LazyExoticComponent<
    ({
      workspaceDir,
      contextPath,
      terminalContext,
      onWorkspaceMutated,
      onClose,
      selectedAgentId,
      onSelectedAgentIdChange,
      agents,
      onPendingFileDiffsChange,
      onPendingFileDiffControllerChange,
    }: import("./ideTypes").IDEChatPanelProps) => import("react").JSX.Element
  >;
  formatIdeScannedFiles: (value?: number) => string | null;
  navigate: import("react-router-dom").NavigateFunction;
  currentPath: string;
  selectedFile: FileEntry;
  setSelectedFile: import("react").Dispatch<import("react").SetStateAction<FileEntry>>;
  openTabs: IdeTab[];
  activeTabPath: string;
  setActiveTabPath: import("react").Dispatch<import("react").SetStateAction<string>>;
  expandedDirs: Set<string>;
  treeFilterDraft: string;
  isTreeFilterPending: boolean;
  deferredTreeFilter: string;
  rootInfo: BrowseResult;
  createType: "file" | "directory";
  setCreateType: import("react").Dispatch<import("react").SetStateAction<"file" | "directory">>;
  createParentPath: string;
  setCreateParentPath: import("react").Dispatch<import("react").SetStateAction<string>>;
  refreshKey: number;
  setRefreshKey: import("react").Dispatch<import("react").SetStateAction<number>>;
  saveRequestToken: number;
  requestedJumpLine: number;
  setRequestedJumpLine: import("react").Dispatch<import("react").SetStateAction<number>>;
  cursorPosition: { line: number; column: number };
  gitHistoryStatus: GitHistoryStatus;
  setGitHistoryStatus: import("react").Dispatch<import("react").SetStateAction<GitHistoryStatus>>;
  sidebarWidth: number;
  sidebarMode: "explorer" | "search" | "outline";
  openMenu: IdeTopMenuId;
  setOpenMenu: import("react").Dispatch<import("react").SetStateAction<IdeTopMenuId>>;
  globalSearchQuery: string;
  setGlobalSearchQuery: import("react").Dispatch<import("react").SetStateAction<string>>;
  globalSearchReplace: string;
  setGlobalSearchReplace: import("react").Dispatch<import("react").SetStateAction<string>>;
  globalSearchCaseSensitive: boolean;
  setGlobalSearchCaseSensitive: import("react").Dispatch<import("react").SetStateAction<boolean>>;
  globalSearchWholeWord: boolean;
  setGlobalSearchWholeWord: import("react").Dispatch<import("react").SetStateAction<boolean>>;
  globalSearchResults: IdeSearchResult;
  globalReplacePreview: IdeReplacePreviewResult;
  globalSearchLoading: boolean;
  globalSearchError: string;
  globalReplaceLoading: boolean;
  globalPreviewLoading: boolean;
  showQuickOpen: boolean;
  quickOpenQuery: string;
  setQuickOpenQuery: import("react").Dispatch<import("react").SetStateAction<string>>;
  quickOpenResults: { path: string; relativePath: string }[];
  quickOpenLoading: boolean;
  quickOpenError: string;
  quickOpenNotice: string;
  quickOpenSelectedIndex: number;
  setQuickOpenSelectedIndex: import("react").Dispatch<import("react").SetStateAction<number>>;
  showCommandPalette: boolean;
  keymapOverrides: Record<string, string>;
  recordingActionId: IdeActionId;
  setRecordingActionId: import("react").Dispatch<import("react").SetStateAction<IdeActionId>>;
  isMacPlatform: boolean;
  commandQuery: string;
  setCommandQuery: import("react").Dispatch<import("react").SetStateAction<string>>;
  commandSelectedIndex: number;
  setCommandSelectedIndex: import("react").Dispatch<import("react").SetStateAction<number>>;
  outlineLoading: boolean;
  outlineError: string;
  outlineFilter: string;
  setOutlineFilter: import("react").Dispatch<import("react").SetStateAction<string>>;
  explorerScrollTop: number;
  setExplorerScrollTop: import("react").Dispatch<import("react").SetStateAction<number>>;
  explorerViewportHeight: number;
  setExplorerViewportHeight: import("react").Dispatch<import("react").SetStateAction<number>>;
  treeContextMenu: TreeContextMenuState;
  setTreeContextMenu: import("react").Dispatch<
    import("react").SetStateAction<TreeContextMenuState>
  >;
  ideChatSelectedAgentId: string;
  setIdeChatSelectedAgentId: import("react").Dispatch<import("react").SetStateAction<string>>;
  ideAgentOptions: IdeChatAgentOption[];
  showIdeSettings: boolean;
  setShowIdeSettings: import("react").Dispatch<import("react").SetStateAction<boolean>>;
  ideSettingsSection: IdeSettingsSectionId;
  setIdeSettingsSection: import("react").Dispatch<
    import("react").SetStateAction<IdeSettingsSectionId>
  >;
  ideSettingsSearch: string;
  setIdeSettingsSearch: import("react").Dispatch<import("react").SetStateAction<string>>;
  idePreferences: IdePreferences;
  setIdePreferences: import("react").Dispatch<import("react").SetStateAction<IdePreferences>>;
  showIndexerSettings: boolean;
  setShowIndexerSettings: import("react").Dispatch<import("react").SetStateAction<boolean>>;
  indexStatus: WorkspaceIndexerStatusResponse;
  setIndexSettingsDraft: import("react").Dispatch<
    import("react").SetStateAction<WorkspaceIndexerSettings>
  >;
  indexSettingsDirty: boolean;
  setIndexSettingsDirty: import("react").Dispatch<import("react").SetStateAction<boolean>>;
  indexStatusLoading: boolean;
  indexActionLoading: boolean;
  indexSettingsError: string;
  setIndexSettingsError: import("react").Dispatch<import("react").SetStateAction<string>>;
  indexSettingsMessage: string;
  embeddingProviders: WorkspaceEmbeddingProviderOption[];
  embeddingCatalogLoading: boolean;
  embeddingRuntime: WorkspaceEmbeddingRuntimeResponse;
  embeddingRuntimeLoading: boolean;
  embeddingRuntimeActionLoading: boolean;
  embeddingModelCustom: boolean;
  setEmbeddingModelCustom: import("react").Dispatch<import("react").SetStateAction<boolean>>;
  isIdeChatOpen: boolean;
  setIsIdeChatOpen: import("react").Dispatch<import("react").SetStateAction<boolean>>;
  idePendingFileDiffs: IdePendingFileDiff[];
  setIdePendingFileDiffs: import("react").Dispatch<
    import("react").SetStateAction<IdePendingFileDiff[]>
  >;
  idePendingFileDiffController: IdePendingFileDiffController;
  setIdePendingFileDiffController: import("react").Dispatch<
    import("react").SetStateAction<IdePendingFileDiffController>
  >;
  isTerminalPanelOpen: boolean;
  setIsTerminalPanelOpen: import("react").Dispatch<import("react").SetStateAction<boolean>>;
  terminalPanelHeight: number;
  setTerminalPanelHeight: import("react").Dispatch<import("react").SetStateAction<number>>;
  terminalCreateRequestToken: number;
  terminalPanelState: IdeTerminalPanelState;
  setTerminalPanelState: import("react").Dispatch<
    import("react").SetStateAction<IdeTerminalPanelState>
  >;
  chatPanelWidth: number;
  workspacePaneRef: import("react").RefObject<HTMLDivElement>;
  globalSearchInputRef: import("react").RefObject<HTMLInputElement>;
  treeFilterInputRef: import("react").RefObject<HTMLInputElement>;
  outlineInputRef: import("react").RefObject<HTMLInputElement>;
  quickOpenInputRef: import("react").RefObject<HTMLInputElement>;
  commandInputRef: import("react").RefObject<HTMLInputElement>;
  menuRef: import("react").RefObject<HTMLDivElement>;
  explorerScrollRef: import("react").RefObject<HTMLDivElement>;
  settingsSearchRef: import("react").RefObject<HTMLInputElement>;
  effectiveWorkspacePath: string;
  handleCursorPositionChange: (position: { line: number; column: number } | null) => void;
  updateTreeFilter: (nextFilter: string) => void;
  fetchIndexStatus: (workspacePath?: string, options?: { silent?: boolean }) => Promise<void>;
  fetchEmbeddingCatalog: () => Promise<void>;
  fetchEmbeddingRuntimeStatus: (options?: { silent?: boolean }) => Promise<void>;
  saveIndexSettings: () => Promise<void>;
  runWorkspaceReindex: () => Promise<void>;
  stopWorkspaceIndexing: () => Promise<void>;
  loadEmbeddingRuntime: () => Promise<void>;
  stopEmbeddingRuntime: () => Promise<void>;
  handleToggleDir: (path: string) => void;
  openFileInEditor: (
    entry: FileEntry,
    line?: number | null,
    options?: { previewMode?: boolean }
  ) => void;
  handleCloseTab: (targetPath: string) => void;
  handleSelectFile: (entry: FileEntry) => void;
  handleTreeContextMenu: (entry: FileEntry, event: React.MouseEvent<HTMLDivElement>) => void;
  handleRevealInExplorer: (pathValue: string) => Promise<void>;
  handleSetWorkspacePath: (nextPath: string) => void;
  handlePromptOpenWorkspace: () => Promise<void>;
  handleRenameEntry: (entry: FileEntry) => Promise<void>;
  handleGoHome: () => void;
  handleGoUp: () => void;
  handleRefresh: () => void;
  handleExpandTopLevel: () => void;
  handleCollapseAll: () => void;
  openFileAtPath: (filePath: string, line?: number | null, previewMode?: boolean) => void;
  handleNavigateToBreadcrumb: (crumb: IdeBreadcrumb) => void;
  runGlobalSearch: () => Promise<void>;
  openGlobalSearchMatch: (filePath: string, line: number) => void;
  closeQuickOpenPalette: () => void;
  openCommandPalette: () => void;
  closeCommandPalette: () => void;
  openIdeSettings: (section?: IdeSettingsSectionId) => void;
  updateIdePreferences: (patch: Partial<IdePreferences>) => void;
  toggleTerminalPanel: () => void;
  openNewTerminal: () => void;
  handleQuickOpenConfirm: (index?: number) => void;
  filteredCommandItems: IdeCommandItem[];
  handleCommandConfirm: (index?: number) => void;
  handleGlobalPreviewReplace: () => Promise<void>;
  handleGlobalReplaceAll: () => Promise<void>;
  resetKeymapAction: (id: IdeActionId) => void;
  resetAllKeymap: () => void;
  handleSidebarResizeStart: (event: React.MouseEvent<HTMLDivElement>) => void;
  handleChatResizeStart: (event: React.MouseEvent<HTMLDivElement>) => void;
  handleTerminalResizeStart: (event: React.MouseEvent<HTMLDivElement>) => void;
  activeTab: IdeTab;
  pendingEditorFiles: IdePendingFileDiff[];
  activePendingEditorFileIndex: number;
  activePendingEditorFile: IdePendingFileDiff;
  resolvedCompletionAgentId: string;
  openPendingEditorFile: (nextIndex: number) => void;
  handleAcceptActivePendingEditorFile: () => void;
  handleRejectActivePendingEditorFile: () => Promise<void>;
  breadcrumbs: IdeBreadcrumb[];
  flattenedOutlineRows: FlattenedOutlineSymbol[];
  filteredOutlineRows: FlattenedOutlineSymbol[];
  statusLanguage: string;
  statusEncoding: "UTF-8";
  statusEol: "LF";
  statusIndent: "Spaces: 2";
  gitHistoryStatusLabel:
    | "Git blame: loading"
    | "Git blame: ready"
    | "Git blame: not tracked"
    | "Git blame: error";
  contextMenuPosition: { left: number; top: number };
  indexStatusLabel: string;
  activeIndexSettings: WorkspaceIndexerSettings;
  selectedEmbeddingProvider: WorkspaceEmbeddingProviderOption;
  selectedEmbeddingModelOptions: string[];
  runtimeTargetProvider: "openai" | "voyage" | "gemini" | "ollama" | "transformers_js" | "local";
  runtimeTargetModel: string;
  canManageLocalRuntime: boolean;
  canUnloadLocalRuntime: boolean;
  selectedTransformersRuntimeEntry: import("./ideTypes").WorkspaceEmbeddingRuntimeModelStatus;
  effectiveRuntimeNote: string;
  runtimeModelStatus: import("./indexerModel").RuntimeModelStatus;
  normalizedSettingsSearch: string;
  matchesIdeSettingsSearch: (...parts: string[]) => boolean;
  settingsSections: {
    id: IdeSettingsSectionId;
    label: string;
    description: string;
  }[];
  visibleSettingsSectionIds: IdeSettingsSectionId[];
  topMenus: {
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
  }[];
}
