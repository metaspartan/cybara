import { ErrorBoundary } from "@/components/ErrorBoundary";
import EmbeddedTerminalPanel from "@/components/ide/EmbeddedTerminalPanel";
import { Button } from "@/components/ui/Button";
import { Switch } from "@/components/ui/Switch";
import { cn } from "@/lib/utils";
import {
  Check,
  ChevronRight,
  Code,
  Copy,
  ExternalLink,
  Eye,
  FilePlus,
  Folder,
  FolderOpen,
  FolderPlus,
  Home,
  ListTree,
  Loader2,
  MessageSquare,
  RotateCcw,
  Search,
  Settings2,
  TerminalSquare,
  X,
  Zap,
} from "lucide-react";
import type { ReactElement } from "react";
import { type CSSProperties, Suspense } from "react";
import { AdvancedIndexerSettingsModal } from "./AdvancedIndexerSettingsModal";
import { CodeViewer } from "./CodeViewer";
import { CreateDialog } from "./CreateDialog";
import { FileTree } from "./FileTree";
import { GitStatus } from "./GitStatus";
import { IDE_DEFAULT_PREFERENCES } from "./ideConstants";
import { IDEKeyboardSettingsPanel } from "./IDEKeyboardSettingsPanel";
import { IDETerminalSettingsPanel } from "./IDETerminalSettingsPanel";
import { fileEntryFromPath, getSymbolKindLabel, isMarkdownExtension } from "./ideUtils";
import type { IDEViewModel } from "./IDEViewModel";
import { IDEWelcomeScreen } from "./IDEWelcomeScreen";
import { IndexerSettingsPanel } from "./IndexerSettingsPanel";
import { LSPStatus } from "./LSPStatus";

export function IDEView({ model }: { model: IDEViewModel }): ReactElement {
  const {
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
  } = model;
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

        <div className="relative flex-1 flex min-w-0 overflow-hidden bg-[#0d0d12]">
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
              style={{
                height: isTerminalPanelOpen ? `${terminalPanelHeight}px` : "0px",
              }}
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
                className="absolute inset-0 z-40 h-full w-full border-l border-[var(--surface-border)] bg-[var(--surface-panel)] md:relative md:inset-auto md:z-auto md:min-w-[300px] md:w-[min(var(--ide-chat-width),48%)]"
                style={{ "--ide-chat-width": `${chatPanelWidth}px` } as CSSProperties}
              >
                <Suspense
                  fallback={
                    <div className="flex h-full items-center justify-center text-sm text-[var(--text-muted)]">
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Loading chat...
                    </div>
                  }
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
                </Suspense>
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
                  <IDEKeyboardSettingsPanel
                    isMacPlatform={isMacPlatform}
                    keymapOverrides={keymapOverrides}
                    recordingActionId={recordingActionId}
                    onRecordAction={setRecordingActionId}
                    onResetAction={resetKeymapAction}
                    onResetAll={resetAllKeymap}
                  />
                )}

                {ideSettingsSection === "terminal" && (
                  <IDETerminalSettingsPanel
                    isTerminalPanelOpen={isTerminalPanelOpen}
                    preferences={idePreferences}
                    terminalPanelState={terminalPanelState}
                    onNewTerminal={openNewTerminal}
                    onSetTerminalPanelOpen={setIsTerminalPanelOpen}
                    onToggleTerminalPanel={toggleTerminalPanel}
                    onUpdatePreferences={updateIdePreferences}
                  />
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
        <AdvancedIndexerSettingsModal
          activeSettings={activeIndexSettings}
          actionLoading={indexActionLoading}
          catalogLoading={embeddingCatalogLoading}
          error={indexSettingsError}
          message={indexSettingsMessage}
          status={indexStatus}
          statusLoading={indexStatusLoading}
          workspacePath={effectiveWorkspacePath}
          onChangeSettings={(settings) => {
            setIndexSettingsDraft(settings);
            setIndexSettingsDirty(true);
          }}
          onClose={() => setShowIndexerSettings(false)}
          onRefreshModels={() => void fetchEmbeddingCatalog()}
          onReindex={() => void runWorkspaceReindex()}
          onSave={() => void saveIndexSettings()}
          onStop={() => void stopWorkspaceIndexing()}
          settingsDirty={indexSettingsDirty}
        />
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
              style={{
                left: `${contextMenuPosition.left}px`,
                top: `${contextMenuPosition.top}px`,
              }}
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
