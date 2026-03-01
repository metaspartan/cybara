import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useLocation } from "react-router-dom";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
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
  MessageSquare,
  ExternalLink,
  Copy,
  RotateCcw,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { apiFetch } from "@/lib/auth";
import { chatApi, agentsApi } from "@/lib/api";

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

interface IdeBlameLine {
  line: number;
  commit: string;
  shortCommit: string;
  author: string;
  authorDate?: string;
  summary?: string;
  commitDescription?: string;
  commitUrl?: string;
  isUncommitted: boolean;
}

interface IdeBlameResult {
  success: boolean;
  path: string;
  isRepo: boolean;
  truncated: boolean;
  lines: IdeBlameLine[];
  error?: string;
}

interface IdeTab {
  path: string;
  name: string;
  extension?: string;
  previewMode?: boolean;
}

interface IdeChatMessage {
  role: "user" | "assistant";
  content: string;
  timestamp: string;
}

interface IdeChatAgentOption {
  id: string;
  name: string;
  status?: string;
}

interface TreeContextMenuState {
  x: number;
  y: number;
  entry: FileEntry;
}

const IDE_SIDEBAR_WIDTH_STORAGE_KEY = "cybara.ide.sidebar.width";
const IDE_SIDEBAR_DEFAULT_WIDTH = 280;
const IDE_SIDEBAR_MIN_WIDTH = 220;
const IDE_SIDEBAR_MAX_WIDTH = 520;
const IDE_CHAT_WIDTH_STORAGE_KEY = "cybara.ide.chat.width";
const IDE_CHAT_OPEN_STORAGE_KEY = "cybara.ide.chat.open";
const IDE_CHAT_DEFAULT_WIDTH = 420;
const IDE_CHAT_MIN_WIDTH = 320;
const IDE_CHAT_MAX_WIDTH = 720;

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

function clampChatWidth(width: number): number {
  if (!Number.isFinite(width)) return IDE_CHAT_DEFAULT_WIDTH;
  return Math.min(IDE_CHAT_MAX_WIDTH, Math.max(IDE_CHAT_MIN_WIDTH, Math.round(width)));
}

function readPersistedChatWidth(): number {
  if (typeof window === "undefined") return IDE_CHAT_DEFAULT_WIDTH;
  const raw = window.localStorage.getItem(IDE_CHAT_WIDTH_STORAGE_KEY);
  if (!raw) return IDE_CHAT_DEFAULT_WIDTH;
  const parsed = Number.parseInt(raw, 10);
  return clampChatWidth(parsed);
}

function persistChatWidth(width: number): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(IDE_CHAT_WIDTH_STORAGE_KEY, String(clampChatWidth(width)));
}

function readPersistedChatOpen(): boolean {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(IDE_CHAT_OPEN_STORAGE_KEY) === "1";
}

function persistChatOpen(isOpen: boolean): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(IDE_CHAT_OPEN_STORAGE_KEY, isOpen ? "1" : "0");
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

function fileEntryFromPath(filePath: string): FileEntry {
  const separatorIndex = Math.max(filePath.lastIndexOf("/"), filePath.lastIndexOf("\\"));
  const fileName = separatorIndex >= 0 ? filePath.slice(separatorIndex + 1) : filePath;
  const extensionMatch = fileName.match(/(\.[^.\\/]+)$/);
  return {
    name: fileName,
    path: filePath,
    type: "file",
    extension: extensionMatch?.[1],
  };
}

function isMarkdownExtension(extension?: string): boolean {
  const ext = (extension || "").toLowerCase();
  return ext === ".md" || ext === ".markdown";
}

const ideMarkdownComponents: Components = {
  h1: ({ children }) => <h1 className="mb-3 text-2xl font-semibold tracking-tight text-white">{children}</h1>,
  h2: ({ children }) => <h2 className="mb-2.5 mt-5 text-xl font-semibold tracking-tight text-white">{children}</h2>,
  h3: ({ children }) => <h3 className="mb-2 mt-4 text-lg font-semibold text-gray-100">{children}</h3>,
  p: ({ children }) => <p className="mb-3 leading-7 text-gray-200 last:mb-0">{children}</p>,
  ul: ({ children }) => <ul className="mb-3 list-disc pl-5 text-gray-200">{children}</ul>,
  ol: ({ children }) => <ol className="mb-3 list-decimal pl-5 text-gray-200">{children}</ol>,
  li: ({ children }) => <li className="mb-1">{children}</li>,
  blockquote: ({ children }) => (
    <blockquote className="my-4 border-l-2 border-indigo-400/50 pl-3 text-gray-300">{children}</blockquote>
  ),
  table: ({ children }) => (
    <div className="my-4 overflow-x-auto rounded-xl border border-white/10 bg-black/20">
      <table className="w-full border-collapse text-[12px]">{children}</table>
    </div>
  ),
  thead: ({ children }) => <thead className="bg-white/[0.04]">{children}</thead>,
  tr: ({ children }) => <tr className="border-b border-white/10 last:border-b-0">{children}</tr>,
  th: ({ children }) => <th className="px-3 py-2 text-left font-semibold text-gray-100">{children}</th>,
  td: ({ children }) => <td className="px-3 py-2 align-top text-gray-300">{children}</td>,
  code: ({ className, children }) => {
    const raw = String(children ?? "");
    const isInline = !className && !raw.includes("\n");
    if (isInline) {
      return <code className="rounded bg-white/10 px-1.5 py-0.5 font-mono text-[12px] text-indigo-100">{children}</code>;
    }
    return <code className="font-mono text-[12px] text-gray-100">{children}</code>;
  },
  pre: ({ children }) => (
    <pre className="my-4 overflow-x-auto rounded-xl border border-white/10 bg-black/45 p-3 text-[12px] leading-6 text-gray-100">
      {children}
    </pre>
  ),
  a: ({ href, children }) => (
    <a
      href={href}
      className="text-indigo-300 underline decoration-indigo-400/50 underline-offset-2 hover:text-indigo-200"
      target="_blank"
      rel="noopener noreferrer"
    >
      {children}
    </a>
  ),
};

function formatBlameStamp(value?: string): string {
  if (!value) return "";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "";
  return parsed.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

function formatBlameDateTime(value?: string): string {
  if (!value) return "";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "";
  return parsed.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function scoreQuickOpenResult(relativePath: string, query: string): number {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) return 0;
  const normalizedPath = relativePath.toLowerCase();
  const fileName = normalizedPath.split("/").pop() || normalizedPath;

  if (fileName === normalizedQuery) return 0;
  if (fileName.startsWith(normalizedQuery)) return 1;
  const fileNameIndex = fileName.indexOf(normalizedQuery);
  if (fileNameIndex >= 0) return 2 + fileNameIndex / 1000;
  if (normalizedPath.includes(`/${normalizedQuery}`)) return 3;
  const pathIndex = normalizedPath.indexOf(normalizedQuery);
  if (pathIndex >= 0) return 4 + pathIndex / 10000;
  return 10;
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
  onContextMenu,
  isSelected,
}: {
  entry: FileEntry;
  level?: number;
  isExpanded?: boolean;
  onToggle?: () => void;
  onSelect: (entry: FileEntry) => void;
  onContextMenu?: (entry: FileEntry, event: React.MouseEvent<HTMLDivElement>) => void;
  isSelected: boolean;
}) {
  const isDir = entry.type === "directory";
  const isModified = entry.gitModified || entry.gitStaged;
  const isIgnored = entry.gitIgnored;
  const isUntracked = entry.gitUntracked;

  return (
    <div
      className={cn(
        "flex items-center gap-2 px-2 py-1.5 cursor-pointer rounded-md transition-colors text-sm select-none",
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
      onMouseDown={(event) => {
        if (event.button === 2) {
          event.preventDefault();
        }
      }}
      onContextMenu={(event) => {
        if (!onContextMenu) return;
        event.preventDefault();
        onContextMenu(entry, event);
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
  onContextMenu,
  expandedDirs,
  onToggleDir,
  filterQuery,
}: {
  path: string;
  level?: number;
  selectedPath: string | null;
  onSelectFile: (entry: FileEntry) => void;
  onContextMenu?: (entry: FileEntry, event: React.MouseEvent<HTMLDivElement>) => void;
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
              onContextMenu={onContextMenu}
              isSelected={selectedPath === entry.path}
            />
            {isDir && isExpanded && (
              <FileTree
                path={entry.path}
                level={level + 1}
                selectedPath={selectedPath}
                onSelectFile={onSelectFile}
                onContextMenu={onContextMenu}
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
  previewMode = false,
  autoRefresh,
  jumpToLineRequest,
  externalRefreshKey,
  saveRequestToken,
  onSaveSuccess,
  onCursorChange,
  onOpenLocation,
}: {
  path: string | null;
  previewMode?: boolean;
  autoRefresh: boolean;
  jumpToLineRequest?: number | null;
  externalRefreshKey?: number;
  saveRequestToken?: number;
  onSaveSuccess?: () => void;
  onCursorChange?: (position: { line: number; column: number } | null) => void;
  onOpenLocation?: (filePath: string, line: number) => void;
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
  const [activeLine, setActiveLine] = useState(1);
  const [blamePopoverLine, setBlamePopoverLine] = useState<number | null>(null);
  const [copiedCommit, setCopiedCommit] = useState<string | null>(null);
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
  const editorRef = useRef<HTMLTextAreaElement | null>(null);
  const highlightScrollRef = useRef<HTMLDivElement | null>(null);
  const gutterRef = useRef<HTMLDivElement | null>(null);
  const findInputRef = useRef<HTMLInputElement | null>(null);
  const replaceInputRef = useRef<HTMLInputElement | null>(null);
  const appliedJumpRequestRef = useRef<string>("");
  const hasUnsavedChangesRef = useRef(false);
  const blameHideTimeoutRef = useRef<number | null>(null);

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

  const fetchBlame = useCallback(async () => {
    if (!path || isBinary) {
      setBlameLines(new Map());
      setBlameLoading(false);
      return;
    }

    const contentLineCount = Math.max(1, (content || "").split("\n").length);
    const maxBlameLines = Math.max(3000, Math.min(contentLineCount + 64, 50000));

    setBlameLoading(true);
    try {
      const res = await apiFetch(
        `/api/ide/blame?path=${encodeURIComponent(path)}&maxLines=${encodeURIComponent(String(maxBlameLines))}`
      );
      const data: IdeBlameResult = await res.json();
      if (data.success && data.isRepo && Array.isArray(data.lines)) {
        const nextMap = new Map<number, IdeBlameLine>();
        for (const line of data.lines) {
          nextMap.set(line.line, line);
        }
        setBlameLines(nextMap);
      } else {
        setBlameLines(new Map());
      }
    } catch {
      setBlameLines(new Map());
    } finally {
      setBlameLoading(false);
    }
  }, [content, isBinary, path]);

  useEffect(() => {
    setDiagnostics([]);
    setBlameLines(new Map());
    setBlameLoading(false);
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
    onCursorChange?.(path ? { line: 1, column: 1 } : null);
    appliedJumpRequestRef.current = "";
    void fetchContent({ resetEditor: true });
  }, [fetchContent, onCursorChange, path]);

  useEffect(() => {
    if (content !== null && path) {
      fetchDiagnostics();
      fetchBlame();
    }
  }, [content, path, fetchBlame, fetchDiagnostics]);

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
    return () => {
      if (blameHideTimeoutRef.current !== null) {
        window.clearTimeout(blameHideTimeoutRef.current);
        blameHideTimeoutRef.current = null;
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
  }, [externalRefreshKey, fetchBlame, fetchContent, fetchDiagnostics, path]);

  const updateScrollMetrics = useCallback((textarea: HTMLTextAreaElement | null) => {
    if (!textarea) return;
    setScrollMetrics({
      top: textarea.scrollTop,
      left: textarea.scrollLeft,
      height: textarea.clientHeight || 1,
      width: textarea.clientWidth || 1,
      scrollHeight: textarea.scrollHeight || 1,
      scrollWidth: textarea.scrollWidth || 1,
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
  }, [focusReplaceInput, handleSave, isBinary, isSaving, path, promptJumpToLine, showFindBar, toggleFindBar]);

  const handleEditorKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
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

  const resolveLspLocations = useCallback(async (
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
    const normalized = (
      data.location ? [data.location] : []
    ).concat(Array.isArray(data.locations) ? data.locations : []);
    return normalized
      .filter((location): location is { path: string; line: number; character: number } => !!location?.path)
      .map((location) => ({
        path: location.path,
        line: Number.isFinite(location.line) ? location.line : 0,
        character: Number.isFinite(location.character) ? location.character : 0,
      }));
  }, [editorContextMenu, path]);

  const openFirstLspLocation = useCallback(async (
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
      const primaryLocation = (primaryLocations[0] || fallbackLocations[0]) || null;
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
  }, [closeEditorContextMenu, editorContextMenu, onOpenLocation, path, resolveLspLocations]);

  const handleGoToDefinition = useCallback(async () => {
    await openFirstLspLocation("definition", "No definition found at the current cursor.");
  }, [openFirstLspLocation]);

  const handleGoToDeclaration = useCallback(async () => {
    await openFirstLspLocation("declaration", "No declaration found at the current cursor.");
  }, [openFirstLspLocation]);

  const handleGoToTypeDefinition = useCallback(async () => {
    await openFirstLspLocation("type-definition", "No type definition found at the current cursor.");
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
    setSaveError("Code actions are not available for this selection yet.");
    closeEditorContextMenu();
  }, [closeEditorContextMenu]);

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

  const handleCopySelection = useCallback(async (trim = false) => {
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
  }, [closeEditorContextMenu, editContent]);

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

  const showInlineBlame = blameLoading || blameLines.size > 0;
  const popoverBlameDetails = blamePopoverLine ? blameLines.get(blamePopoverLine) || null : null;
  const popoverBlameTimestamp = formatBlameDateTime(popoverBlameDetails?.authorDate);
  const isMarkdownPreview =
    !isBinary &&
    previewMode &&
    (extension.toLowerCase() === ".md" || extension.toLowerCase() === ".markdown");
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

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {saveError && (
        <div className="px-4 py-2 bg-red-500/10 border-b border-red-500/30 text-red-400 text-sm">
          {saveError}
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
              className="w-16 shrink-0 overflow-hidden border-r border-white/10 bg-black/30 py-4 px-2 text-right select-none font-mono text-[13px] leading-[20px]"
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
                      "h-[20px] w-full flex items-center justify-end px-1 m-0 py-0 border-0 rounded-none appearance-none bg-transparent leading-none transition-colors",
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
                  className="absolute inset-0 overflow-auto pointer-events-none z-20"
                >
                  <Highlight theme={themes.nightOwl} code={sourceText} language={language}>
                    {({ className, style, tokens, getLineProps, getTokenProps }) => (
                      <pre
                        className={cn(className, "m-0 p-4 font-mono text-[13px] min-w-full leading-[20px]")}
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
                          const isActiveLine = activeLine === i + 1;
                          const blameLine = blameLines.get(i + 1) || null;
                          const blameDate = formatBlameStamp(blameLine?.authorDate);
                          const blameSummary =
                            blameLine?.summary || (blameLine?.isUncommitted ? "Uncommitted" : "");
                          const blameText = blameLine
                            ? `${blameLine.author} · ${blameLine.shortCommit}${blameDate ? ` · ${blameDate}` : ""}${blameSummary ? ` · ${blameSummary}` : ""}`
                            : blameLoading
                              ? "Loading history..."
                              : "No history";
                          const shouldShowLineBlame = isActiveLine && showInlineBlame;
                          const lineProps = getLineProps({ line });
                          return (
                          <div
                            key={i}
                            data-line-number={i + 1}
                            {...lineProps}
                            style={{ ...(lineProps.style || {}), height: "20px", lineHeight: "20px" }}
                            className={cn(
                              lineProps.className,
                              "h-[20px] w-max min-w-full flex items-center",
                              hasError && "bg-red-500/10",
                              hasWarning && !hasError && "bg-yellow-500/10",
                              isActiveLine && "bg-indigo-500/20"
                              )}
                            >
                              <span className="flex-shrink-0">
                                {line.length > 0 ? (
                                  line.map((token, key) => (
                                    <span key={key} {...getTokenProps({ token })} />
                                  ))
                                ) : (
                                  <span>&nbsp;</span>
                                )}
                              </span>
                              {shouldShowLineBlame && (
                                <span className="relative ml-5 inline-flex max-w-[54vw] flex-shrink-0 items-center">
                                  <button
                                    type="button"
                                    onMouseEnter={() => showBlamePopover(i + 1)}
                                    onMouseLeave={scheduleHideBlamePopover}
                                    disabled={!blameLine}
                                    className={cn(
                                      "max-w-full truncate border-0 bg-transparent p-0 text-left font-mono text-[13px] leading-[20px]",
                                      blameLine ? "pointer-events-auto text-gray-500 hover:text-gray-300" : "text-gray-700 cursor-default"
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
                                        <span className="font-medium text-emerald-200">Line {blamePopoverLine}</span>
                                        <div className="flex items-center gap-1">
                                          {!popoverBlameDetails.isUncommitted && (
                                            <button
                                              type="button"
                                              onClick={() => void handleCopyCommit(popoverBlameDetails.commit)}
                                              className="p-1 rounded border border-white/15 text-gray-300 hover:text-white hover:bg-white/10"
                                              title={copiedCommit === popoverBlameDetails.commit ? "Copied" : "Copy commit hash"}
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
                                        {popoverBlameTimestamp ? ` · ${popoverBlameTimestamp}` : ""}
                                      </div>
                                      <div className="mt-1 text-[10px] text-gray-500 break-all">
                                        {popoverBlameDetails.isUncommitted
                                          ? "Uncommitted local changes"
                                          : `${popoverBlameDetails.shortCommit} · ${popoverBlameDetails.commit}`}
                                      </div>
                                      {(popoverBlameDetails.commitDescription || popoverBlameDetails.summary) && (
                                        <div className="mt-1 whitespace-pre-wrap text-[11px] text-gray-300 break-words">
                                          {popoverBlameDetails.commitDescription || popoverBlameDetails.summary}
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
                </div>

              <textarea
                ref={editorRef}
                value={editContent}
                  onChange={(e) => setEditContent(e.target.value)}
                  onKeyDown={handleEditorKeyDown}
                  onClick={(e) => updateCursorFromSelection(e.currentTarget)}
                  onKeyUp={(e) => updateCursorFromSelection(e.currentTarget)}
                  onSelect={(e) => updateCursorFromSelection(e.currentTarget)}
                  onContextMenu={handleEditorContextMenu}
                  onScroll={(e) => syncEditorScroll(e.currentTarget)}
                className="absolute inset-0 z-10 p-4 font-mono text-[13px] leading-[20px] bg-transparent text-transparent caret-indigo-200 resize-none !outline-none focus:!outline-none selection:bg-indigo-500/30"
                spellCheck={false}
                wrap="off"
                style={{
                  tabSize: 2,
                  lineHeight: "20px",
                  fontSize: "13px",
                  fontFamily: "var(--font-mono), ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
                  margin: 0,
                }}
              />
              {blameLoading && (
                <div className="absolute left-6 top-2 z-20 px-1 py-0.5 text-[12px] leading-[20px] text-gray-600">
                  <div className="flex items-center gap-1.5">
                    <Loader2 className="w-3 h-3 animate-spin" />
                    <span>Loading git history...</span>
                  </div>
                </div>
              )}
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
      {editorContextMenu && editorContextMenuPosition && (
        <div
          className="fixed z-[85] min-w-[260px] rounded-md border border-white/15 bg-[#0a0a10] p-1 shadow-2xl"
          style={{ left: `${editorContextMenuPosition.left}px`, top: `${editorContextMenuPosition.top}px` }}
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
    ".html": "html",
    ".htm": "html",
    ".css": "css",
    ".scss": "css",
    ".json": "json",
    ".jsonc": "json",
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

function IDEChatPanel({
  workspaceDir,
  contextPath,
  onClose,
}: {
  workspaceDir: string;
  contextPath: string | null;
  onClose: () => void;
}) {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<IdeChatMessage[]>([]);
  const [agents, setAgents] = useState<IdeChatAgentOption[]>([]);
  const [selectedAgentId, setSelectedAgentId] = useState<string>("");
  const [input, setInput] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [isReverting, setIsReverting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    list.scrollTop = list.scrollHeight;
  }, [messages, isSending]);

  useEffect(() => {
    let isCancelled = false;
    const loadAgents = async () => {
      try {
        const response = await agentsApi.list();
        if (!response.success || !response.data || isCancelled) return;
        const options = (response.data || [])
          .map((agent) => ({
            id: typeof agent.id === "string" ? agent.id : "",
            name: typeof agent.name === "string" ? agent.name : "Agent",
            status: typeof agent.status === "string" ? agent.status : undefined,
          }))
          .filter((agent) => agent.id);
        setAgents(options);
        if (!selectedAgentId && options.length === 1) {
          setSelectedAgentId(options[0]?.id || "");
        }
      } catch {
        // Keep chat usable with default agent fallback.
      }
    };
    void loadAgents();
    return () => {
      isCancelled = true;
    };
  }, [selectedAgentId]);

  const mapApiMessageToIde = useCallback((value: unknown): IdeChatMessage | null => {
    if (!value || typeof value !== "object") return null;
    const item = value as Record<string, unknown>;
    const role = item.role === "assistant" || item.role === "user" ? item.role : null;
    const content = typeof item.content === "string" ? item.content : "";
    const timestamp =
      typeof item.timestamp === "string" && item.timestamp
        ? item.timestamp
        : new Date().toISOString();
    if (!role || !content.trim()) return null;
    return { role, content, timestamp };
  }, []);

  const handleSend = useCallback(async () => {
    const trimmed = input.trim();
    if (!trimmed || isSending || isReverting) return;

    const userMessage: IdeChatMessage = {
      role: "user",
      content: trimmed,
      timestamp: new Date().toISOString(),
    };
    setMessages((previous) => [...previous, userMessage]);
    setInput("");
    setIsSending(true);
    setError(null);

    const contextualPrompt = contextPath
      ? `${trimmed}\n\nCurrent IDE file context: ${contextPath}`
      : trimmed;

    try {
      const response = await chatApi.send(
        contextualPrompt,
        selectedAgentId || undefined,
        sessionId || undefined,
        workspaceDir || null
      );
      if (!response.success || !response.data) {
        setError(response.error || "Failed to send message");
        return;
      }
      setSessionId(response.data.sessionId || sessionId);
      const assistantContent = response.data.message?.content || "(No assistant response)";
      const assistantMessage: IdeChatMessage = {
        role: "assistant",
        content: assistantContent,
        timestamp: new Date().toISOString(),
      };
      setMessages((previous) => [...previous, assistantMessage]);
    } catch (sendError) {
      setError(String(sendError));
    } finally {
      setIsSending(false);
    }
  }, [contextPath, input, isReverting, isSending, selectedAgentId, sessionId, workspaceDir]);

  const handleNewChat = useCallback(() => {
    setSessionId(null);
    setMessages([]);
    setError(null);
  }, []);

  const handleRevertToHere = useCallback(
    async (messageIndex: number) => {
      if (!sessionId || isSending || isReverting) return;
      const target = messages[messageIndex];
      if (!target || target.role !== "user") return;
      const confirmed = window.confirm(
        "Revert this IDE chat session to this message? Later messages will be removed."
      );
      if (!confirmed) return;
      setIsReverting(true);
      setError(null);
      try {
        const response = await chatApi.revertSession(sessionId, {
          messageIndex,
          messageRole: target.role,
          messageContent: target.content,
          messageTimestamp: target.timestamp,
        });
        if (!response.success || !response.data) {
          setError(response.error || "Failed to revert session");
          return;
        }
        const revertedMessages = Array.isArray(response.data.messagesList)
          ? response.data.messagesList
              .map((message) => mapApiMessageToIde(message))
              .filter((message): message is IdeChatMessage => !!message)
          : [];
        if (revertedMessages.length > 0) {
          setMessages(revertedMessages);
        } else {
          setMessages(messages.slice(0, messageIndex + 1));
        }
        setInput(target.content);
      } catch (revertError) {
        setError(String(revertError));
      } finally {
        setIsReverting(false);
      }
    },
    [isReverting, isSending, mapApiMessageToIde, messages, sessionId]
  );

  return (
    <div className="h-full flex flex-col bg-[#0a0a12]">
      <div className="h-9 px-3 border-b border-white/10 flex items-center justify-between">
        <div className="flex items-center gap-2 text-xs text-gray-400">
          <MessageSquare className="w-3.5 h-3.5 text-indigo-300" />
          <span>IDE Chat</span>
          {sessionId && <span className="text-[10px] text-gray-600">{sessionId.slice(0, 8)}</span>}
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            onClick={handleNewChat}
            className="h-7 px-2 text-[11px]"
            title="Start new IDE chat session"
          >
            New
          </Button>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded text-gray-500 hover:text-gray-300 hover:bg-white/5"
            title="Close IDE chat"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {contextPath && (
        <div className="px-3 py-2 border-b border-white/10 text-[11px] text-gray-500 truncate" title={contextPath}>
          Context: {contextPath}
        </div>
      )}

      <div ref={listRef} className="flex-1 overflow-y-auto px-3 py-2 space-y-2">
        {messages.length === 0 ? (
          <div className="text-xs text-gray-500">
            Ask about the current workspace or file. This panel shares session context while open.
          </div>
        ) : (
          messages.map((message, index) => (
            <div
              key={`${message.role}:${message.timestamp}:${index}`}
              className={cn(
                "rounded-md px-2.5 py-2 text-xs whitespace-pre-wrap break-words border",
                message.role === "user"
                  ? "border-indigo-500/30 bg-indigo-500/10 text-indigo-100"
                  : "border-white/10 bg-black/30 text-gray-200"
              )}
            >
              <div className="mb-1 flex items-center justify-between gap-2 text-[10px] text-gray-500">
                <span>{message.role === "user" ? "You" : "Assistant"}</span>
                <div className="flex items-center gap-2">
                  <span>{new Date(message.timestamp).toLocaleTimeString()}</span>
                  {message.role === "user" && sessionId && (
                    <button
                      type="button"
                      disabled={isReverting || isSending}
                      onClick={() => void handleRevertToHere(index)}
                      className="inline-flex items-center rounded border border-amber-500/30 bg-amber-500/10 p-1 text-amber-200 hover:bg-amber-500/20 disabled:opacity-50 disabled:cursor-not-allowed"
                      title="Revert this IDE chat session to this message"
                      aria-label="Revert to here"
                    >
                      <RotateCcw className="w-3 h-3" />
                    </button>
                  )}
                </div>
              </div>
              {message.content}
            </div>
          ))
        )}
        {isSending && (
          <div className="text-xs text-gray-500 flex items-center gap-2">
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
            Thinking...
          </div>
        )}
        {isReverting && (
          <div className="text-xs text-gray-500 flex items-center gap-2">
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
            Reverting session...
          </div>
        )}
      </div>

      {error && (
        <div className="px-3 py-2 border-t border-red-500/20 bg-red-500/10 text-[11px] text-red-300">
          {error}
        </div>
      )}

      <div className="p-3 border-t border-white/10 space-y-2">
        <textarea
          value={input}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              void handleSend();
            }
          }}
          placeholder="Message IDE chat (Shift+Enter for newline)"
          className="w-full min-h-[82px] max-h-56 px-2 py-1.5 rounded border border-white/10 bg-black/40 text-xs text-gray-200 !outline-none focus:border-indigo-500/40 resize-y"
        />
        <div className="flex items-center gap-2">
          <select
            value={selectedAgentId}
            onChange={(event) => setSelectedAgentId(event.target.value)}
            className="flex-1 min-w-0 px-2 py-1 rounded border border-white/10 bg-black/40 text-[11px] text-gray-200 !outline-none focus:border-indigo-500/40"
            title="Agent for IDE chat"
          >
            <option value="">Default Agent</option>
            {agents.map((agent) => (
              <option key={agent.id} value={agent.id}>
                {agent.name}
                {agent.status ? ` (${agent.status})` : ""}
              </option>
            ))}
          </select>
          <Button
            variant="ghost"
            size="sm"
            disabled={isSending || isReverting || !input.trim()}
            onClick={() => void handleSend()}
            className="h-7 px-2.5"
          >
            {isSending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <MessageSquare className="w-3.5 h-3.5" />}
            <span className="ml-1 text-xs">Send</span>
          </Button>
        </div>
      </div>
    </div>
  );
}

export function IDE() {
  const location = useLocation();
  const [currentPath, setCurrentPath] = useState<string>("~");
  const [selectedFile, setSelectedFile] = useState<FileEntry | null>(null);
  const [openTabs, setOpenTabs] = useState<IdeTab[]>([]);
  const [activeTabPath, setActiveTabPath] = useState<string | null>(null);
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set());
  const [treeFilter, setTreeFilter] = useState("");
  const [rootInfo, setRootInfo] = useState<BrowseResult | null>(null);
  const [createType, setCreateType] = useState<"file" | "directory" | null>(null);
  const [createParentPath, setCreateParentPath] = useState<string | null>(null);
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
  const [treeContextMenu, setTreeContextMenu] = useState<TreeContextMenuState | null>(null);
  const [isIdeChatOpen, setIsIdeChatOpen] = useState<boolean>(() => readPersistedChatOpen());
  const [chatPanelWidth, setChatPanelWidth] = useState<number>(() => readPersistedChatWidth());
  const workspacePaneRef = useRef<HTMLDivElement | null>(null);
  const sidebarResizeCleanupRef = useRef<(() => void) | null>(null);
  const chatResizeCleanupRef = useRef<(() => void) | null>(null);
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
    setTreeFilter("");

    if (directoryPath) {
      setCurrentPath((previous) => (previous === directoryPath ? previous : directoryPath));
      setExpandedDirs((previous) => {
        const next = new Set(previous);
        next.add(directoryPath);
        return next;
      });
    }
  }, [location.search, openFileInEditor]);

  const handleSelectFile = (entry: FileEntry) => {
    openFileInEditor(entry, null, { previewMode: false });
  };

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

  const handleSetWorkspacePath = useCallback((nextPath: string) => {
    setCurrentPath(nextPath);
    setSelectedFile(null);
    setActiveTabPath(null);
    setRequestedJumpLine(null);
    setExpandedDirs(new Set());
    setTreeFilter("");
    setRefreshKey((previous) => previous + 1);
  }, []);

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

  const handleGoHome = () => {
    setCurrentPath("~");
    setSelectedFile(null);
    setActiveTabPath(null);
    setRequestedJumpLine(null);
    setExpandedDirs(new Set());
  };

  const handleGoUp = () => {
    if (rootInfo?.parent) {
      setCurrentPath(rootInfo.parent);
      setSelectedFile(null);
      setActiveTabPath(null);
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

  const openFileAtPath = useCallback((filePath: string, line?: number | null, previewMode?: boolean) => {
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
  }, [openFileInEditor]);

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
        setCreateParentPath(rootInfo?.path || currentPath);
        setCreateType("file");
        return;
      }

      if ((event.metaKey || event.ctrlKey) && !event.shiftKey && event.key === "\\") {
        event.preventDefault();
        setIsIdeChatOpen((previous) => !previous);
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

      if (event.key === "Escape" && sidebarMode === "search") {
        event.preventDefault();
        setSidebarMode("explorer");
      }
    };

    window.addEventListener("keydown", handleGlobalSearchShortcut);
    return () => window.removeEventListener("keydown", handleGlobalSearchShortcut);
  }, [
    closeQuickOpenPalette,
    currentPath,
    openMenu,
    openGlobalSearchPanel,
    openQuickOpenPalette,
    rootInfo?.path,
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

  useEffect(() => {
    return () => {
      sidebarResizeCleanupRef.current?.();
      chatResizeCleanupRef.current?.();
    };
  }, []);

  useEffect(() => {
    persistChatOpen(isIdeChatOpen);
  }, [isIdeChatOpen]);

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

  const activeTab = openTabs.find((tab) => tab.path === (activeTabPath || selectedFile?.path || ""));
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
                  setCreateParentPath(rootInfo?.path || currentPath);
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
                  setCreateParentPath(rootInfo?.path || currentPath);
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
                  setIsIdeChatOpen((previous) => !previous);
                  setOpenMenu(null);
                }}
                className="w-full text-left px-3 py-2 text-gray-200 hover:bg-white/5 text-sm"
              >
                {isIdeChatOpen ? "Hide IDE Chat" : "Show IDE Chat"}
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
        <div className="flex items-center gap-2 min-w-0 max-w-[70vw]">
          <div className="text-gray-500 truncate" title={rootInfo?.path || currentPath}>
            {(rootInfo?.path || currentPath)
              .replace(/^\/Users\/[^/]+/, "~")
              .replace(/^C:\\Users\\[^\\]+/, "~")}
          </div>
          <button
            type="button"
            onClick={() => setIsIdeChatOpen((previous) => !previous)}
            className={cn(
              "px-2 py-1 rounded text-xs border transition-colors flex items-center gap-1",
              isIdeChatOpen
                ? "border-indigo-500/40 bg-indigo-500/20 text-indigo-200"
                : "border-white/10 text-gray-400 hover:text-gray-200 hover:bg-white/5"
            )}
            title={isIdeChatOpen ? "Hide IDE chat panel" : "Show IDE chat panel"}
          >
            <MessageSquare className="w-3.5 h-3.5" />
            Chat
          </button>
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
                  onContextMenu={handleTreeContextMenu}
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

        <div className="flex-1 flex overflow-hidden bg-[#0d0d12]">
          <div className="flex-1 flex flex-col overflow-hidden min-w-0">
            <div
              className="h-9 border-b border-white/10 bg-black/20 flex items-center overflow-x-auto"
              style={{ fontFamily: "var(--font-zed-ui), var(--font-ui), Inter, system-ui, sans-serif" }}
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
                <div className="px-3 text-xs text-gray-600">No open files</div>
              )}
            </div>

            <CodeViewer
              path={selectedFile?.path || null}
              previewMode={activeTab?.previewMode === true}
              autoRefresh={true}
              jumpToLineRequest={requestedJumpLine}
              externalRefreshKey={refreshKey}
              saveRequestToken={saveRequestToken}
              onSaveSuccess={handleRefresh}
              onCursorChange={setCursorPosition}
              onOpenLocation={(filePath, line) => {
                openFileAtPath(filePath, line, false);
              }}
            />
          </div>

          {isIdeChatOpen && (
            <>
              <div
                role="separator"
                aria-label="Resize IDE chat panel"
                aria-orientation="vertical"
                onMouseDown={handleChatResizeStart}
                className="w-1.5 cursor-col-resize bg-transparent hover:bg-indigo-500/40 transition-colors"
              />
              <div
                className="border-l border-white/10 bg-[#0b0b12] h-full"
                style={{ width: `${chatPanelWidth}px` }}
              >
                <IDEChatPanel
                  workspaceDir={rootInfo?.path || currentPath}
                  contextPath={selectedFile?.path || null}
                  onClose={() => setIsIdeChatOpen(false)}
                />
              </div>
            </>
          )}
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

      {treeContextMenu &&
        contextMenuPosition &&
        (() => {
          const entry = treeContextMenu.entry;
          const separatorIndex = Math.max(entry.path.lastIndexOf("/"), entry.path.lastIndexOf("\\"));
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
                {entry.type === "file" ? "Open" : expandedDirs.has(entry.path) ? "Collapse" : "Expand"}
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
