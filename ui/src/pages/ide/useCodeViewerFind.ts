import {
  type Dispatch,
  type RefObject,
  type SetStateAction,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { getLineAndColumn } from "./ideUtils";

interface UseCodeViewerFindOptions {
  path: string | null;
  editContent: string;
  setEditContent: Dispatch<SetStateAction<string>>;
  editorRef: RefObject<HTMLTextAreaElement | null>;
  normalizedLineHeight: number;
  updateCursorFromSelection: (element: HTMLTextAreaElement | null) => void;
  syncEditorScroll: (element: HTMLTextAreaElement | null) => void;
}

interface CodeViewerFindController {
  findQuery: string;
  setFindQuery: Dispatch<SetStateAction<string>>;
  findCaseSensitive: boolean;
  setFindCaseSensitive: Dispatch<SetStateAction<boolean>>;
  findMatches: Array<{ start: number; end: number }>;
  activeFindMatchIndex: number;
  showFindBar: boolean;
  setShowFindBar: Dispatch<SetStateAction<boolean>>;
  showFindReplace: boolean;
  setShowFindReplace: Dispatch<SetStateAction<boolean>>;
  findReplaceValue: string;
  setFindReplaceValue: Dispatch<SetStateAction<string>>;
  findInputRef: RefObject<HTMLInputElement | null>;
  replaceInputRef: RefObject<HTMLInputElement | null>;
  focusReplaceInput: () => void;
  toggleFindBar: () => void;
  handleFindNext: () => void;
  handleFindPrevious: () => void;
  handleReplaceCurrent: () => void;
  handleReplaceAllInFile: () => void;
}

export function useCodeViewerFind({
  path,
  editContent,
  setEditContent,
  editorRef,
  normalizedLineHeight,
  updateCursorFromSelection,
  syncEditorScroll,
}: UseCodeViewerFindOptions): CodeViewerFindController {
  const [findQuery, setFindQuery] = useState("");
  const [findCaseSensitive, setFindCaseSensitive] = useState(false);
  const [findMatches, setFindMatches] = useState<Array<{ start: number; end: number }>>([]);
  const [activeFindMatchIndex, setActiveFindMatchIndex] = useState(0);
  const [showFindBar, setShowFindBar] = useState(false);
  const [showFindReplace, setShowFindReplace] = useState(false);
  const [findReplaceValue, setFindReplaceValue] = useState("");
  const findInputRef = useRef<HTMLInputElement | null>(null);
  const replaceInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    setShowFindBar(false);
    setFindQuery("");
    setFindReplaceValue("");
    setShowFindReplace(false);
    setFindMatches([]);
    setActiveFindMatchIndex(0);
  }, [path]);

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
    const next = !showFindBar;
    setShowFindBar(next);
    if (next) {
      focusFindInput();
      return;
    }
    setShowFindReplace(false);
    window.requestAnimationFrame(() => {
      editorRef.current?.focus();
    });
  }, [editorRef, focusFindInput, showFindBar]);

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

  return {
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
  };
}
