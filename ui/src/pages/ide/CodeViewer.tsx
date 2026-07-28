import { apiFetch } from "@/lib/auth";
import {
  buildPendingInlinePreviewRows,
  emptyIdePendingDiffDecorations,
  mergeGitDiffDecorations,
  parseGitDiffDecorations,
  type IdePendingDeletedBlock,
  type IdePendingDiffDecorations,
  type IdePendingInlinePreviewRow,
} from "@/lib/idePendingDiffDecorations";
import { AlertCircle, Code, Loader2 } from "lucide-react";
import React, { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { CodeViewerView } from "./CodeViewerView";
import {
  getCodeViewerConfiguration,
  getMinimapRowBudget,
  isCodeViewerLargeFile,
  type CodeViewerProps,
} from "./codeViewerConfig";
import {
  EDITOR_FONT_SIZE_PX,
  EDITOR_LARGE_FILE_CHAR_THRESHOLD,
  EDITOR_LARGE_FILE_LINE_THRESHOLD,
  EDITOR_LINE_HEIGHT_PX,
  EDITOR_TYPING_BURST_MS,
} from "./ideConstants";
import { isSameIdePath, shouldHydratePendingFileDiffFromGit } from "./ideDiffHelpers";
import type {
  Diagnostic,
  GitHistoryStatus,
  IdeBlameLine,
  IdeBlameResult,
  ReadResult,
} from "./ideTypes";
import { formatBlameDateTime, getLineAndColumn, getPrismLanguage } from "./ideUtils";
import { useCodeViewerCompletions } from "./useCodeViewerCompletions";
import { useCodeViewerFind } from "./useCodeViewerFind";

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
}: CodeViewerProps) {
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
  const [blameAllLines, setBlameAllLines] = useState(false);
  const [copiedCommit, setCopiedCommit] = useState<string | null>(null);
  const [hoverInfo, setHoverInfo] = useState<{
    line: number;
    text: string | null;
    loading: boolean;
  } | null>(null);
  const hoverAbortRef = useRef<AbortController | null>(null);
  const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [cursorLine, setCursorLine] = useState(1);
  const [cursorColumn, setCursorColumn] = useState(1);
  const [scrollMetrics, setScrollMetrics] = useState({
    top: 0,
    left: 0,
    height: 1,
    width: 1,
    scrollHeight: 1,
    scrollWidth: 1,
  });
  const [editorContextMenu, setEditorContextMenu] = useState<{
    x: number;
    y: number;
    line: number;
    column: number;
  } | null>(null);
  const [definitionLoading, setDefinitionLoading] = useState(false);
  const [isTypingBurst, setIsTypingBurst] = useState(false);
  const editorRef = useRef<HTMLTextAreaElement | null>(null);
  const previewScrollRef = useRef<HTMLDivElement | null>(null);
  const highlightScrollRef = useRef<HTMLDivElement | null>(null);
  const gutterRef = useRef<HTMLDivElement | null>(null);
  const appliedJumpRequestRef = useRef<string>("");
  const hasUnsavedChangesRef = useRef(false);
  const blameHideTimeoutRef = useRef<number | null>(null);
  const blameShowTimeoutRef = useRef<number | null>(null);
  const scrollMetricsFrameRef = useRef<number | null>(null);
  const pendingScrollMetricsRef = useRef<{
    top: number;
    left: number;
    height: number;
    width: number;
    scrollHeight: number;
    scrollWidth: number;
  } | null>(null);
  const fileReadRequestSeqRef = useRef(0);
  const fileReadAbortRef = useRef<AbortController | null>(null);
  const blameRequestSeqRef = useRef(0);
  const blameAbortRef = useRef<AbortController | null>(null);
  const lineChangesRequestSeqRef = useRef(0);
  const lineChangesAbortRef = useRef<AbortController | null>(null);
  const typingBurstTimeoutRef = useRef<number | null>(null);
  const pendingCursorNotifyRef = useRef<{
    line: number;
    column: number;
  } | null>(null);
  const cursorNotifyFrameRef = useRef<number | null>(null);
  const pendingCursorSelectionRef = useRef<HTMLTextAreaElement | null>(null);
  const cursorSelectionFrameRef = useRef<number | null>(null);
  const showPendingInlinePreviewRef = useRef(false);
  const previousPendingInlinePreviewRef = useRef(false);
  const pendingPreviewRowIndexByLineRef = useRef<Map<number, number>>(new Map());
  const {
    normalizedFontSize,
    normalizedLineHeight,
    normalizedCompletionDebounce,
    normalizedGhostDebounce,
    charWidthPx,
    isMarkdownFile,
  } = getCodeViewerConfiguration(
    editorFontSizePx,
    editorLineHeightPx,
    completionDebounceMs,
    ghostDebounceMs,
    extension,
    path
  );

  const hasUnsavedChanges = editContent !== (content || "");
  const isLargeFileMode = useMemo(
    () =>
      isCodeViewerLargeFile(
        editContent,
        content,
        EDITOR_LARGE_FILE_CHAR_THRESHOLD,
        EDITOR_LARGE_FILE_LINE_THRESHOLD
      ),
    [content, editContent]
  );
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
        forCurrentFile.length > 1 ||
        forCurrentFile.some((entry) => shouldHydratePendingFileDiffFromGit(entry));

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
    setActiveLine(1);
    if (blameHideTimeoutRef.current !== null) {
      window.clearTimeout(blameHideTimeoutRef.current);
      blameHideTimeoutRef.current = null;
    }
    if (blameShowTimeoutRef.current !== null) {
      window.clearTimeout(blameShowTimeoutRef.current);
      blameShowTimeoutRef.current = null;
    }
    setBlamePopoverLine(null);
    setCopiedCommit(null);
    setCursorLine(1);
    setCursorColumn(1);
    setScrollMetrics({
      top: 0,
      left: 0,
      height: 1,
      width: 1,
      scrollHeight: 1,
      scrollWidth: 1,
    });
    setEditorContextMenu(null);
    setDefinitionLoading(false);
    setIsTypingBurst(false);
    if (typingBurstTimeoutRef.current !== null) {
      window.clearTimeout(typingBurstTimeoutRef.current);
      typingBurstTimeoutRef.current = null;
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
      if (blameShowTimeoutRef.current !== null) {
        window.clearTimeout(blameShowTimeoutRef.current);
        blameShowTimeoutRef.current = null;
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

  const {
    findQuery,
    setFindQuery,
    findCaseSensitive,
    setFindCaseSensitive,
    findMatches,
    activeFindMatchIndex,
    showFindBar,
    setShowFindBar,
    showFindReplace,
    setShowFindReplace,
    findReplaceValue,
    setFindReplaceValue,
    findInputRef,
    replaceInputRef,
    focusReplaceInput,
    toggleFindBar,
    handleFindNext,
    handleFindPrevious,
    handleReplaceCurrent,
    handleReplaceAllInFile,
  } = useCodeViewerFind({
    path,
    editContent,
    setEditContent,
    editorRef,
    normalizedLineHeight,
    updateCursorFromSelection,
    syncEditorScroll,
  });

  const {
    completionItems,
    completionIndex,
    setCompletionIndex,
    completionVisible,
    setCompletionVisible,
    completionLoading,
    completionPrefix,
    completionOrigin,
    ghostCompletion,
    ghostOrigin,
    clearCompletions,
    requestCompletions,
    applyCompletion,
    applyGhostCompletion,
    tryInlineTabCompletion,
  } = useCodeViewerCompletions({
    path,
    previewMode,
    completionAgentId,
    enableCompletions,
    enableGhostCompletions,
    normalizedCompletionDebounce,
    normalizedGhostDebounce,
    extension,
    isBinary,
    showFindBar,
    isLargeFileMode,
    isTypingBurst,
    editContent,
    setEditContent,
    editorRef,
    updateCursorFromSelection,
    syncEditorScroll,
    markTypingBurst,
    cursorLine,
    cursorColumn,
  });

  const selectPendingPreviewLine = useCallback(
    (requestedLine: number, options?: { scrollIntoView?: boolean }) => {
      const previewElement = previewScrollRef.current;
      if (!previewElement) return;
      const line = Math.max(1, Math.round(requestedLine));
      if (options?.scrollIntoView) {
        const rowIndex = pendingPreviewRowIndexByLineRef.current.get(line) ?? Math.max(line - 1, 0);
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
      if (!path) return [];
      const targetLine = editorContextMenu ? editorContextMenu.line : cursorLine;
      const targetColumn = editorContextMenu ? editorContextMenu.column : cursorColumn;
      const params = new URLSearchParams({
        path,
        line: String(Math.max(targetLine - 1, 0)),
        character: String(Math.max(targetColumn - 1, 0)),
      });
      const response = await apiFetch(`/api/lsp/${endpoint}?${params.toString()}`);
      const data = (await response.json()) as {
        success?: boolean;
        error?: string;
        location?: { path?: string; line?: number; character?: number } | null;
        locations?: Array<{
          path?: string;
          line?: number;
          character?: number;
        }> | null;
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
    [editorContextMenu, cursorLine, cursorColumn, path]
  );

  const openFirstLspLocation = useCallback(
    async (
      endpoint: "definition" | "declaration" | "type-definition" | "implementation",
      notFoundMessage: string
    ) => {
      if (!path) return;
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
    [closeEditorContextMenu, onOpenLocation, path, resolveLspLocations]
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
    if (!path) return;
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
  }, [closeEditorContextMenu, onOpenLocation, path, resolveLspLocations]);

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
      .then(
        (data: {
          diagnostics?: Array<{
            line: number;
            character: number;
            message: string;
            severity: string;
          }>;
        }) => {
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
        }
      )
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
    const data = (await response.json()) as {
      success?: boolean;
      url?: string;
      error?: string;
    };
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
    const data = (await response.json()) as {
      success?: boolean;
      url?: string;
      error?: string;
    };
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
      pendingFileDiffs.some(
        (entry) => entry && typeof entry.path === "string" && isSameIdePath(path, entry.path)
      ),
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
    const maxRows = getMinimapRowBudget(scrollMetrics.height);
    const previewRows = showPendingInlinePreview ? pendingInlinePreviewRows : null;
    const totalRows = previewRows ? previewRows.length : sourceLines.length;
    const step = Math.max(1, Math.ceil(Math.max(totalRows, 1) / maxRows));
    const rows: Array<{
      sourceLine: number;
      length: number;
      kind: IdePendingInlinePreviewRow["kind"] | "mixed";
    }> = [];
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
  }, [pendingInlinePreviewRows, scrollMetrics.height, showPendingInlinePreview, sourceLines]);
  const activeEditorRowIndex = showPendingInlinePreview
    ? (pendingInlinePreviewIndexByLine.get(activeLine) ?? Math.max(activeLine - 1, 0))
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
    } catch {}
  };

  const clearBlameHideTimer = () => {
    if (blameHideTimeoutRef.current !== null) {
      window.clearTimeout(blameHideTimeoutRef.current);
      blameHideTimeoutRef.current = null;
    }
  };

  const clearBlameShowTimer = () => {
    if (blameShowTimeoutRef.current !== null) {
      window.clearTimeout(blameShowTimeoutRef.current);
      blameShowTimeoutRef.current = null;
    }
  };

  const showBlamePopover = (line: number) => {
    clearBlameHideTimer();
    clearBlameShowTimer();
    if (blamePopoverLine !== null) {
      setBlamePopoverLine(line);
      return;
    }
    blameShowTimeoutRef.current = window.setTimeout(() => {
      blameShowTimeoutRef.current = null;
      setBlamePopoverLine(line);
    }, 1000);
  };

  const cancelBlamePopover = () => {
    clearBlameShowTimer();
    scheduleHideBlamePopover();
  };

  const scheduleHideBlamePopover = () => {
    clearBlameHideTimer();
    clearBlameShowTimer();
    blameHideTimeoutRef.current = window.setTimeout(() => {
      setBlamePopoverLine(null);
      blameHideTimeoutRef.current = null;
    }, 130);
  };

  const clearHoverTimer = () => {
    if (hoverTimerRef.current) {
      clearTimeout(hoverTimerRef.current);
      hoverTimerRef.current = null;
    }
  };

  const scheduleHover = (displayLine: number, character: number) => {
    clearHoverTimer();
    hoverTimerRef.current = setTimeout(async () => {
      hoverTimerRef.current = null;
      hoverAbortRef.current?.abort();
      const controller = new AbortController();
      hoverAbortRef.current = controller;
      setHoverInfo({ line: displayLine, text: null, loading: true });
      try {
        const params = new URLSearchParams({
          path: path,
          line: String(Math.max(displayLine - 1, 0)),
          character: String(character),
        });
        const res = await apiFetch(`/api/lsp/hover?${params}`, {
          signal: controller.signal,
        });
        const data = await res.json();
        if (controller.signal.aborted) return;
        setHoverInfo({
          line: displayLine,
          text: data.text || null,
          loading: false,
        });
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
    <CodeViewerView
      model={{
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
        disableTokenizedHighlight: isLargeFileMode || isTypingBurst,
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
      }}
    />
  );
}
