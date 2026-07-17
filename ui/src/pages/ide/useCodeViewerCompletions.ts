import { apiFetch } from "@/lib/auth";
import {
  type Dispatch,
  type RefObject,
  type SetStateAction,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  COMPLETION_CACHE_MAX_ENTRIES,
  COMPLETION_CACHE_TTL_MS,
  COMPLETION_LOCAL_SCAN_AFTER,
  COMPLETION_LOCAL_SCAN_BEFORE,
} from "./ideConstants";
import type {
  IdeCompletionItem,
  IdeCompletionResponse,
  IdeInlineCompletionResponse,
} from "./ideTypes";
import { getLineAndColumn } from "./ideUtils";

interface UseCodeViewerCompletionsOptions {
  path: string | null;
  previewMode: boolean;
  completionAgentId?: string | null;
  enableCompletions: boolean;
  enableGhostCompletions: boolean;
  normalizedCompletionDebounce: number;
  normalizedGhostDebounce: number;
  extension: string;
  isBinary: boolean;
  showFindBar: boolean;
  isLargeFileMode: boolean;
  isTypingBurst: boolean;
  editContent: string;
  setEditContent: Dispatch<SetStateAction<string>>;
  editorRef: RefObject<HTMLTextAreaElement | null>;
  updateCursorFromSelection: (element: HTMLTextAreaElement | null) => void;
  syncEditorScroll: (element: HTMLTextAreaElement | null) => void;
  markTypingBurst: () => void;
  cursorLine: number;
  cursorColumn: number;
}

interface CodeViewerCompletionsController {
  completionItems: IdeCompletionItem[];
  completionIndex: number;
  setCompletionIndex: Dispatch<SetStateAction<number>>;
  completionVisible: boolean;
  setCompletionVisible: Dispatch<SetStateAction<boolean>>;
  completionLoading: boolean;
  completionPrefix: string;
  completionOrigin: { line: number; column: number } | null;
  ghostCompletion: string;
  ghostOrigin: { line: number; column: number; replaceStart: number } | null;
  clearCompletions: () => void;
  requestCompletions: (options?: { force?: boolean }) => Promise<void>;
  applyCompletion: (targetIndex?: number) => boolean;
  applyGhostCompletion: () => boolean;
  tryInlineTabCompletion: () => boolean;
}

export function useCodeViewerCompletions({
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
}: UseCodeViewerCompletionsOptions): CodeViewerCompletionsController {
  const [completionItems, setCompletionItems] = useState<IdeCompletionItem[]>([]);
  const [completionIndex, setCompletionIndex] = useState(0);
  const [completionVisible, setCompletionVisible] = useState(false);
  const [completionLoading, setCompletionLoading] = useState(false);
  const [completionReplaceStart, setCompletionReplaceStart] = useState(0);
  const [completionPrefix, setCompletionPrefix] = useState("");
  const [completionOrigin, setCompletionOrigin] = useState<{
    line: number;
    column: number;
  } | null>(null);
  const [ghostCompletion, setGhostCompletion] = useState("");
  const [ghostOrigin, setGhostOrigin] = useState<{
    line: number;
    column: number;
    replaceStart: number;
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

  const resetCompletionState = useCallback(() => {
    setCompletionItems([]);
    setCompletionIndex(0);
    setCompletionVisible(false);
    setCompletionLoading(false);
    setCompletionReplaceStart(0);
    setCompletionPrefix("");
    setCompletionOrigin(null);
    setGhostCompletion("");
    setGhostOrigin(null);
    completionRequestSeqRef.current += 1;
    ghostRequestSeqRef.current += 1;
    if (completionDebounceRef.current !== null) {
      window.clearTimeout(completionDebounceRef.current);
      completionDebounceRef.current = null;
    }
    completionAbortRef.current?.abort();
    completionAbortRef.current = null;
    if (ghostDebounceRef.current !== null) {
      window.clearTimeout(ghostDebounceRef.current);
      ghostDebounceRef.current = null;
    }
    ghostAbortRef.current?.abort();
    ghostAbortRef.current = null;
  }, []);

  useEffect(() => {
    resetCompletionState();
  }, [path, resetCompletionState]);

  useEffect(() => resetCompletionState, [resetCompletionState]);

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
          {
            label: "for",
            insertText: "for (let i = 0; i < ; i++) {\n  \n}",
            detail: "Snippet",
          },
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
              completionCacheRef.current.set(cacheKey, {
                ts: now,
                items: lspItems,
              });
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

  return {
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
  };
}
