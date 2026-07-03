import React, { useState, useRef, useEffect, useMemo, useCallback, useDeferredValue } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Highlight, themes } from "prism-react-renderer";
import {
  Loader2, Check, AlertTriangle, AlertCircle, Info, RotateCcw, X, ChevronRight, ChevronDown,
  ChevronUp, File, FileCode, FileJson, FileText, FilePlus, Folder, FolderOpen, Search, Save,
  RefreshCw, Copy, Code, Zap, Sparkles, MessageSquare, Square, ListTree, GitBranch,
  ExternalLink, CheckCircle2,
} from "lucide-react";
import type { CSSProperties } from "react";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/utils";
import { apiFetch } from "@/lib/auth";
import { chatApi, agentsApi } from "@/lib/api";
import { useStopAgent } from "@/hooks/useApi";
import {
  mergeActivityLists, normalizeActivityTextForPhase, finalizeCompletedActivities,
  buildActivitiesFromToolCalls, type LiveActivityItem, type ToolCallLike,
} from "@/lib/chatActivities";
import { connectStatusStream } from "@/lib/status-stream";
import {
  parseGitDiffDecorations, countGitDiffLineChanges, mergeGitDiffDecorations,
  buildPendingInlinePreviewRows, emptyIdePendingDiffDecorations,
  type IdePendingLineState, type IdePendingDeletedBlock,
  type IdePendingInlinePreviewRow, type IdePendingDiffDecorations,
} from "@/lib/idePendingDiffDecorations";
import {
  IDE_DEFAULT_PREFERENCES, IDE_CHAT_AGENT_STORAGE_KEY, IDE_CHAT_OPEN_STORAGE_KEY,
  IDE_CHAT_WIDTH_STORAGE_KEY, EDITOR_FONT_SIZE_PX, EDITOR_LINE_HEIGHT_PX,
  EDITOR_LARGE_FILE_CHAR_THRESHOLD, EDITOR_LARGE_FILE_LINE_THRESHOLD,
  COMPLETION_LOCAL_SCAN_BEFORE, COMPLETION_LOCAL_SCAN_AFTER, COMPLETION_CACHE_TTL_MS, COMPLETION_CACHE_MAX_ENTRIES,
  EDITOR_TYPING_BURST_MS,
} from "./ideConstants";
import { getActiveLanguageFromExtension } from "./ideLanguageMaps";
import {
  getFileIcon, formatSize, getLineAndColumn, getPrismLanguage, splitPathForBreadcrumbs,
  flattenOutlineSymbols, getSymbolKindLabel, fileEntryFromPath, isMarkdownExtension,
  ideMarkdownComponents, formatBlameStamp, formatBlameDateTime, scoreQuickOpenResult, getSeverityIcon,
} from "./ideUtils";
import {
  isPlainRecord, normalizeIdePath, getIdePendingFileDecisionKey, isSameIdePath, countDiffLines,
  truncateDiffPreview, shouldHydratePendingFileDiffFromGit, getPendingLineTextClass,
  getPendingLineContainerClass, getPendingLineDecorationStyle, summarizePendingDeletedBlocks,
  parseIdePatchFileChanges, parseIdeChangeRecord, summarizeIdeFileChanges,
  summarizeIdeTextFileChanges, summarizeIdeMessageFileChanges, summarizeIdeActivityFileChanges,
  mergeIdeFileChangeSummaries, reverseUnifiedDiff, isIdeToolCallLike, getIdeToolCallsInTimelineOrder,
} from "./ideDiffHelpers";
import {
  getIdeToolCallArgs, getIdeToolCallCommand, getIdeToolCallResultSummary, getIdeToolCallExitCode,
  parseIdeTimestampMs, normalizeIdeSandboxProviderValue, formatIdeSandboxProviderLabel,
  isGenericIdeStatusLabel, isMeaningfulIdeThoughtDetail, getLatestIdeInFlightStep,
  toIdeLiveActivityItems, formatIdeStatusEventText, getIdeHeaderTitle,
} from "./ideActivityHelpers";
import {
  persistIdeChatAgentId, readPersistedChatOpen, persistChatOpen, readPersistedChatWidth,
  persistChatWidth, readPersistedIdeChatAgentId, readPersistedIdePreferences,
} from "./idePersistence";
import type {
  FileEntry, BrowseResult, ReadResult, Diagnostic, LspActiveServer,
  IdeSearchMatch, IdeSearchFileResult, IdeSearchResult, IdeReplaceResult,
  IdeReplacePreviewFile, IdeReplacePreviewResult, IdeListFilesResult, WorkspaceIndexerSettings,
  IdeBlameLine, IdeBlameResult, GitHistoryStatus, IdeTab, IdeChatMessage, IdeChatAgentOption,
  IdeProcessActivity, IdeFileChangeItem, IdeFileChangeSummary, IdePendingFileDiff,
  IdePendingFileDiffController, TreeContextMenuState, IdeCommandItem, IdeOutlineSymbol,
  IdeOutlineResponse, IdeCompletionItem, IdeCompletionResponse, IdeInlineCompletionResponse,
  FlattenedOutlineSymbol, IdeBreadcrumb, IdeSettingsSectionId, IdeTopMenuId, IdePreferences,
} from "./ideTypes";
import { IdeActivityText, IdeProcessActivityList, IdeLiveActivityTimeline } from "./IdeActivityTimeline";

export function CodeViewer({
  path,
  previewMode = false,
  autoRefresh,
  jumpToLineRequest,
  externalRefreshKey,
  saveRequestToken,
  onSaveSuccess,
  onCursorChange,
  onGitHistoryStatusChange,
  onOpenLocation,
  completionAgentId,
  editorFontSizePx = EDITOR_FONT_SIZE_PX,
  editorLineHeightPx = EDITOR_LINE_HEIGHT_PX,
  showMinimap = true,
  enableCompletions = false,
  enableGhostCompletions = false,
  completionDebounceMs = 110,
  ghostDebounceMs = 240,
  pendingFileDiffs,
}: {
  path: string | null;
  previewMode?: boolean;
  autoRefresh: boolean;
  jumpToLineRequest?: number | null;
  externalRefreshKey?: number;
  saveRequestToken?: number;
  onSaveSuccess?: () => void;
  onCursorChange?: (position: { line: number; column: number } | null) => void;
  onGitHistoryStatusChange?: (status: GitHistoryStatus) => void;
  onOpenLocation?: (filePath: string, line: number) => void;
  completionAgentId?: string | null;
  editorFontSizePx?: number;
  editorLineHeightPx?: number;
  showMinimap?: boolean;
  enableCompletions?: boolean;
  enableGhostCompletions?: boolean;
  completionDebounceMs?: number;
  ghostDebounceMs?: number;
  pendingFileDiffs?: IdePendingFileDiff[];
}) {
  const [content, setContent] = useState<string | null>(null);
  const [editContent, setEditContent] = useState<string>("");
  const [extension, setExtension] = useState<string>("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [isBinary, setIsBinary] = useState(false);
  const [diagnostics, setDiagnostics] = useState<Diagnostic[]>([]);
  const [blameLines, setBlameLines] = useState<Map<number, IdeBlameLine>>(new Map());
  const [blameLoading, setBlameLoading] = useState(false);
  const [gitHistoryStatus, setGitHistoryStatus] = useState<GitHistoryStatus>("idle");
  const [pendingLineDecorations, setPendingLineDecorations] = useState<IdePendingDiffDecorations>(
    () => emptyIdePendingDiffDecorations()
  );
  const [pendingPreviewDiff, setPendingPreviewDiff] = useState<string | null>(null);
  const [activeLine, setActiveLine] = useState(1);
  const [blamePopoverLine, setBlamePopoverLine] = useState<number | null>(null);
  const [copiedCommit, setCopiedCommit] = useState<string | null>(null);
  const [hoverInfo, setHoverInfo] = useState<{ line: number; text: string | null; loading: boolean } | null>(null);
  const hoverAbortRef = useRef<AbortController | null>(null);
  const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [cursorLine, setCursorLine] = useState(1);
  const [cursorColumn, setCursorColumn] = useState(1);
  const [findQuery, setFindQuery] = useState("");
  const [findCaseSensitive, setFindCaseSensitive] = useState(false);
  const [findMatches, setFindMatches] = useState<Array<{ start: number; end: number }>>([]);
  const [activeFindMatchIndex, setActiveFindMatchIndex] = useState(0);
  const [showFindBar, setShowFindBar] = useState(false);
  const [showFindReplace, setShowFindReplace] = useState(false);
  const [scrollMetrics, setScrollMetrics] = useState({
    top: 0,
    left: 0,
    height: 1,
    width: 1,
    scrollHeight: 1,
    scrollWidth: 1,
  });
  const [findReplaceValue, setFindReplaceValue] = useState("");
  const [editorContextMenu, setEditorContextMenu] = useState<{
    x: number;
    y: number;
    line: number;
    column: number;
  } | null>(null);
  const [definitionLoading, setDefinitionLoading] = useState(false);
  const [completionItems, setCompletionItems] = useState<IdeCompletionItem[]>([]);
  const [completionIndex, setCompletionIndex] = useState(0);
  const [completionVisible, setCompletionVisible] = useState(false);
  const [completionLoading, setCompletionLoading] = useState(false);
  const [completionReplaceStart, setCompletionReplaceStart] = useState(0);
  const [completionPrefix, setCompletionPrefix] = useState("");
  const [completionOrigin, setCompletionOrigin] = useState<{ line: number; column: number } | null>(
    null
  );
  const [ghostCompletion, setGhostCompletion] = useState("");
  const [ghostOrigin, setGhostOrigin] = useState<{
    line: number;
    column: number;
    replaceStart: number;
  } | null>(null);
  const [isTypingBurst, setIsTypingBurst] = useState(false);
  const editorRef = useRef<HTMLTextAreaElement | null>(null);
  const previewScrollRef = useRef<HTMLDivElement | null>(null);
  const highlightScrollRef = useRef<HTMLDivElement | null>(null);
  const gutterRef = useRef<HTMLDivElement | null>(null);
  const findInputRef = useRef<HTMLInputElement | null>(null);
  const replaceInputRef = useRef<HTMLInputElement | null>(null);
  const appliedJumpRequestRef = useRef<string>("");
  const hasUnsavedChangesRef = useRef(false);
  const blameHideTimeoutRef = useRef<number | null>(null);
  const scrollMetricsFrameRef = useRef<number | null>(null);
  const pendingScrollMetricsRef = useRef<{
    top: number;
    left: number;
    height: number;
    width: number;
    scrollHeight: number;
    scrollWidth: number;
  } | null>(null);
  const completionRequestSeqRef = useRef(0);
  const completionDebounceRef = useRef<number | null>(null);
  const completionAbortRef = useRef<AbortController | null>(null);
  const completionCacheRef = useRef<Map<string, { ts: number; items: IdeCompletionItem[] }>>(
    new Map()
  );
  const ghostRequestSeqRef = useRef(0);
  const ghostDebounceRef = useRef<number | null>(null);
  const ghostAbortRef = useRef<AbortController | null>(null);
  const ghostCacheRef = useRef<Map<string, { ts: number; text: string }>>(new Map());
  const fileReadRequestSeqRef = useRef(0);
  const fileReadAbortRef = useRef<AbortController | null>(null);
  const blameRequestSeqRef = useRef(0);
  const blameAbortRef = useRef<AbortController | null>(null);
  const lineChangesRequestSeqRef = useRef(0);
  const lineChangesAbortRef = useRef<AbortController | null>(null);
  const typingBurstTimeoutRef = useRef<number | null>(null);
  const pendingCursorNotifyRef = useRef<{ line: number; column: number } | null>(null);
  const cursorNotifyFrameRef = useRef<number | null>(null);
  const pendingCursorSelectionRef = useRef<HTMLTextAreaElement | null>(null);
  const cursorSelectionFrameRef = useRef<number | null>(null);
  const showPendingInlinePreviewRef = useRef(false);
  const previousPendingInlinePreviewRef = useRef(false);
  const pendingPreviewRowIndexByLineRef = useRef<Map<number, number>>(new Map());
  const normalizedFontSize = Math.max(11, Math.min(22, Math.round(editorFontSizePx)));
  const normalizedLineHeight = Math.max(16, Math.min(38, Math.round(editorLineHeightPx)));
  const normalizedCompletionDebounce = Math.max(
    30,
    Math.min(800, Math.round(completionDebounceMs))
  );
  const normalizedGhostDebounce = Math.max(60, Math.min(1400, Math.round(ghostDebounceMs)));
  const charWidthPx = Math.max(6.4, Math.min(14, Number((normalizedFontSize * 0.586).toFixed(2))));
  const normalizedExtension = (extension || "").toLowerCase().replace(/^\./, "");
  const isMarkdownFile =
    normalizedExtension === "md" ||
    normalizedExtension === "markdown" ||
    normalizedExtension === "mdx" ||
    /\.(md|markdown|mdx)$/i.test(path || "");

  const hasUnsavedChanges = editContent !== (content || "");
  const isLargeFileMode = useMemo(() => {
    const text = editContent || content || "";
    if (text.length >= EDITOR_LARGE_FILE_CHAR_THRESHOLD) return true;
    let lineCount = 1;
    for (let i = 0; i < text.length; i += 1) {
      if (text.charCodeAt(i) === 10) {
        lineCount += 1;
        if (lineCount >= EDITOR_LARGE_FILE_LINE_THRESHOLD) {
          return true;
        }
      }
    }
    return false;
  }, [content, editContent]);
  const disableTokenizedHighlight = isLargeFileMode || isTypingBurst;

  useEffect(() => {
    hasUnsavedChangesRef.current = hasUnsavedChanges;
  }, [hasUnsavedChanges]);

  const emitCursorChange = useCallback(
    (position: { line: number; column: number } | null) => {
      if (!onCursorChange) return;
      pendingCursorNotifyRef.current = position;
      if (cursorNotifyFrameRef.current !== null) return;
      cursorNotifyFrameRef.current = window.requestAnimationFrame(() => {
        cursorNotifyFrameRef.current = null;
        onCursorChange(pendingCursorNotifyRef.current);
      });
    },
    [onCursorChange]
  );

  const fetchContent = useCallback(
    async (options?: { resetEditor?: boolean }) => {
      if (!path) return;

      const requestId = fileReadRequestSeqRef.current + 1;
      fileReadRequestSeqRef.current = requestId;
      if (fileReadAbortRef.current) {
        fileReadAbortRef.current.abort();
      }
      const controller = new AbortController();
      fileReadAbortRef.current = controller;

      setIsLoading(true);
      setError(null);
      try {
        const res = await apiFetch(`/api/ide/read?path=${encodeURIComponent(path)}`, {
          signal: controller.signal,
        });
        const data: ReadResult = await res.json();
        if (fileReadRequestSeqRef.current !== requestId) return;
        if (data.success) {
          // Normalize line endings for stable cursor/line mapping in the editor UI.
          const nextContent = (data.content || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
          setContent(nextContent);
          setEditContent((previous) => {
            if (options?.resetEditor || !hasUnsavedChangesRef.current) {
              return nextContent;
            }
            return previous;
          });
          setExtension(data.extension || "");
          setIsBinary(data.isBinary || false);
        } else {
          setError(data.error || "Failed to load file");
        }
      } catch (e) {
        if ((e as Error)?.name !== "AbortError") {
          setError(String(e));
        }
      } finally {
        if (fileReadAbortRef.current === controller) {
          fileReadAbortRef.current = null;
        }
        if (fileReadRequestSeqRef.current === requestId) {
          setIsLoading(false);
        }
      }
    },
    [path]
  );

  const fetchDiagnostics = useCallback(async () => {
    if (!path || isLargeFileMode) {
      setDiagnostics([]);
      return;
    }

    try {
      const res = await apiFetch(`/api/lsp/diagnostics/file?path=${encodeURIComponent(path)}`);
      const data = await res.json();
      if (data.success && data.diagnostics) {
        setDiagnostics(data.diagnostics);
      }
    } catch {}
  }, [isLargeFileMode, path]);

  const fetchBlame = useCallback(async () => {
    if (!path || isBinary || isLargeFileMode) {
      if (blameAbortRef.current) {
        blameAbortRef.current.abort();
        blameAbortRef.current = null;
      }
      setBlameLines(new Map());
      setBlameLoading(false);
      setGitHistoryStatus("unavailable");
      return;
    }

    const requestId = blameRequestSeqRef.current + 1;
    blameRequestSeqRef.current = requestId;
    if (blameAbortRef.current) {
      blameAbortRef.current.abort();
    }
    const controller = new AbortController();
    blameAbortRef.current = controller;

    const contentLineCount = Math.max(1, (content || "").split("\n").length);
    const maxBlameLines = Math.max(3000, Math.min(contentLineCount + 64, 50000));

    setBlameLoading(true);
    setGitHistoryStatus("loading");
    try {
      const res = await apiFetch(
        `/api/ide/blame?path=${encodeURIComponent(path)}&maxLines=${encodeURIComponent(String(maxBlameLines))}`,
        { signal: controller.signal }
      );
      const data: IdeBlameResult = await res.json();
      if (blameRequestSeqRef.current !== requestId) return;
      if (data.success && data.isRepo && Array.isArray(data.lines)) {
        const nextMap = new Map<number, IdeBlameLine>();
        for (const line of data.lines) {
          nextMap.set(line.line, line);
        }
        setBlameLines(nextMap);
        setGitHistoryStatus("ready");
      } else {
        setBlameLines(new Map());
        setGitHistoryStatus("unavailable");
      }
    } catch (errorValue) {
      if ((errorValue as Error)?.name !== "AbortError") {
        setBlameLines(new Map());
        setGitHistoryStatus("error");
      }
    } finally {
      if (blameAbortRef.current === controller) {
        blameAbortRef.current = null;
      }
      if (blameRequestSeqRef.current === requestId) {
        setBlameLoading(false);
      }
    }
  }, [content, isBinary, isLargeFileMode, path]);

  const fetchLineChanges = useCallback(async () => {
    const currentLineCount = Math.max(1, (content || "").split("\n").length);
    if (!path || isBinary || isLargeFileMode) {
      if (lineChangesAbortRef.current) {
        lineChangesAbortRef.current.abort();
        lineChangesAbortRef.current = null;
      }
      setPendingLineDecorations(emptyIdePendingDiffDecorations());
      setPendingPreviewDiff(null);
      return;
    }

    if (Array.isArray(pendingFileDiffs)) {
      const forCurrentFile = pendingFileDiffs.filter(
        (entry) => entry && typeof entry.path === "string" && isSameIdePath(path, entry.path)
      );
      if (forCurrentFile.length === 0) {
        setPendingLineDecorations(emptyIdePendingDiffDecorations());
        setPendingPreviewDiff(null);
        return;
      }

      const directDiff =
        forCurrentFile.length === 1 && typeof forCurrentFile[0]?.diff === "string"
          ? forCurrentFile[0].diff.trim()
            ? forCurrentFile[0].diff
            : null
          : null;
      const fallbackDecorations = mergeGitDiffDecorations(
        forCurrentFile.map((entry) => (typeof entry.diff === "string" ? entry.diff : undefined)),
        currentLineCount
      );
      const needsGitHydration =
        forCurrentFile.length > 1 || forCurrentFile.some((entry) => shouldHydratePendingFileDiffFromGit(entry));

      if (!needsGitHydration && directDiff) {
        setPendingLineDecorations(parseGitDiffDecorations(directDiff, currentLineCount));
        setPendingPreviewDiff(directDiff);
        return;
      }

      const requestId = lineChangesRequestSeqRef.current + 1;
      lineChangesRequestSeqRef.current = requestId;
      if (lineChangesAbortRef.current) {
        lineChangesAbortRef.current.abort();
      }
      const controller = new AbortController();
      lineChangesAbortRef.current = controller;

      try {
        const res = await apiFetch(`/api/git/diff?path=${encodeURIComponent(path)}`, {
          signal: controller.signal,
        });
        const data = (await res.json()) as { success?: boolean; diff?: string };
        if (lineChangesRequestSeqRef.current !== requestId) return;
        if (!res.ok || !data?.success || typeof data.diff !== "string") {
          setPendingLineDecorations(fallbackDecorations);
          setPendingPreviewDiff(directDiff);
          return;
        }
        setPendingLineDecorations(parseGitDiffDecorations(data.diff, currentLineCount));
        setPendingPreviewDiff(data.diff);
      } catch (errorValue) {
        if ((errorValue as Error)?.name !== "AbortError") {
          setPendingLineDecorations(fallbackDecorations);
          setPendingPreviewDiff(directDiff);
        }
      } finally {
        if (lineChangesAbortRef.current === controller) {
          lineChangesAbortRef.current = null;
        }
      }
      return;
    }

    setPendingPreviewDiff(null);

    const requestId = lineChangesRequestSeqRef.current + 1;
    lineChangesRequestSeqRef.current = requestId;
    if (lineChangesAbortRef.current) {
      lineChangesAbortRef.current.abort();
    }
    const controller = new AbortController();
    lineChangesAbortRef.current = controller;

    try {
      const res = await apiFetch(`/api/git/diff?path=${encodeURIComponent(path)}`, {
        signal: controller.signal,
      });
      const data = (await res.json()) as { success?: boolean; diff?: string };
      if (lineChangesRequestSeqRef.current !== requestId) return;
      if (!res.ok || !data?.success) {
        setPendingLineDecorations(emptyIdePendingDiffDecorations());
        setPendingPreviewDiff(null);
        return;
      }
      setPendingLineDecorations(
        parseGitDiffDecorations(typeof data.diff === "string" ? data.diff : "", currentLineCount)
      );
    } catch (errorValue) {
      if ((errorValue as Error)?.name !== "AbortError") {
        setPendingLineDecorations(emptyIdePendingDiffDecorations());
        setPendingPreviewDiff(null);
      }
    } finally {
      if (lineChangesAbortRef.current === controller) {
        lineChangesAbortRef.current = null;
      }
    }
  }, [content, isBinary, isLargeFileMode, path, pendingFileDiffs]);

  useEffect(() => {
    if (fileReadAbortRef.current) {
      fileReadAbortRef.current.abort();
      fileReadAbortRef.current = null;
    }
    if (blameAbortRef.current) {
      blameAbortRef.current.abort();
      blameAbortRef.current = null;
    }
    if (lineChangesAbortRef.current) {
      lineChangesAbortRef.current.abort();
      lineChangesAbortRef.current = null;
    }
    setContent(null);
    setEditContent("");
    setExtension("");
    setIsBinary(false);
    setDiagnostics([]);
    setBlameLines(new Map());
    setPendingLineDecorations(emptyIdePendingDiffDecorations());
    setPendingPreviewDiff(null);
    setBlameLoading(false);
    setGitHistoryStatus("idle");
    setShowFindBar(false);
    setFindQuery("");
    setFindReplaceValue("");
    setShowFindReplace(false);
    setFindMatches([]);
    setActiveFindMatchIndex(0);
    setActiveLine(1);
    if (blameHideTimeoutRef.current !== null) {
      window.clearTimeout(blameHideTimeoutRef.current);
      blameHideTimeoutRef.current = null;
    }
    setBlamePopoverLine(null);
    setCopiedCommit(null);
    setCursorLine(1);
    setCursorColumn(1);
    setScrollMetrics({ top: 0, left: 0, height: 1, width: 1, scrollHeight: 1, scrollWidth: 1 });
    setEditorContextMenu(null);
    setDefinitionLoading(false);
    setCompletionItems([]);
    setCompletionIndex(0);
    setCompletionVisible(false);
    setCompletionLoading(false);
    setCompletionReplaceStart(0);
    setCompletionPrefix("");
    setCompletionOrigin(null);
    setGhostCompletion("");
    setGhostOrigin(null);
    setIsTypingBurst(false);
    if (typingBurstTimeoutRef.current !== null) {
      window.clearTimeout(typingBurstTimeoutRef.current);
      typingBurstTimeoutRef.current = null;
    }
    if (completionAbortRef.current) {
      completionAbortRef.current.abort();
      completionAbortRef.current = null;
    }
    if (ghostDebounceRef.current !== null) {
      window.clearTimeout(ghostDebounceRef.current);
      ghostDebounceRef.current = null;
    }
    if (ghostAbortRef.current) {
      ghostAbortRef.current.abort();
      ghostAbortRef.current = null;
    }
    emitCursorChange(path ? { line: 1, column: 1 } : null);
    appliedJumpRequestRef.current = "";
    void fetchContent({ resetEditor: true });
  }, [emitCursorChange, fetchContent, path]);

  useEffect(() => {
    onGitHistoryStatusChange?.(gitHistoryStatus);
  }, [gitHistoryStatus, onGitHistoryStatusChange]);

  useEffect(() => {
    if (content !== null && path) {
      fetchDiagnostics();
      fetchBlame();
      fetchLineChanges();
    }
  }, [content, path, fetchBlame, fetchDiagnostics, fetchLineChanges]);

  useEffect(() => {
    if (!autoRefresh || !path) return;

    const interval = setInterval(() => {
      if (!hasUnsavedChangesRef.current) {
        void fetchContent();
      }
      void fetchDiagnostics();
      void fetchLineChanges();
    }, 3000);
    return () => clearInterval(interval);
  }, [autoRefresh, path, fetchContent, fetchDiagnostics, fetchLineChanges]);

  useEffect(() => {
    return () => {
      if (blameHideTimeoutRef.current !== null) {
        window.clearTimeout(blameHideTimeoutRef.current);
        blameHideTimeoutRef.current = null;
      }
      if (completionDebounceRef.current !== null) {
        window.clearTimeout(completionDebounceRef.current);
        completionDebounceRef.current = null;
      }
      if (completionAbortRef.current) {
        completionAbortRef.current.abort();
        completionAbortRef.current = null;
      }
      if (ghostDebounceRef.current !== null) {
        window.clearTimeout(ghostDebounceRef.current);
        ghostDebounceRef.current = null;
      }
      if (ghostAbortRef.current) {
        ghostAbortRef.current.abort();
        ghostAbortRef.current = null;
      }
      if (fileReadAbortRef.current) {
        fileReadAbortRef.current.abort();
        fileReadAbortRef.current = null;
      }
      if (blameAbortRef.current) {
        blameAbortRef.current.abort();
        blameAbortRef.current = null;
      }
      if (lineChangesAbortRef.current) {
        lineChangesAbortRef.current.abort();
        lineChangesAbortRef.current = null;
      }
      if (cursorNotifyFrameRef.current !== null) {
        window.cancelAnimationFrame(cursorNotifyFrameRef.current);
        cursorNotifyFrameRef.current = null;
      }
      pendingCursorNotifyRef.current = null;
      if (cursorSelectionFrameRef.current !== null) {
        window.cancelAnimationFrame(cursorSelectionFrameRef.current);
        cursorSelectionFrameRef.current = null;
      }
      pendingCursorSelectionRef.current = null;
      if (typingBurstTimeoutRef.current !== null) {
        window.clearTimeout(typingBurstTimeoutRef.current);
        typingBurstTimeoutRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!path) return;
    if (!externalRefreshKey || externalRefreshKey <= 0) return;
    if (hasUnsavedChangesRef.current) return;
    void fetchContent();
    void fetchDiagnostics();
    void fetchBlame();
    void fetchLineChanges();
  }, [externalRefreshKey, fetchBlame, fetchContent, fetchDiagnostics, fetchLineChanges, path]);

  const updateScrollMetrics = useCallback((scrollElement: HTMLElement | null) => {
    if (!scrollElement) return;
    pendingScrollMetricsRef.current = {
      top: scrollElement.scrollTop,
      left: scrollElement.scrollLeft,
      height: scrollElement.clientHeight || 1,
      width: scrollElement.clientWidth || 1,
      scrollHeight: scrollElement.scrollHeight || 1,
      scrollWidth: scrollElement.scrollWidth || 1,
    };

    if (scrollMetricsFrameRef.current !== null) return;
    scrollMetricsFrameRef.current = window.requestAnimationFrame(() => {
      scrollMetricsFrameRef.current = null;
      const nextMetrics = pendingScrollMetricsRef.current;
      pendingScrollMetricsRef.current = null;
      if (!nextMetrics) return;
      setScrollMetrics((previous) => {
        if (
          previous.top === nextMetrics.top &&
          previous.left === nextMetrics.left &&
          previous.height === nextMetrics.height &&
          previous.width === nextMetrics.width &&
          previous.scrollHeight === nextMetrics.scrollHeight &&
          previous.scrollWidth === nextMetrics.scrollWidth
        ) {
          return previous;
        }
        return nextMetrics;
      });
    });
  }, []);

  useEffect(() => {
    return () => {
      if (scrollMetricsFrameRef.current !== null) {
        window.cancelAnimationFrame(scrollMetricsFrameRef.current);
        scrollMetricsFrameRef.current = null;
      }
      pendingScrollMetricsRef.current = null;
    };
  }, []);

  const syncEditorScroll = useCallback(
    (scrollElement: HTMLElement | null) => {
      if (!scrollElement) return;
      if (highlightScrollRef.current) {
        highlightScrollRef.current.scrollTop = scrollElement.scrollTop;
        highlightScrollRef.current.scrollLeft = scrollElement.scrollLeft;
      }
      if (gutterRef.current) {
        gutterRef.current.scrollTop = scrollElement.scrollTop;
      }
      updateScrollMetrics(scrollElement);
    },
    [updateScrollMetrics]
  );

  const updateCursorFromSelection = useCallback(
    (textarea: HTMLTextAreaElement | null) => {
      if (!textarea) return;
      const value = textarea.value;
      const selectionStart = Math.max(0, textarea.selectionStart ?? 0);
      let line = 1;
      for (let i = 0; i < selectionStart; i += 1) {
        if (value.charCodeAt(i) === 10) line += 1;
      }
      const lastBreak = value.lastIndexOf("\n", selectionStart - 1);
      const column = selectionStart - lastBreak;
      setCursorLine((previous) => (previous === line ? previous : line));
      setCursorColumn((previous) => (previous === column ? previous : column));
      setActiveLine((previous) => (previous === line ? previous : line));
      emitCursorChange({ line, column });
    },
    [emitCursorChange]
  );

  const scheduleCursorUpdate = useCallback(
    (textarea: HTMLTextAreaElement | null) => {
      if (!textarea) return;
      pendingCursorSelectionRef.current = textarea;
      if (cursorSelectionFrameRef.current !== null) return;
      cursorSelectionFrameRef.current = window.requestAnimationFrame(() => {
        cursorSelectionFrameRef.current = null;
        updateCursorFromSelection(pendingCursorSelectionRef.current);
        pendingCursorSelectionRef.current = null;
      });
    },
    [updateCursorFromSelection]
  );

  const markTypingBurst = useCallback(() => {
    setIsTypingBurst(true);
    if (typingBurstTimeoutRef.current !== null) {
      window.clearTimeout(typingBurstTimeoutRef.current);
    }
    typingBurstTimeoutRef.current = window.setTimeout(() => {
      typingBurstTimeoutRef.current = null;
      setIsTypingBurst(false);
    }, EDITOR_TYPING_BURST_MS);
  }, []);

  const clearCompletions = useCallback(() => {
    setCompletionItems([]);
    setCompletionIndex(0);
    setCompletionVisible(false);
    setCompletionLoading(false);
    setCompletionPrefix("");
    setCompletionOrigin(null);
  }, []);

  const clearGhostCompletion = useCallback(() => {
    setGhostCompletion("");
    setGhostOrigin(null);
  }, []);

  const scoreCompletionItem = useCallback(
    (item: IdeCompletionItem, normalizedPrefix: string): number => {
      const label = item.label || "";
      const insert = item.insertText || label;
      const labelLower = label.toLowerCase();
      const insertLower = insert.toLowerCase();
      let score = 10;

      if (normalizedPrefix.length > 0) {
        if (labelLower === normalizedPrefix || insertLower === normalizedPrefix) {
          score = 0;
        } else if (
          labelLower.startsWith(normalizedPrefix) ||
          insertLower.startsWith(normalizedPrefix)
        ) {
          score = 1 + Math.min(label.length, insert.length) / 100;
        } else {
          const inLabel = labelLower.indexOf(normalizedPrefix);
          const inInsert = insertLower.indexOf(normalizedPrefix);
          if (inLabel >= 0 || inInsert >= 0) {
            const offset = Math.min(inLabel >= 0 ? inLabel : 99, inInsert >= 0 ? inInsert : 99);
            score = 3 + offset / 10 + Math.min(label.length, insert.length) / 100;
          }
        }
      }

      if (item.detail === "Local") score -= 0.15;
      if (item.detail === "Snippet") score += 0.6;
      return score;
    },
    []
  );

  const getCompletionContext = useCallback((text: string, cursorOffset: number) => {
    const safeCursor = Math.max(0, Math.min(cursorOffset, text.length));
    const before = text.slice(0, safeCursor);
    const after = text.slice(safeCursor);
    const identifierMatch = before.match(/[A-Za-z_$][A-Za-z0-9_$]*$/);
    const prefix = identifierMatch?.[0] || "";
    const replaceStart = safeCursor - prefix.length;
    const previousChar = before[before.length - 1] || "";
    const memberAccessTrigger = previousChar === ".";
    const trigger = memberAccessTrigger || prefix.length >= 1;
    const cursor = getLineAndColumn(text, safeCursor);
    return {
      trigger,
      prefix,
      replaceStart,
      line: cursor.line,
      column: cursor.column,
      aroundCursorAfter: after,
      memberAccessTrigger,
    };
  }, []);

  const buildLocalCompletions = useCallback(
    (
      context: {
        prefix: string;
        replaceStart: number;
        memberAccessTrigger: boolean;
      },
      cursorOffset: number
    ): IdeCompletionItem[] => {
      const lowerPrefix = context.prefix.toLowerCase();
      const localSet = new Map<string, IdeCompletionItem>();
      const scanBefore = isLargeFileMode
        ? Math.min(COMPLETION_LOCAL_SCAN_BEFORE, 7_000)
        : Math.min(COMPLETION_LOCAL_SCAN_BEFORE, 16_000);
      const scanAfter = isLargeFileMode
        ? Math.min(COMPLETION_LOCAL_SCAN_AFTER, 2_500)
        : Math.min(COMPLETION_LOCAL_SCAN_AFTER, 5_500);
      const boundedStart = Math.max(0, cursorOffset - scanBefore);
      const boundedEnd = Math.min(editContent.length, cursorOffset + scanAfter);
      const nearbyText = editContent.slice(boundedStart, boundedEnd);
      const wordRegex = /\b[A-Za-z_$][A-Za-z0-9_$]{1,}\b/g;
      for (const match of nearbyText.matchAll(wordRegex)) {
        const candidate = match[0];
        if (!candidate || candidate.length < 2) continue;
        if (lowerPrefix && !candidate.toLowerCase().startsWith(lowerPrefix)) continue;
        if (!context.memberAccessTrigger && candidate === context.prefix) continue;
        if (!localSet.has(candidate)) {
          localSet.set(candidate, {
            label: candidate,
            insertText: candidate,
            detail: "Local",
            sortText: `z-${candidate}`,
          });
        }
        if (localSet.size >= 120) break;
      }

      const normalizedExt = extension.toLowerCase();
      const isTsLike = [".ts", ".tsx", ".js", ".jsx"].includes(normalizedExt);
      if (isTsLike && !context.memberAccessTrigger) {
        const snippets: IdeCompletionItem[] = [
          { label: "const", insertText: "const ", detail: "Keyword" },
          { label: "let", insertText: "let ", detail: "Keyword" },
          { label: "function", insertText: "function ", detail: "Keyword" },
          { label: "if", insertText: "if () {\n  \n}", detail: "Snippet" },
          { label: "for", insertText: "for (let i = 0; i < ; i++) {\n  \n}", detail: "Snippet" },
          { label: "import", insertText: "import ", detail: "Keyword" },
          { label: "return", insertText: "return ", detail: "Keyword" },
          { label: "await", insertText: "await ", detail: "Keyword" },
        ];
        for (const snippet of snippets) {
          if (
            lowerPrefix &&
            !snippet.label.toLowerCase().startsWith(lowerPrefix) &&
            !snippet.insertText?.toLowerCase().startsWith(lowerPrefix)
          ) {
            continue;
          }
          if (!localSet.has(snippet.label)) {
            localSet.set(snippet.label, snippet);
          }
        }
      }

      return [...localSet.values()].slice(0, 80);
    },
    [editContent, extension, isLargeFileMode]
  );

  const requestCompletions = useCallback(
    async (options?: { force?: boolean }) => {
      if (!enableCompletions || !path || !editorRef.current || isBinary || showFindBar) {
        clearCompletions();
        clearGhostCompletion();
        return;
      }
      const force = options?.force === true;

      const editor = editorRef.current;
      const selectionStart = editor.selectionStart ?? 0;
      const selectionEnd = editor.selectionEnd ?? selectionStart;
      if (selectionStart !== selectionEnd) {
        clearCompletions();
        clearGhostCompletion();
        return;
      }

      const context = getCompletionContext(editContent, selectionStart);
      if (!context.trigger) {
        clearCompletions();
        clearGhostCompletion();
        return;
      }
      if (!force && !context.memberAccessTrigger && context.prefix.length < 2) {
        clearCompletions();
        clearGhostCompletion();
        return;
      }

      const localItems = buildLocalCompletions(context, selectionStart);
      const requestId = completionRequestSeqRef.current + 1;
      completionRequestSeqRef.current = requestId;

      let mergedItems = [...localItems];
      const normalizedPrefix = context.prefix.toLowerCase();
      const cacheKey = `${path}::${context.memberAccessTrigger ? "member" : "word"}::${normalizedPrefix}::${context.line}`;
      const shouldRequestLsp = force || context.memberAccessTrigger || context.prefix.length >= 3;
      if (shouldRequestLsp) {
        const cached = completionCacheRef.current.get(cacheKey);
        const now = Date.now();
        if (cached && now - cached.ts <= COMPLETION_CACHE_TTL_MS) {
          setCompletionLoading(false);
          const known = new Set(
            mergedItems.map((item) => `${item.label}:${item.insertText || ""}`)
          );
          for (const item of cached.items) {
            const key = `${item.label}:${item.insertText || ""}`;
            if (known.has(key)) continue;
            known.add(key);
            mergedItems.push(item);
            if (mergedItems.length >= 120) break;
          }
        } else {
          setCompletionLoading(true);
          if (completionAbortRef.current) {
            completionAbortRef.current.abort();
          }
          const controller = new AbortController();
          completionAbortRef.current = controller;
          try {
            const params = new URLSearchParams({
              path,
              line: String(Math.max(context.line - 1, 0)),
              character: String(Math.max(context.column - 1, 0)),
              prefix: context.prefix,
              limit: "120",
            });
            const response = await apiFetch(`/api/lsp/completion?${params.toString()}`, {
              signal: controller.signal,
            });
            const data: IdeCompletionResponse = await response.json();
            if (completionRequestSeqRef.current !== requestId) return;
            if (data.success && Array.isArray(data.items)) {
              const known = new Set(
                mergedItems.map((item) => `${item.label}:${item.insertText || ""}`)
              );
              const lspItems: IdeCompletionItem[] = [];
              for (const item of data.items) {
                const key = `${item.label}:${item.insertText || ""}`;
                if (known.has(key)) continue;
                known.add(key);
                mergedItems.push(item);
                lspItems.push(item);
                if (mergedItems.length >= 120) break;
              }
              completionCacheRef.current.set(cacheKey, { ts: now, items: lspItems });
              if (completionCacheRef.current.size > COMPLETION_CACHE_MAX_ENTRIES) {
                const oldest = completionCacheRef.current.keys().next().value;
                if (typeof oldest === "string") {
                  completionCacheRef.current.delete(oldest);
                }
              }
            }
            if (completionAbortRef.current === controller) {
              completionAbortRef.current = null;
            }
          } catch (errorValue) {
            if ((errorValue as Error)?.name === "AbortError") {
              return;
            }
            // Keep local completions if LSP completion fails.
            if (completionAbortRef.current === controller) {
              completionAbortRef.current = null;
            }
          } finally {
            if (completionRequestSeqRef.current === requestId) {
              setCompletionLoading(false);
            }
          }
        }
      } else {
        setCompletionLoading(false);
      }

      if (completionRequestSeqRef.current !== requestId) return;

      if (mergedItems.length === 0) {
        clearCompletions();
        return;
      }

      mergedItems = mergedItems
        .sort((left, right) => {
          const delta =
            scoreCompletionItem(left, normalizedPrefix) -
            scoreCompletionItem(right, normalizedPrefix);
          if (delta !== 0) return delta;
          const leftSort = left.sortText || left.label;
          const rightSort = right.sortText || right.label;
          if (leftSort !== rightSort) return leftSort.localeCompare(rightSort);
          return left.label.localeCompare(right.label);
        })
        .slice(0, 80);

      setCompletionItems(mergedItems);
      setCompletionIndex(0);
      setCompletionVisible(true);
      setCompletionReplaceStart(context.replaceStart);
      setCompletionPrefix(context.prefix);
      setCompletionOrigin({ line: context.line, column: context.column });
    },
    [
      buildLocalCompletions,
      clearGhostCompletion,
      clearCompletions,
      editContent,
      getCompletionContext,
      isBinary,
      enableCompletions,
      path,
      scoreCompletionItem,
      showFindBar,
    ]
  );

  const requestInlineGhostCompletion = useCallback(async () => {
    if (
      !enableCompletions ||
      !enableGhostCompletions ||
      !path ||
      !editorRef.current ||
      isBinary ||
      showFindBar ||
      isLargeFileMode
    ) {
      clearGhostCompletion();
      return;
    }
    if (completionVisible && completionItems.length > 0) {
      clearGhostCompletion();
      return;
    }

    const editor = editorRef.current;
    const selectionStart = editor.selectionStart ?? 0;
    const selectionEnd = editor.selectionEnd ?? selectionStart;
    if (selectionStart !== selectionEnd) {
      clearGhostCompletion();
      return;
    }

    const context = getCompletionContext(editContent, selectionStart);
    if (!context.trigger || (!context.memberAccessTrigger && context.prefix.length < 2)) {
      clearGhostCompletion();
      return;
    }

    const before = editContent.slice(Math.max(0, selectionStart - 6000), selectionStart);
    const after = editContent.slice(
      selectionStart,
      Math.min(editContent.length, selectionStart + 1800)
    );
    const suffixMatch = after.match(/^[A-Za-z0-9_$]+/);
    const suffix = suffixMatch?.[0] || "";
    const cacheKey = `${path}::${context.line}:${context.column}:${context.prefix.toLowerCase()}::${suffix.toLowerCase()}`;
    const now = Date.now();
    const cached = ghostCacheRef.current.get(cacheKey);
    if (cached && now - cached.ts <= COMPLETION_CACHE_TTL_MS) {
      setGhostCompletion(cached.text);
      setGhostOrigin({
        line: context.line,
        column: context.column,
        replaceStart: context.replaceStart,
      });
      return;
    }

    const requestId = ghostRequestSeqRef.current + 1;
    ghostRequestSeqRef.current = requestId;
    if (ghostAbortRef.current) {
      ghostAbortRef.current.abort();
    }
    const controller = new AbortController();
    ghostAbortRef.current = controller;

    try {
      const response = await apiFetch("/api/ide/inline-completion", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          path,
          before,
          after,
          prefix: context.prefix,
          suffix,
          agentId: completionAgentId || undefined,
          maxChars: 360,
        }),
      });
      const data: IdeInlineCompletionResponse = await response.json();
      if (ghostRequestSeqRef.current !== requestId) return;
      if (!data.success) {
        clearGhostCompletion();
        return;
      }

      let completionText = (data.completion || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
      if (context.prefix && completionText.toLowerCase().startsWith(context.prefix.toLowerCase())) {
        completionText = completionText.slice(context.prefix.length);
      }
      if (!completionText.trim()) {
        clearGhostCompletion();
        return;
      }
      if (completionText.length > 720) {
        completionText = completionText.slice(0, 720);
      }

      ghostCacheRef.current.set(cacheKey, { ts: now, text: completionText });
      if (ghostCacheRef.current.size > COMPLETION_CACHE_MAX_ENTRIES) {
        const oldest = ghostCacheRef.current.keys().next().value;
        if (typeof oldest === "string") {
          ghostCacheRef.current.delete(oldest);
        }
      }

      setGhostCompletion(completionText);
      setGhostOrigin({
        line: context.line,
        column: context.column,
        replaceStart: context.replaceStart,
      });
    } catch (errorValue) {
      if ((errorValue as Error)?.name !== "AbortError") {
        clearGhostCompletion();
      }
    } finally {
      if (ghostAbortRef.current === controller) {
        ghostAbortRef.current = null;
      }
    }
  }, [
    clearGhostCompletion,
    completionAgentId,
    completionItems.length,
    completionVisible,
    editContent,
    getCompletionContext,
    isBinary,
    enableCompletions,
    enableGhostCompletions,
    isLargeFileMode,
    path,
    showFindBar,
  ]);

  const applyCompletion = useCallback(
    (targetIndex?: number): boolean => {
      if (!editorRef.current || completionItems.length === 0) return false;
      const editor = editorRef.current;
      const index =
        typeof targetIndex === "number"
          ? Math.max(0, Math.min(targetIndex, completionItems.length - 1))
          : Math.max(0, Math.min(completionIndex, completionItems.length - 1));
      const item = completionItems[index];
      if (!item) return false;

      const cursor = editor.selectionStart ?? 0;
      if (cursor < completionReplaceStart) return false;
      const rawInsert = item.insertText || item.label;
      const insertText = rawInsert.replace(/\$\{\d+:([^}]+)\}/g, "$1").replace(/\$\d+/g, "");
      const nextContent =
        editContent.slice(0, completionReplaceStart) + insertText + editContent.slice(cursor);

      setEditContent(nextContent);
      setCompletionVisible(false);
      setCompletionItems([]);
      clearGhostCompletion();
      const nextCursor = completionReplaceStart + insertText.length;
      window.requestAnimationFrame(() => {
        if (!editorRef.current) return;
        editorRef.current.focus();
        editorRef.current.setSelectionRange(nextCursor, nextCursor);
        updateCursorFromSelection(editorRef.current);
        syncEditorScroll(editorRef.current);
      });
      return true;
    },
    [
      clearGhostCompletion,
      completionIndex,
      completionItems,
      completionReplaceStart,
      editContent,
      syncEditorScroll,
      updateCursorFromSelection,
    ]
  );

  const applyGhostCompletion = useCallback((): boolean => {
    if (!editorRef.current || !ghostOrigin || !ghostCompletion) return false;
    const editor = editorRef.current;
    const cursor = editor.selectionStart ?? 0;
    if (cursor < ghostOrigin.replaceStart) return false;

    const nextContent =
      editContent.slice(0, ghostOrigin.replaceStart) + ghostCompletion + editContent.slice(cursor);
    const nextCursor = ghostOrigin.replaceStart + ghostCompletion.length;
    setEditContent(nextContent);
    clearGhostCompletion();
    markTypingBurst();
    window.requestAnimationFrame(() => {
      if (!editorRef.current) return;
      editorRef.current.focus();
      editorRef.current.setSelectionRange(nextCursor, nextCursor);
      updateCursorFromSelection(editorRef.current);
      syncEditorScroll(editorRef.current);
    });
    return true;
  }, [
    clearGhostCompletion,
    editContent,
    ghostCompletion,
    ghostOrigin,
    markTypingBurst,
    syncEditorScroll,
    updateCursorFromSelection,
  ]);

  const tryInlineTabCompletion = useCallback((): boolean => {
    const editor = editorRef.current;
    if (!enableCompletions || !editor || isBinary || showFindBar) return false;

    const selectionStart = editor.selectionStart ?? 0;
    const selectionEnd = editor.selectionEnd ?? selectionStart;
    if (selectionStart !== selectionEnd) return false;

    const context = getCompletionContext(editContent, selectionStart);
    if (!context.trigger) return false;
    if (!context.memberAccessTrigger && context.prefix.length < 2) return false;

    const normalizedPrefix = context.prefix.toLowerCase();
    const candidates = buildLocalCompletions(context, selectionStart)
      .filter((item) => {
        const insert = (item.insertText || item.label || "").toLowerCase();
        if (!insert) return false;
        if (normalizedPrefix && insert === normalizedPrefix) return false;
        return context.memberAccessTrigger || insert.startsWith(normalizedPrefix);
      })
      .sort((left, right) => {
        const delta =
          scoreCompletionItem(left, normalizedPrefix) -
          scoreCompletionItem(right, normalizedPrefix);
        if (delta !== 0) return delta;
        return (left.label || "").localeCompare(right.label || "");
      });

    const best = candidates[0];
    if (!best) return false;

    const rawInsert = best.insertText || best.label;
    const insertText = rawInsert.replace(/\$\{\d+:([^}]+)\}/g, "$1").replace(/\$\d+/g, "");
    if (!insertText) return false;

    const nextContent =
      editContent.slice(0, context.replaceStart) + insertText + editContent.slice(selectionStart);
    setEditContent(nextContent);
    setCompletionVisible(false);
    setCompletionItems([]);
    clearGhostCompletion();
    markTypingBurst();

    const nextCursor = context.replaceStart + insertText.length;
    window.requestAnimationFrame(() => {
      if (!editorRef.current) return;
      editorRef.current.focus();
      editorRef.current.setSelectionRange(nextCursor, nextCursor);
      updateCursorFromSelection(editorRef.current);
      syncEditorScroll(editorRef.current);
    });
    return true;
  }, [
    buildLocalCompletions,
    editContent,
    getCompletionContext,
    isBinary,
    enableCompletions,
    markTypingBurst,
    scoreCompletionItem,
    showFindBar,
    syncEditorScroll,
    updateCursorFromSelection,
    clearGhostCompletion,
  ]);

  useEffect(() => {
    const isMarkdownPreview =
      previewMode && (extension.toLowerCase() === ".md" || extension.toLowerCase() === ".markdown");
    if (!enableCompletions || !path || isBinary || isMarkdownPreview || showFindBar) {
      clearCompletions();
      return;
    }

    if (completionDebounceRef.current !== null) {
      window.clearTimeout(completionDebounceRef.current);
    }
    completionDebounceRef.current = window.setTimeout(
      () => {
        void requestCompletions();
      },
      isLargeFileMode
        ? Math.max(normalizedCompletionDebounce, 220)
        : isTypingBurst
          ? Math.max(normalizedCompletionDebounce, 160)
          : normalizedCompletionDebounce
    );

    return () => {
      if (completionDebounceRef.current !== null) {
        window.clearTimeout(completionDebounceRef.current);
        completionDebounceRef.current = null;
      }
    };
  }, [
    clearCompletions,
    editContent,
    enableCompletions,
    extension,
    isBinary,
    isTypingBurst,
    isLargeFileMode,
    path,
    previewMode,
    requestCompletions,
    showFindBar,
    normalizedCompletionDebounce,
    cursorLine,
    cursorColumn,
  ]);

  useEffect(() => {
    const isMarkdownPreview =
      previewMode && (extension.toLowerCase() === ".md" || extension.toLowerCase() === ".markdown");
    if (
      !enableCompletions ||
      !enableGhostCompletions ||
      !path ||
      isBinary ||
      isMarkdownPreview ||
      showFindBar ||
      isLargeFileMode ||
      completionVisible
    ) {
      clearGhostCompletion();
      return;
    }

    if (ghostDebounceRef.current !== null) {
      window.clearTimeout(ghostDebounceRef.current);
    }
    ghostDebounceRef.current = window.setTimeout(
      () => {
        void requestInlineGhostCompletion();
      },
      isTypingBurst ? Math.max(normalizedGhostDebounce, 280) : normalizedGhostDebounce
    );

    return () => {
      if (ghostDebounceRef.current !== null) {
        window.clearTimeout(ghostDebounceRef.current);
        ghostDebounceRef.current = null;
      }
    };
  }, [
    clearGhostCompletion,
    completionVisible,
    cursorColumn,
    cursorLine,
    editContent,
    enableCompletions,
    enableGhostCompletions,
    extension,
    isBinary,
    isLargeFileMode,
    isTypingBurst,
    path,
    previewMode,
    requestInlineGhostCompletion,
    showFindBar,
    normalizedGhostDebounce,
  ]);

  const computeFindMatches = useCallback(
    (query: string): Array<{ start: number; end: number }> => {
      const trimmed = query.trim();
      if (!trimmed) return [];
      const source = editContent;
      const haystack = findCaseSensitive ? source : source.toLowerCase();
      const needle = findCaseSensitive ? trimmed : trimmed.toLowerCase();
      if (!needle) return [];

      const matches: Array<{ start: number; end: number }> = [];
      let index = 0;
      while (index < haystack.length) {
        const found = haystack.indexOf(needle, index);
        if (found === -1) break;
        const end = found + needle.length;
        matches.push({ start: found, end });
        index = end > index ? end : index + 1;
      }
      return matches;
    },
    [editContent, findCaseSensitive]
  );

  const focusFindInput = useCallback(() => {
    window.requestAnimationFrame(() => {
      findInputRef.current?.focus();
      findInputRef.current?.select();
    });
  }, []);

  const focusReplaceInput = useCallback(() => {
    setShowFindBar(true);
    setShowFindReplace(true);
    window.requestAnimationFrame(() => {
      replaceInputRef.current?.focus();
      replaceInputRef.current?.select();
    });
  }, []);

  const toggleFindBar = useCallback(() => {
    setShowFindBar((previous) => {
      const next = !previous;
      if (next) {
        focusFindInput();
      } else {
        setShowFindReplace(false);
        window.requestAnimationFrame(() => {
          editorRef.current?.focus();
        });
      }
      return next;
    });
  }, [focusFindInput]);

  const selectFindMatch = useCallback(
    (index: number) => {
      const textarea = editorRef.current;
      if (!textarea || findMatches.length === 0) return;
      const normalizedIndex =
        ((index % findMatches.length) + findMatches.length) % findMatches.length;
      const match = findMatches[normalizedIndex];
      if (!match) return;

      textarea.focus();
      textarea.setSelectionRange(match.start, match.end);
      const lineHeight =
        Number.parseFloat(
          window.getComputedStyle(textarea).lineHeight || String(normalizedLineHeight)
        ) || normalizedLineHeight;
      const line = getLineAndColumn(editContent, match.start).line;
      textarea.scrollTop = Math.max((line - 2) * lineHeight, 0);
      syncEditorScroll(textarea);
      updateCursorFromSelection(textarea);
      setActiveFindMatchIndex(normalizedIndex);
    },
    [editContent, findMatches, syncEditorScroll, updateCursorFromSelection]
  );

  const handleFindNext = useCallback(() => {
    if (findMatches.length === 0) return;
    const textarea = editorRef.current;
    const current = findMatches[activeFindMatchIndex];
    if (
      !textarea ||
      !current ||
      textarea.selectionStart !== current.start ||
      textarea.selectionEnd !== current.end
    ) {
      selectFindMatch(activeFindMatchIndex);
      return;
    }
    selectFindMatch(activeFindMatchIndex + 1);
  }, [activeFindMatchIndex, findMatches, selectFindMatch]);

  const handleFindPrevious = useCallback(() => {
    if (findMatches.length === 0) return;
    const textarea = editorRef.current;
    const current = findMatches[activeFindMatchIndex];
    if (
      !textarea ||
      !current ||
      textarea.selectionStart !== current.start ||
      textarea.selectionEnd !== current.end
    ) {
      selectFindMatch(activeFindMatchIndex);
      return;
    }
    selectFindMatch(activeFindMatchIndex - 1);
  }, [activeFindMatchIndex, findMatches, selectFindMatch]);

  const handleReplaceCurrent = useCallback(() => {
    const textarea = editorRef.current;
    if (!textarea) return;
    const matches = computeFindMatches(findQuery);
    if (matches.length === 0) return;
    const normalizedIndex =
      ((activeFindMatchIndex % matches.length) + matches.length) % matches.length;
    const match = matches[normalizedIndex];
    if (!match) return;

    const nextContent =
      editContent.slice(0, match.start) + findReplaceValue + editContent.slice(match.end);
    setEditContent(nextContent);

    window.requestAnimationFrame(() => {
      textarea.focus();
      const nextCursor = match.start + findReplaceValue.length;
      textarea.setSelectionRange(match.start, nextCursor);
      updateCursorFromSelection(textarea);
      syncEditorScroll(textarea);
    });
  }, [
    activeFindMatchIndex,
    computeFindMatches,
    editContent,
    findQuery,
    findReplaceValue,
    syncEditorScroll,
    updateCursorFromSelection,
  ]);

  const handleReplaceAllInFile = useCallback(() => {
    const matches = computeFindMatches(findQuery);
    if (matches.length === 0) return;
    let nextContent = editContent;
    for (let i = matches.length - 1; i >= 0; i -= 1) {
      const match = matches[i];
      nextContent =
        nextContent.slice(0, match.start) + findReplaceValue + nextContent.slice(match.end);
    }
    setEditContent(nextContent);
  }, [computeFindMatches, editContent, findQuery, findReplaceValue]);

  useEffect(() => {
    const matches = computeFindMatches(findQuery);
    setFindMatches(matches);
    if (matches.length === 0) {
      setActiveFindMatchIndex(0);
      return;
    }
    setActiveFindMatchIndex((previous) => Math.min(previous, matches.length - 1));
  }, [computeFindMatches, findQuery]);

  const selectPendingPreviewLine = useCallback(
    (requestedLine: number, options?: { scrollIntoView?: boolean }) => {
      const previewElement = previewScrollRef.current;
      if (!previewElement) return;
      const line = Math.max(1, Math.round(requestedLine));
      if (options?.scrollIntoView) {
        const rowIndex =
          pendingPreviewRowIndexByLineRef.current.get(line) ?? Math.max(line - 1, 0);
        const targetTop = Math.max((rowIndex - 2) * normalizedLineHeight, 0);
        const maxScroll = Math.max(previewElement.scrollHeight - previewElement.clientHeight, 0);
        previewElement.scrollTop = Math.min(targetTop, maxScroll);
        syncEditorScroll(previewElement);
      }
      setCursorLine((previous) => (previous === line ? previous : line));
      setCursorColumn((previous) => (previous === 1 ? previous : 1));
      setActiveLine((previous) => (previous === line ? previous : line));
      emitCursorChange({ line, column: 1 });
    },
    [emitCursorChange, normalizedLineHeight, syncEditorScroll]
  );

  const jumpToLine = useCallback(
    (requestedLine: number) => {
      if (showPendingInlinePreviewRef.current) {
        selectPendingPreviewLine(requestedLine, { scrollIntoView: true });
        return;
      }

      const textarea = editorRef.current;
      if (!textarea) return;

      const lines = editContent.split("\n");
      const maxLine = Math.max(1, lines.length);
      const line = Math.min(Math.max(requestedLine, 1), maxLine);

      let offset = 0;
      for (let i = 0; i < line - 1; i += 1) {
        offset += lines[i]?.length || 0;
        offset += 1;
      }

      textarea.focus();
      textarea.setSelectionRange(offset, offset);
      const computedLineHeight = Number.parseFloat(
        window.getComputedStyle(textarea).lineHeight || String(normalizedLineHeight)
      );
      const lineHeight = Number.isFinite(computedLineHeight)
        ? computedLineHeight
        : normalizedLineHeight;
      textarea.scrollTop = Math.max((line - 2) * lineHeight, 0);
      syncEditorScroll(textarea);
      updateCursorFromSelection(textarea);
    },
    [editContent, selectPendingPreviewLine, syncEditorScroll, updateCursorFromSelection]
  );

  useEffect(() => {
    if (!path || !jumpToLineRequest || jumpToLineRequest <= 0) return;
    if (content === null || isLoading) return;
    const requestKey = `${path}:${jumpToLineRequest}`;
    if (appliedJumpRequestRef.current === requestKey) return;
    appliedJumpRequestRef.current = requestKey;
    window.requestAnimationFrame(() => {
      jumpToLine(jumpToLineRequest);
    });
  }, [content, isLoading, jumpToLine, jumpToLineRequest, path]);

  const promptJumpToLine = useCallback(() => {
    if (isBinary) return;
    const rawValue = window.prompt("Go to line:", String(cursorLine));
    if (rawValue === null) return;
    const parsed = Number.parseInt(rawValue.trim(), 10);
    if (!Number.isFinite(parsed) || parsed <= 0) return;
    jumpToLine(parsed);
  }, [cursorLine, isBinary, jumpToLine]);

  const handleSave = useCallback(async () => {
    if (!path) return;

    setIsSaving(true);
    setSaveError(null);
    try {
      const res = await apiFetch("/api/ide/write", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path, content: editContent }),
      });
      const data = await res.json();
      if (data.success) {
        setContent(editContent);
        onSaveSuccess?.();
        setTimeout(() => {
          void fetchDiagnostics();
          void fetchBlame();
        }, 500);
      } else {
        setSaveError(data.error || "Failed to save");
      }
    } catch (e) {
      setSaveError(String(e));
    }
    setIsSaving(false);
  }, [path, editContent, onSaveSuccess, fetchBlame, fetchDiagnostics]);

  useEffect(() => {
    if (!path || !saveRequestToken || saveRequestToken <= 0) return;
    if (isBinary || isSaving || !hasUnsavedChangesRef.current) return;
    void handleSave();
  }, [handleSave, isBinary, isSaving, path, saveRequestToken]);

  useEffect(() => {
    if (!path) return;

    const handleWindowKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && !event.shiftKey && event.key.toLowerCase() === "f") {
        event.preventDefault();
        toggleFindBar();
        return;
      }
      if ((event.metaKey || event.ctrlKey) && !event.shiftKey && event.key.toLowerCase() === "h") {
        event.preventDefault();
        focusReplaceInput();
        return;
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "g") {
        event.preventDefault();
        promptJumpToLine();
        return;
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
        if (isBinary || !hasUnsavedChangesRef.current || isSaving) return;
        event.preventDefault();
        void handleSave();
        return;
      }
      if (event.key === "Escape" && showFindBar) {
        event.preventDefault();
        setShowFindBar(false);
        setShowFindReplace(false);
        window.requestAnimationFrame(() => {
          editorRef.current?.focus();
        });
      }
    };

    window.addEventListener("keydown", handleWindowKeyDown);
    return () => window.removeEventListener("keydown", handleWindowKeyDown);
  }, [
    focusReplaceInput,
    handleSave,
    isBinary,
    isSaving,
    path,
    promptJumpToLine,
    showFindBar,
    toggleFindBar,
  ]);

  const handleEditorKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (completionVisible && completionItems.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        e.stopPropagation();
        setCompletionIndex((previous) =>
          Math.min(previous + 1, Math.max(completionItems.length - 1, 0))
        );
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        e.stopPropagation();
        setCompletionIndex((previous) => Math.max(previous - 1, 0));
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        clearCompletions();
        return;
      }
      if (e.key === "Tab" && !e.shiftKey) {
        e.preventDefault();
        e.stopPropagation();
        if (applyCompletion()) {
          return;
        }
      }
    }

    if (enableCompletions && (e.metaKey || e.ctrlKey) && e.key === " ") {
      e.preventDefault();
      e.stopPropagation();
      void requestCompletions({ force: true });
      return;
    }

    if (e.key === "F12") {
      e.preventDefault();
      e.stopPropagation();
      void handleGoToDefinition();
      return;
    }

    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
      e.preventDefault();
      e.stopPropagation();
      void handleSave();
      return;
    }

    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "g") {
      e.preventDefault();
      e.stopPropagation();
      promptJumpToLine();
      return;
    }

    if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key.toLowerCase() === "f") {
      e.preventDefault();
      e.stopPropagation();
      toggleFindBar();
      return;
    }

    if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key.toLowerCase() === "h") {
      e.preventDefault();
      e.stopPropagation();
      focusReplaceInput();
      return;
    }

    if (e.key === "Tab") {
      if (enableGhostCompletions && applyGhostCompletion()) {
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      if (tryInlineTabCompletion()) {
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      e.preventDefault();
      const target = e.currentTarget;
      const start = target.selectionStart;
      const end = target.selectionEnd;
      const nextContent = `${editContent.slice(0, start)}  ${editContent.slice(end)}`;
      setEditContent(nextContent);
      markTypingBurst();
      setCompletionVisible(false);
      requestAnimationFrame(() => {
        target.selectionStart = start + 2;
        target.selectionEnd = start + 2;
        updateCursorFromSelection(target);
      });
    }
  };

  const handleEditorContextMenu = useCallback(
    (event: React.MouseEvent<HTMLTextAreaElement>) => {
      event.preventDefault();
      const target = event.currentTarget;
      target.focus();
      const position = target.selectionStart ?? 0;
      const cursor = getLineAndColumn(target.value, position);
      setCursorLine(cursor.line);
      setCursorColumn(cursor.column);
      setActiveLine(cursor.line);
      onCursorChange?.(cursor);
      setEditorContextMenu({
        x: event.clientX,
        y: event.clientY,
        line: cursor.line,
        column: cursor.column,
      });
    },
    [onCursorChange]
  );

  const closeEditorContextMenu = useCallback(() => {
    setEditorContextMenu(null);
  }, []);

  const resolveLspLocations = useCallback(
    async (
      endpoint: "definition" | "declaration" | "type-definition" | "implementation" | "references"
    ): Promise<Array<{ path: string; line: number; character: number }>> => {
      if (!path || !editorContextMenu) return;
      const params = new URLSearchParams({
        path,
        line: String(Math.max(editorContextMenu.line - 1, 0)),
        character: String(Math.max(editorContextMenu.column - 1, 0)),
      });
      const response = await apiFetch(`/api/lsp/${endpoint}?${params.toString()}`);
      const data = (await response.json()) as {
        success?: boolean;
        error?: string;
        location?: { path?: string; line?: number; character?: number } | null;
        locations?: Array<{ path?: string; line?: number; character?: number }> | null;
      };
      if (!data.success) {
        throw new Error(data.error || `Failed to resolve ${endpoint}`);
      }
      const normalized = (data.location ? [data.location] : []).concat(
        Array.isArray(data.locations) ? data.locations : []
      );
      return normalized
        .filter(
          (location): location is { path: string; line: number; character: number } =>
            !!location?.path
        )
        .map((location) => ({
          path: location.path,
          line: Number.isFinite(location.line) ? location.line : 0,
          character: Number.isFinite(location.character) ? location.character : 0,
        }));
    },
    [editorContextMenu, path]
  );

  const openFirstLspLocation = useCallback(
    async (
      endpoint: "definition" | "declaration" | "type-definition" | "implementation",
      notFoundMessage: string
    ) => {
      if (!path || !editorContextMenu) return;
      setDefinitionLoading(true);
      setSaveError(null);
      try {
        const primaryLocations = await resolveLspLocations(endpoint);
        const fallbackLocations =
          endpoint !== "definition" && primaryLocations.length === 0
            ? await resolveLspLocations("definition")
            : [];
        const primaryLocation = primaryLocations[0] || fallbackLocations[0] || null;
        if (!primaryLocation?.path) {
          setSaveError(notFoundMessage);
          return;
        }
        if (onOpenLocation) {
          onOpenLocation(
            primaryLocation.path,
            Number.isFinite(primaryLocation.line) ? (primaryLocation.line as number) + 1 : 1
          );
        } else {
          setSaveError("Go to Definition is unavailable in this view.");
        }
      } catch (errorValue) {
        setSaveError(String(errorValue));
      } finally {
        setDefinitionLoading(false);
        closeEditorContextMenu();
      }
    },
    [closeEditorContextMenu, editorContextMenu, onOpenLocation, path, resolveLspLocations]
  );

  const handleGoToDefinition = useCallback(async () => {
    await openFirstLspLocation("definition", "No definition found at the current cursor.");
  }, [openFirstLspLocation]);

  const handleGoToDeclaration = useCallback(async () => {
    await openFirstLspLocation("declaration", "No declaration found at the current cursor.");
  }, [openFirstLspLocation]);

  const handleGoToTypeDefinition = useCallback(async () => {
    await openFirstLspLocation(
      "type-definition",
      "No type definition found at the current cursor."
    );
  }, [openFirstLspLocation]);

  const handleGoToImplementation = useCallback(async () => {
    await openFirstLspLocation("implementation", "No implementation found at the current cursor.");
  }, [openFirstLspLocation]);

  const handleFindAllReferences = useCallback(async () => {
    if (!path || !editorContextMenu) return;
    setDefinitionLoading(true);
    setSaveError(null);
    try {
      const locations = await resolveLspLocations("references");
      if (locations.length === 0) {
        setSaveError("No references found at the current cursor.");
        return;
      }
      if (onOpenLocation) {
        const first = locations[0];
        onOpenLocation(first.path, first.line + 1);
      }
    } catch (errorValue) {
      setSaveError(String(errorValue));
    } finally {
      setDefinitionLoading(false);
      closeEditorContextMenu();
    }
  }, [closeEditorContextMenu, editorContextMenu, onOpenLocation, path, resolveLspLocations]);

  const handleRenameSymbol = useCallback(() => {
    const editor = editorRef.current;
    if (!editor) return;
    const start = editor.selectionStart ?? 0;
    const end = editor.selectionEnd ?? start;
    let symbol = editContent.slice(start, end).trim();
    let symbolStart = start;
    let symbolEnd = end;

    if (!symbol) {
      const before = editContent.slice(0, start);
      const after = editContent.slice(start);
      const leftMatch = before.match(/[A-Za-z_$][A-Za-z0-9_$]*$/);
      const rightMatch = after.match(/^[A-Za-z0-9_$]*/);
      const leftPart = leftMatch?.[0] || "";
      const rightPart = rightMatch?.[0] || "";
      symbol = `${leftPart}${rightPart}`.trim();
      symbolStart = start - leftPart.length;
      symbolEnd = start + rightPart.length;
    }

    if (!symbol || !/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(symbol)) {
      setSaveError("Place cursor on an identifier or select a symbol first.");
      closeEditorContextMenu();
      return;
    }

    const replacement = window.prompt(`Rename symbol "${symbol}" to:`, symbol);
    if (!replacement) {
      closeEditorContextMenu();
      return;
    }
    const nextName = replacement.trim();
    if (!nextName || nextName === symbol) {
      closeEditorContextMenu();
      return;
    }

    const escaped = symbol.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const regex = new RegExp(`\\b${escaped}\\b`, "g");
    const nextContent = editContent.replace(regex, nextName);
    setEditContent(nextContent);
    window.requestAnimationFrame(() => {
      if (!editorRef.current) return;
      editorRef.current.focus();
      const nextCursor = symbolStart + nextName.length;
      editorRef.current.setSelectionRange(nextCursor, nextCursor);
      updateCursorFromSelection(editorRef.current);
    });
    closeEditorContextMenu();
  }, [closeEditorContextMenu, editContent, updateCursorFromSelection]);

  const handleFormatBuffer = useCallback(() => {
    const normalized = editContent
      .split("\n")
      .map((line) => line.replace(/[ \t]+$/g, ""))
      .join("\n")
      .replace(/\s*$/, "\n");
    setEditContent(normalized);
    closeEditorContextMenu();
  }, [closeEditorContextMenu, editContent]);

  const handleShowCodeActions = useCallback(() => {
    // If an LSP server is active, try to fetch quick-fix code actions for the
    // current selection. Falls back to a message if none are available.
    const editor = editorRef.current;
    if (!editor || !path) {
      setSaveError("No code actions available for this selection.");
      closeEditorContextMenu();
      return;
    }
    const { selectionStart } = editor;
    const before = editContent.slice(0, selectionStart);
    const line = before.split("\n").length - 1;
    const col = selectionStart - before.lastIndexOf("\n") - 1;
    apiFetch(`/api/lsp/diagnostics/file?path=${encodeURIComponent(path)}`)
      .then((res) => res.json())
      .then((data: { diagnostics?: Array<{ line: number; character: number; message: string; severity: string }> }) => {
        const diags = (data.diagnostics ?? []).filter(
          (d) => d.line === line && Math.abs(d.character - col) <= 5
        );
        if (diags.length > 0) {
          setSaveError(
            diags.map((d) => `[${d.severity}] Line ${d.line + 1}: ${d.message}`).join("\n")
          );
        } else {
          setSaveError("No diagnostics or code actions at this position.");
        }
      })
      .catch(() => {
        setSaveError("No code actions available for this selection.");
      });
    closeEditorContextMenu();
  }, [closeEditorContextMenu, editContent, path]);

  const handleCutSelection = useCallback(async () => {
    const editor = editorRef.current;
    if (!editor) return;
    const start = editor.selectionStart ?? 0;
    const end = editor.selectionEnd ?? start;
    if (end <= start) {
      closeEditorContextMenu();
      return;
    }
    const selected = editContent.slice(start, end);
    try {
      await navigator.clipboard.writeText(selected);
    } catch {
      setSaveError("Clipboard write failed.");
    }
    const next = `${editContent.slice(0, start)}${editContent.slice(end)}`;
    setEditContent(next);
    window.requestAnimationFrame(() => {
      if (!editorRef.current) return;
      editorRef.current.focus();
      editorRef.current.setSelectionRange(start, start);
      updateCursorFromSelection(editorRef.current);
    });
    closeEditorContextMenu();
  }, [closeEditorContextMenu, editContent, updateCursorFromSelection]);

  const handleCopySelection = useCallback(
    async (trim = false) => {
      const editor = editorRef.current;
      if (!editor) return;
      const start = editor.selectionStart ?? 0;
      const end = editor.selectionEnd ?? start;
      const selected = editContent.slice(start, end);
      if (!selected) {
        closeEditorContextMenu();
        return;
      }
      try {
        await navigator.clipboard.writeText(trim ? selected.trim() : selected);
      } catch {
        setSaveError("Clipboard write failed.");
      }
      closeEditorContextMenu();
    },
    [closeEditorContextMenu, editContent]
  );

  const handlePasteSelection = useCallback(async () => {
    const editor = editorRef.current;
    if (!editor) return;
    let clipboardText = "";
    try {
      clipboardText = await navigator.clipboard.readText();
    } catch {
      setSaveError("Clipboard read failed.");
      closeEditorContextMenu();
      return;
    }
    const start = editor.selectionStart ?? 0;
    const end = editor.selectionEnd ?? start;
    const next = `${editContent.slice(0, start)}${clipboardText}${editContent.slice(end)}`;
    setEditContent(next);
    window.requestAnimationFrame(() => {
      if (!editorRef.current) return;
      const cursor = start + clipboardText.length;
      editorRef.current.focus();
      editorRef.current.setSelectionRange(cursor, cursor);
      updateCursorFromSelection(editorRef.current);
    });
    closeEditorContextMenu();
  }, [closeEditorContextMenu, editContent, updateCursorFromSelection]);

  const handleRevealInFinder = useCallback(async () => {
    if (!path) return;
    await apiFetch("/api/ide/reveal", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path }),
    });
    closeEditorContextMenu();
  }, [closeEditorContextMenu, path]);

  const handleOpenInTerminal = useCallback(async () => {
    if (!path) return;
    const response = await apiFetch("/api/ide/open-terminal", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path }),
    });
    const data = await response.json();
    if (!data?.success) {
      setSaveError(data?.error || "Failed to open terminal.");
    }
    closeEditorContextMenu();
  }, [closeEditorContextMenu, path]);

  const handleCopyPermalink = useCallback(async () => {
    if (!path || !editorContextMenu) return;
    const params = new URLSearchParams({
      path,
      line: String(editorContextMenu.line),
    });
    const response = await apiFetch(`/api/ide/permalink?${params.toString()}`);
    const data = (await response.json()) as { success?: boolean; url?: string; error?: string };
    if (!data?.success || !data.url) {
      setSaveError(data?.error || "Failed to generate permalink.");
      closeEditorContextMenu();
      return;
    }
    try {
      await navigator.clipboard.writeText(data.url);
    } catch {
      setSaveError("Clipboard write failed.");
    }
    closeEditorContextMenu();
  }, [closeEditorContextMenu, editorContextMenu, path]);

  const handleViewFileHistory = useCallback(async () => {
    if (!path) return;
    const response = await apiFetch(`/api/ide/history-url?path=${encodeURIComponent(path)}`);
    const data = (await response.json()) as { success?: boolean; url?: string; error?: string };
    if (!data?.success || !data.url) {
      setSaveError(data?.error || "Failed to resolve file history URL.");
      closeEditorContextMenu();
      return;
    }
    window.open(data.url, "_blank", "noopener,noreferrer");
    closeEditorContextMenu();
  }, [closeEditorContextMenu, path]);

  useEffect(() => {
    if (!editorContextMenu) return;

    const handleClickAway = () => {
      setEditorContextMenu(null);
    };
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setEditorContextMenu(null);
      }
    };

    window.addEventListener("mousedown", handleClickAway);
    window.addEventListener("scroll", handleClickAway, true);
    window.addEventListener("resize", handleClickAway);
    window.addEventListener("keydown", handleEscape);
    return () => {
      window.removeEventListener("mousedown", handleClickAway);
      window.removeEventListener("scroll", handleClickAway, true);
      window.removeEventListener("resize", handleClickAway);
      window.removeEventListener("keydown", handleEscape);
    };
  }, [editorContextMenu]);

  useEffect(() => {
    if (!path || isBinary) return;
    window.requestAnimationFrame(() => {
      const scrollElement = showPendingInlinePreviewRef.current
        ? previewScrollRef.current
        : editorRef.current;
      if (scrollElement) {
        syncEditorScroll(scrollElement);
      }
      if (!showPendingInlinePreviewRef.current && editorRef.current) {
        updateCursorFromSelection(editorRef.current);
      }
    });
  }, [path, isBinary, syncEditorScroll, updateCursorFromSelection]);

  const isMarkdownPreview =
    !isBinary &&
    previewMode &&
    (extension.toLowerCase() === ".md" || extension.toLowerCase() === ".markdown");
  const sourceText = useDeferredValue(editContent);
  const sourceLines = useMemo(() => sourceText.split("\n"), [sourceText]);
  const hasCurrentPendingFileDiff = useMemo(
    () =>
      !!path &&
      Array.isArray(pendingFileDiffs) &&
      pendingFileDiffs.some((entry) => entry && typeof entry.path === "string" && isSameIdePath(path, entry.path)),
    [path, pendingFileDiffs]
  );
  const pendingInlinePreviewRows = useMemo<IdePendingInlinePreviewRow[]>(
    () =>
      hasCurrentPendingFileDiff && pendingPreviewDiff
        ? buildPendingInlinePreviewRows(pendingPreviewDiff, sourceText)
        : [],
    [hasCurrentPendingFileDiff, pendingPreviewDiff, sourceText]
  );
  const pendingInlinePreviewIndexByLine = useMemo(() => {
    const indexByLine = new Map<number, number>();
    pendingInlinePreviewRows.forEach((row, index) => {
      if (row.lineNumber === null || indexByLine.has(row.lineNumber)) return;
      indexByLine.set(row.lineNumber, index);
    });
    return indexByLine;
  }, [pendingInlinePreviewRows]);
  const showPendingInlinePreview =
    !isBinary &&
    !isMarkdownPreview &&
    !hasUnsavedChanges &&
    !showFindBar &&
    hasCurrentPendingFileDiff &&
    pendingInlinePreviewRows.length > 0;
  const renderedEditorRowCount = showPendingInlinePreview
    ? pendingInlinePreviewRows.length
    : sourceLines.length;
  const lineHeightPx = normalizedLineHeight;
  const gutterStartLine = Math.max(0, Math.floor(scrollMetrics.top / lineHeightPx) - 80);
  const gutterVisibleCount = Math.max(Math.ceil(scrollMetrics.height / lineHeightPx) + 160, 220);
  const gutterEndLine = Math.min(renderedEditorRowCount, gutterStartLine + gutterVisibleCount);
  const visibleLineIndices = useMemo(() => {
    const indices: number[] = [];
    for (let line = gutterStartLine; line < gutterEndLine; line += 1) {
      indices.push(line);
    }
    return indices;
  }, [gutterEndLine, gutterStartLine]);
  const pendingDeletedBlocksByLine = useMemo(() => {
    const grouped = new Map<number, IdePendingDeletedBlock[]>();
    for (const block of pendingLineDecorations.deletedBlocks) {
      const existing = grouped.get(block.anchorLine) || [];
      existing.push(block);
      grouped.set(block.anchorLine, existing);
    }
    return grouped;
  }, [pendingLineDecorations]);
  const minimapRows = useMemo(() => {
    const maxRows = 1200;
    const previewRows = showPendingInlinePreview ? pendingInlinePreviewRows : null;
    const totalRows = previewRows ? previewRows.length : sourceLines.length;
    const step = Math.max(1, Math.ceil(Math.max(totalRows, 1) / maxRows));
    const rows: Array<{ sourceLine: number; length: number; kind: IdePendingInlinePreviewRow["kind"] | "mixed" }> = [];
    for (let i = 0; i < totalRows; i += step) {
      let longest = 0;
      let segmentKind: IdePendingInlinePreviewRow["kind"] | "mixed" = "context";
      const end = Math.min(i + step, totalRows);
      for (let j = i; j < end; j += 1) {
        const previewRow = previewRows?.[j] || null;
        const lengthSource = previewRow ? previewRow.text : sourceLines[j] || "";
        longest = Math.max(longest, lengthSource.trim().length || 0);
        const nextKind = previewRow?.kind || "context";
        if (segmentKind === "context") {
          segmentKind = nextKind;
        } else if (nextKind !== "context" && nextKind !== segmentKind) {
          segmentKind = "mixed";
        }
      }
      rows.push({ sourceLine: i + 1, length: longest, kind: segmentKind });
    }
    return { rows, step };
  }, [pendingInlinePreviewRows, showPendingInlinePreview, sourceLines]);
  const activeEditorRowIndex = showPendingInlinePreview
    ? pendingInlinePreviewIndexByLine.get(activeLine) ?? Math.max(activeLine - 1, 0)
    : Math.max(activeLine - 1, 0);
  const activeMinimapRow = Math.floor(activeEditorRowIndex / Math.max(minimapRows.step, 1));

  useEffect(() => {
    showPendingInlinePreviewRef.current = showPendingInlinePreview;
    pendingPreviewRowIndexByLineRef.current = pendingInlinePreviewIndexByLine;
  }, [pendingInlinePreviewIndexByLine, showPendingInlinePreview]);

  useEffect(() => {
    const wasShowingPendingPreview = previousPendingInlinePreviewRef.current;
    previousPendingInlinePreviewRef.current = showPendingInlinePreview;
    if (!wasShowingPendingPreview || showPendingInlinePreview) return;
    window.requestAnimationFrame(() => {
      const textarea = editorRef.current;
      if (!textarea) return;
      const lines = editContent.split("\n");
      const line = Math.min(Math.max(activeLine, 1), Math.max(lines.length, 1));
      let offset = 0;
      for (let i = 0; i < line - 1; i += 1) {
        offset += lines[i]?.length || 0;
        offset += 1;
      }
      textarea.setSelectionRange(offset, offset);
      textarea.scrollTop = scrollMetrics.top;
      textarea.scrollLeft = scrollMetrics.left;
      syncEditorScroll(textarea);
      updateCursorFromSelection(textarea);
    });
  }, [
    activeLine,
    editContent,
    scrollMetrics.left,
    scrollMetrics.top,
    showPendingInlinePreview,
    syncEditorScroll,
    updateCursorFromSelection,
  ]);

  useEffect(() => {
    if (!showPendingInlinePreview || !previewScrollRef.current) return;
    syncEditorScroll(previewScrollRef.current);
  }, [pendingInlinePreviewRows, showPendingInlinePreview, syncEditorScroll]);

  const lineDiagnostics = useMemo(() => {
    const map = new Map<number, Diagnostic[]>();
    diagnostics.forEach((d) => {
      const existing = map.get(d.line) || [];
      existing.push(d);
      map.set(d.line, existing);
    });
    return map;
  }, [diagnostics]);

  if (!path) {
    return (
      <div className="flex-1 flex items-center justify-center text-gray-500">
        <div className="text-center">
          <Code className="w-12 h-12 mx-auto mb-4 opacity-50" />
          <p>Select a file to view</p>
        </div>
      </div>
    );
  }

  if (isLoading && content === null) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-gray-500" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex-1 flex items-center justify-center text-red-400">
        <div className="text-center">
          <AlertCircle className="w-8 h-8 mx-auto mb-2" />
          <p>{error}</p>
        </div>
      </div>
    );
  }

  const language = getPrismLanguage(extension);
  const highlightLanguage = isMarkdownFile ? "plaintext" : language;

  const showCompletionPanel =
    enableCompletions && completionVisible && completionItems.length > 0 && !!completionOrigin;
  const completionPanelPosition = completionOrigin
    ? {
        left: Math.max(8, 16 + (completionOrigin.column - 1) * charWidthPx - scrollMetrics.left),
        top: Math.max(
          8,
          16 +
            (completionOrigin.line - 1) * normalizedLineHeight -
            scrollMetrics.top +
            normalizedLineHeight
        ),
      }
    : null;
  const ghostInlineText = ghostCompletion ? ghostCompletion.split("\n")[0] || "" : "";
  const showGhostCompletion =
    enableCompletions &&
    enableGhostCompletions &&
    !!ghostOrigin &&
    !!ghostInlineText &&
    !showCompletionPanel;
  const ghostPosition = ghostOrigin
    ? {
        left: Math.max(8, 16 + (ghostOrigin.column - 1) * charWidthPx - scrollMetrics.left),
        top: Math.max(8, 16 + (ghostOrigin.line - 1) * normalizedLineHeight - scrollMetrics.top),
      }
    : null;
  const showInlineBlame =
    !isLargeFileMode &&
    !isTypingBurst &&
    !completionLoading &&
    !showCompletionPanel &&
    !showGhostCompletion &&
    !completionVisible &&
    blameLines.size > 0;
  const popoverBlameDetails = blamePopoverLine ? blameLines.get(blamePopoverLine) || null : null;
  const popoverBlameTimestamp = formatBlameDateTime(popoverBlameDetails?.authorDate);
  const editorContextMenuPosition = editorContextMenu
    ? {
        left:
          typeof window !== "undefined"
            ? Math.min(editorContextMenu.x, Math.max(window.innerWidth - 240, 8))
            : editorContextMenu.x,
        top:
          typeof window !== "undefined"
            ? Math.min(editorContextMenu.y, Math.max(window.innerHeight - 210, 8))
            : editorContextMenu.y,
      }
    : null;

  const handleCopyCommit = async (commit: string) => {
    if (!commit) return;
    try {
      await navigator.clipboard.writeText(commit);
      setCopiedCommit(commit);
      window.setTimeout(() => setCopiedCommit(null), 1400);
    } catch {
      // Clipboard API can fail in locked-down contexts.
    }
  };

  const clearBlameHideTimer = () => {
    if (blameHideTimeoutRef.current !== null) {
      window.clearTimeout(blameHideTimeoutRef.current);
      blameHideTimeoutRef.current = null;
    }
  };

  const showBlamePopover = (line: number) => {
    clearBlameHideTimer();
    setBlamePopoverLine(line);
  };

  const scheduleHideBlamePopover = () => {
    clearBlameHideTimer();
    blameHideTimeoutRef.current = window.setTimeout(() => {
      setBlamePopoverLine(null);
      blameHideTimeoutRef.current = null;
    }, 130);
  };

  // --- LSP hover tooltip ---

  const clearHoverTimer = () => {
    if (hoverTimerRef.current) {
      clearTimeout(hoverTimerRef.current);
      hoverTimerRef.current = null;
    }
  };

  const scheduleHover = (line: number, character: number) => {
    clearHoverTimer();
    hoverTimerRef.current = setTimeout(async () => {
      hoverTimerRef.current = null;
      // Abort any previous hover fetch.
      hoverAbortRef.current?.abort();
      const controller = new AbortController();
      hoverAbortRef.current = controller;
      setHoverInfo({ line, text: null, loading: true });
      try {
        const params = new URLSearchParams({
          path: path,
          line: String(line),
          character: String(character),
        });
        const res = await apiFetch(`/api/lsp/hover?${params}`, { signal: controller.signal });
        const data = await res.json();
        if (controller.signal.aborted) return;
        setHoverInfo({ line, text: data.text || null, loading: false });
      } catch {
        if (!controller.signal.aborted) {
          setHoverInfo(null);
        }
      }
    }, 350); // 350ms debounce
  };

  const scheduleHideHover = () => {
    clearHoverTimer();
    hoverAbortRef.current?.abort();
    setHoverInfo(null);
  };

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
                  style={{ transform: `translateY(${gutterStartLine * lineHeightPx}px)` }}
                >
                  {visibleLineIndices.map((i) => {
                    if (showPendingInlinePreview) {
                      const previewRow = pendingInlinePreviewRows[i];
                      if (!previewRow) return null;
                      const lineNum = previewRow.lineNumber;
                      const diagnosticsIndex = lineNum === null ? null : lineNum - 1;
                      const lineDiags =
                        diagnosticsIndex === null ? [] : lineDiagnostics.get(diagnosticsIndex) || [];
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
                              selectPendingPreviewLine(lineNum, { scrollIntoView: false });
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
                        const diagnosticsIndex = row.lineNumber === null ? null : row.lineNumber - 1;
                        const lineDiags =
                          diagnosticsIndex === null ? [] : lineDiagnostics.get(diagnosticsIndex) || [];
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
                              row.kind === "context" && hasWarning && !hasError && "bg-yellow-500/10",
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
                              title={row.lineNumber === null ? "Removed line" : `Line ${row.lineNumber}`}
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
                              style={{ transform: `translateY(${gutterStartLine * lineHeightPx}px)` }}
                            >
                              {visibleLineIndices.map((i) => {
                                const line = sourceLines[i] || "";
                                const lineNum = i;
                                const lineDiags = lineDiagnostics.get(lineNum) || [];
                                const hasError = lineDiags.some((d) => d.severity === "error");
                                const hasWarning = lineDiags.some((d) => d.severity === "warning");
                                const isActiveLine = activeLine === i + 1;
                                const pendingLineState = pendingLineDecorations.lineStates.get(i + 1);
                                const pendingDeletedSummary = summarizePendingDeletedBlocks(
                                  pendingDeletedBlocksByLine.get(i + 1)
                                );
                                return (
                                  <div
                                    key={i}
                                    data-line-number={i + 1}
                                    onMouseEnter={() => scheduleHover(i, 0)}
                                    onMouseLeave={scheduleHideHover}
                                    style={{
                                      height: `${normalizedLineHeight}px`,
                                      lineHeight: `${normalizedLineHeight}px`,
                                      ...getPendingLineDecorationStyle(pendingLineState, isActiveLine),
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
                                    <span className="flex-shrink-0">{line.length > 0 ? line : "\u00a0"}</span>
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
                                        <ReactMarkdown remarkPlugins={[remarkGfm]} components={ideMarkdownComponents}>
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
                                const pendingLineState = pendingLineDecorations.lineStates.get(i + 1);
                                const pendingDeletedSummary = summarizePendingDeletedBlocks(
                                  pendingDeletedBlocksByLine.get(i + 1)
                                );
                                const blameLine = blameLines.get(i + 1) || null;
                                const blameDate = formatBlameStamp(blameLine?.authorDate);
                                const blameSummary =
                                  blameLine?.summary || (blameLine?.isUncommitted ? "Uncommitted" : "");
                                const blameText = blameLine
                                  ? `${blameLine.author} · ${blameLine.shortCommit}${blameDate ? ` · ${blameDate}` : ""}${blameSummary ? ` · ${blameSummary}` : ""}`
                                  : "";
                                const shouldShowLineBlame =
                                  isActiveLine && showInlineBlame && !!blameLine;
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
                                      ...getPendingLineDecorationStyle(pendingLineState, isActiveLine),
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
                                          const tokenProps = getTokenProps({ token });
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
                                          onMouseLeave={scheduleHideBlamePopover}
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
                                                      void handleCopyCommit(popoverBlameDetails.commit)
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
                        tabSize: 2,
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
                          <span>Completions {completionPrefix ? `for "${completionPrefix}"` : ""}</span>
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
