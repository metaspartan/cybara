import { Button } from "@/components/ui/Button";
import {
  type IdePendingDeletedBlock,
  type IdePendingDiffDecorations,
  type IdePendingInlinePreviewRow,
} from "@/lib/idePendingDiffDecorations";
import { cn } from "@/lib/utils";
import {
  AlertCircle,
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  Copy,
  ExternalLink,
  File,
  GitBranch,
  Search,
  Zap,
} from "lucide-react";
import { Highlight, themes } from "prism-react-renderer";
import type { CSSProperties, ReactElement } from "react";
import React from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  getPendingLineContainerClass,
  getPendingLineDecorationStyle,
  getPendingLineTextClass,
  summarizePendingDeletedBlocks,
} from "./ideDiffHelpers";
import type { Diagnostic, GitHistoryStatus, IdeBlameLine, IdeCompletionItem } from "./ideTypes";
import { formatBlameStamp, getSeverityIcon, ideMarkdownComponents } from "./ideUtils";

export interface CodeViewerViewModel {
  showMinimap: boolean;
  editContent: string;
  setEditContent: React.Dispatch<React.SetStateAction<string>>;
  saveError: string;
  isBinary: boolean;
  diagnostics: Diagnostic[];
  blameLines: Map<number, IdeBlameLine>;
  gitHistoryStatus: GitHistoryStatus;
  pendingLineDecorations: IdePendingDiffDecorations;
  activeLine: number;
  blamePopoverLine: number;
  blameAllLines: boolean;
  setBlameAllLines: React.Dispatch<React.SetStateAction<boolean>>;
  copiedCommit: string;
  hoverInfo: { line: number; text: string | null; loading: boolean };
  findQuery: string;
  setFindQuery: React.Dispatch<React.SetStateAction<string>>;
  findCaseSensitive: boolean;
  setFindCaseSensitive: React.Dispatch<React.SetStateAction<boolean>>;
  findMatches: { start: number; end: number }[];
  activeFindMatchIndex: number;
  showFindBar: boolean;
  showFindReplace: boolean;
  setShowFindReplace: React.Dispatch<React.SetStateAction<boolean>>;
  scrollMetrics: {
    top: number;
    left: number;
    height: number;
    width: number;
    scrollHeight: number;
    scrollWidth: number;
  };
  findReplaceValue: string;
  setFindReplaceValue: React.Dispatch<React.SetStateAction<string>>;
  editorContextMenu: { x: number; y: number; line: number; column: number };
  definitionLoading: boolean;
  completionItems: IdeCompletionItem[];
  completionIndex: number;
  setCompletionVisible: React.Dispatch<React.SetStateAction<boolean>>;
  completionPrefix: string;
  setIsTypingBurst: React.Dispatch<React.SetStateAction<boolean>>;
  editorRef: React.RefObject<HTMLTextAreaElement>;
  previewScrollRef: React.RefObject<HTMLDivElement>;
  highlightScrollRef: React.RefObject<HTMLDivElement>;
  gutterRef: React.RefObject<HTMLDivElement>;
  findInputRef: React.RefObject<HTMLInputElement>;
  replaceInputRef: React.RefObject<HTMLInputElement>;
  typingBurstTimeoutRef: React.RefObject<number>;
  normalizedFontSize: number;
  normalizedLineHeight: number;
  isLargeFileMode: boolean;
  disableTokenizedHighlight: boolean;
  syncEditorScroll: (scrollElement: HTMLElement | null) => void;
  scheduleCursorUpdate: (textarea: HTMLTextAreaElement | null) => void;
  markTypingBurst: () => void;
  applyCompletion: (targetIndex?: number) => boolean;
  handleFindNext: () => void;
  handleFindPrevious: () => void;
  handleReplaceCurrent: () => void;
  handleReplaceAllInFile: () => void;
  selectPendingPreviewLine: (requestedLine: number, options?: { scrollIntoView?: boolean }) => void;
  jumpToLine: (requestedLine: number) => void;
  handleEditorKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  handleEditorContextMenu: (event: React.MouseEvent<HTMLTextAreaElement>) => void;
  handleGoToDefinition: () => Promise<void>;
  handleGoToDeclaration: () => Promise<void>;
  handleGoToTypeDefinition: () => Promise<void>;
  handleGoToImplementation: () => Promise<void>;
  handleFindAllReferences: () => Promise<void>;
  handleRenameSymbol: () => void;
  handleFormatBuffer: () => void;
  handleShowCodeActions: () => void;
  handleCutSelection: () => Promise<void>;
  handleCopySelection: (trim?: boolean) => Promise<void>;
  handlePasteSelection: () => Promise<void>;
  handleRevealInFinder: () => Promise<void>;
  handleOpenInTerminal: () => Promise<void>;
  handleCopyPermalink: () => Promise<void>;
  handleViewFileHistory: () => Promise<void>;
  isMarkdownPreview: boolean;
  sourceText: string;
  sourceLines: string[];
  pendingInlinePreviewRows: IdePendingInlinePreviewRow[];
  showPendingInlinePreview: boolean;
  renderedEditorRowCount: number;
  lineHeightPx: number;
  gutterStartLine: number;
  visibleLineIndices: number[];
  pendingDeletedBlocksByLine: Map<number, IdePendingDeletedBlock[]>;
  minimapRows: {
    rows: {
      sourceLine: number;
      length: number;
      kind: IdePendingInlinePreviewRow["kind"] | "mixed";
    }[];
    step: number;
  };
  activeMinimapRow: number;
  lineDiagnostics: Map<number, Diagnostic[]>;
  highlightLanguage: string;
  showCompletionPanel: boolean;
  completionPanelPosition: { left: number; top: number };
  ghostInlineText: string;
  showGhostCompletion: boolean;
  ghostPosition: { left: number; top: number };
  showInlineBlame: boolean;
  popoverBlameDetails: IdeBlameLine;
  popoverBlameTimestamp: string;
  editorContextMenuPosition: { left: number; top: number };
  handleCopyCommit: (commit: string) => Promise<void>;
  clearBlameHideTimer: () => void;
  showBlamePopover: (line: number) => void;
  cancelBlamePopover: () => void;
  scheduleHideBlamePopover: () => void;
  scheduleHover: (displayLine: number, character: number) => void;
  scheduleHideHover: () => void;
}

export function CodeViewerView({ model }: { model: CodeViewerViewModel }): ReactElement {
  const {
    showMinimap,
    editContent,
    setEditContent,
    saveError,
    isBinary,
    diagnostics,
    blameLines,
    gitHistoryStatus,
    pendingLineDecorations,
    activeLine,
    blamePopoverLine,
    blameAllLines,
    setBlameAllLines,
    copiedCommit,
    hoverInfo,
    findQuery,
    setFindQuery,
    findCaseSensitive,
    setFindCaseSensitive,
    findMatches,
    activeFindMatchIndex,
    showFindBar,
    showFindReplace,
    setShowFindReplace,
    scrollMetrics,
    findReplaceValue,
    setFindReplaceValue,
    editorContextMenu,
    definitionLoading,
    completionItems,
    completionIndex,
    setCompletionVisible,
    completionPrefix,
    setIsTypingBurst,
    editorRef,
    previewScrollRef,
    highlightScrollRef,
    gutterRef,
    findInputRef,
    replaceInputRef,
    typingBurstTimeoutRef,
    normalizedFontSize,
    normalizedLineHeight,
    isLargeFileMode,
    disableTokenizedHighlight,
    syncEditorScroll,
    scheduleCursorUpdate,
    markTypingBurst,
    applyCompletion,
    handleFindNext,
    handleFindPrevious,
    handleReplaceCurrent,
    handleReplaceAllInFile,
    selectPendingPreviewLine,
    jumpToLine,
    handleEditorKeyDown,
    handleEditorContextMenu,
    handleGoToDefinition,
    handleGoToDeclaration,
    handleGoToTypeDefinition,
    handleGoToImplementation,
    handleFindAllReferences,
    handleRenameSymbol,
    handleFormatBuffer,
    handleShowCodeActions,
    handleCutSelection,
    handleCopySelection,
    handlePasteSelection,
    handleRevealInFinder,
    handleOpenInTerminal,
    handleCopyPermalink,
    handleViewFileHistory,
    isMarkdownPreview,
    sourceText,
    sourceLines,
    pendingInlinePreviewRows,
    showPendingInlinePreview,
    renderedEditorRowCount,
    lineHeightPx,
    gutterStartLine,
    visibleLineIndices,
    pendingDeletedBlocksByLine,
    minimapRows,
    activeMinimapRow,
    lineDiagnostics,
    highlightLanguage,
    showCompletionPanel,
    completionPanelPosition,
    ghostInlineText,
    showGhostCompletion,
    ghostPosition,
    showInlineBlame,
    popoverBlameDetails,
    popoverBlameTimestamp,
    editorContextMenuPosition,
    handleCopyCommit,
    clearBlameHideTimer,
    showBlamePopover,
    cancelBlamePopover,
    scheduleHideBlamePopover,
    scheduleHover,
    scheduleHideHover,
  } = model;
  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {saveError && (
        <div className="px-4 py-2 bg-red-500/10 border-b border-red-500/30 text-red-400 text-sm">
          {saveError}
        </div>
      )}
      {isLargeFileMode && !isBinary && (
        <div className="px-4 py-1.5 bg-amber-500/10 border-b border-amber-500/30 text-amber-200 text-xs">
          Large file mode enabled: syntax highlighting and blame are reduced for responsiveness.
        </div>
      )}
      {!isBinary && !isLargeFileMode && gitHistoryStatus === "ready" && blameLines.size > 0 && (
        <div className="px-4 py-1.5 border-b border-white/10 bg-black/20 flex items-center justify-between text-xs">
          <span className="flex items-center gap-1.5 text-gray-500">
            <GitBranch className="w-3.5 h-3.5" />
            Git blame
          </span>
          <button
            type="button"
            onClick={() => setBlameAllLines((previous) => !previous)}
            aria-pressed={blameAllLines}
            className={cn(
              "px-2 py-0.5 rounded text-[11px] border transition-colors",
              blameAllLines
                ? "border-[rgb(var(--accent-primary))] text-[rgb(var(--accent-primary))] bg-[rgba(var(--accent-primary),0.12)]"
                : "border-white/10 text-gray-400 hover:text-gray-200"
            )}
            title="Show git blame on every line (current line always shown)"
          >
            {blameAllLines ? "All lines" : "Current line"}
          </button>
        </div>
      )}

      {!isBinary && !isMarkdownPreview && showFindBar && (
        <div className="px-4 py-2 border-b border-white/10 bg-black/25 flex items-center gap-2">
          <Search className="w-3.5 h-3.5 text-gray-500" />
          <input
            ref={findInputRef}
            type="text"
            value={findQuery}
            onChange={(event) => setFindQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                if (event.shiftKey) {
                  handleFindPrevious();
                } else {
                  handleFindNext();
                }
              }
            }}
            placeholder="Find in file (Ctrl/Cmd+F)"
            className="flex-1 min-w-0 px-2 py-1 rounded border border-white/10 bg-black/40 text-xs text-gray-200 !outline-none focus:border-indigo-500/40"
          />
          <button
            type="button"
            onClick={() => setFindCaseSensitive((previous) => !previous)}
            className={cn(
              "px-2 py-1 rounded text-[11px] border transition-colors",
              findCaseSensitive
                ? "border-indigo-500/40 bg-indigo-500/20 text-indigo-300"
                : "border-white/10 text-gray-500 hover:text-gray-300"
            )}
            title="Case sensitive"
          >
            Aa
          </button>
          <button
            type="button"
            onClick={handleFindPrevious}
            disabled={findMatches.length === 0}
            className="p-1 rounded border border-white/10 text-gray-500 hover:text-gray-300 disabled:opacity-40 disabled:cursor-not-allowed"
            title="Previous match (Shift+Enter)"
          >
            <ChevronUp className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={handleFindNext}
            disabled={findMatches.length === 0}
            className="p-1 rounded border border-white/10 text-gray-500 hover:text-gray-300 disabled:opacity-40 disabled:cursor-not-allowed"
            title="Next match (Enter)"
          >
            <ChevronDown className="w-3.5 h-3.5" />
          </button>
          <span className="text-[11px] text-gray-500 tabular-nums min-w-[62px] text-right">
            {findMatches.length === 0
              ? "0/0"
              : `${Math.min(activeFindMatchIndex + 1, findMatches.length)}/${findMatches.length}`}
          </span>
          <button
            type="button"
            onClick={() => setShowFindReplace((previous) => !previous)}
            className={cn(
              "px-2 py-1 rounded text-[11px] border transition-colors",
              showFindReplace
                ? "border-indigo-500/40 bg-indigo-500/20 text-indigo-300"
                : "border-white/10 text-gray-500 hover:text-gray-300"
            )}
            title="Replace in file (Ctrl/Cmd+H)"
          >
            Replace
          </button>
        </div>
      )}

      {!isBinary && !isMarkdownPreview && showFindBar && showFindReplace && (
        <div className="px-4 py-2 border-b border-white/10 bg-black/20 flex items-center gap-2">
          <input
            ref={replaceInputRef}
            type="text"
            value={findReplaceValue}
            onChange={(event) => setFindReplaceValue(event.target.value)}
            placeholder="Replace in file"
            className="flex-1 min-w-0 px-2 py-1 rounded border border-white/10 bg-black/40 text-xs text-gray-200 !outline-none focus:border-indigo-500/40"
          />
          <Button
            variant="ghost"
            size="sm"
            onClick={handleReplaceCurrent}
            disabled={findMatches.length === 0}
            className="h-7 px-2"
            title="Replace current match"
          >
            <span className="text-xs">Replace</span>
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleReplaceAllInFile}
            disabled={findMatches.length === 0}
            className="h-7 px-2 text-amber-300 hover:text-amber-200"
            title="Replace all matches in file"
          >
            <span className="text-xs">All</span>
          </Button>
        </div>
      )}

      <div className="flex-1 min-h-0 flex overflow-hidden">
        {isBinary ? (
          <div className="flex-1 flex items-center justify-center text-gray-500">
            <div className="text-center">
              <File className="w-10 h-10 mx-auto mb-3 opacity-40" />
              <p>Binary file preview is read-only.</p>
            </div>
          </div>
        ) : isMarkdownPreview ? (
          <div className="flex-1 min-w-0 overflow-auto px-8 py-6">
            <article className="mx-auto w-full max-w-4xl">
              <ReactMarkdown remarkPlugins={[remarkGfm]} components={ideMarkdownComponents}>
                {editContent}
              </ReactMarkdown>
            </article>
          </div>
        ) : (
          <>
            <div
              ref={gutterRef}
              className="w-16 shrink-0 overflow-hidden border-r border-white/10 bg-black/30 py-4 px-2 text-right select-none font-mono text-[14px] leading-[22px]"
              style={{
                fontFamily: "var(--font-zed-mono), var(--font-mono), ui-monospace, monospace",
              }}
            >
              <div
                className="relative"
                style={{ height: `${renderedEditorRowCount * lineHeightPx}px` }}
              >
                <div
                  className="absolute left-0 right-0"
                  style={{
                    transform: `translateY(${gutterStartLine * lineHeightPx}px)`,
                  }}
                >
                  {visibleLineIndices.map((i) => {
                    if (showPendingInlinePreview) {
                      const previewRow = pendingInlinePreviewRows[i];
                      if (!previewRow) return null;
                      const lineNum = previewRow.lineNumber;
                      const diagnosticsIndex = lineNum === null ? null : lineNum - 1;
                      const lineDiags =
                        diagnosticsIndex === null
                          ? []
                          : lineDiagnostics.get(diagnosticsIndex) || [];
                      const hasError = lineDiags.some((d) => d.severity === "error");
                      const hasWarning = lineDiags.some((d) => d.severity === "warning");
                      const isActivePreviewLine = lineNum !== null && activeLine === lineNum;
                      const previewLineTextClass =
                        previewRow.kind === "added"
                          ? "text-emerald-300"
                          : previewRow.kind === "removed"
                            ? "text-red-300"
                            : hasError
                              ? "text-red-400"
                              : hasWarning
                                ? "text-yellow-400"
                                : isActivePreviewLine
                                  ? "text-indigo-200"
                                  : "text-gray-600 hover:text-gray-400";
                      return (
                        <button
                          key={`preview-gutter:${i}:${lineNum ?? "removed"}`}
                          type="button"
                          onClick={() => {
                            if (lineNum !== null) {
                              selectPendingPreviewLine(lineNum, {
                                scrollIntoView: false,
                              });
                            }
                          }}
                          disabled={lineNum === null}
                          className={cn(
                            "w-full flex items-center justify-end px-1 m-0 py-0 border-0 rounded-none appearance-none bg-transparent leading-none transition-colors",
                            lineNum === null && "cursor-default",
                            isActivePreviewLine && "bg-indigo-500/20",
                            previewLineTextClass
                          )}
                          style={{ height: `${lineHeightPx}px` }}
                          title={
                            lineDiags.map((d) => d.message).join("\n") ||
                            (lineNum === null ? "Removed line" : `Line ${lineNum}`)
                          }
                        >
                          {lineNum === null ? (
                            <span className="font-semibold">-</span>
                          ) : lineDiags.length > 0 ? (
                            hasError ? (
                              <AlertCircle className="w-3 h-3" />
                            ) : (
                              <AlertTriangle className="w-3 h-3" />
                            )
                          ) : (
                            lineNum
                          )}
                        </button>
                      );
                    }

                    const lineNum = i;
                    const lineDiags = lineDiagnostics.get(lineNum) || [];
                    const hasError = lineDiags.some((d) => d.severity === "error");
                    const hasWarning = lineDiags.some((d) => d.severity === "warning");
                    const pendingLineState = pendingLineDecorations.lineStates.get(i + 1);
                    const pendingLineTextClass = getPendingLineTextClass(
                      pendingLineState,
                      hasError,
                      hasWarning
                    );
                    return (
                      <button
                        key={i}
                        type="button"
                        onClick={() => jumpToLine(i + 1)}
                        className={cn(
                          "w-full flex items-center justify-end px-1 m-0 py-0 border-0 rounded-none appearance-none bg-transparent leading-none transition-colors",
                          activeLine === i + 1 && "bg-indigo-500/20 text-indigo-200",
                          hasError && "text-red-400",
                          hasWarning && !hasError && "text-yellow-400",
                          pendingLineTextClass,
                          !hasError &&
                            !hasWarning &&
                            !pendingLineTextClass &&
                            activeLine !== i + 1 &&
                            "text-gray-600 hover:text-gray-400"
                        )}
                        style={{ height: `${lineHeightPx}px` }}
                        title={lineDiags.map((d) => d.message).join("\n") || `Line ${i + 1}`}
                      >
                        {lineDiags.length > 0 ? (
                          hasError ? (
                            <AlertCircle className="w-3 h-3" />
                          ) : (
                            <AlertTriangle className="w-3 h-3" />
                          )
                        ) : (
                          i + 1
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
            <div className="flex-1 min-w-0 flex">
              <div className="relative flex-1 min-w-0">
                {showPendingInlinePreview ? (
                  <div
                    ref={previewScrollRef}
                    className="absolute inset-0 z-10 overflow-auto"
                    onScroll={(event) => syncEditorScroll(event.currentTarget)}
                  >
                    <pre
                      className="m-0 p-4 font-mono text-[14px] min-w-full leading-[22px] text-gray-200"
                      style={{
                        background: "transparent",
                        width: "max-content",
                        minWidth: "100%",
                        whiteSpace: "pre",
                        overflowWrap: "normal",
                        wordBreak: "normal",
                        lineHeight: `${normalizedLineHeight}px`,
                        fontSize: `${normalizedFontSize}px`,
                        fontFamily:
                          "var(--font-zed-mono), var(--font-mono), ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Courier New', 'Liberation Mono', monospace",
                      }}
                    >
                      {pendingInlinePreviewRows.map((row, index) => {
                        const diagnosticsIndex =
                          row.lineNumber === null ? null : row.lineNumber - 1;
                        const lineDiags =
                          diagnosticsIndex === null
                            ? []
                            : lineDiagnostics.get(diagnosticsIndex) || [];
                        const hasError = lineDiags.some((d) => d.severity === "error");
                        const hasWarning = lineDiags.some((d) => d.severity === "warning");
                        const isActivePreviewLine =
                          row.lineNumber !== null && activeLine === row.lineNumber;
                        const previewDecorationStyle: CSSProperties = {
                          height: `${normalizedLineHeight}px`,
                          lineHeight: `${normalizedLineHeight}px`,
                        };
                        if (row.kind === "added") {
                          previewDecorationStyle.boxShadow =
                            "inset 3px 0 0 rgba(52, 211, 153, 0.72)";
                        } else if (row.kind === "removed") {
                          previewDecorationStyle.boxShadow =
                            "inset 3px 0 0 rgba(248, 113, 113, 0.74)";
                        }
                        if (isActivePreviewLine) {
                          previewDecorationStyle.outline = "1px solid rgba(129, 140, 248, 0.45)";
                          previewDecorationStyle.outlineOffset = "-1px";
                        }
                        return (
                          <div
                            key={`preview-row:${index}:${row.lineNumber ?? "removed"}`}
                            data-line-number={row.lineNumber ?? undefined}
                            style={previewDecorationStyle}
                            className={cn(
                              "w-max min-w-full flex items-center",
                              row.kind === "added" && "bg-emerald-500/14 text-emerald-100/95",
                              row.kind === "removed" && "bg-red-500/12 text-red-100/95",
                              row.kind === "context" && hasError && "bg-red-500/10",
                              row.kind === "context" &&
                                hasWarning &&
                                !hasError &&
                                "bg-yellow-500/10",
                              row.kind === "context" &&
                                !hasError &&
                                !hasWarning &&
                                isActivePreviewLine &&
                                "bg-indigo-500/20"
                            )}
                          >
                            <button
                              type="button"
                              onClick={() => {
                                if (row.lineNumber !== null) {
                                  selectPendingPreviewLine(row.lineNumber, {
                                    scrollIntoView: false,
                                  });
                                }
                              }}
                              disabled={row.lineNumber === null}
                              className={cn(
                                "min-w-full flex-1 border-0 bg-transparent px-0 text-left font-inherit text-inherit",
                                row.lineNumber !== null ? "cursor-pointer" : "cursor-default",
                                row.kind === "removed" && "line-through"
                              )}
                              title={
                                row.lineNumber === null ? "Removed line" : `Line ${row.lineNumber}`
                              }
                            >
                              {row.text.length > 0 ? row.text : "\u00a0"}
                            </button>
                          </div>
                        );
                      })}
                    </pre>
                  </div>
                ) : (
                  <>
                    <div
                      ref={highlightScrollRef}
                      className="absolute inset-0 overflow-auto pointer-events-none z-20"
                    >
                      {disableTokenizedHighlight ? (
                        <pre
                          className="m-0 p-4 font-mono text-[14px] min-w-full leading-[22px] text-gray-200"
                          style={{
                            background: "transparent",
                            width: "max-content",
                            minWidth: "100%",
                            whiteSpace: "pre",
                            overflowWrap: "normal",
                            wordBreak: "normal",
                            lineHeight: `${normalizedLineHeight}px`,
                            fontSize: `${normalizedFontSize}px`,
                            fontFamily:
                              "var(--font-zed-mono), var(--font-mono), ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Courier New', 'Liberation Mono', monospace",
                          }}
                        >
                          <div
                            className="relative min-w-full"
                            style={{
                              height: `${renderedEditorRowCount * lineHeightPx}px`,
                              minWidth: `${Math.max(scrollMetrics.scrollWidth, scrollMetrics.width)}px`,
                            }}
                          >
                            <div
                              className="absolute left-0 right-0"
                              style={{
                                transform: `translateY(${gutterStartLine * lineHeightPx}px)`,
                              }}
                            >
                              {visibleLineIndices.map((i) => {
                                const line = sourceLines[i] || "";
                                const lineNum = i;
                                const lineDiags = lineDiagnostics.get(lineNum) || [];
                                const hasError = lineDiags.some((d) => d.severity === "error");
                                const hasWarning = lineDiags.some((d) => d.severity === "warning");
                                const isActiveLine = activeLine === i + 1;
                                const pendingLineState = pendingLineDecorations.lineStates.get(
                                  i + 1
                                );
                                const pendingDeletedSummary = summarizePendingDeletedBlocks(
                                  pendingDeletedBlocksByLine.get(i + 1)
                                );
                                return (
                                  <div
                                    key={i}
                                    data-line-number={i + 1}
                                    onMouseEnter={() => scheduleHover(i + 1, 0)}
                                    onMouseLeave={scheduleHideHover}
                                    style={{
                                      height: `${normalizedLineHeight}px`,
                                      lineHeight: `${normalizedLineHeight}px`,
                                      ...getPendingLineDecorationStyle(
                                        pendingLineState,
                                        isActiveLine
                                      ),
                                    }}
                                    className={cn(
                                      "w-max min-w-full flex items-center relative",
                                      hasError && "bg-red-500/10",
                                      hasWarning && !hasError && "bg-yellow-500/10",
                                      !pendingLineState && isActiveLine && "bg-indigo-500/20",
                                      getPendingLineContainerClass(
                                        pendingLineState,
                                        hasError,
                                        hasWarning
                                      )
                                    )}
                                  >
                                    <span className="flex-shrink-0">
                                      {line.length > 0 ? line : "\u00a0"}
                                    </span>
                                    {pendingDeletedSummary && (
                                      <span className="ml-4 inline-flex max-w-[40vw] min-w-0 flex-shrink items-center rounded border border-red-500/25 bg-red-500/10 px-1.5 py-0.5 text-[10px] text-red-200/90">
                                        <span className="truncate font-mono line-through">
                                          {pendingDeletedSummary.preview}
                                        </span>
                                        {pendingDeletedSummary.extraLines > 0 && (
                                          <span className="ml-1 flex-shrink-0 text-red-100/85 no-underline">
                                            +{pendingDeletedSummary.extraLines}
                                          </span>
                                        )}
                                      </span>
                                    )}
                                    {hoverInfo?.line === i + 1 && hoverInfo.text && (
                                      <div className="absolute z-30 left-0 top-full mt-1 max-w-[500px] rounded-md border border-white/15 bg-[#0b0f19] shadow-[0_10px_30px_rgba(0,0,0,0.5)] px-3 py-2 text-xs text-gray-300 whitespace-pre-wrap break-words pointer-events-none">
                                        <ReactMarkdown
                                          remarkPlugins={[remarkGfm]}
                                          components={ideMarkdownComponents}
                                        >
                                          {hoverInfo.text}
                                        </ReactMarkdown>
                                      </div>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        </pre>
                      ) : (
                        <Highlight
                          theme={themes.nightOwl}
                          code={sourceText}
                          language={highlightLanguage}
                        >
                          {({ className, style, tokens, getLineProps, getTokenProps }) => (
                            <pre
                              className={cn(
                                className,
                                "m-0 p-4 font-mono text-[14px] min-w-full leading-[22px]"
                              )}
                              style={{
                                ...style,
                                background: "transparent",
                                width: "max-content",
                                minWidth: "100%",
                                whiteSpace: "pre",
                                overflowWrap: "normal",
                                wordBreak: "normal",
                                tabSize: 4,
                                lineHeight: `${normalizedLineHeight}px`,
                                fontSize: `${normalizedFontSize}px`,
                                fontFamily:
                                  "var(--font-zed-mono), var(--font-mono), ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Courier New', 'Liberation Mono', monospace",
                              }}
                            >
                              {tokens.map((line, i) => {
                                const lineNum = i;
                                const lineDiags = lineDiagnostics.get(lineNum) || [];
                                const hasError = lineDiags.some((d) => d.severity === "error");
                                const hasWarning = lineDiags.some((d) => d.severity === "warning");
                                const isActiveLine = activeLine === i + 1;
                                const pendingLineState = pendingLineDecorations.lineStates.get(
                                  i + 1
                                );
                                const pendingDeletedSummary = summarizePendingDeletedBlocks(
                                  pendingDeletedBlocksByLine.get(i + 1)
                                );
                                const blameLine = blameLines.get(i + 1) || null;
                                const shouldShowLineBlame =
                                  (isActiveLine || blameAllLines) && showInlineBlame && !!blameLine;
                                const blameDate = shouldShowLineBlame
                                  ? formatBlameStamp(blameLine?.authorDate)
                                  : "";
                                const blameSummary = shouldShowLineBlame
                                  ? blameLine?.summary ||
                                    (blameLine?.isUncommitted ? "Uncommitted" : "")
                                  : "";
                                const blameText =
                                  shouldShowLineBlame && blameLine
                                    ? `${blameLine.author} · ${blameLine.shortCommit}${blameDate ? ` · ${blameDate}` : ""}${blameSummary ? ` · ${blameSummary}` : ""}`
                                    : "";
                                const lineProps = getLineProps({ line });
                                return (
                                  <div
                                    key={i}
                                    data-line-number={i + 1}
                                    {...lineProps}
                                    style={{
                                      ...(lineProps.style || {}),
                                      height: `${normalizedLineHeight}px`,
                                      lineHeight: `${normalizedLineHeight}px`,
                                      ...getPendingLineDecorationStyle(
                                        pendingLineState,
                                        isActiveLine
                                      ),
                                    }}
                                    className={cn(
                                      lineProps.className,
                                      "w-max min-w-full flex items-center",
                                      hasError && "bg-red-500/10",
                                      hasWarning && !hasError && "bg-yellow-500/10",
                                      !pendingLineState && isActiveLine && "bg-indigo-500/20",
                                      getPendingLineContainerClass(
                                        pendingLineState,
                                        hasError,
                                        hasWarning
                                      )
                                    )}
                                  >
                                    <span className="flex-shrink-0">
                                      {line.length > 0 ? (
                                        line.map((token, key) => {
                                          const tokenProps = getTokenProps({
                                            token,
                                          });
                                          const tokenText =
                                            typeof tokenProps.children === "string"
                                              ? tokenProps.children.split(/\r?\n/, 1)[0] || ""
                                              : typeof token.content === "string"
                                                ? token.content.split(/\r?\n/, 1)[0] || ""
                                                : tokenProps.children;
                                          return (
                                            <span key={key} {...tokenProps}>
                                              {tokenText}
                                            </span>
                                          );
                                        })
                                      ) : (
                                        <span>&nbsp;</span>
                                      )}
                                    </span>
                                    {pendingDeletedSummary && (
                                      <span className="ml-4 inline-flex max-w-[40vw] min-w-0 flex-shrink items-center rounded border border-red-500/25 bg-red-500/10 px-1.5 py-0.5 text-[10px] text-red-200/90">
                                        <span className="truncate font-mono line-through">
                                          {pendingDeletedSummary.preview}
                                        </span>
                                        {pendingDeletedSummary.extraLines > 0 && (
                                          <span className="ml-1 flex-shrink-0 text-red-100/85 no-underline">
                                            +{pendingDeletedSummary.extraLines}
                                          </span>
                                        )}
                                      </span>
                                    )}
                                    {shouldShowLineBlame && (
                                      <span className="relative ml-5 inline-flex max-w-[54vw] flex-shrink-0 items-center">
                                        <button
                                          type="button"
                                          onMouseEnter={() => showBlamePopover(i + 1)}
                                          onMouseLeave={cancelBlamePopover}
                                          disabled={!blameLine}
                                          className={cn(
                                            "max-w-full truncate border-0 bg-transparent p-0 text-left font-mono text-[14px] leading-[22px]",
                                            blameLine
                                              ? "pointer-events-auto text-gray-500 hover:text-gray-300"
                                              : "text-gray-700 cursor-default"
                                          )}
                                          title={blameText}
                                        >
                                          {blameText}
                                        </button>
                                        {popoverBlameDetails && blamePopoverLine === i + 1 && (
                                          <div
                                            className="pointer-events-auto absolute left-0 top-[18px] z-30 mt-1 rounded-md border border-white/15 bg-black/80 px-2.5 py-2 text-[11px] text-gray-300 shadow-lg backdrop-blur min-w-[280px]"
                                            onMouseEnter={clearBlameHideTimer}
                                            onMouseLeave={scheduleHideBlamePopover}
                                          >
                                            <div className="flex items-center justify-between gap-2">
                                              <span className="font-medium text-emerald-200">
                                                Line {blamePopoverLine}
                                              </span>
                                              <div className="flex items-center gap-1">
                                                {!popoverBlameDetails.isUncommitted && (
                                                  <button
                                                    type="button"
                                                    onClick={() =>
                                                      void handleCopyCommit(
                                                        popoverBlameDetails.commit
                                                      )
                                                    }
                                                    className="p-1 rounded border border-white/15 text-gray-300 hover:text-white hover:bg-white/10"
                                                    title={
                                                      copiedCommit === popoverBlameDetails.commit
                                                        ? "Copied"
                                                        : "Copy commit hash"
                                                    }
                                                  >
                                                    <Copy className="w-3 h-3" />
                                                  </button>
                                                )}
                                                {popoverBlameDetails.commitUrl && (
                                                  <a
                                                    href={popoverBlameDetails.commitUrl}
                                                    target="_blank"
                                                    rel="noopener noreferrer"
                                                    className="p-1 rounded border border-white/15 text-indigo-300 hover:text-indigo-200 hover:bg-white/10"
                                                    title="Open commit details"
                                                  >
                                                    <ExternalLink className="w-3 h-3" />
                                                  </a>
                                                )}
                                              </div>
                                            </div>
                                            <div className="mt-1 text-[10px] text-gray-400">
                                              {popoverBlameDetails.author}
                                              {popoverBlameTimestamp
                                                ? ` · ${popoverBlameTimestamp}`
                                                : ""}
                                            </div>
                                            <div className="mt-1 text-[10px] text-gray-500 break-all">
                                              {popoverBlameDetails.isUncommitted
                                                ? "Uncommitted local changes"
                                                : `${popoverBlameDetails.shortCommit} · ${popoverBlameDetails.commit}`}
                                            </div>
                                            {(popoverBlameDetails.commitDescription ||
                                              popoverBlameDetails.summary) && (
                                              <div className="mt-1 whitespace-pre-wrap text-[11px] text-gray-300 break-words">
                                                {popoverBlameDetails.commitDescription ||
                                                  popoverBlameDetails.summary}
                                              </div>
                                            )}
                                          </div>
                                        )}
                                      </span>
                                    )}
                                  </div>
                                );
                              })}
                            </pre>
                          )}
                        </Highlight>
                      )}
                    </div>

                    <textarea
                      ref={editorRef}
                      value={editContent}
                      onChange={(e) => {
                        setEditContent(e.target.value);
                        markTypingBurst();
                      }}
                      onKeyDown={handleEditorKeyDown}
                      onSelect={(e) => scheduleCursorUpdate(e.currentTarget)}
                      onBlur={() => {
                        if (typingBurstTimeoutRef.current !== null) {
                          window.clearTimeout(typingBurstTimeoutRef.current);
                          typingBurstTimeoutRef.current = null;
                        }
                        setIsTypingBurst(false);
                        window.setTimeout(() => {
                          setCompletionVisible(false);
                        }, 80);
                      }}
                      onContextMenu={handleEditorContextMenu}
                      onScroll={(e) => syncEditorScroll(e.currentTarget)}
                      className="absolute inset-0 z-10 p-4 font-mono text-[14px] leading-[22px] bg-transparent text-transparent caret-indigo-200 resize-none !outline-none focus:!outline-none selection:bg-indigo-500/30"
                      spellCheck={false}
                      wrap="off"
                      style={{
                        tabSize: 4,
                        lineHeight: `${normalizedLineHeight}px`,
                        fontSize: `${normalizedFontSize}px`,
                        color: "transparent",
                        WebkitTextFillColor: "transparent",
                        textShadow: "none",
                        caretColor: "#c7d2fe",
                        whiteSpace: "pre",
                        overflowWrap: "normal",
                        wordBreak: "normal",
                        fontFamily:
                          "var(--font-zed-mono), var(--font-mono), ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Courier New', 'Liberation Mono', monospace",
                        margin: 0,
                      }}
                    />
                    {showGhostCompletion && ghostPosition && (
                      <div
                        className="absolute z-20 pointer-events-none text-gray-500/75 whitespace-pre"
                        style={{
                          left: `${ghostPosition.left}px`,
                          top: `${ghostPosition.top}px`,
                          lineHeight: `${normalizedLineHeight}px`,
                          fontSize: `${normalizedFontSize}px`,
                          fontFamily:
                            "var(--font-zed-mono), var(--font-mono), ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Courier New', 'Liberation Mono', monospace",
                        }}
                      >
                        {ghostInlineText}
                      </div>
                    )}
                    {showCompletionPanel && completionPanelPosition && (
                      <div
                        className="absolute z-30 w-[340px] max-w-[80%] max-h-64 overflow-y-auto rounded-md border border-white/15 bg-[#0a0a10]/95 shadow-xl backdrop-blur"
                        style={{
                          left: `${Math.min(completionPanelPosition.left, 560)}px`,
                          top: `${completionPanelPosition.top}px`,
                        }}
                      >
                        <div className="px-2 py-1.5 border-b border-white/10 text-[10px] text-gray-500 flex items-center justify-between">
                          <span>
                            Completions {completionPrefix ? `for "${completionPrefix}"` : ""}
                          </span>
                          <span>Tab to accept</span>
                        </div>
                        <div className="divide-y divide-white/5">
                          {completionItems.slice(0, 12).map((item, index) => (
                            <button
                              key={`${item.label}:${item.insertText || ""}:${index}`}
                              type="button"
                              onMouseDown={(event) => {
                                event.preventDefault();
                                void applyCompletion(index);
                              }}
                              className={cn(
                                "w-full text-left px-2 py-1.5 hover:bg-white/10",
                                index === completionIndex && "bg-indigo-500/20"
                              )}
                            >
                              <div className="text-xs text-gray-100 truncate">{item.label}</div>
                              {(item.detail || item.kind) && (
                                <div className="text-[10px] text-gray-500 truncate">
                                  {item.detail || `Kind ${item.kind}`}
                                </div>
                              )}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </>
                )}
              </div>

              {showMinimap && (
                <div className="w-24 shrink-0 border-l border-white/10 bg-[#080810] hidden xl:flex flex-col">
                  <div
                    className="relative flex-1 overflow-hidden cursor-pointer"
                    onMouseDown={(event) => {
                      const scrollElement = showPendingInlinePreview
                        ? previewScrollRef.current
                        : editorRef.current;
                      if (!scrollElement) return;
                      const rect = event.currentTarget.getBoundingClientRect();
                      const ratio = Math.max(
                        0,
                        Math.min(1, (event.clientY - rect.top) / Math.max(rect.height, 1))
                      );
                      const target =
                        ratio * scrollElement.scrollHeight - scrollElement.clientHeight / 2;
                      const maxScroll = Math.max(
                        scrollElement.scrollHeight - scrollElement.clientHeight,
                        0
                      );
                      scrollElement.scrollTop = Math.max(0, Math.min(target, maxScroll));
                      syncEditorScroll(scrollElement);
                      if (scrollElement instanceof HTMLTextAreaElement) {
                        scrollElement.focus();
                      }
                    }}
                    title="Minimap"
                  >
                    <div className="absolute inset-0 px-2 py-3 space-y-px overflow-hidden">
                      {minimapRows.rows.map((row, index) => {
                        const len = row.length;
                        const width = Math.max(10, Math.min(100, (len / 140) * 100));
                        const isActive = activeMinimapRow === index;
                        return (
                          <div
                            key={`minimap:${row.sourceLine}`}
                            className={cn(
                              "h-[2px] rounded-sm",
                              isActive
                                ? "bg-indigo-300/70"
                                : row.kind === "added"
                                  ? "bg-emerald-300/40"
                                  : row.kind === "removed"
                                    ? "bg-red-300/40"
                                    : row.kind === "mixed"
                                      ? "bg-amber-300/35"
                                      : "bg-white/20"
                            )}
                            style={{ width: `${width}%` }}
                          />
                        );
                      })}
                    </div>
                    <div
                      className="absolute left-0 right-0 border border-indigo-400/40 bg-indigo-500/10 pointer-events-none"
                      style={{
                        height: `${Math.max((scrollMetrics.height / Math.max(scrollMetrics.scrollHeight, 1)) * 100, 6)}%`,
                        top: `${Math.min(
                          (scrollMetrics.top /
                            Math.max(scrollMetrics.scrollHeight - scrollMetrics.height, 1)) *
                            (100 -
                              Math.max(
                                (scrollMetrics.height / Math.max(scrollMetrics.scrollHeight, 1)) *
                                  100,
                                6
                              )),
                          100
                        )}%`,
                      }}
                    />
                  </div>
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {diagnostics.length > 0 && (
        <div className="max-h-48 overflow-y-auto border-t border-white/10 bg-black/30">
          <div className="px-3 py-2 text-xs font-medium text-gray-400 border-b border-white/5 flex items-center gap-2">
            <Zap className="w-3 h-3" />
            Problems ({diagnostics.length})
          </div>
          <div className="divide-y divide-white/5">
            {diagnostics.map((diag, i) => (
              <button
                key={i}
                type="button"
                onClick={() => jumpToLine(diag.line + 1)}
                className="w-full text-left px-3 py-2 text-sm flex items-start gap-2 hover:bg-white/5"
              >
                {getSeverityIcon(diag.severity)}
                <div className="flex-1 min-w-0">
                  <p className="text-gray-300 break-words">{diag.message}</p>
                  <p className="text-xs text-gray-500 mt-0.5">
                    Line {diag.line + 1}, Col {diag.character + 1}
                    {diag.source && <span className="ml-2">[{diag.source}]</span>}
                    {diag.code && <span className="ml-1">({diag.code})</span>}
                  </p>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}
      {editorContextMenu && editorContextMenuPosition && (
        <div
          className="fixed z-[85] min-w-[260px] rounded-md border border-white/15 bg-[#0a0a10] p-1 shadow-2xl"
          style={{
            left: `${editorContextMenuPosition.left}px`,
            top: `${editorContextMenuPosition.top}px`,
          }}
          onMouseDown={(event) => event.stopPropagation()}
        >
          <button
            type="button"
            disabled={definitionLoading}
            onClick={() => {
              void handleGoToDefinition();
            }}
            className={cn(
              "w-full rounded px-2 py-1.5 text-left text-xs text-gray-200 hover:bg-white/10 flex items-center justify-between",
              definitionLoading && "opacity-60 cursor-not-allowed"
            )}
          >
            <span>{definitionLoading ? "Resolving..." : "Go to Definition"}</span>
            <span className="text-[10px] text-gray-500">F12</span>
          </button>
          <button
            type="button"
            disabled={definitionLoading}
            onClick={() => {
              void handleGoToDeclaration();
            }}
            className="w-full rounded px-2 py-1.5 text-left text-xs text-gray-200 hover:bg-white/10 flex items-center justify-between"
          >
            <span>Go to Declaration</span>
            <span className="text-[10px] text-gray-500">Ctrl/Cmd+F12</span>
          </button>
          <button
            type="button"
            disabled={definitionLoading}
            onClick={() => {
              void handleGoToTypeDefinition();
            }}
            className="w-full rounded px-2 py-1.5 text-left text-xs text-gray-200 hover:bg-white/10 flex items-center justify-between"
          >
            <span>Go to Type Definition</span>
            <span className="text-[10px] text-gray-500">Cmd+F12</span>
          </button>
          <button
            type="button"
            disabled={definitionLoading}
            onClick={() => {
              void handleGoToImplementation();
            }}
            className="w-full rounded px-2 py-1.5 text-left text-xs text-gray-200 hover:bg-white/10 flex items-center justify-between"
          >
            <span>Go to Implementation</span>
            <span className="text-[10px] text-gray-500">Shift+F12</span>
          </button>
          <button
            type="button"
            disabled={definitionLoading}
            onClick={() => {
              void handleFindAllReferences();
            }}
            className="w-full rounded px-2 py-1.5 text-left text-xs text-gray-200 hover:bg-white/10 flex items-center justify-between"
          >
            <span>Find All References</span>
            <span className="text-[10px] text-gray-500">Alt+Shift+F12</span>
          </button>
          <div className="my-1 h-px bg-white/10" />
          <button
            type="button"
            onClick={handleRenameSymbol}
            className="w-full rounded px-2 py-1.5 text-left text-xs text-gray-200 hover:bg-white/10 flex items-center justify-between"
          >
            <span>Rename Symbol</span>
            <span className="text-[10px] text-gray-500">F2</span>
          </button>
          <button
            type="button"
            onClick={handleFormatBuffer}
            className="w-full rounded px-2 py-1.5 text-left text-xs text-gray-200 hover:bg-white/10"
          >
            Format Buffer
          </button>
          <button
            type="button"
            onClick={handleShowCodeActions}
            className="w-full rounded px-2 py-1.5 text-left text-xs text-gray-200 hover:bg-white/10"
          >
            Show Code Actions
          </button>
          <div className="my-1 h-px bg-white/10" />
          <button
            type="button"
            onClick={() => {
              void handleCutSelection();
            }}
            className="w-full rounded px-2 py-1.5 text-left text-xs text-gray-200 hover:bg-white/10 flex items-center justify-between"
          >
            <span>Cut</span>
            <span className="text-[10px] text-gray-500">Ctrl/Cmd+X</span>
          </button>
          <button
            type="button"
            onClick={() => {
              void handleCopySelection(false);
            }}
            className="w-full rounded px-2 py-1.5 text-left text-xs text-gray-200 hover:bg-white/10 flex items-center justify-between"
          >
            <span>Copy</span>
            <span className="text-[10px] text-gray-500">Ctrl/Cmd+C</span>
          </button>
          <button
            type="button"
            onClick={() => {
              void handleCopySelection(true);
            }}
            className="w-full rounded px-2 py-1.5 text-left text-xs text-gray-200 hover:bg-white/10"
          >
            Copy and Trim
          </button>
          <button
            type="button"
            onClick={() => {
              void handlePasteSelection();
            }}
            className="w-full rounded px-2 py-1.5 text-left text-xs text-gray-200 hover:bg-white/10 flex items-center justify-between"
          >
            <span>Paste</span>
            <span className="text-[10px] text-gray-500">Ctrl/Cmd+V</span>
          </button>
          <div className="my-1 h-px bg-white/10" />
          <button
            type="button"
            onClick={() => {
              void handleRevealInFinder();
            }}
            className="w-full rounded px-2 py-1.5 text-left text-xs text-gray-200 hover:bg-white/10"
          >
            Reveal in Finder
          </button>
          <button
            type="button"
            onClick={() => {
              void handleOpenInTerminal();
            }}
            className="w-full rounded px-2 py-1.5 text-left text-xs text-gray-200 hover:bg-white/10"
          >
            Open in Terminal
          </button>
          <button
            type="button"
            onClick={() => {
              void handleCopyPermalink();
            }}
            className="w-full rounded px-2 py-1.5 text-left text-xs text-gray-200 hover:bg-white/10"
          >
            Copy Permalink
          </button>
          <button
            type="button"
            onClick={() => {
              void handleViewFileHistory();
            }}
            className="w-full rounded px-2 py-1.5 text-left text-xs text-gray-200 hover:bg-white/10"
          >
            View File History
          </button>
          <div className="my-1 h-px bg-white/10" />
          <div className="px-2 py-1 text-[10px] text-gray-500">
            Line {editorContextMenu.line}, Col {editorContextMenu.column}
          </div>
        </div>
      )}
    </div>
  );
}
