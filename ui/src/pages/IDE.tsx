import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useLocation } from "react-router-dom";
import { Button } from "@/components/ui/Button";
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
  Zap,
  GitBranch,
  Search,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { apiFetch } from "@/lib/auth";

interface FileEntry {
  name: string;
  path: string;
  type: "file" | "directory";
  size?: number;
  extension?: string;
  modifiedAt?: string;
  gitModified?: boolean;
  gitStaged?: boolean;
  gitUntracked?: boolean;
  gitIgnored?: boolean;
}

interface BrowseResult {
  success: boolean;
  path: string;
  parent: string | null;
  entries: FileEntry[];
  error?: string;
}

interface ReadResult {
  success: boolean;
  path: string;
  content?: string;
  size?: number;
  extension?: string;
  isBinary?: boolean;
  error?: string;
}

interface Diagnostic {
  line: number;
  character: number;
  endLine: number;
  endCharacter: number;
  severity: "error" | "warning" | "info";
  message: string;
  source?: string;
  code?: string | number;
}

interface LSPLanguage {
  name: string;
  available: boolean;
  bundled: boolean;
}

interface IdeSearchMatch {
  line: number;
  column: number;
  text: string;
}

interface IdeSearchFileResult {
  file: string;
  matches: IdeSearchMatch[];
  count: number;
}

interface IdeSearchResult {
  success: boolean;
  path: string;
  query: string;
  totalMatches: number;
  truncated: boolean;
  files: IdeSearchFileResult[];
  error?: string;
}

interface IdeReplaceResult {
  success: boolean;
  path: string;
  query: string;
  replacement: string;
  changedFiles: Array<{ file: string; replacements: number }>;
  totalReplacements: number;
  error?: string;
}

interface IdeReplacePreviewFile {
  file: string;
  replacements: number;
  preview: Array<{ line: number; before: string; after: string }>;
}

interface IdeReplacePreviewResult {
  success: boolean;
  path: string;
  query: string;
  replacement: string;
  totalReplacements: number;
  files: IdeReplacePreviewFile[];
  truncated: boolean;
  error?: string;
}

interface IdeListFilesResult {
  success: boolean;
  path: string;
  query: string;
  totalFiles: number;
  truncated: boolean;
  files: Array<{ path: string; relativePath: string }>;
  error?: string;
}

const IDE_SIDEBAR_WIDTH_STORAGE_KEY = "cybara.ide.sidebar.width";
const IDE_SIDEBAR_DEFAULT_WIDTH = 280;
const IDE_SIDEBAR_MIN_WIDTH = 220;
const IDE_SIDEBAR_MAX_WIDTH = 520;

function clampSidebarWidth(width: number): number {
  if (!Number.isFinite(width)) return IDE_SIDEBAR_DEFAULT_WIDTH;
  return Math.min(IDE_SIDEBAR_MAX_WIDTH, Math.max(IDE_SIDEBAR_MIN_WIDTH, Math.round(width)));
}

function readPersistedSidebarWidth(): number {
  if (typeof window === "undefined") return IDE_SIDEBAR_DEFAULT_WIDTH;
  const raw = window.localStorage.getItem(IDE_SIDEBAR_WIDTH_STORAGE_KEY);
  if (!raw) return IDE_SIDEBAR_DEFAULT_WIDTH;
  const parsed = Number.parseInt(raw, 10);
  return clampSidebarWidth(parsed);
}

function persistSidebarWidth(width: number): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(IDE_SIDEBAR_WIDTH_STORAGE_KEY, String(clampSidebarWidth(width)));
}

function getFileIcon(entry: FileEntry) {
  if (entry.type === "directory") return null;

  const ext = entry.extension?.toLowerCase() || "";
  const codeExts = [
    ".ts",
    ".tsx",
    ".js",
    ".jsx",
    ".py",
    ".rs",
    ".go",
    ".c",
    ".cpp",
    ".h",
    ".hpp",
    ".java",
    ".kt",
    ".swift",
    ".rb",
    ".php",
    ".lua",
    ".zig",
  ];
  const jsonExts = [".json", ".yaml", ".yml", ".toml"];
  const textExts = [".md", ".txt", ".log", ".env", ".sh", ".bash", ".zsh"];

  if (codeExts.includes(ext)) return <FileCode className="w-4 h-4 text-blue-400" />;
  if (jsonExts.includes(ext)) return <FileJson className="w-4 h-4 text-yellow-400" />;
  if (textExts.includes(ext)) return <FileText className="w-4 h-4 text-gray-400" />;
  return <File className="w-4 h-4 text-gray-500" />;
}

function formatSize(bytes?: number): string {
  if (bytes === undefined) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function getLineAndColumn(content: string, index: number): { line: number; column: number } {
  const safeIndex = Math.max(0, Math.min(index, content.length));
  const before = content.slice(0, safeIndex);
  const line = before.split("\n").length;
  const lineStart = before.lastIndexOf("\n") + 1;
  return {
    line,
    column: safeIndex - lineStart + 1,
  };
}

function getPrismLanguage(ext?: string): string {
  const map: Record<string, string> = {
    ".ts": "typescript",
    ".tsx": "tsx",
    ".js": "javascript",
    ".jsx": "jsx",
    ".py": "python",
    ".rs": "rust",
    ".go": "go",
    ".json": "json",
    ".md": "markdown",
    ".css": "css",
    ".html": "markup",
    ".xml": "markup",
    ".sh": "bash",
    ".bash": "bash",
    ".zsh": "bash",
    ".yaml": "yaml",
    ".yml": "yaml",
    ".toml": "toml",
    ".sql": "sql",
    ".c": "c",
    ".cpp": "cpp",
    ".h": "c",
    ".hpp": "cpp",
    ".java": "java",
    ".kt": "kotlin",
    ".swift": "swift",
    ".rb": "ruby",
    ".php": "php",
    ".lua": "lua",
  };
  return map[ext?.toLowerCase() || ""] || "plaintext";
}

function getSeverityIcon(severity: "error" | "warning" | "info") {
  switch (severity) {
    case "error":
      return <AlertCircle className="w-3 h-3 text-red-400" />;
    case "warning":
      return <AlertTriangle className="w-3 h-3 text-yellow-400" />;
    default:
      return <Info className="w-3 h-3 text-blue-400" />;
  }
}

function FileTreeItem({
  entry,
  level = 0,
  isExpanded,
  onToggle,
  onSelect,
  isSelected,
}: {
  entry: FileEntry;
  level?: number;
  isExpanded?: boolean;
  onToggle?: () => void;
  onSelect: (entry: FileEntry) => void;
  isSelected: boolean;
}) {
  const isDir = entry.type === "directory";
  const isModified = entry.gitModified || entry.gitStaged;
  const isIgnored = entry.gitIgnored;
  const isUntracked = entry.gitUntracked;

  return (
    <div
      className={cn(
        "flex items-center gap-2 px-2 py-1.5 cursor-pointer rounded-md transition-colors text-sm",
        "!outline-none focus:!outline-none",
        isSelected
          ? "bg-indigo-500/20 text-indigo-300"
          : isIgnored
            ? "text-gray-600 hover:bg-white/5 hover:text-gray-300"
            : isModified
              ? "text-amber-300 hover:bg-white/5 hover:text-amber-200"
              : "text-gray-400 hover:bg-white/5 hover:text-white"
      )}
      style={{ paddingLeft: `${level * 16 + 8}px` }}
      onClick={() => {
        if (isDir && onToggle) {
          onToggle();
        } else {
          onSelect(entry);
        }
      }}
    >
      {isDir ? (
        <>
          {isExpanded ? (
            <ChevronDown className="w-3 h-3 flex-shrink-0" />
          ) : (
            <ChevronRight className="w-3 h-3 flex-shrink-0" />
          )}
          {isExpanded ? (
            <FolderOpen className="w-4 h-4 text-amber-400 flex-shrink-0" />
          ) : (
            <Folder className="w-4 h-4 text-amber-400 flex-shrink-0" />
          )}
        </>
      ) : (
        <>
          <span className="w-3" />
          {getFileIcon(entry)}
        </>
      )}
      <span className={cn("truncate", isIgnored && !isSelected && "opacity-75")}>{entry.name}</span>
      {!isDir && (
        <div className="ml-auto flex items-center gap-1.5">
          {isModified && (
            <span className="text-[10px] leading-none px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/30">
              M
            </span>
          )}
          {!isModified && isUntracked && (
            <span className="text-[10px] leading-none px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
              U
            </span>
          )}
          {entry.size !== undefined && <span className="text-xs text-gray-600">{formatSize(entry.size)}</span>}
        </div>
      )}
    </div>
  );
}

function FileTree({
  path,
  level = 0,
  selectedPath,
  onSelectFile,
  expandedDirs,
  onToggleDir,
  filterQuery,
}: {
  path: string;
  level?: number;
  selectedPath: string | null;
  onSelectFile: (entry: FileEntry) => void;
  expandedDirs: Set<string>;
  onToggleDir: (path: string) => void;
  filterQuery: string;
}) {
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchEntries = async () => {
      setIsLoading(true);
      setError(null);
      try {
        const res = await apiFetch(`/api/ide/browse?path=${encodeURIComponent(path)}`);
        const data: BrowseResult = await res.json();
        if (data.success) {
          setEntries(data.entries);
        } else {
          setError(data.error || "Failed to load");
        }
      } catch (e) {
        setError(String(e));
      }
      setIsLoading(false);
    };
    fetchEntries();
  }, [path]);

  const normalizedFilter = filterQuery.trim().toLowerCase();
  const filteredEntries = useMemo(() => {
    if (!normalizedFilter) return entries;
    return entries.filter((entry) => entry.name.toLowerCase().includes(normalizedFilter));
  }, [entries, normalizedFilter]);

  if (isLoading && level === 0) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="w-5 h-5 animate-spin text-gray-500" />
      </div>
    );
  }

  if (error && level === 0) {
    return (
      <div className="flex items-center gap-2 p-4 text-red-400 text-sm">
        <AlertCircle className="w-4 h-4" />
        {error}
      </div>
    );
  }

  if (level === 0 && filteredEntries.length === 0) {
    return (
      <div className="px-3 py-6 text-sm text-gray-500">
        {normalizedFilter
          ? `No files match "${filterQuery.trim()}"`
          : "No files found in this folder"}
      </div>
    );
  }

  return (
    <div>
      {filteredEntries.map((entry) => {
        const isDir = entry.type === "directory";
        const isExpanded = expandedDirs.has(entry.path);

        return (
          <div key={entry.path}>
            <FileTreeItem
              entry={entry}
              level={level}
              isExpanded={isExpanded}
              onToggle={() => onToggleDir(entry.path)}
              onSelect={onSelectFile}
              isSelected={selectedPath === entry.path}
            />
            {isDir && isExpanded && (
              <FileTree
                path={entry.path}
                level={level + 1}
                selectedPath={selectedPath}
                onSelectFile={onSelectFile}
                expandedDirs={expandedDirs}
                onToggleDir={onToggleDir}
                filterQuery={filterQuery}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

function CodeViewer({
  path,
  autoRefresh,
  jumpToLineRequest,
  externalRefreshKey,
  saveRequestToken,
  onSaveSuccess,
  onCursorChange,
}: {
  path: string | null;
  autoRefresh: boolean;
  jumpToLineRequest?: number | null;
  externalRefreshKey?: number;
  saveRequestToken?: number;
  onSaveSuccess?: () => void;
  onCursorChange?: (position: { line: number; column: number } | null) => void;
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
  const [activeLine, setActiveLine] = useState(1);
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
    height: 1,
    scrollHeight: 1,
  });
  const [findReplaceValue, setFindReplaceValue] = useState("");
  const editorRef = useRef<HTMLTextAreaElement | null>(null);
  const highlightScrollRef = useRef<HTMLDivElement | null>(null);
  const gutterRef = useRef<HTMLDivElement | null>(null);
  const findInputRef = useRef<HTMLInputElement | null>(null);
  const replaceInputRef = useRef<HTMLInputElement | null>(null);
  const appliedJumpRequestRef = useRef<string>("");
  const hasUnsavedChangesRef = useRef(false);

  const hasUnsavedChanges = editContent !== (content || "");

  useEffect(() => {
    hasUnsavedChangesRef.current = hasUnsavedChanges;
  }, [hasUnsavedChanges]);

  const fetchContent = useCallback(async (options?: { resetEditor?: boolean }) => {
    if (!path) return;

    setIsLoading(true);
    setError(null);
    try {
      const res = await apiFetch(`/api/ide/read?path=${encodeURIComponent(path)}`);
      const data: ReadResult = await res.json();
      if (data.success) {
        const nextContent = data.content || "";
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
      setError(String(e));
    }
    setIsLoading(false);
  }, [path]);

  const fetchDiagnostics = useCallback(async () => {
    if (!path) return;

    try {
      const res = await apiFetch(`/api/lsp/diagnostics/file?path=${encodeURIComponent(path)}`);
      const data = await res.json();
      if (data.success && data.diagnostics) {
        setDiagnostics(data.diagnostics);
      }
    } catch {}
  }, [path]);

  useEffect(() => {
    setDiagnostics([]);
    setShowFindBar(false);
    setFindQuery("");
    setFindReplaceValue("");
    setShowFindReplace(false);
    setFindMatches([]);
    setActiveFindMatchIndex(0);
    setActiveLine(1);
    setCursorLine(1);
    setCursorColumn(1);
    setScrollMetrics({ top: 0, height: 1, scrollHeight: 1 });
    onCursorChange?.(path ? { line: 1, column: 1 } : null);
    appliedJumpRequestRef.current = "";
    void fetchContent({ resetEditor: true });
  }, [fetchContent, onCursorChange, path]);

  useEffect(() => {
    if (content !== null && path) {
      fetchDiagnostics();
    }
  }, [content, path, fetchDiagnostics]);

  useEffect(() => {
    if (!autoRefresh || !path) return;

    const interval = setInterval(() => {
      if (!hasUnsavedChangesRef.current) {
        void fetchContent();
      }
      void fetchDiagnostics();
    }, 3000);
    return () => clearInterval(interval);
  }, [autoRefresh, path, fetchContent, fetchDiagnostics]);

  useEffect(() => {
    if (!path) return;
    if (!externalRefreshKey || externalRefreshKey <= 0) return;
    if (hasUnsavedChangesRef.current) return;
    void fetchContent();
    void fetchDiagnostics();
  }, [externalRefreshKey, fetchContent, fetchDiagnostics, path]);

  const updateScrollMetrics = useCallback((textarea: HTMLTextAreaElement | null) => {
    if (!textarea) return;
    setScrollMetrics({
      top: textarea.scrollTop,
      height: textarea.clientHeight || 1,
      scrollHeight: textarea.scrollHeight || 1,
    });
  }, []);

  const syncEditorScroll = useCallback((textarea: HTMLTextAreaElement | null) => {
    if (!textarea) return;
    if (highlightScrollRef.current) {
      highlightScrollRef.current.scrollTop = textarea.scrollTop;
      highlightScrollRef.current.scrollLeft = textarea.scrollLeft;
    }
    if (gutterRef.current) {
      gutterRef.current.scrollTop = textarea.scrollTop;
    }
    updateScrollMetrics(textarea);
  }, [updateScrollMetrics]);

  const updateCursorFromSelection = useCallback((textarea: HTMLTextAreaElement | null) => {
    if (!textarea) return;
    const value = textarea.value;
    const selectionStart = textarea.selectionStart ?? 0;
    const before = value.slice(0, selectionStart);
    const line = before.split("\n").length;
    const lastBreak = before.lastIndexOf("\n");
    const column = selectionStart - lastBreak;
    setCursorLine(line);
    setCursorColumn(column);
    setActiveLine(line);
    onCursorChange?.({ line, column });
  }, [onCursorChange]);

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
      const normalizedIndex = ((index % findMatches.length) + findMatches.length) % findMatches.length;
      const match = findMatches[normalizedIndex];
      if (!match) return;

      textarea.focus();
      textarea.setSelectionRange(match.start, match.end);
      const lineHeight = Number.parseFloat(window.getComputedStyle(textarea).lineHeight || "20") || 20;
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
    if (!textarea || !current || textarea.selectionStart !== current.start || textarea.selectionEnd !== current.end) {
      selectFindMatch(activeFindMatchIndex);
      return;
    }
    selectFindMatch(activeFindMatchIndex + 1);
  }, [activeFindMatchIndex, findMatches, selectFindMatch]);

  const handleFindPrevious = useCallback(() => {
    if (findMatches.length === 0) return;
    const textarea = editorRef.current;
    const current = findMatches[activeFindMatchIndex];
    if (!textarea || !current || textarea.selectionStart !== current.start || textarea.selectionEnd !== current.end) {
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

  const jumpToLine = useCallback(
    (requestedLine: number) => {
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
      const computedLineHeight = Number.parseFloat(window.getComputedStyle(textarea).lineHeight || "20");
      const lineHeight = Number.isFinite(computedLineHeight) ? computedLineHeight : 20;
      textarea.scrollTop = Math.max((line - 2) * lineHeight, 0);
      syncEditorScroll(textarea);
      updateCursorFromSelection(textarea);
    },
    [editContent, syncEditorScroll, updateCursorFromSelection]
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
        }, 500);
      } else {
        setSaveError(data.error || "Failed to save");
      }
    } catch (e) {
      setSaveError(String(e));
    }
    setIsSaving(false);
  }, [path, editContent, onSaveSuccess, fetchDiagnostics]);

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
  }, [focusReplaceInput, handleSave, isBinary, isSaving, path, promptJumpToLine, showFindBar, toggleFindBar]);

  const handleEditorKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
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
      e.preventDefault();
      const target = e.currentTarget;
      const start = target.selectionStart;
      const end = target.selectionEnd;
      const nextContent = `${editContent.slice(0, start)}  ${editContent.slice(end)}`;
      setEditContent(nextContent);
      requestAnimationFrame(() => {
        target.selectionStart = start + 2;
        target.selectionEnd = start + 2;
        updateCursorFromSelection(target);
      });
    }
  };

  useEffect(() => {
    if (!path || isBinary || !editorRef.current) return;
    window.requestAnimationFrame(() => {
      syncEditorScroll(editorRef.current);
      updateCursorFromSelection(editorRef.current);
    });
  }, [path, isBinary, editContent, syncEditorScroll, updateCursorFromSelection]);

  const sourceText = editContent;
  const sourceLines = sourceText.split("\n");
  const minimapRows = useMemo(() => {
    const maxRows = 1200;
    const step = Math.max(1, Math.ceil(sourceLines.length / maxRows));
    const rows: Array<{ sourceLine: number; length: number }> = [];
    for (let i = 0; i < sourceLines.length; i += step) {
      let longest = 0;
      const end = Math.min(i + step, sourceLines.length);
      for (let j = i; j < end; j += 1) {
        longest = Math.max(longest, sourceLines[j]?.trim().length || 0);
      }
      rows.push({ sourceLine: i + 1, length: longest });
    }
    return { rows, step };
  }, [sourceLines]);
  const activeMinimapRow = Math.floor(Math.max(activeLine - 1, 0) / Math.max(minimapRows.step, 1));

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

  const lineDiagnostics = new Map<number, Diagnostic[]>();
  diagnostics.forEach((d) => {
    const existing = lineDiagnostics.get(d.line) || [];
    existing.push(d);
    lineDiagnostics.set(d.line, existing);
  });

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {saveError && (
        <div className="px-4 py-2 bg-red-500/10 border-b border-red-500/30 text-red-400 text-sm">
          {saveError}
        </div>
      )}

      {!isBinary && showFindBar && (
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

      {!isBinary && showFindBar && showFindReplace && (
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
        ) : (
          <>
            <div
              ref={gutterRef}
              className="w-16 shrink-0 overflow-hidden border-r border-white/10 bg-black/30 py-4 px-2 text-right select-none"
            >
              {sourceLines.map((_, i) => {
                const lineNum = i;
                const lineDiags = lineDiagnostics.get(lineNum) || [];
                const hasError = lineDiags.some((d) => d.severity === "error");
                const hasWarning = lineDiags.some((d) => d.severity === "warning");
                return (
                  <button
                    key={i}
                    type="button"
                    onClick={() => jumpToLine(i + 1)}
                    className={cn(
                      "h-[20px] w-full inline-flex items-center justify-end px-1 font-mono text-[13px] leading-[20px] transition-colors",
                      activeLine === i + 1 && "bg-indigo-500/20 text-indigo-200",
                      hasError && "text-red-400",
                      hasWarning && !hasError && "text-yellow-400",
                      !hasError && !hasWarning && activeLine !== i + 1 && "text-gray-600 hover:text-gray-400"
                    )}
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
            <div className="flex-1 min-w-0 flex">
              <div className="relative flex-1 min-w-0">
                <div
                  ref={highlightScrollRef}
                  className="absolute inset-0 overflow-auto pointer-events-none"
                >
                  <Highlight theme={themes.nightOwl} code={sourceText} language={language}>
                    {({ className, style, tokens, getLineProps, getTokenProps }) => (
                      <pre
                        className={cn(className, "p-4 font-mono text-[13px] min-w-full leading-[20px]")}
                        style={{
                          ...style,
                          background: "transparent",
                          lineHeight: "20px",
                          fontSize: "13px",
                          fontFamily: "var(--font-mono), ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
                        }}
                      >
                        {tokens.map((line, i) => {
                          const lineNum = i;
                          const lineDiags = lineDiagnostics.get(lineNum) || [];
                          const hasError = lineDiags.some((d) => d.severity === "error");
                          const hasWarning = lineDiags.some((d) => d.severity === "warning");
                          const lineProps = getLineProps({ line });
                          return (
                          <div
                            key={i}
                            data-line-number={i + 1}
                            {...lineProps}
                            style={{ ...(lineProps.style || {}), height: "20px", lineHeight: "20px" }}
                            className={cn(
                              lineProps.className,
                              "h-[20px]",
                                hasError && "bg-red-500/10",
                                hasWarning && !hasError && "bg-yellow-500/10",
                                activeLine === i + 1 && "bg-indigo-500/20"
                              )}
                            >
                              {line.length > 0 ? (
                                line.map((token, key) => (
                                  <span key={key} {...getTokenProps({ token })} />
                                ))
                              ) : (
                                <span>&nbsp;</span>
                              )}
                            </div>
                          );
                        })}
                      </pre>
                    )}
                  </Highlight>
                </div>

                <textarea
                  ref={editorRef}
                  value={editContent}
                  onChange={(e) => setEditContent(e.target.value)}
                  onKeyDown={handleEditorKeyDown}
                  onClick={(e) => updateCursorFromSelection(e.currentTarget)}
                  onKeyUp={(e) => updateCursorFromSelection(e.currentTarget)}
                  onSelect={(e) => updateCursorFromSelection(e.currentTarget)}
                  onScroll={(e) => syncEditorScroll(e.currentTarget)}
                  className="absolute inset-0 p-4 font-mono text-[13px] leading-[20px] bg-transparent text-transparent caret-indigo-200 resize-none !outline-none focus:!outline-none selection:bg-indigo-500/30"
                  spellCheck={false}
                  wrap="off"
                  style={{ tabSize: 2 }}
                />
              </div>

              <div className="w-24 shrink-0 border-l border-white/10 bg-[#080810] hidden xl:flex flex-col">
                <div
                  className="relative flex-1 overflow-hidden cursor-pointer"
                  onMouseDown={(event) => {
                    const textarea = editorRef.current;
                    if (!textarea) return;
                    const rect = event.currentTarget.getBoundingClientRect();
                    const ratio = Math.max(0, Math.min(1, (event.clientY - rect.top) / Math.max(rect.height, 1)));
                    const target = ratio * textarea.scrollHeight - textarea.clientHeight / 2;
                    const maxScroll = Math.max(textarea.scrollHeight - textarea.clientHeight, 0);
                    textarea.scrollTop = Math.max(0, Math.min(target, maxScroll));
                    syncEditorScroll(textarea);
                    textarea.focus();
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
                          className={cn("h-[2px] rounded-sm", isActive ? "bg-indigo-300/70" : "bg-white/20")}
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
                        (scrollMetrics.top / Math.max(scrollMetrics.scrollHeight - scrollMetrics.height, 1)) *
                          (100 - Math.max((scrollMetrics.height / Math.max(scrollMetrics.scrollHeight, 1)) * 100, 6)),
                        100
                      )}%`,
                    }}
                  />
                </div>
              </div>
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
    </div>
  );
}

function CreateDialog({
  isOpen,
  type,
  parentPath,
  onClose,
  onSuccess,
}: {
  isOpen: boolean;
  type: "file" | "directory";
  parentPath: string;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [name, setName] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleCreate = async () => {
    if (!name.trim()) return;

    setIsCreating(true);
    setError(null);
    try {
      const res = await apiFetch("/api/ide/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ parentPath, name: name.trim(), type }),
      });
      const data = await res.json();
      if (data.success) {
        setName("");
        onSuccess();
        onClose();
      } else {
        setError(data.error || "Failed to create");
      }
    } catch (e) {
      setError(String(e));
    }
    setIsCreating(false);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="glass-card rounded-xl p-6 w-96">
        <h3 className="text-lg font-semibold text-white mb-4">
          New {type === "file" ? "File" : "Folder"}
        </h3>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={type === "file" ? "filename.ts" : "folder-name"}
          className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-white text-sm mb-4 !outline-none focus:border-indigo-500/50"
          autoFocus
          onKeyDown={(e) => e.key === "Enter" && handleCreate()}
        />
        {error && <p className="text-red-400 text-sm mb-4">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={handleCreate} disabled={isCreating || !name.trim()}>
            {isCreating ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Check className="w-4 h-4" />
            )}
            <span className="ml-1">Create</span>
          </Button>
        </div>
      </div>
    </div>
  );
}

function getActiveLanguageFromExtension(extension?: string | null): string | null {
  if (!extension) return null;
  const ext = extension.toLowerCase();
  const languageByExtension: Record<string, string> = {
    ".ts": "typescript",
    ".tsx": "typescript",
    ".js": "javascript",
    ".jsx": "javascript",
    ".go": "go",
    ".rs": "rust",
    ".py": "python",
    ".java": "java",
    ".c": "c",
    ".cpp": "cpp",
    ".h": "c",
    ".hpp": "cpp",
  };
  return languageByExtension[ext] || null;
}

function LSPStatus({
  compact = false,
  activeExtension,
}: {
  compact?: boolean;
  activeExtension?: string | null;
}) {
  const [languages, setLanguages] = useState<LSPLanguage[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const fetchStatus = async () => {
      try {
        const res = await apiFetch("/api/lsp/languages");
        const data = await res.json();
        setLanguages(data.languages || []);
      } catch {
        // Ignore errors
      }
      setIsLoading(false);
    };
    fetchStatus();
  }, []);

  if (isLoading) return null;

  const available = languages.filter((l) => l.available);
  const activeLanguage = getActiveLanguageFromExtension(activeExtension);
  const active = activeLanguage
    ? available.find((lang) => lang.name.toLowerCase() === activeLanguage)
    : null;
  const label = active ? active.name : "none";
  const labelClass = active ? "text-emerald-400" : "text-gray-600";

  return (
    <div className={cn(compact ? "flex items-center gap-2 text-xs text-gray-500" : "px-3 py-2 border-t border-white/10 bg-white/5")}>
      <div className="flex items-center gap-2 text-xs text-gray-500">
        <Zap className="w-3 h-3" />
        <span>LSP:</span>
        <span className={labelClass}>{label}</span>
      </div>
    </div>
  );
}

function GitStatus({ path, compact = false }: { path: string; compact?: boolean }) {
  const [branch, setBranch] = useState<string | null>(null);
  const [modified, setModified] = useState(0);
  const [untracked, setUntracked] = useState(0);

  useEffect(() => {
    const fetchGit = async () => {
      try {
        const res = await apiFetch(`/api/git/status?path=${encodeURIComponent(path)}`);
        const data = await res.json();
        if (data.isRepo) {
          setBranch(data.branch || "HEAD");
          setModified(data.modified?.length || 0);
          setUntracked(data.untracked?.length || 0);
        } else {
          setBranch(null);
        }
      } catch {
        setBranch(null);
      }
    };
    fetchGit();
  }, [path]);

  if (!branch) return null;

  return (
    <div className={cn(compact ? "flex items-center gap-2 text-xs text-gray-500" : "px-3 py-2 border-t border-white/10 bg-white/5")}>
      <div className="flex items-center gap-2 text-xs text-gray-500">
        <GitBranch className="w-3 h-3" />
        <span className="text-indigo-400 font-medium">{branch}</span>
        {modified > 0 && <span className="text-yellow-400">~{modified}</span>}
        {untracked > 0 && <span className="text-gray-400">+{untracked}</span>}
      </div>
    </div>
  );
}

export function IDE() {
  const location = useLocation();
  const [currentPath, setCurrentPath] = useState<string>("~");
  const [selectedFile, setSelectedFile] = useState<FileEntry | null>(null);
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set());
  const [treeFilter, setTreeFilter] = useState("");
  const [rootInfo, setRootInfo] = useState<BrowseResult | null>(null);
  const [createType, setCreateType] = useState<"file" | "directory" | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [saveRequestToken, setSaveRequestToken] = useState(0);
  const [requestedJumpLine, setRequestedJumpLine] = useState<number | null>(null);
  const [cursorPosition, setCursorPosition] = useState<{ line: number; column: number } | null>(null);
  const [sidebarWidth, setSidebarWidth] = useState<number>(() => readPersistedSidebarWidth());
  const [sidebarMode, setSidebarMode] = useState<"explorer" | "search">("explorer");
  const [openMenu, setOpenMenu] = useState<"file" | null>(null);
  const [globalSearchQuery, setGlobalSearchQuery] = useState("");
  const [globalSearchReplace, setGlobalSearchReplace] = useState("");
  const [globalSearchCaseSensitive, setGlobalSearchCaseSensitive] = useState(false);
  const [globalSearchWholeWord, setGlobalSearchWholeWord] = useState(false);
  const [globalSearchResults, setGlobalSearchResults] = useState<IdeSearchResult | null>(null);
  const [globalReplacePreview, setGlobalReplacePreview] = useState<IdeReplacePreviewResult | null>(null);
  const [globalSearchLoading, setGlobalSearchLoading] = useState(false);
  const [globalSearchError, setGlobalSearchError] = useState<string | null>(null);
  const [globalReplaceLoading, setGlobalReplaceLoading] = useState(false);
  const [globalPreviewLoading, setGlobalPreviewLoading] = useState(false);
  const [showQuickOpen, setShowQuickOpen] = useState(false);
  const [quickOpenQuery, setQuickOpenQuery] = useState("");
  const [quickOpenResults, setQuickOpenResults] = useState<Array<{ path: string; relativePath: string }>>([]);
  const [quickOpenLoading, setQuickOpenLoading] = useState(false);
  const [quickOpenError, setQuickOpenError] = useState<string | null>(null);
  const [quickOpenSelectedIndex, setQuickOpenSelectedIndex] = useState(0);
  const workspacePaneRef = useRef<HTMLDivElement | null>(null);
  const sidebarResizeCleanupRef = useRef<(() => void) | null>(null);
  const globalSearchInputRef = useRef<HTMLInputElement | null>(null);
  const treeFilterInputRef = useRef<HTMLInputElement | null>(null);
  const quickOpenInputRef = useRef<HTMLInputElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const fetchRoot = async () => {
      const res = await apiFetch(`/api/ide/browse?path=${encodeURIComponent(currentPath)}`);
      const data: BrowseResult = await res.json();
      if (data.success) {
        setRootInfo(data);
      }
    };
    fetchRoot();
  }, [currentPath, refreshKey]);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const rawPath = params.get("path");
    if (!rawPath) return;
    const targetPath = rawPath.trim();
    if (!targetPath) return;

    const lineRaw = params.get("line");
    const parsedLine = lineRaw ? Number.parseInt(lineRaw, 10) : Number.NaN;
    const targetLine = Number.isFinite(parsedLine) && parsedLine > 0 ? parsedLine : null;
    setRequestedJumpLine(targetLine);

    const separatorIndex = Math.max(targetPath.lastIndexOf("/"), targetPath.lastIndexOf("\\"));
    const fileName = separatorIndex >= 0 ? targetPath.slice(separatorIndex + 1) : targetPath;
    const directoryPath = separatorIndex >= 0 ? targetPath.slice(0, separatorIndex) : "";
    const extensionMatch = fileName.match(/(\.[^.\\/]+)$/);
    const extension = extensionMatch?.[1];

    setSelectedFile({
      name: fileName,
      path: targetPath,
      type: "file",
      extension,
    });
    setTreeFilter("");

    if (directoryPath) {
      setCurrentPath((previous) => (previous === directoryPath ? previous : directoryPath));
      setExpandedDirs((previous) => {
        const next = new Set(previous);
        next.add(directoryPath);
        return next;
      });
    }
  }, [location.search]);

  const handleToggleDir = (path: string) => {
    setExpandedDirs((prev) => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  };

  const handleSelectFile = (entry: FileEntry) => {
    if (entry.type === "file") {
      setRequestedJumpLine(null);
      setSelectedFile(entry);
    }
  };

  const handleGoHome = () => {
    setCurrentPath("~");
    setSelectedFile(null);
    setRequestedJumpLine(null);
    setExpandedDirs(new Set());
  };

  const handleGoUp = () => {
    if (rootInfo?.parent) {
      setCurrentPath(rootInfo.parent);
      setSelectedFile(null);
      setRequestedJumpLine(null);
      setExpandedDirs(new Set());
    }
  };

  const handleRefresh = () => {
    setRefreshKey((k) => k + 1);
  };

  const handleExpandTopLevel = () => {
    if (!rootInfo) return;
    setExpandedDirs((prev) => {
      const next = new Set(prev);
      for (const entry of rootInfo.entries) {
        if (entry.type === "directory") next.add(entry.path);
      }
      return next;
    });
  };

  const handleCollapseAll = () => {
    setExpandedDirs(new Set());
  };

  const workspaceSearchPath = rootInfo?.path || currentPath;
  const parseQuickOpenQuery = useCallback((value: string): { query: string; line: number | null } => {
    const trimmed = value.trim();
    const lineMatch = trimmed.match(/^(.*?):(\d+)$/);
    if (!lineMatch) {
      return { query: trimmed, line: null };
    }
    const query = (lineMatch[1] || "").trim();
    const parsedLine = Number.parseInt(lineMatch[2] || "", 10);
    const line = Number.isFinite(parsedLine) && parsedLine > 0 ? parsedLine : null;
    return { query, line };
  }, []);

  const openFileAtPath = useCallback((filePath: string, line?: number | null) => {
    const separatorIndex = Math.max(filePath.lastIndexOf("/"), filePath.lastIndexOf("\\"));
    const fileName = separatorIndex >= 0 ? filePath.slice(separatorIndex + 1) : filePath;
    const directoryPath = separatorIndex >= 0 ? filePath.slice(0, separatorIndex) : "";
    const extensionMatch = fileName.match(/(\.[^.\\/]+)$/);
    const extension = extensionMatch?.[1];
    const resolvedLine =
      typeof line === "number" && Number.isFinite(line) && line > 0 ? Math.floor(line) : null;

    setRequestedJumpLine(resolvedLine);
    setSelectedFile({
      name: fileName,
      path: filePath,
      type: "file",
      extension,
    });

    if (directoryPath) {
      setCurrentPath((previous) => (previous === directoryPath ? previous : directoryPath));
      setExpandedDirs((previous) => {
        const next = new Set(previous);
        next.add(directoryPath);
        return next;
      });
    }
  }, []);

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

  const openGlobalSearchMatch = useCallback((filePath: string, line: number) => {
    openFileAtPath(filePath, line);
  }, [openFileAtPath]);

  const runQuickOpenSearch = useCallback(
    async (queryValue: string) => {
      const { query } = parseQuickOpenQuery(queryValue);
      setQuickOpenLoading(true);
      setQuickOpenError(null);
      try {
        const params = new URLSearchParams({
          path: workspaceSearchPath,
          query,
          limit: "250",
        });
        const response = await apiFetch(`/api/ide/files?${params.toString()}`);
        const data: IdeListFilesResult = await response.json();
        if (data.success) {
          setQuickOpenResults(data.files || []);
          setQuickOpenSelectedIndex((previous) => {
            if (!data.files || data.files.length === 0) return 0;
            return Math.min(previous, data.files.length - 1);
          });
        } else {
          setQuickOpenResults([]);
          setQuickOpenError(data.error || "Quick open failed");
        }
      } catch (error) {
        setQuickOpenResults([]);
        setQuickOpenError(String(error));
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
    setQuickOpenSelectedIndex(0);
    window.requestAnimationFrame(() => {
      quickOpenInputRef.current?.focus();
      quickOpenInputRef.current?.select();
    });
  }, []);

  const closeQuickOpenPalette = useCallback(() => {
    setShowQuickOpen(false);
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
    [closeQuickOpenPalette, openFileAtPath, parseQuickOpenQuery, quickOpenQuery, quickOpenResults, quickOpenSelectedIndex]
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
      if ((event.metaKey || event.ctrlKey) && event.shiftKey && event.key.toLowerCase() === "f") {
        event.preventDefault();
        openGlobalSearchPanel();
        return;
      }

      if ((event.metaKey || event.ctrlKey) && event.shiftKey && event.key.toLowerCase() === "e") {
        event.preventDefault();
        setSidebarMode("explorer");
        return;
      }

      if ((event.metaKey || event.ctrlKey) && !event.shiftKey && event.key.toLowerCase() === "p") {
        event.preventDefault();
        openQuickOpenPalette();
        return;
      }

      if ((event.metaKey || event.ctrlKey) && !event.shiftKey && event.key.toLowerCase() === "n") {
        event.preventDefault();
        setCreateType("file");
        return;
      }

      if ((event.metaKey || event.ctrlKey) && event.shiftKey && event.key.toLowerCase() === "n") {
        event.preventDefault();
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

      if (event.key === "Escape" && sidebarMode === "search") {
        event.preventDefault();
        setSidebarMode("explorer");
      }
    };

    window.addEventListener("keydown", handleGlobalSearchShortcut);
    return () => window.removeEventListener("keydown", handleGlobalSearchShortcut);
  }, [
    closeQuickOpenPalette,
    openMenu,
    openGlobalSearchPanel,
    openQuickOpenPalette,
    sidebarMode,
    showQuickOpen,
  ]);

  const handleSidebarResizeStart = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
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
    },
    []
  );

  useEffect(() => {
    return () => {
      sidebarResizeCleanupRef.current?.();
    };
  }, []);

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

  return (
    <div className="h-screen flex flex-col bg-[#050508]">
      <div
        ref={menuRef}
        className="h-8 px-2 border-b border-white/10 bg-white/[0.02] flex items-center justify-between text-xs"
      >
        <div className="flex items-center gap-2 relative">
          <button
            type="button"
            onClick={() => setOpenMenu((previous) => (previous === "file" ? null : "file"))}
            className={cn(
              "px-2 py-1 rounded text-gray-300 hover:bg-white/5",
              openMenu === "file" && "bg-white/10"
            )}
          >
            File
          </button>
          {openMenu === "file" && (
            <div className="absolute top-full left-0 mt-1 w-72 rounded-md border border-white/10 bg-[#0a0a10] shadow-xl z-40 overflow-hidden">
              <button
                type="button"
                onClick={() => {
                  setSaveRequestToken((previous) => previous + 1);
                  setOpenMenu(null);
                }}
                className="w-full text-left px-3 py-2 text-gray-200 hover:bg-white/5 text-sm flex items-center justify-between"
              >
                <span>Save</span>
                <span className="text-xs text-gray-500">Ctrl/Cmd+S</span>
              </button>
              <div className="h-px bg-white/10" />
              <button
                type="button"
                onClick={() => {
                  setCreateType("file");
                  setOpenMenu(null);
                }}
                className="w-full text-left px-3 py-2 text-gray-200 hover:bg-white/5 text-sm flex items-center justify-between"
              >
                <span>New File</span>
                <span className="text-xs text-gray-500">Ctrl/Cmd+N</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setCreateType("directory");
                  setOpenMenu(null);
                }}
                className="w-full text-left px-3 py-2 text-gray-200 hover:bg-white/5 text-sm"
              >
                New Folder
              </button>
              <div className="h-px bg-white/10" />
              <button
                type="button"
                onClick={() => {
                  setSidebarMode("explorer");
                  setOpenMenu(null);
                }}
                className="w-full text-left px-3 py-2 text-gray-200 hover:bg-white/5 text-sm flex items-center justify-between"
              >
                <span>Show Explorer</span>
                <span className="text-xs text-gray-500">Ctrl/Cmd+Shift+E</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  openGlobalSearchPanel();
                  setOpenMenu(null);
                }}
                className="w-full text-left px-3 py-2 text-gray-200 hover:bg-white/5 text-sm flex items-center justify-between"
              >
                <span>Show Search</span>
                <span className="text-xs text-gray-500">Ctrl/Cmd+Shift+F</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  handleRefresh();
                  setOpenMenu(null);
                }}
                className="w-full text-left px-3 py-2 text-gray-200 hover:bg-white/5 text-sm"
              >
                Refresh Workspace
              </button>
              <div className="h-px bg-white/10" />
              <button
                type="button"
                onClick={() => {
                  openQuickOpenPalette();
                  setOpenMenu(null);
                }}
                className="w-full text-left px-3 py-2 text-gray-200 hover:bg-white/5 text-sm flex items-center justify-between"
              >
                <span>Quick Open</span>
                <span className="text-xs text-gray-500">Ctrl/Cmd+P</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  handleGoHome();
                  setOpenMenu(null);
                }}
                className="w-full text-left px-3 py-2 text-gray-200 hover:bg-white/5 text-sm"
              >
                Go Home
              </button>
            </div>
          )}
        </div>
        <div className="text-gray-500 truncate max-w-[60vw]" title={rootInfo?.path || currentPath}>
          {(rootInfo?.path || currentPath)
            .replace(/^\/Users\/[^/]+/, "~")
            .replace(/^C:\\Users\\[^\\]+/, "~")}
        </div>
      </div>

      <div className="flex-1 flex overflow-hidden" ref={workspacePaneRef}>
        <div
          className="border-r border-white/10 flex flex-col overflow-hidden bg-white/[0.01] relative"
          style={{ width: `${sidebarWidth}px` }}
        >
          <div className="px-3 py-2 border-b border-white/10 bg-white/5 text-xs uppercase tracking-wide text-gray-500">
            {sidebarMode === "search" ? "Search" : "Explorer"}
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
                    onClick={() => setCreateType("file")}
                    className="p-1"
                    title="New File"
                  >
                    <FilePlus className="w-4 h-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setCreateType("directory")}
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
                      value={treeFilter}
                      onChange={(event) => setTreeFilter(event.target.value)}
                      placeholder="Filter files"
                      className="w-full bg-transparent text-xs text-gray-200 placeholder-gray-600 !outline-none"
                    />
                    {treeFilter.trim() && (
                      <button
                        type="button"
                        onClick={() => setTreeFilter("")}
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

              <div className="flex-1 overflow-y-auto py-2" key={refreshKey}>
                <FileTree
                  path={rootInfo?.path || currentPath}
                  selectedPath={selectedFile?.path || null}
                  onSelectFile={handleSelectFile}
                  expandedDirs={expandedDirs}
                  onToggleDir={handleToggleDir}
                  filterQuery={treeFilter}
                />
              </div>
            </>
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
                    {globalSearchLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Search className="w-3.5 h-3.5" />}
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
                    ? `${globalSearchResults.totalMatches} matches in ${globalSearchResults.files.length} files`
                    : "No results"}
                </span>
                <div className="flex items-center gap-2">
                  {globalReplacePreview && (
                    <span className="text-indigo-300">
                      Preview: {globalReplacePreview.totalReplacements}
                    </span>
                  )}
                  {globalSearchResults?.truncated && (
                    <span className="text-amber-300">Truncated</span>
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
                      </span>
                      {globalReplacePreview.truncated && (
                        <span className="text-amber-300">Truncated</span>
                      )}
                    </div>
                    <div className="max-h-56 overflow-y-auto divide-y divide-indigo-500/10">
                      {globalReplacePreview.files.map((file) => (
                        <div key={`preview:${file.file}`} className="px-2 py-1.5">
                          <div className="text-[11px] text-indigo-100 truncate" title={file.file}>
                            {file.file} <span className="text-indigo-300">({file.replacements})</span>
                          </div>
                          <div className="mt-1 space-y-1">
                            {file.preview.map((line) => (
                              <div key={`${file.file}:${line.line}:${line.before}`} className="text-[11px] font-mono">
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
                    <div key={file.file} className="rounded border border-white/10 bg-white/[0.02] overflow-hidden">
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
                            <div className="text-[12px] text-gray-300 font-mono truncate">{match.text}</div>
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
            className="absolute top-0 right-0 h-full w-1.5 cursor-col-resize bg-transparent hover:bg-indigo-500/40 transition-colors"
          />
        </div>

        <div className="flex-1 flex flex-col overflow-hidden bg-[#0d0d12]">
          <CodeViewer
            path={selectedFile?.path || null}
            autoRefresh={true}
            jumpToLineRequest={requestedJumpLine}
            externalRefreshKey={refreshKey}
            saveRequestToken={saveRequestToken}
            onSaveSuccess={handleRefresh}
            onCursorChange={setCursorPosition}
          />
        </div>
      </div>

      {showQuickOpen && (
        <div className="absolute inset-0 z-50 bg-black/40 flex items-start justify-center pt-16">
          <div className="w-[680px] max-w-[92vw] rounded-xl border border-white/15 bg-[#0b0b12] shadow-2xl overflow-hidden">
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

      <div className="h-8 border-t border-white/10 bg-black/30 px-3 flex items-center justify-between text-xs">
        <div className="flex items-center gap-3">
          <span className="text-gray-600">Ready</span>
          <GitStatus path={rootInfo?.path || currentPath} compact />
        </div>
        <div className="flex items-center gap-3">
          <span className="text-gray-500 tabular-nums">
            {selectedFile ? `Ln ${cursorPosition?.line || 1}, Col ${cursorPosition?.column || 1}` : "Ln -, Col -"}
          </span>
          <span className="text-gray-600">
            {sidebarMode === "search" ? "Global Search" : "Editor"}
          </span>
          <LSPStatus compact activeExtension={selectedFile?.extension || null} />
        </div>
      </div>

      <CreateDialog
        isOpen={createType !== null}
        type={createType || "file"}
        parentPath={rootInfo?.path || currentPath}
        onClose={() => setCreateType(null)}
        onSuccess={handleRefresh}
      />
    </div>
  );
}

export default IDE;
