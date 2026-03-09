import {
  useState,
  useEffect,
  useCallback,
  useMemo,
  useRef,
  useDeferredValue,
  memo,
  type CSSProperties,
} from "react";
import { useLocation, useNavigate } from "react-router-dom";
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
  CheckCircle2,
  Zap,
  GitBranch,
  Search,
  MessageSquare,
  ExternalLink,
  Copy,
  RotateCcw,
  Sparkles,
  Square,
  ListTree,
  Settings2,
  TerminalSquare,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { apiFetch } from "@/lib/auth";
import { chatApi, agentsApi } from "@/lib/api";
import { connectStatusStream } from "@/lib/status-stream";
import {
  buildActivitiesFromToolCalls,
  finalizeCompletedActivities,
  mergeActivityLists,
  normalizeActivityTextForPhase,
  type LiveActivityItem,
  type ToolCallLike,
} from "@/lib/chatActivities";
import {
  countGitDiffLineChanges,
  buildPendingInlinePreviewRows,
  emptyIdePendingDiffDecorations,
  mergeGitDiffDecorations,
  parseGitDiffDecorations,
  type IdePendingInlinePreviewRow,
  type IdePendingDeletedBlock,
  type IdePendingDiffDecorations,
  type IdePendingLineState,
} from "@/lib/idePendingDiffDecorations";
import EmbeddedTerminalPanel, {
  type IdeTerminalPanelState,
} from "@/components/ide/EmbeddedTerminalPanel";
import { useStopAgent } from "@/hooks/useApi";

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

interface LspActiveServer {
  id: string;
  name: string;
  command: string;
  args: string[];
  available: boolean;
  bundled: boolean;
  primary: boolean;
  running: boolean;
  initialized: boolean;
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

interface WorkspaceIndexerSettings {
  enabled: boolean;
  autoReindexOnWorkspaceSet: boolean;
  includeHidden: boolean;
  maxFileSizeBytes: number;
  maxFiles: number;
  semanticEnabled: boolean;
  semanticMaxFiles: number;
  semanticMinScore: number;
  embeddingProvider: "auto" | "openai" | "gemini" | "ollama" | "transformers_js";
  embeddingModel: string;
  ignoreDirs: string[];
  includeExtensions: string[];
}

interface WorkspaceEmbeddingProviderOption {
  id: "auto" | "openai" | "gemini" | "ollama" | "transformers_js";
  label: string;
  local: boolean;
  available: boolean;
  reason?: string;
  defaultModel: string;
  models: string[];
}

interface WorkspaceEmbeddingCatalogResponse {
  success: boolean;
  selected?: {
    provider: WorkspaceIndexerSettings["embeddingProvider"];
    model: string;
  };
  providers?: WorkspaceEmbeddingProviderOption[];
  error?: string;
}

interface WorkspaceEmbeddingRuntimeModelStatus {
  model: string;
  state: "idle" | "loading" | "ready" | "error";
  loadedAt: string | null;
  lastUsedAt: string | null;
  lastError: string | null;
}

interface WorkspaceEmbeddingRuntimeResponse {
  success: boolean;
  selectedProvider?: string;
  selectedModel?: string;
  vectorProvider?: string;
  vectorModel?: string;
  vectorFallbackReason?: string | null;
  transformers?: {
    selectedModel: string;
    selectedState: "idle" | "loading" | "ready" | "error";
    loadedModels: WorkspaceEmbeddingRuntimeModelStatus[];
  };
  error?: string;
}

interface WorkspaceIndexerStatusResponse {
  success: boolean;
  state: "idle" | "indexing" | "ready" | "stopped" | "error";
  isIndexing: boolean;
  workspacePath: string | null;
  indexedWorkspacePath: string | null;
  filesIndexed: number;
  filesScanned: number;
  directoriesScanned: number;
  skippedFiles: number;
  progress: number;
  startedAt: string | null;
  finishedAt: string | null;
  durationMs: number | null;
  lastIndexedAt: string | null;
  semanticReady: boolean;
  semanticProvider: string | null;
  semanticModel: string | null;
  semanticIndexedFiles: number;
  semanticIndexedChunks: number;
  semanticError: string | null;
  error: string | null;
  settings: WorkspaceIndexerSettings;
  message?: string;
}

interface WorkspaceIndexerSearchResult extends IdeListFilesResult {
  source?: "index" | "filesystem";
  indexed?: boolean;
  indexState?: "idle" | "indexing" | "ready" | "stopped" | "error";
  indexError?: string;
  workspacePath?: string;
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

type GitHistoryStatus = "idle" | "loading" | "ready" | "unavailable" | "error";

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
  thinking?: string;
  tool_calls?: ToolCallLike[];
  process_activities?: IdeProcessActivity[];
}

interface IdeChatAgentOption {
  id: string;
  name: string;
  status?: string;
}

interface IdeProcessActivity extends LiveActivityItem {}

interface IdeFileChangeItem {
  path: string;
  type: "created" | "updated" | "deleted";
  added: number;
  removed: number;
  diff?: string;
}

interface IdeFileChangeSummary {
  files: IdeFileChangeItem[];
  totalAdded: number;
  totalRemoved: number;
}

interface IdePendingFileDiff {
  key: string;
  messageKey: string;
  path: string;
  type: IdeFileChangeItem["type"];
  added: number;
  removed: number;
  diff?: string;
}

interface IdePendingFileDiffController {
  items: IdePendingFileDiff[];
  acceptFile: (fileKey: string) => void;
  rejectFile: (fileKey: string) => Promise<void>;
  acceptAll: () => void;
  rejectAll: () => Promise<void>;
}

interface TreeContextMenuState {
  x: number;
  y: number;
  entry: FileEntry;
}

interface IdeCommandItem {
  id: string;
  label: string;
  detail?: string;
  shortcut?: string;
  run: () => void;
}

interface IdeOutlineSymbol {
  name: string;
  kind: number;
  detail?: string;
  line: number;
  character: number;
  endLine: number;
  endCharacter: number;
  children?: IdeOutlineSymbol[];
}

interface IdeOutlineResponse {
  success: boolean;
  path: string;
  symbols: IdeOutlineSymbol[];
  error?: string;
}

interface IdeCompletionItem {
  label: string;
  detail?: string;
  kind?: number;
  insertText?: string;
  sortText?: string;
}

interface IdeCompletionResponse {
  success: boolean;
  items: IdeCompletionItem[];
  error?: string;
}

interface IdeInlineCompletionResponse {
  success: boolean;
  completion?: string;
  error?: string;
  agentId?: string;
  model?: string;
  provider?: string;
}

interface FlattenedOutlineSymbol extends IdeOutlineSymbol {
  depth: number;
  key: string;
}

interface IdeBreadcrumb {
  label: string;
  path: string;
  isFile: boolean;
}

type IdeSettingsSectionId = "general" | "editor" | "completion" | "indexing" | "terminal";

interface IdePreferences {
  editorFontSizePx: number;
  editorLineHeightPx: number;
  showMinimap: boolean;
  enableCompletions: boolean;
  enableGhostCompletions: boolean;
  completionDebounceMs: number;
  ghostDebounceMs: number;
  useChatAgentForCompletions: boolean;
  completionAgentId: string;
  openTerminalOnStartup: boolean;
  autoCreateTerminalOnOpen: boolean;
  terminalPanelHeight: number;
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
const IDE_WORKSPACE_PATH_STORAGE_KEY = "cybara.ide.workspace.path";
const IDE_CHAT_AGENT_STORAGE_KEY = "cybara.ide.chat.agent";
const IDE_TERMINAL_OPEN_STORAGE_KEY = "cybara.ide.terminal.open";
const IDE_SETTINGS_STORAGE_KEY = "cybara.ide.settings";
const EXPLORER_VIRTUALIZATION_MIN_ENTRIES = 400;
const EXPLORER_VIRTUALIZATION_ROW_HEIGHT = 30;
const EXPLORER_VIRTUALIZATION_OVERSCAN = 12;
const EDITOR_LARGE_FILE_CHAR_THRESHOLD = 400_000;
const EDITOR_LARGE_FILE_LINE_THRESHOLD = 8_000;
const COMPLETION_LOCAL_SCAN_BEFORE = 24_000;
const COMPLETION_LOCAL_SCAN_AFTER = 8_000;
const COMPLETION_CACHE_TTL_MS = 20_000;
const COMPLETION_CACHE_MAX_ENTRIES = 180;
const EDITOR_TYPING_BURST_MS = 160;
const EDITOR_FONT_SIZE_PX = 14;
const EDITOR_LINE_HEIGHT_PX = 22;
const IDE_TERMINAL_DEFAULT_HEIGHT = 240;
const IDE_TERMINAL_MIN_HEIGHT = 120;
const IDE_TERMINAL_MAX_HEIGHT = 520;
const IDE_DEFAULT_PREFERENCES: IdePreferences = {
  editorFontSizePx: EDITOR_FONT_SIZE_PX,
  editorLineHeightPx: EDITOR_LINE_HEIGHT_PX,
  showMinimap: true,
  enableCompletions: true,
  enableGhostCompletions: true,
  completionDebounceMs: 110,
  ghostDebounceMs: 240,
  useChatAgentForCompletions: true,
  completionAgentId: "",
  openTerminalOnStartup: false,
  autoCreateTerminalOnOpen: false,
  terminalPanelHeight: IDE_TERMINAL_DEFAULT_HEIGHT,
};
const DEFAULT_INDEXER_SETTINGS_DRAFT: WorkspaceIndexerSettings = {
  enabled: true,
  autoReindexOnWorkspaceSet: true,
  includeHidden: false,
  maxFileSizeBytes: 1024 * 1024,
  maxFiles: 25000,
  semanticEnabled: true,
  semanticMaxFiles: 2000,
  semanticMinScore: 0.45,
  embeddingProvider: "auto",
  embeddingModel: "",
  ignoreDirs: [".git", "node_modules", "dist", "build"],
  includeExtensions: [],
};

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

function readPersistedWorkspacePath(): string {
  if (typeof window === "undefined") return "~";
  const raw = window.localStorage.getItem(IDE_WORKSPACE_PATH_STORAGE_KEY);
  if (!raw || !raw.trim()) return "~";
  return raw.trim();
}

function persistWorkspacePath(pathValue: string): void {
  if (typeof window === "undefined") return;
  const normalized = pathValue.trim();
  if (!normalized) return;
  window.localStorage.setItem(IDE_WORKSPACE_PATH_STORAGE_KEY, normalized);
}

function readPersistedIdeChatAgentId(): string {
  if (typeof window === "undefined") return "";
  const raw = window.localStorage.getItem(IDE_CHAT_AGENT_STORAGE_KEY);
  return raw && raw.trim() ? raw.trim() : "";
}

function persistIdeChatAgentId(agentId: string): void {
  if (typeof window === "undefined") return;
  const normalized = agentId.trim();
  if (!normalized) {
    window.localStorage.removeItem(IDE_CHAT_AGENT_STORAGE_KEY);
    return;
  }
  window.localStorage.setItem(IDE_CHAT_AGENT_STORAGE_KEY, normalized);
}

function clampTerminalHeight(height: number): number {
  if (!Number.isFinite(height)) return IDE_TERMINAL_DEFAULT_HEIGHT;
  return Math.min(IDE_TERMINAL_MAX_HEIGHT, Math.max(IDE_TERMINAL_MIN_HEIGHT, Math.round(height)));
}

function readPersistedTerminalOpen(defaultOpen: boolean): boolean {
  if (typeof window === "undefined") return defaultOpen;
  const raw = window.localStorage.getItem(IDE_TERMINAL_OPEN_STORAGE_KEY);
  if (raw === "1") return true;
  if (raw === "0") return false;
  return defaultOpen;
}

function persistTerminalOpen(isOpen: boolean): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(IDE_TERMINAL_OPEN_STORAGE_KEY, isOpen ? "1" : "0");
}

function readPersistedIdePreferences(): IdePreferences {
  if (typeof window === "undefined") return IDE_DEFAULT_PREFERENCES;
  const raw = window.localStorage.getItem(IDE_SETTINGS_STORAGE_KEY);
  if (!raw) return IDE_DEFAULT_PREFERENCES;
  try {
    const parsed = JSON.parse(raw) as Partial<IdePreferences>;
    return {
      ...IDE_DEFAULT_PREFERENCES,
      ...parsed,
      editorFontSizePx: Number.isFinite(parsed.editorFontSizePx)
        ? Math.max(11, Math.min(22, Math.round(parsed.editorFontSizePx || EDITOR_FONT_SIZE_PX)))
        : IDE_DEFAULT_PREFERENCES.editorFontSizePx,
      editorLineHeightPx: Number.isFinite(parsed.editorLineHeightPx)
        ? Math.max(16, Math.min(38, Math.round(parsed.editorLineHeightPx || EDITOR_LINE_HEIGHT_PX)))
        : IDE_DEFAULT_PREFERENCES.editorLineHeightPx,
      completionDebounceMs: Number.isFinite(parsed.completionDebounceMs)
        ? Math.max(30, Math.min(800, Math.round(parsed.completionDebounceMs || 110)))
        : IDE_DEFAULT_PREFERENCES.completionDebounceMs,
      ghostDebounceMs: Number.isFinite(parsed.ghostDebounceMs)
        ? Math.max(60, Math.min(1400, Math.round(parsed.ghostDebounceMs || 240)))
        : IDE_DEFAULT_PREFERENCES.ghostDebounceMs,
      completionAgentId:
        typeof parsed.completionAgentId === "string"
          ? parsed.completionAgentId.trim()
          : IDE_DEFAULT_PREFERENCES.completionAgentId,
      terminalPanelHeight: clampTerminalHeight(
        Number.isFinite(parsed.terminalPanelHeight)
          ? Number(parsed.terminalPanelHeight)
          : IDE_DEFAULT_PREFERENCES.terminalPanelHeight
      ),
    };
  } catch {
    return IDE_DEFAULT_PREFERENCES;
  }
}

function persistIdePreferences(preferences: IdePreferences): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(IDE_SETTINGS_STORAGE_KEY, JSON.stringify(preferences));
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

function formatDurationMs(durationMs?: number | null): string {
  if (!Number.isFinite(durationMs || 0) || !durationMs || durationMs <= 0) return "0s";
  const seconds = Math.floor(durationMs / 1000);
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  if (minutes <= 0) return `${Math.max(1, remainingSeconds)}s`;
  return `${minutes}m ${remainingSeconds}s`;
}

function getLineAndColumn(content: string, index: number): { line: number; column: number } {
  const safeIndex = Math.max(0, Math.min(index, content.length));
  let line = 1;
  let lineStart = 0;
  for (let i = 0; i < safeIndex; i += 1) {
    if (content.charCodeAt(i) === 10) {
      line += 1;
      lineStart = i + 1;
    }
  }
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

function splitPathForBreadcrumbs(pathValue: string): string[] {
  const normalized = pathValue.replace(/\\/g, "/");
  return normalized.split("/").filter((segment) => segment.length > 0);
}

function flattenOutlineSymbols(
  symbols: IdeOutlineSymbol[],
  depth = 0,
  prefix = "root"
): FlattenedOutlineSymbol[] {
  const rows: FlattenedOutlineSymbol[] = [];
  symbols.forEach((symbol, index) => {
    const key = `${prefix}:${index}:${symbol.name}:${symbol.line}:${symbol.character}`;
    rows.push({
      ...symbol,
      depth,
      key,
    });
    if (Array.isArray(symbol.children) && symbol.children.length > 0) {
      rows.push(...flattenOutlineSymbols(symbol.children, depth + 1, key));
    }
  });
  return rows;
}

function getSymbolKindLabel(kind: number): string {
  const labels: Record<number, string> = {
    1: "File",
    2: "Module",
    3: "Namespace",
    4: "Package",
    5: "Class",
    6: "Method",
    7: "Property",
    8: "Field",
    9: "Ctor",
    10: "Enum",
    11: "Interface",
    12: "Function",
    13: "Variable",
    14: "Const",
    22: "Enum Member",
    26: "Type",
  };
  return labels[kind] || `Kind ${kind}`;
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
  h1: ({ children }) => (
    <h1 className="mb-3 text-2xl font-semibold tracking-tight text-white">{children}</h1>
  ),
  h2: ({ children }) => (
    <h2 className="mb-2.5 mt-5 text-xl font-semibold tracking-tight text-white">{children}</h2>
  ),
  h3: ({ children }) => (
    <h3 className="mb-2 mt-4 text-lg font-semibold text-gray-100">{children}</h3>
  ),
  p: ({ children }) => <p className="mb-3 leading-7 text-gray-200 last:mb-0">{children}</p>,
  ul: ({ children }) => <ul className="mb-3 list-disc pl-5 text-gray-200">{children}</ul>,
  ol: ({ children }) => <ol className="mb-3 list-decimal pl-5 text-gray-200">{children}</ol>,
  li: ({ children }) => <li className="mb-1">{children}</li>,
  blockquote: ({ children }) => (
    <blockquote className="my-4 border-l-2 border-indigo-400/50 pl-3 text-gray-300">
      {children}
    </blockquote>
  ),
  table: ({ children }) => (
    <div className="my-4 overflow-x-auto rounded-xl border border-white/10 bg-black/20">
      <table className="w-full border-collapse text-[12px]">{children}</table>
    </div>
  ),
  thead: ({ children }) => <thead className="bg-white/[0.04]">{children}</thead>,
  tr: ({ children }) => <tr className="border-b border-white/10 last:border-b-0">{children}</tr>,
  th: ({ children }) => (
    <th className="px-3 py-2 text-left font-semibold text-gray-100">{children}</th>
  ),
  td: ({ children }) => <td className="px-3 py-2 align-top text-gray-300">{children}</td>,
  code: ({ className, children }) => {
    const raw = String(children ?? "");
    const isInline = !className && !raw.includes("\n");
    if (isInline) {
      return (
        <code className="rounded bg-white/10 px-1.5 py-0.5 font-mono text-[12px] text-indigo-100">
          {children}
        </code>
      );
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

const FileTreeItem = memo(function FileTreeItem({
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
          {entry.size !== undefined && (
            <span className="text-xs text-gray-600">{formatSize(entry.size)}</span>
          )}
        </div>
      )}
    </div>
  );
});

const treeBrowseCache = new Map<string, FileEntry[]>();

interface FileTreeProps {
  path: string;
  level?: number;
  selectedPath: string | null;
  onSelectFile: (entry: FileEntry) => void;
  onContextMenu?: (entry: FileEntry, event: React.MouseEvent<HTMLDivElement>) => void;
  expandedDirs: Set<string>;
  onToggleDir: (path: string) => void;
  filterQuery: string;
  refreshToken: number;
  rootScrollTop?: number;
  rootViewportHeight?: number;
}

const FileTree = memo(function FileTree({
  path,
  level = 0,
  selectedPath,
  onSelectFile,
  onContextMenu,
  expandedDirs,
  onToggleDir,
  filterQuery,
  refreshToken,
  rootScrollTop = 0,
  rootViewportHeight = 0,
}: FileTreeProps) {
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let isCancelled = false;
    const fetchEntries = async () => {
      const cacheKey = `${refreshToken}:${path}`;
      const cachedEntries = treeBrowseCache.get(cacheKey);
      if (cachedEntries) {
        setEntries(cachedEntries);
        setError(null);
        setIsLoading(false);
        return;
      }
      setIsLoading(true);
      setError(null);
      try {
        const res = await apiFetch(`/api/ide/browse?path=${encodeURIComponent(path)}`);
        const data: BrowseResult = await res.json();
        if (isCancelled) return;
        if (data.success) {
          const nextEntries = Array.isArray(data.entries) ? data.entries : [];
          treeBrowseCache.set(cacheKey, nextEntries);
          setEntries(nextEntries);
        } else {
          setError(data.error || "Failed to load");
        }
      } catch (e) {
        if (isCancelled) return;
        setError(String(e));
      }
      if (isCancelled) return;
      setIsLoading(false);
    };
    fetchEntries();
    return () => {
      isCancelled = true;
    };
  }, [path, refreshToken]);

  const normalizedFilter = filterQuery.trim().toLowerCase();
  const filteredEntries = useMemo(() => {
    if (!normalizedFilter) return entries;
    return entries.filter((entry) => entry.name.toLowerCase().includes(normalizedFilter));
  }, [entries, normalizedFilter]);
  const hasExpandedDirectoriesAtLevel = useMemo(
    () =>
      filteredEntries.some((entry) => entry.type === "directory" && expandedDirs.has(entry.path)),
    [expandedDirs, filteredEntries]
  );
  const enableVirtualizedRows =
    level === 0 &&
    !normalizedFilter &&
    !hasExpandedDirectoriesAtLevel &&
    filteredEntries.length >= EXPLORER_VIRTUALIZATION_MIN_ENTRIES &&
    rootViewportHeight > 0;
  const virtualWindow = useMemo(() => {
    if (!enableVirtualizedRows) {
      return {
        startIndex: 0,
        endIndex: filteredEntries.length,
        topSpacerHeight: 0,
        bottomSpacerHeight: 0,
      };
    }
    const rowHeight = EXPLORER_VIRTUALIZATION_ROW_HEIGHT;
    const visibleStart = Math.max(
      0,
      Math.floor(rootScrollTop / rowHeight) - EXPLORER_VIRTUALIZATION_OVERSCAN
    );
    const visibleEnd = Math.min(
      filteredEntries.length,
      Math.ceil((rootScrollTop + rootViewportHeight) / rowHeight) + EXPLORER_VIRTUALIZATION_OVERSCAN
    );
    return {
      startIndex: visibleStart,
      endIndex: visibleEnd,
      topSpacerHeight: visibleStart * rowHeight,
      bottomSpacerHeight: Math.max(0, (filteredEntries.length - visibleEnd) * rowHeight),
    };
  }, [enableVirtualizedRows, filteredEntries.length, rootScrollTop, rootViewportHeight]);
  const entriesToRender = enableVirtualizedRows
    ? filteredEntries.slice(virtualWindow.startIndex, virtualWindow.endIndex)
    : filteredEntries;

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
      {enableVirtualizedRows && virtualWindow.topSpacerHeight > 0 && (
        <div style={{ height: `${virtualWindow.topSpacerHeight}px` }} aria-hidden />
      )}
      {entriesToRender.map((entry) => {
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
                refreshToken={refreshToken}
                rootScrollTop={rootScrollTop}
                rootViewportHeight={rootViewportHeight}
              />
            )}
          </div>
        );
      })}
      {enableVirtualizedRows && virtualWindow.bottomSpacerHeight > 0 && (
        <div style={{ height: `${virtualWindow.bottomSpacerHeight}px` }} aria-hidden />
      )}
    </div>
  );
});

function CodeViewer({
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
  enableCompletions = true,
  enableGhostCompletions = true,
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
    if (!showPendingInlinePreview || !previewScrollRef.current) return;
    syncEditorScroll(previewScrollRef.current);
  }, [pendingInlinePreviewRows, showPendingInlinePreview, syncEditorScroll]);

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

  const lineDiagnostics = new Map<number, Diagnostic[]>();
  diagnostics.forEach((d) => {
    const existing = lineDiagnostics.get(d.line) || [];
    existing.push(d);
    lineDiagnostics.set(d.line, existing);
  });

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
                          {sourceLines.map((line, i) => {
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
                                style={{
                                  height: `${normalizedLineHeight}px`,
                                  lineHeight: `${normalizedLineHeight}px`,
                                  ...getPendingLineDecorationStyle(pendingLineState, isActiveLine),
                                }}
                                className={cn(
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
                              </div>
                            );
                          })}
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
  activeFilePath,
  activeExtension,
}: {
  compact?: boolean;
  activeFilePath?: string | null;
  activeExtension?: string | null;
}) {
  const [languageId, setLanguageId] = useState<string | null>(
    getActiveLanguageFromExtension(activeExtension)
  );
  const [servers, setServers] = useState<LspActiveServer[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    const handleClickAway = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (popoverRef.current && target && !popoverRef.current.contains(target)) {
        setIsOpen(false);
      }
    };
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIsOpen(false);
    };
    window.addEventListener("mousedown", handleClickAway);
    window.addEventListener("keydown", handleEscape);
    return () => {
      window.removeEventListener("mousedown", handleClickAway);
      window.removeEventListener("keydown", handleEscape);
    };
  }, [isOpen]);

  useEffect(() => {
    const fallbackLanguage = getActiveLanguageFromExtension(activeExtension);
    if (!activeFilePath) {
      setServers([]);
      setLanguageId(fallbackLanguage);
      setError(null);
      setIsLoading(false);
      return;
    }

    let isCancelled = false;
    const fetchStatus = async () => {
      setIsLoading(true);
      setError(null);
      try {
        const res = await apiFetch(`/api/lsp/active?path=${encodeURIComponent(activeFilePath)}`);
        const data = await res.json();
        if (isCancelled) return;
        setServers(Array.isArray(data?.servers) ? (data.servers as LspActiveServer[]) : []);
        setLanguageId(
          typeof data?.languageId === "string" && data.languageId
            ? data.languageId
            : fallbackLanguage
        );
        if (data?.success === false && typeof data?.error === "string") {
          setError(data.error);
        }
      } catch (err) {
        if (isCancelled) return;
        setServers([]);
        setLanguageId(fallbackLanguage);
        setError((err as Error)?.message || "Failed to load LSP status");
      } finally {
        if (!isCancelled) {
          setIsLoading(false);
        }
      }
    };
    void fetchStatus();
    return () => {
      isCancelled = true;
    };
  }, [activeExtension, activeFilePath]);

  const runningCount = servers.filter((server) => server.running && server.initialized).length;
  const availableCount = servers.filter((server) => server.available).length;
  const summaryLabel = isLoading
    ? "loading"
    : runningCount > 0
      ? `${runningCount} active`
      : availableCount > 0
        ? `${availableCount} ready`
        : "none";
  const summaryClass =
    runningCount > 0 ? "text-emerald-400" : availableCount > 0 ? "text-amber-300" : "text-gray-600";

  return (
    <div
      className={cn(
        compact
          ? "flex items-center gap-2 text-xs text-gray-500"
          : "px-3 py-2 border-t border-white/10 bg-white/5"
      )}
    >
      <div ref={popoverRef} className="relative">
        <button
          type="button"
          onClick={() => setIsOpen((previous) => !previous)}
          className="inline-flex items-center gap-2 rounded px-1.5 py-0.5 hover:bg-white/5"
          title="Show active language servers"
        >
          <div className="flex items-center gap-2 text-xs text-gray-500">
            <Zap className="w-3 h-3" />
            <span>LSP:</span>
            <span className={summaryClass}>{summaryLabel}</span>
            <span className="text-gray-600">{languageId || "unknown"}</span>
            <ChevronDown className={cn("w-3 h-3 transition-transform", isOpen && "rotate-180")} />
          </div>
        </button>
        {isOpen && (
          <div className="absolute bottom-[calc(100%+8px)] right-0 z-30 w-[360px] overflow-hidden rounded-md border border-white/10 bg-[#0b0f19] shadow-[0_20px_40px_rgba(0,0,0,0.45)]">
            <div className="border-b border-white/10 px-3 py-2">
              <div className="text-xs font-medium text-gray-200">Language Servers</div>
              <div className="mt-0.5 text-[11px] text-gray-500">
                {languageId || "unknown"} • {runningCount}/{servers.length} running
              </div>
            </div>
            {error ? (
              <div className="px-3 py-2 text-[11px] text-red-300">{error}</div>
            ) : servers.length === 0 ? (
              <div className="px-3 py-2 text-[11px] text-gray-500">
                No servers configured for this file.
              </div>
            ) : (
              <div className="max-h-72 overflow-y-auto py-1">
                {servers.map((server) => {
                  const statusLabel =
                    server.running && server.initialized
                      ? "running"
                      : server.available
                        ? "available"
                        : "unavailable";
                  const statusClass =
                    server.running && server.initialized
                      ? "text-emerald-300"
                      : server.available
                        ? "text-amber-300"
                        : "text-red-300";
                  return (
                    <div
                      key={`lsp-server:${server.id}`}
                      className="border-b border-white/5 px-3 py-2 text-[11px] last:border-b-0"
                    >
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-gray-200">{server.name}</span>
                        {server.primary && (
                          <span className="rounded border border-indigo-400/40 bg-indigo-500/15 px-1.5 py-0.5 text-[10px] text-indigo-200">
                            primary
                          </span>
                        )}
                        {server.bundled && (
                          <span className="rounded border border-cyan-400/40 bg-cyan-500/15 px-1.5 py-0.5 text-[10px] text-cyan-200">
                            bundled
                          </span>
                        )}
                        <span className={cn("ml-auto font-medium", statusClass)}>
                          {statusLabel}
                        </span>
                      </div>
                      <div className="mt-1 truncate text-gray-500">
                        {server.command}
                        {Array.isArray(server.args) && server.args.length > 0
                          ? ` ${server.args.join(" ")}`
                          : ""}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
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
    <div
      className={cn(
        compact
          ? "flex items-center gap-2 text-xs text-gray-500"
          : "px-3 py-2 border-t border-white/10 bg-white/5"
      )}
    >
      <div className="flex items-center gap-2 text-xs text-gray-500">
        <GitBranch className="w-3 h-3" />
        <span className="text-indigo-400 font-medium">{branch}</span>
        {modified > 0 && <span className="text-yellow-400">~{modified}</span>}
        {untracked > 0 && <span className="text-gray-400">+{untracked}</span>}
      </div>
    </div>
  );
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function normalizeIdePath(value: string): string {
  return value.replace(/\\/g, "/").replace(/^\.\//, "").replace(/^\/+/, "/");
}

function getIdePendingFileDecisionKey(messageKey: string, filePath: string): string {
  return `${messageKey}::${normalizeIdePath(filePath)}`;
}

function isSameIdePath(currentPath: string, candidatePath: string): boolean {
  const current = normalizeIdePath(currentPath);
  const candidate = normalizeIdePath(candidatePath).replace(/^[ab]\//, "");
  if (!current || !candidate) return false;
  if (current === candidate) return true;
  if (current.endsWith(`/${candidate}`)) return true;
  if (candidate.endsWith(`/${current}`)) return true;
  return false;
}

function countDiffLines(content: string): number {
  if (!content) return 0;
  return content.split(/\r?\n/).length;
}

function toFiniteDiffNumber(raw: unknown): number {
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  if (typeof raw === "string" && raw.trim()) {
    const parsed = Number(raw);
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
}

function normalizeIdeChangeType(raw: unknown): IdeFileChangeItem["type"] {
  const normalized = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  if (normalized === "created" || normalized === "create" || normalized === "new") return "created";
  if (normalized === "deleted" || normalized === "delete" || normalized === "remove")
    return "deleted";
  return "updated";
}

function truncateDiffPreview(diff: string, maxLines = 220): string {
  const lines = diff.split(/\r?\n/);
  if (lines.length <= maxLines) return diff;
  const omitted = lines.length - maxLines;
  return [...lines.slice(0, maxLines), `... [diff truncated, ${omitted} lines omitted]`].join("\n");
}

function shouldHydratePendingFileDiffFromGit(file: IdePendingFileDiff): boolean {
  const diff = typeof file.diff === "string" ? file.diff : "";
  if (!diff.trim()) return true;
  const counts = countGitDiffLineChanges(diff);
  if (counts.truncated) return true;
  if (file.added > 0 && counts.added === 0) return true;
  if (file.removed > 0 && counts.removed === 0) return true;
  return counts.added !== file.added || counts.removed !== file.removed;
}

function getPendingLineTextClass(
  state: IdePendingLineState | undefined,
  hasError: boolean,
  hasWarning: boolean
): string | null {
  if (hasError || hasWarning) return null;
  if (state === "added") return "text-emerald-300";
  if (state === "removed") return "text-red-300";
  if (state === "mixed") return "text-amber-300";
  return null;
}

function getPendingLineContainerClass(
  state: IdePendingLineState | undefined,
  hasError: boolean,
  hasWarning: boolean
): string | null {
  if (hasError || hasWarning) return null;
  if (state === "added") return "bg-emerald-500/14";
  if (state === "removed") return "bg-red-500/12";
  return null;
}

function getPendingLineDecorationStyle(
  state: IdePendingLineState | undefined,
  isActiveLine: boolean
): CSSProperties | undefined {
  const style: CSSProperties = {};
  if (state === "added") {
    style.boxShadow = "inset 3px 0 0 rgba(52, 211, 153, 0.72)";
  } else if (state === "removed") {
    style.boxShadow = "inset 3px 0 0 rgba(248, 113, 113, 0.74)";
  } else if (state === "mixed") {
    style.backgroundImage =
      "linear-gradient(90deg, rgba(248,113,113,0.12) 0%, rgba(248,113,113,0.12) 34%, rgba(52,211,153,0.12) 34%, rgba(52,211,153,0.12) 100%)";
    style.boxShadow = "inset 3px 0 0 rgba(251, 191, 36, 0.74)";
  }
  if (isActiveLine) {
    style.outline = "1px solid rgba(129, 140, 248, 0.45)";
    style.outlineOffset = "-1px";
  }
  return Object.keys(style).length > 0 ? style : undefined;
}

function summarizePendingDeletedBlocks(
  blocks: IdePendingDeletedBlock[] | undefined
): { preview: string; extraLines: number } | null {
  if (!Array.isArray(blocks) || blocks.length === 0) return null;
  const removedLines: string[] = [];
  for (const block of blocks) {
    removedLines.push(...block.lines);
  }
  if (removedLines.length === 0) return null;
  const trimmedPreview = removedLines.find((line) => line.trim().length > 0)?.trim() || "";
  const previewSource = trimmedPreview || removedLines[0] || "deleted line";
  const preview =
    previewSource.length > 96 ? `${previewSource.slice(0, 93).trimEnd()}...` : previewSource;
  return {
    preview,
    extraLines: Math.max(0, removedLines.length - 1),
  };
}

function parseIdePatchFileChanges(patch: string): IdeFileChangeItem[] {
  const lines = patch.split(/\r?\n/);
  const changes: IdeFileChangeItem[] = [];
  let current: IdeFileChangeItem | null = null;
  let diffLines: string[] = [];

  const pushCurrent = () => {
    if (!current) return;
    if (diffLines.length > 0) {
      current.diff = truncateDiffPreview(diffLines.join("\n"));
    }
    changes.push(current);
    current = null;
    diffLines = [];
  };

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];

    if (line.startsWith("--- ")) {
      pushCurrent();
      const oldPathRaw = line.slice(4).trim();
      const next = lines[index + 1] || "";
      const newPathRaw = next.startsWith("+++ ") ? next.slice(4).trim() : oldPathRaw;
      const oldPath = oldPathRaw.replace(/^[ab]\//, "");
      const newPath = newPathRaw.replace(/^[ab]\//, "");
      const type: IdeFileChangeItem["type"] =
        oldPathRaw === "/dev/null" ? "created" : newPathRaw === "/dev/null" ? "deleted" : "updated";
      const path = type === "deleted" ? oldPath : newPath;
      current = {
        path,
        type,
        added: 0,
        removed: 0,
      };
      diffLines.push(line);
      if (next.startsWith("+++ ")) {
        diffLines.push(next);
        index += 1;
      }
      continue;
    }

    if (!current) continue;
    if (line.startsWith("+") && !line.startsWith("+++")) {
      current.added += 1;
      diffLines.push(line);
      continue;
    }
    if (line.startsWith("-") && !line.startsWith("---")) {
      current.removed += 1;
      diffLines.push(line);
      continue;
    }
    if (line.startsWith("@@") || line.startsWith("diff --git ") || line.startsWith(" ")) {
      diffLines.push(line);
    }
  }

  pushCurrent();
  return changes.filter((change) => !!change.path);
}

function parseIdeChangeRecord(value: unknown): IdeFileChangeItem | null {
  if (!isPlainRecord(value)) return null;
  const path = typeof value.path === "string" ? value.path.trim() : "";
  if (!path) return null;
  const added =
    toFiniteDiffNumber(value.added) ||
    toFiniteDiffNumber(value.addedLines) ||
    toFiniteDiffNumber(value.plus);
  const removed =
    toFiniteDiffNumber(value.removed) ||
    toFiniteDiffNumber(value.removedLines) ||
    toFiniteDiffNumber(value.minus);
  const diff =
    typeof value.diff === "string" && value.diff.trim()
      ? truncateDiffPreview(value.diff)
      : undefined;
  return {
    path,
    type: normalizeIdeChangeType(value.type || value.kind),
    added: Math.max(0, Math.floor(added)),
    removed: Math.max(0, Math.floor(removed)),
    diff,
  };
}

function isIdeToolCallLike(value: unknown): value is ToolCallLike {
  return isPlainRecord(value) && typeof value.name === "string" && value.name.trim().length > 0;
}

function getIdeToolCallsInTimelineOrder(toolCalls: ToolCallLike[] | undefined): ToolCallLike[] {
  if (!Array.isArray(toolCalls) || toolCalls.length <= 1) {
    return toolCalls ? [...toolCalls] : [];
  }
  const hasTimeline = toolCalls.some(
    (toolCall) =>
      typeof toolCall.timeline_index === "number" &&
      Number.isFinite(toolCall.timeline_index as number)
  );
  if (!hasTimeline) return [...toolCalls];
  return [...toolCalls].sort((left, right) => {
    const leftRank =
      typeof left.timeline_index === "number" && Number.isFinite(left.timeline_index as number)
        ? (left.timeline_index as number)
        : Number.MAX_SAFE_INTEGER;
    const rightRank =
      typeof right.timeline_index === "number" && Number.isFinite(right.timeline_index as number)
        ? (right.timeline_index as number)
        : Number.MAX_SAFE_INTEGER;
    return leftRank - rightRank;
  });
}

function extractIdeToolFileChanges(toolCall: ToolCallLike): IdeFileChangeItem[] {
  const toolName = typeof toolCall.name === "string" ? toolCall.name.toLowerCase() : "";
  const args = isPlainRecord(toolCall.args)
    ? toolCall.args
    : isPlainRecord(toolCall.arguments)
      ? toolCall.arguments
      : {};
  const result = isPlainRecord(toolCall.result) ? toolCall.result : null;
  const parsedFromResult: IdeFileChangeItem[] = [];

  if (result && Array.isArray(result.changes)) {
    for (const change of result.changes) {
      const parsed = parseIdeChangeRecord(change);
      if (parsed) parsedFromResult.push(parsed);
    }
  }

  if (result && isPlainRecord(result.change)) {
    const parsed = parseIdeChangeRecord({
      path:
        (typeof result.path === "string" && result.path) ||
        (typeof args.path === "string" && args.path) ||
        "",
      ...(result.change as Record<string, unknown>),
    });
    if (parsed) parsedFromResult.push(parsed);
  }

  if (parsedFromResult.length > 0) return parsedFromResult;

  if (toolName === "apply_patch") {
    const patch = typeof args.patch === "string" ? args.patch : "";
    if (!patch.trim()) return [];
    return parseIdePatchFileChanges(patch);
  }

  if (toolName === "write") {
    const path = typeof args.path === "string" ? args.path : "";
    const content = typeof args.content === "string" ? args.content : "";
    if (!path || !content) return [];
    const diffLines = [
      `--- a/${path}`,
      `+++ b/${path}`,
      `@@ -1,0 +1,${countDiffLines(content)} @@`,
      ...content.split(/\r?\n/).map((line) => `+${line}`),
    ];
    return [
      {
        path,
        type: "created",
        added: countDiffLines(content),
        removed: 0,
        diff: truncateDiffPreview(diffLines.join("\n")),
      },
    ];
  }

  if (toolName === "edit") {
    const path = typeof args.path === "string" ? args.path : "";
    const oldText = typeof args.oldText === "string" ? args.oldText : "";
    const newText = typeof args.newText === "string" ? args.newText : "";
    if (!path || (!oldText && !newText)) return [];
    const oldLines = oldText ? oldText.split(/\r?\n/) : [];
    const newLines = newText ? newText.split(/\r?\n/) : [];
    const diffLines = [
      `--- a/${path}`,
      `+++ b/${path}`,
      `@@ -1,${oldLines.length} +1,${newLines.length} @@`,
      ...oldLines.map((line) => `-${line}`),
      ...newLines.map((line) => `+${line}`),
    ];
    return [
      {
        path,
        type: "updated",
        added: newLines.length,
        removed: oldLines.length,
        diff: truncateDiffPreview(diffLines.join("\n")),
      },
    ];
  }

  return [];
}

function summarizeIdeFileChanges(changes: IdeFileChangeItem[]): IdeFileChangeSummary | null {
  if (!Array.isArray(changes) || changes.length === 0) return null;
  const byPath = new Map<string, IdeFileChangeItem>();
  for (const change of changes) {
    if (!change?.path) continue;
    const existing = byPath.get(change.path);
    if (!existing) {
      byPath.set(change.path, { ...change });
      continue;
    }
    existing.added += change.added;
    existing.removed += change.removed;
    if (change.diff) existing.diff = change.diff;
    if (change.type === "deleted") existing.type = "deleted";
    if (existing.type !== "deleted" && change.type === "updated") existing.type = "updated";
  }
  const files = Array.from(byPath.values()).sort((left, right) =>
    left.path.localeCompare(right.path)
  );
  if (files.length === 0) return null;
  return {
    files,
    totalAdded: files.reduce((sum, file) => sum + file.added, 0),
    totalRemoved: files.reduce((sum, file) => sum + file.removed, 0),
  };
}

function mergeIdeFileChangeSummaries(
  ...summaries: Array<IdeFileChangeSummary | null | undefined>
): IdeFileChangeSummary | null {
  const merged: IdeFileChangeItem[] = [];
  for (const summary of summaries) {
    if (!summary || !Array.isArray(summary.files)) continue;
    merged.push(...summary.files);
  }
  return summarizeIdeFileChanges(merged);
}

function parseIdeChangeFromTextLine(line: string): IdeFileChangeItem | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  const match = trimmed.match(
    /^(Edited|Updated|Created|Deleted)\s+(.+?)(?:\s+\+(\d+)\s*-\s*(\d+))?(?:\s+\(.*\))?$/i
  );
  if (!match) return null;
  const action = (match[1] || "").toLowerCase();
  const rawPath = (match[2] || "").trim();
  const path = rawPath.replace(/^["'`]|["'`]$/g, "").trim();
  if (!path) return null;

  const addedRaw = match[3] ? Number(match[3]) : NaN;
  const removedRaw = match[4] ? Number(match[4]) : NaN;
  const type: IdeFileChangeItem["type"] =
    action === "created" ? "created" : action === "deleted" ? "deleted" : "updated";
  const added = Number.isFinite(addedRaw)
    ? Math.max(0, Math.floor(addedRaw))
    : type === "created"
      ? 1
      : 0;
  const removed = Number.isFinite(removedRaw)
    ? Math.max(0, Math.floor(removedRaw))
    : type === "deleted"
      ? 1
      : 0;

  return { path, type, added, removed };
}

function summarizeIdeActivityFileChanges(
  activities?: IdeProcessActivity[]
): IdeFileChangeSummary | null {
  if (!Array.isArray(activities) || activities.length === 0) return null;
  const parsed: IdeFileChangeItem[] = [];
  for (const activity of activities) {
    const line = typeof activity?.text === "string" ? activity.text : "";
    const change = parseIdeChangeFromTextLine(line);
    if (change) parsed.push(change);
  }
  return summarizeIdeFileChanges(parsed);
}

function summarizeIdeTextFileChanges(text?: string): IdeFileChangeSummary | null {
  if (typeof text !== "string" || !text.trim()) return null;
  const parsed: IdeFileChangeItem[] = [];
  for (const line of text.split(/\r?\n/)) {
    const change = parseIdeChangeFromTextLine(line);
    if (change) parsed.push(change);
  }
  return summarizeIdeFileChanges(parsed);
}

function summarizeIdeMessageFileChanges(
  toolCalls?: ToolCallLike[]
): IdeFileChangeSummary | null {
  if (!Array.isArray(toolCalls) || toolCalls.length === 0) return null;
  const collectedChanges: IdeFileChangeItem[] = [];
  const orderedToolCalls = getIdeToolCallsInTimelineOrder(toolCalls);

  for (const toolCall of orderedToolCalls) {
    collectedChanges.push(...extractIdeToolFileChanges(toolCall));
  }
  return summarizeIdeFileChanges(collectedChanges);
}

function reverseUnifiedDiff(diff: string, changeType: IdeFileChangeItem["type"]): string | null {
  if (!diff.trim() || diff.includes("[diff truncated")) return null;
  const lines = diff.split(/\r?\n/);
  if (lines.length === 0) return null;
  const oldLineIndex = lines.findIndex((line) => line.startsWith("--- "));
  const newLineIndex = lines.findIndex((line) => line.startsWith("+++ "));
  if (oldLineIndex < 0 || newLineIndex < 0) return null;

  const oldHeader = lines[oldLineIndex].slice(4).trim();
  const newHeader = lines[newLineIndex].slice(4).trim();
  const reversed = [...lines];
  if (changeType === "created") {
    reversed[oldLineIndex] = `--- ${newHeader}`;
    reversed[newLineIndex] = "+++ /dev/null";
  } else if (changeType === "deleted") {
    reversed[oldLineIndex] = "--- /dev/null";
    reversed[newLineIndex] = `+++ ${oldHeader}`;
  } else {
    reversed[oldLineIndex] = `--- ${newHeader}`;
    reversed[newLineIndex] = `+++ ${oldHeader}`;
  }

  for (let index = 0; index < reversed.length; index += 1) {
    const line = reversed[index] || "";
    if (line.startsWith("@@")) {
      const match = line.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)$/);
      if (match) {
        const oldStart = match[1];
        const oldCount = match[2] || "1";
        const newStart = match[3];
        const newCount = match[4] || "1";
        const suffix = match[5] || "";
        reversed[index] = `@@ -${newStart},${newCount} +${oldStart},${oldCount} @@${suffix}`;
      }
      continue;
    }
    if (line.startsWith("+++ ") || line.startsWith("--- ")) continue;
    if (line.startsWith("+")) {
      reversed[index] = `-${line.slice(1)}`;
      continue;
    }
    if (line.startsWith("-")) {
      reversed[index] = `+${line.slice(1)}`;
    }
  }

  return reversed.join("\n");
}

function getIdeToolCallArgs(toolCall: ToolCallLike): Record<string, unknown> | null {
  if (isPlainRecord(toolCall.args)) return toolCall.args;
  if (isPlainRecord(toolCall.arguments)) return toolCall.arguments;
  return null;
}

function getIdeToolCallCommand(toolCall: ToolCallLike): string | null {
  const args = getIdeToolCallArgs(toolCall);
  if (!args) return null;
  const directCommand =
    (typeof args.command === "string" && args.command.trim()) ||
    (typeof args.cmd === "string" && args.cmd.trim()) ||
    "";
  if (directCommand) return directCommand;

  const toolName = typeof toolCall.name === "string" ? toolCall.name : "tool";
  const path =
    typeof args.path === "string" && args.path.trim()
      ? args.path.trim()
      : typeof args.file === "string" && args.file.trim()
        ? args.file.trim()
        : "";
  const pattern = typeof args.pattern === "string" ? args.pattern.trim() : "";
  const query = typeof args.query === "string" ? args.query.trim() : "";

  if (pattern && path) return `${toolName} "${pattern}" ${path}`;
  if (query) return `${toolName} "${query}"`;
  if (path) return `${toolName} ${path}`;
  return null;
}

function getIdeToolCallResultSummary(
  toolCall: ToolCallLike,
  maxLength = 320
): string | null {
  const formatOutput = (value: string, maxChars = 2400, maxLines = 32): string => {
    const normalized = value.replace(/\r\n/g, "\n").trim();
    if (!normalized) return "";
    const lines = normalized.split("\n");
    let clipped = normalized;
    let truncated = false;
    if (lines.length > maxLines) {
      clipped = lines.slice(0, maxLines).join("\n");
      truncated = true;
    }
    if (clipped.length > maxChars) {
      clipped = `${clipped.slice(0, maxChars).trimEnd()}\n...`;
      truncated = true;
    }
    return truncated ? `${clipped}\n[output truncated]` : clipped;
  };

  const result = toolCall.result;
  if (typeof result === "string" && result.trim()) {
    const formatted = formatOutput(result);
    return formatted.length > maxLength && !formatted.includes("\n")
      ? `${formatted.slice(0, maxLength - 1)}…`
      : formatted;
  }
  if (!isPlainRecord(result)) return null;

  const keys = ["output", "stdout", "message", "error", "content", "diff"] as const;
  for (const key of keys) {
    const value = result[key];
    if (typeof value === "string" && value.trim()) {
      const formatted = formatOutput(value);
      return formatted.length > maxLength && !formatted.includes("\n")
        ? `${formatted.slice(0, maxLength - 1)}…`
        : formatted;
    }
  }
  return null;
}

function getIdeToolCallExitCode(toolCall: ToolCallLike): string | null {
  const result = toolCall.result;
  if (!isPlainRecord(result)) return null;
  const exitCode = result.exitCode;
  const code = result.code;
  if (typeof exitCode === "number" && Number.isFinite(exitCode)) return String(exitCode);
  if (typeof exitCode === "string" && exitCode.trim()) return exitCode.trim();
  if (typeof code === "number" && Number.isFinite(code)) return String(code);
  if (typeof code === "string" && code.trim()) return code.trim();
  return null;
}

function parseIdeTimestampMs(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim().length > 0) {
    const asNumber = Number(value);
    if (Number.isFinite(asNumber)) return asNumber;
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function normalizeIdeSandboxProviderValue(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().toLowerCase();
  if (
    normalized === "apple_sandbox" ||
    normalized === "podman" ||
    normalized === "docker" ||
    normalized === "host"
  ) {
    return normalized;
  }
  return undefined;
}

function formatIdeSandboxProviderLabel(provider: string): string {
  if (provider === "apple_sandbox") return "Apple Sandbox";
  if (provider === "podman") return "Podman";
  if (provider === "docker") return "Docker";
  if (provider === "host") return "Host";
  return provider;
}

function isGenericIdeStatusLabel(detail: string): boolean {
  const normalized = detail.trim().toLowerCase();
  if (!normalized) return false;
  return (
    normalized === "thinking..." ||
    normalized === "thinking" ||
    normalized === "generating response..." ||
    normalized === "generating response" ||
    normalized === "idle" ||
    normalized === "working..." ||
    normalized === "working"
  );
}

function isMeaningfulIdeThoughtDetail(detail: string): boolean {
  const normalized = detail.trim().toLowerCase();
  if (!normalized) return false;
  return !isGenericIdeStatusLabel(normalized);
}

function getLatestIdeInFlightStep(activities: LiveActivityItem[]): string | null {
  for (let index = activities.length - 1; index >= 0; index -= 1) {
    const activity = activities[index];
    if (!activity || activity.phase !== "start") continue;
    const step = activity.text?.trim() || "";
    if (!step || isGenericIdeStatusLabel(step)) continue;
    return step;
  }
  return null;
}

function toIdeLiveActivityItems(
  activities:
    | Array<{
        id?: string;
        phase?: "start" | "result" | "error";
        text?: string;
        timestamp?: number;
        toolName?: string;
        toolCallId?: string;
        sandboxProvider?: string;
      }>
    | undefined
): LiveActivityItem[] {
  if (!Array.isArray(activities) || activities.length === 0) return [];
  return activities
    .filter(
      (activity) =>
        !!activity &&
        typeof activity.id === "string" &&
        typeof activity.text === "string" &&
        typeof activity.timestamp === "number"
    )
    .sort((left, right) => left.timestamp - right.timestamp)
    .map((activity) => ({
      id: activity.id as string,
      phase: activity.phase === "start" || activity.phase === "error" ? activity.phase : "result",
      text: activity.text as string,
      timestamp: activity.timestamp as number,
      toolName: activity.toolName,
      toolCallId: activity.toolCallId,
      sandboxProvider: normalizeIdeSandboxProviderValue(activity.sandboxProvider),
    }));
}

function formatIdeStatusEventText(
  toolName: string | undefined,
  phase: "start" | "result" | "error",
  detail?: string
): string {
  const normalizedDetail = typeof detail === "string" ? detail.trim() : "";
  if (normalizedDetail && !isGenericIdeStatusLabel(normalizedDetail)) {
    return normalizeActivityTextForPhase(normalizedDetail, phase);
  }
  const label = toolName || "Tool";
  if (phase === "start") return `${label} running...`;
  if (phase === "result") return `${label} complete`;
  return `${label} failed`;
}

function getIdeHeaderTitle(sessionTitle: string | null, messages: IdeChatMessage[]): string {
  const normalizedSessionTitle = typeof sessionTitle === "string" ? sessionTitle.trim() : "";
  if (normalizedSessionTitle) return normalizedSessionTitle;
  const firstUserMessage = messages.find((message) => message.role === "user");
  if (!firstUserMessage?.content?.trim()) return "IDE Chat";
  const compact = firstUserMessage.content.trim().replace(/\s+/g, " ");
  return compact.length > 42 ? `${compact.slice(0, 39)}...` : compact;
}

function IdeActivityText({ text }: { text: string }) {
  const shouldHighlightCounters = /^(Edited|Created|Updated|Deleted)\b/i.test(text);
  if (!shouldHighlightCounters) {
    return <span className="whitespace-pre-wrap break-words">{text}</span>;
  }

  const parts = text.split(/(\s\+\d+\b|\s-\d+\b)/g);
  return (
    <span className="whitespace-pre-wrap break-words">
      {parts.map((part, index) => {
        if (/^\s\+\d+$/.test(part)) {
          return (
            <span key={`ide-activity-text:${index}`} className="text-emerald-300">
              {part}
            </span>
          );
        }
        if (/^\s-\d+$/.test(part)) {
          return (
            <span key={`ide-activity-text:${index}`} className="text-red-300">
              {part}
            </span>
          );
        }
        return <span key={`ide-activity-text:${index}`}>{part}</span>;
      })}
    </span>
  );
}

function IdeProcessActivityList({ activities }: { activities: LiveActivityItem[] }) {
  if (activities.length === 0) return null;
  const visibleActivities = activities.filter(
    (activity) => !isGenericIdeStatusLabel(activity.text)
  );
  if (visibleActivities.length === 0) return null;

  return (
    <div className="space-y-1">
      {visibleActivities.map((activity) => (
        <div
          key={activity.id}
          className={cn(
            "flex items-start gap-1.5 text-[12px] px-0.5",
            activity.toolName === "__thought" ? "text-gray-200" : "text-gray-400"
          )}
        >
          {activity.toolName === "__thought" ? (
            <Sparkles className="h-3 w-3 text-indigo-300 mt-0.5 flex-shrink-0" />
          ) : activity.phase === "start" ? (
            <Loader2 className="h-3 w-3 animate-spin text-amber-400 mt-0.5 flex-shrink-0" />
          ) : activity.phase === "result" ? (
            <CheckCircle2 className="h-3 w-3 text-emerald-400 mt-0.5 flex-shrink-0" />
          ) : (
            <AlertTriangle className="h-3 w-3 text-rose-400 mt-0.5 flex-shrink-0" />
          )}
          <div className="min-w-0 flex-1 flex items-center gap-2">
            <IdeActivityText text={activity.text} />
            {activity.toolName !== "__thought" && activity.sandboxProvider && (
              <span className="inline-flex items-center rounded border border-sky-400/30 bg-sky-400/10 px-1.5 py-0.5 text-[10px] leading-none text-sky-200">
                {formatIdeSandboxProviderLabel(activity.sandboxProvider)}
              </span>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

function IdeLiveActivityTimeline({
  status,
  activities,
  currentStep,
}: {
  status: "thinking" | "generating" | "idle";
  activities: LiveActivityItem[];
  currentStep?: string | null;
}) {
  const visibleActivities = activities.filter(
    (activity) => !isGenericIdeStatusLabel(activity.text)
  );
  const activeStartStep = getLatestIdeInFlightStep(visibleActivities);
  const explicitCurrentStep =
    typeof currentStep === "string" && currentStep.trim().length > 0 ? currentStep.trim() : null;
  const normalizedCurrentStep =
    explicitCurrentStep && !isGenericIdeStatusLabel(explicitCurrentStep)
      ? explicitCurrentStep
      : null;
  const displayCurrentStep = activeStartStep
    ? null
    : normalizedCurrentStep ||
      (status === "generating"
        ? "Generating response..."
        : status === "thinking"
          ? "Thinking..."
          : null);

  return (
    <div className="space-y-1">
      {visibleActivities.length > 0 && <IdeProcessActivityList activities={visibleActivities} />}
      {displayCurrentStep ? (
        <div className="flex items-start gap-2 text-[12px] px-0.5 text-gray-300">
          <Loader2 className="w-3 h-3 animate-spin text-amber-400 mt-0.5 flex-shrink-0" />
          <span className="whitespace-pre-wrap break-words">{displayCurrentStep}</span>
        </div>
      ) : visibleActivities.length === 0 ? (
        <div className="flex gap-1 px-1">
          <span
            className="w-1.5 h-1.5 rounded-full bg-gray-500 animate-bounce"
            style={{ animationDelay: "0ms" }}
          />
          <span
            className="w-1.5 h-1.5 rounded-full bg-gray-500 animate-bounce"
            style={{ animationDelay: "150ms" }}
          />
          <span
            className="w-1.5 h-1.5 rounded-full bg-gray-500 animate-bounce"
            style={{ animationDelay: "300ms" }}
          />
        </div>
      ) : null}
    </div>
  );
}

function IDEChatPanel({
  workspaceDir,
  contextPath,
  terminalContext,
  onWorkspaceMutated,
  onClose,
  selectedAgentId,
  onSelectedAgentIdChange,
  onPendingFileDiffsChange,
  onPendingFileDiffControllerChange,
}: {
  workspaceDir: string;
  contextPath: string | null;
  terminalContext?: { isOpen: boolean; sessionCount: number; activeSessionId: string | null };
  onWorkspaceMutated: () => void;
  onClose: () => void;
  selectedAgentId: string;
  onSelectedAgentIdChange: (agentId: string) => void;
  onPendingFileDiffsChange?: (diffs: IdePendingFileDiff[]) => void;
  onPendingFileDiffControllerChange?: (controller: IdePendingFileDiffController | null) => void;
}) {
  const stopAgent = useStopAgent();
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [sessionTitle, setSessionTitle] = useState<string | null>(null);
  const [activeAgentId, setActiveAgentId] = useState<string | null>(null);
  const [messages, setMessages] = useState<IdeChatMessage[]>([]);
  const [agents, setAgents] = useState<IdeChatAgentOption[]>([]);
  const [input, setInput] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [isReverting, setIsReverting] = useState(false);
  const [isApplyingDiffAction, setIsApplyingDiffAction] = useState(false);
  const [liveStatus, setLiveStatus] = useState<"thinking" | "generating" | "idle">("idle");
  const [liveActivities, setLiveActivities] = useState<LiveActivityItem[]>([]);
  const [liveCurrentStep, setLiveCurrentStep] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fileDiffDecision, setFileDiffDecision] = useState<Record<string, "accepted" | "rejected">>(
    {}
  );
  const [resolvedPendingDiffs, setResolvedPendingDiffs] = useState<Record<string, string>>({});
  const [expandedDiffs, setExpandedDiffs] = useState<Record<string, boolean>>({});
  const [collapseProgressUpdates, setCollapseProgressUpdates] = useState(false);
  const [copiedToolCallKey, setCopiedToolCallKey] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const activeRequestAbortRef = useRef<AbortController | null>(null);
  const activeSessionRef = useRef<string | null>(null);
  const sendingRef = useRef(false);
  const latestStatusTimestampBySessionRef = useRef<Record<string, number>>({});
  const liveRunBufferRef = useRef<LiveActivityItem[]>([]);

  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    list.scrollTop = list.scrollHeight;
  }, [liveActivities.length, messages, isSending]);

  useEffect(() => {
    activeSessionRef.current = sessionId;
    sendingRef.current = isSending;
  }, [isSending, sessionId]);

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
          onSelectedAgentIdChange(options[0]?.id || "");
        }
      } catch {
        // Keep chat usable with default agent fallback.
      }
    };
    void loadAgents();
    return () => {
      isCancelled = true;
    };
  }, [onSelectedAgentIdChange, selectedAgentId]);

  useEffect(() => {
    if (!selectedAgentId) return;
    if (agents.some((agent) => agent.id === selectedAgentId)) return;
    onSelectedAgentIdChange("");
  }, [agents, onSelectedAgentIdChange, selectedAgentId]);

  const getMessageKey = useCallback((message: IdeChatMessage, index: number): string => {
    return `${message.role}:${message.timestamp}:${index}`;
  }, []);

  const messageChangeSummaryByKey = useMemo(() => {
    const map = new Map<string, IdeFileChangeSummary>();
    messages.forEach((message, index) => {
      if (message.role !== "assistant") return;
      const toolSummary = summarizeIdeMessageFileChanges(message.tool_calls);
      const summary =
        toolSummary ||
        mergeIdeFileChangeSummaries(
          summarizeIdeActivityFileChanges(message.process_activities),
          summarizeIdeTextFileChanges(message.content)
        );
      if (!summary) return;
      map.set(getMessageKey(message, index), summary);
    });
    return map;
  }, [getMessageKey, messages]);

  const resolvedFileEntriesByMessageKey = useMemo(() => {
    const map = new Map<string, IdePendingFileDiff[]>();
    for (const [messageKey, summary] of messageChangeSummaryByKey.entries()) {
      map.set(
        messageKey,
        summary.files.map((file) => {
          const fileKey = getIdePendingFileDecisionKey(messageKey, file.path);
          return {
            key: fileKey,
            messageKey,
            path: file.path,
            type: file.type,
            added: file.added,
            removed: file.removed,
            diff:
              resolvedPendingDiffs[fileKey] ||
              (typeof file.diff === "string" ? file.diff : undefined),
          } satisfies IdePendingFileDiff;
        })
      );
    }
    return map;
  }, [messageChangeSummaryByKey, resolvedPendingDiffs]);

  const pendingFileDiffs = useMemo(() => {
    const items: IdePendingFileDiff[] = [];
    for (const files of resolvedFileEntriesByMessageKey.values()) {
      for (const file of files) {
        if (!fileDiffDecision[file.key]) {
          items.push(file);
        }
      }
    }
    return items;
  }, [fileDiffDecision, resolvedFileEntriesByMessageKey]);

  const pendingMessageChangeKeys = useMemo(() => {
    const keys: string[] = [];
    for (const [messageKey, files] of resolvedFileEntriesByMessageKey.entries()) {
      if (files.some((file) => !fileDiffDecision[file.key])) {
        keys.push(messageKey);
      }
    }
    return keys;
  }, [fileDiffDecision, resolvedFileEntriesByMessageKey]);

  const pendingChangeAggregate = useMemo(() => {
    const byPath = new Map<string, { added: number; removed: number }>();
    for (const file of pendingFileDiffs) {
      const existing = byPath.get(file.path) || { added: 0, removed: 0 };
      existing.added += file.added;
      existing.removed += file.removed;
      byPath.set(file.path, existing);
    }
    const files = Array.from(byPath.entries()).map(([path, values]) => ({
      path,
      ...values,
    }));
    return {
      fileCount: files.length,
      totalAdded: files.reduce((sum, file) => sum + file.added, 0),
      totalRemoved: files.reduce((sum, file) => sum + file.removed, 0),
    };
  }, [pendingFileDiffs]);

  const conversationTitle = useMemo(
    () => getIdeHeaderTitle(sessionTitle, messages),
    [messages, sessionTitle]
  );
  const conversationAgentLabel = useMemo(() => {
    const resolvedAgentId = activeAgentId || selectedAgentId;
    if (!resolvedAgentId) return "Default agent";
    const matchedAgent = agents.find((agent) => agent.id === resolvedAgentId);
    return matchedAgent?.name || resolvedAgentId;
  }, [activeAgentId, agents, selectedAgentId]);
  const showWorkingTimeline =
    isSending || liveStatus !== "idle" || liveActivities.length > 0 || !!liveCurrentStep;

  useEffect(() => {
    onPendingFileDiffsChange?.(pendingFileDiffs);
  }, [onPendingFileDiffsChange, pendingFileDiffs]);

  useEffect(() => {
    return () => {
      onPendingFileDiffsChange?.([]);
    };
  }, [onPendingFileDiffsChange]);

  useEffect(() => {
    const filesNeedingHydration = pendingFileDiffs.filter(
      (file) => !resolvedPendingDiffs[file.key] && shouldHydratePendingFileDiffFromGit(file)
    );
    if (filesNeedingHydration.length === 0) return;

    let isCancelled = false;
    const controller = new AbortController();

    const hydratePendingDiffs = async () => {
      for (const file of filesNeedingHydration) {
        try {
          const response = await apiFetch(`/api/git/diff?path=${encodeURIComponent(file.path)}`, {
            signal: controller.signal,
          });
          const payload = (await response.json()) as { success?: boolean; diff?: string };
          if (
            !response.ok ||
            !payload.success ||
            typeof payload.diff !== "string" ||
            !payload.diff.trim() ||
            payload.diff === "(No changes)" ||
            isCancelled
          ) {
            continue;
          }

          setResolvedPendingDiffs((previous) => {
            if (previous[file.key]) return previous;
            return { ...previous, [file.key]: payload.diff as string };
          });
        } catch (errorValue) {
          if ((errorValue as Error)?.name === "AbortError") {
            return;
          }
        }
      }
    };

    void hydratePendingDiffs();
    return () => {
      isCancelled = true;
      controller.abort();
    };
  }, [pendingFileDiffs, resolvedPendingDiffs]);

  const mapApiMessageToIde = useCallback((value: unknown): IdeChatMessage | null => {
    if (!isPlainRecord(value)) return null;
    const role = value.role === "assistant" || value.role === "user" ? value.role : null;
    const content = typeof value.content === "string" ? value.content : "";
    const timestamp =
      typeof value.timestamp === "string" && value.timestamp
        ? value.timestamp
        : new Date().toISOString();
    if (!role || !content.trim()) return null;

    const toolCalls = Array.isArray(value.tool_calls)
      ? value.tool_calls.filter((entry): entry is ToolCallLike => isIdeToolCallLike(entry))
      : undefined;
    const processActivities = Array.isArray(
      (value as { process_activities?: unknown }).process_activities
    )
      ? ((value as { process_activities?: unknown[] }).process_activities || [])
          .map((entry): IdeProcessActivity | null => {
            if (!isPlainRecord(entry)) return null;
            const phase =
              entry.phase === "start" || entry.phase === "result" || entry.phase === "error"
                ? entry.phase
                : "result";
            const text = typeof entry.text === "string" ? entry.text.trim() : "";
            const timestampRaw =
              typeof entry.timestamp === "number" && Number.isFinite(entry.timestamp)
                ? entry.timestamp
                : Date.now();
            if (!text) return null;
            return {
              id:
                typeof entry.id === "string" && entry.id.trim()
                  ? entry.id
                  : `${timestampRaw}-${Math.random().toString(36).slice(2, 8)}`,
              phase,
              text,
              timestamp: timestampRaw,
              toolName: typeof entry.toolName === "string" ? entry.toolName : undefined,
              toolCallId: typeof entry.toolCallId === "string" ? entry.toolCallId : undefined,
              sandboxProvider: normalizeIdeSandboxProviderValue(entry.sandboxProvider),
            };
          })
          .filter((entry): entry is IdeProcessActivity => entry !== null)
      : undefined;

    return {
      role,
      content,
      timestamp,
      thinking: typeof value.thinking === "string" ? value.thinking : undefined,
      tool_calls: toolCalls && toolCalls.length > 0 ? toolCalls : undefined,
      process_activities:
        processActivities && processActivities.length > 0 ? processActivities : undefined,
    };
  }, []);

  const clearLiveRunState = useCallback(() => {
    setLiveStatus("idle");
    setLiveCurrentStep(null);
    setLiveActivities([]);
    liveRunBufferRef.current = [];
  }, []);

  const appendLiveActivity = useCallback(
    (
      phase: "start" | "result" | "error",
      text: string,
      toolName?: string,
      eventTimestamp?: number,
      toolCallId?: string,
      sandboxProvider?: string
    ) => {
      const trimmed = text.trim();
      if (!trimmed) return;

      const normalizedText = normalizeActivityTextForPhase(trimmed, phase);
      if (isGenericIdeStatusLabel(normalizedText)) return;
      const nextTimestamp =
        typeof eventTimestamp === "number" && Number.isFinite(eventTimestamp)
          ? eventTimestamp
          : Date.now();
      const normalizedToolName = typeof toolName === "string" ? toolName.trim().toLowerCase() : "";
      const normalizedToolCallId =
        typeof toolCallId === "string" && toolCallId.trim() ? toolCallId.trim().toLowerCase() : "";
      const normalizedSandboxProvider = normalizeIdeSandboxProviderValue(sandboxProvider);

      const sortAndMergeActivities = (items: LiveActivityItem[]): LiveActivityItem[] =>
        mergeActivityLists(
          [],
          [...items].sort((left, right) =>
            left.timestamp === right.timestamp
              ? left.id.localeCompare(right.id)
              : left.timestamp - right.timestamp
          )
        );

      const applyActivityEvent = (previous: LiveActivityItem[]): LiveActivityItem[] => {
        if (phase !== "start") {
          if (normalizedToolCallId) {
            for (let index = previous.length - 1; index >= 0; index -= 1) {
              const candidate = previous[index];
              if (candidate.phase !== "start") continue;
              if ((candidate.toolCallId || "").trim().toLowerCase() !== normalizedToolCallId) {
                continue;
              }
              if (nextTimestamp - candidate.timestamp > 60_000) continue;
              const updated = [...previous];
              updated[index] = {
                ...candidate,
                phase,
                text: normalizedText,
                timestamp: nextTimestamp,
                toolName: normalizedToolName || candidate.toolName,
                toolCallId: normalizedToolCallId,
                sandboxProvider: normalizedSandboxProvider || candidate.sandboxProvider,
              };
              return sortAndMergeActivities(updated);
            }
          }

          if (normalizedToolName) {
            for (let index = previous.length - 1; index >= 0; index -= 1) {
              const candidate = previous[index];
              if (candidate.phase !== "start") continue;
              if ((candidate.toolName || "").trim().toLowerCase() !== normalizedToolName) continue;
              if (nextTimestamp - candidate.timestamp > 60_000) continue;
              const updated = [...previous];
              updated[index] = {
                ...candidate,
                phase,
                text: normalizedText,
                timestamp: nextTimestamp,
                toolName: normalizedToolName,
                toolCallId: normalizedToolCallId || candidate.toolCallId,
                sandboxProvider: normalizedSandboxProvider || candidate.sandboxProvider,
              };
              return sortAndMergeActivities(updated);
            }
          }
        }

        const previousLast = previous[previous.length - 1];
        if (
          previousLast &&
          previousLast.phase === phase &&
          normalizeActivityTextForPhase(previousLast.text, phase) === normalizedText &&
          (normalizedToolCallId
            ? (previousLast.toolCallId || "").trim().toLowerCase() === normalizedToolCallId
            : true) &&
          (normalizedToolName
            ? (previousLast.toolName || "").trim().toLowerCase() === normalizedToolName
            : true) &&
          nextTimestamp - previousLast.timestamp < 750
        ) {
          return previous;
        }

        const next: LiveActivityItem = {
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          phase,
          text: normalizedText,
          timestamp: nextTimestamp,
          toolName: normalizedToolName || undefined,
          toolCallId: normalizedToolCallId || undefined,
          sandboxProvider: normalizedSandboxProvider,
        };
        return sortAndMergeActivities([...previous, next]);
      };

      liveRunBufferRef.current = applyActivityEvent(liveRunBufferRef.current);
      setLiveActivities((previous) => applyActivityEvent(previous));
    },
    []
  );

  const hydrateSessionStatus = useCallback(
    async (targetSessionId?: string | null) => {
      const resolvedSessionId =
        typeof targetSessionId === "string" && targetSessionId.trim().length > 0
          ? targetSessionId.trim()
          : null;
      if (!resolvedSessionId) return;

      try {
        const response = await chatApi.getSessionStatus(resolvedSessionId);
        if (!response.success || !response.data) return;
        if (activeSessionRef.current !== resolvedSessionId) return;

        const snapshot = response.data.session;
        if (!snapshot) {
          if (!sendingRef.current) {
            clearLiveRunState();
          }
          return;
        }

        if (typeof snapshot.agentId === "string" && snapshot.agentId.trim()) {
          setActiveAgentId(snapshot.agentId.trim());
        }

        const snapshotActivities = toIdeLiveActivityItems(snapshot.activities);
        if (snapshotActivities.length > 0) {
          setLiveActivities(snapshotActivities);
          liveRunBufferRef.current = snapshotActivities.map((activity) => ({ ...activity }));
        } else if (!sendingRef.current) {
          setLiveActivities([]);
          liveRunBufferRef.current = [];
        }

        const latestTimestamp = Math.max(
          typeof snapshot.timestamp === "number" && Number.isFinite(snapshot.timestamp)
            ? snapshot.timestamp
            : 0,
          ...snapshotActivities.map((activity) => activity.timestamp)
        );
        if (latestTimestamp > 0) {
          latestStatusTimestampBySessionRef.current[resolvedSessionId] = latestTimestamp;
        }

        const nextStatus =
          snapshot.status === "generating"
            ? "generating"
            : snapshot.status === "idle"
              ? "idle"
              : "thinking";
        setLiveStatus(nextStatus);

        const detail = typeof snapshot.detail === "string" ? snapshot.detail.trim() : "";
        const activeStep = getLatestIdeInFlightStep(snapshotActivities);
        if (activeStep && !isGenericIdeStatusLabel(activeStep)) {
          setLiveCurrentStep(activeStep);
        } else if (isMeaningfulIdeThoughtDetail(detail)) {
          setLiveCurrentStep(detail);
        } else if (nextStatus === "generating") {
          setLiveCurrentStep("Generating response...");
        } else if (nextStatus === "thinking") {
          setLiveCurrentStep("Thinking...");
        } else if (!sendingRef.current) {
          setLiveCurrentStep(null);
        }
      } catch {
        // Keep the IDE chat usable if status hydration fails.
      }
    },
    [clearLiveRunState]
  );

  useEffect(() => {
    if (!selectedAgentId || sessionId) return;
    setActiveAgentId(selectedAgentId);
  }, [selectedAgentId, sessionId]);

  useEffect(() => {
    if (!sessionId) {
      setSessionTitle(null);
      setActiveAgentId(selectedAgentId || null);
      clearLiveRunState();
      return;
    }

    let isCancelled = false;
    const hydrateSessionMeta = async () => {
      try {
        const response = await chatApi.getSession(sessionId);
        if (!response.success || !response.data || isCancelled) return;
        setSessionTitle(
          typeof response.data.title === "string" && response.data.title.trim()
            ? response.data.title.trim()
            : null
        );
        if (typeof response.data.agent_id === "string" && response.data.agent_id.trim()) {
          setActiveAgentId(response.data.agent_id.trim());
        }
      } catch {
        if (!isCancelled) {
          setSessionTitle(null);
        }
      }
    };

    void hydrateSessionMeta();
    void hydrateSessionStatus(sessionId);

    return () => {
      isCancelled = true;
    };
  }, [clearLiveRunState, hydrateSessionStatus, selectedAgentId, sessionId]);

  useEffect(() => {
    const disconnect = connectStatusStream({
      onEvent: (payload) => {
        if (!payload || typeof payload !== "object") return;
        if (payload.type === "snapshot") {
          const activeSession = activeSessionRef.current;
          if (activeSession) {
            void hydrateSessionStatus(activeSession);
          }
          return;
        }
        if (payload.type !== "status") return;

        const activeSession = activeSessionRef.current;
        const payloadSessionId =
          typeof payload.sessionId === "string" && payload.sessionId.trim()
            ? payload.sessionId.trim()
            : null;
        if (!activeSession || !payloadSessionId || payloadSessionId !== activeSession) return;

        const payloadTimestamp =
          typeof payload.timestamp === "number" && Number.isFinite(payload.timestamp)
            ? payload.timestamp
            : 0;
        if (payloadTimestamp > 0) {
          const previousTimestamp =
            latestStatusTimestampBySessionRef.current[payloadSessionId] || 0;
          if (payloadTimestamp < previousTimestamp) {
            return;
          }
          latestStatusTimestampBySessionRef.current[payloadSessionId] = payloadTimestamp;
        }

        if (typeof payload.agentId === "string" && payload.agentId.trim()) {
          setActiveAgentId(payload.agentId.trim());
        }

        if (payload.status === "thinking" || payload.status === "generating") {
          const nextStatus = payload.status === "generating" ? "generating" : "thinking";
          setLiveStatus(nextStatus);
          if (!payload.toolName) {
            const activeStep = getLatestIdeInFlightStep(liveRunBufferRef.current);
            const detail = typeof payload.detail === "string" ? payload.detail.trim() : "";
            if (isMeaningfulIdeThoughtDetail(detail)) {
              appendLiveActivity("result", detail, "__thought", payloadTimestamp);
              setLiveCurrentStep(activeStep || detail);
            } else {
              setLiveCurrentStep(
                activeStep ||
                  (nextStatus === "generating" ? "Generating response..." : "Thinking...")
              );
            }
          }
          return;
        }

        if (payload.status === "idle") {
          setLiveStatus("idle");
          if (!sendingRef.current) {
            clearLiveRunState();
          }
          return;
        }

        if (
          payload.status === "tool_executing" ||
          payload.status === "tool_completed" ||
          payload.status === "error"
        ) {
          const phase: "start" | "result" | "error" =
            payload.status === "tool_executing"
              ? "start"
              : payload.status === "tool_completed"
                ? "result"
                : "error";
          const text = formatIdeStatusEventText(payload.toolName, phase, payload.detail);
          appendLiveActivity(
            phase,
            text,
            payload.toolName,
            payloadTimestamp || undefined,
            payload.toolCallId,
            payload.sandboxProvider
          );
          setLiveStatus("thinking");
          if (phase === "start") {
            setLiveCurrentStep(isGenericIdeStatusLabel(text) ? "Thinking..." : text);
          } else {
            setLiveCurrentStep(getLatestIdeInFlightStep(liveRunBufferRef.current));
          }
        }
      },
    });

    return () => {
      disconnect();
    };
  }, [appendLiveActivity, clearLiveRunState, hydrateSessionStatus]);

  useEffect(() => {
    return () => {
      activeRequestAbortRef.current?.abort();
      activeRequestAbortRef.current = null;
    };
  }, []);

  const handleSend = useCallback(async () => {
    const trimmed = input.trim();
    const sessionCurrentlyActive =
      liveStatus !== "idle" || liveActivities.length > 0 || !!liveCurrentStep;
    if (!trimmed || isSending || isReverting || sessionCurrentlyActive) return;

    activeRequestAbortRef.current?.abort();
    const controller = new AbortController();
    activeRequestAbortRef.current = controller;
    const requestSessionId = sessionId || crypto.randomUUID();

    const userMessage: IdeChatMessage = {
      role: "user",
      content: trimmed,
      timestamp: new Date().toISOString(),
    };
    setSessionId(requestSessionId);
    setMessages((previous) => [...previous, userMessage]);
    setInput("");
    setIsSending(true);
    setError(null);
    setActiveAgentId(selectedAgentId || activeAgentId);
    setLiveStatus("thinking");
    setLiveCurrentStep("Thinking...");
    setLiveActivities([]);
    liveRunBufferRef.current = [];
    latestStatusTimestampBySessionRef.current[requestSessionId] = 0;

    const contextParts: string[] = [];
    if (contextPath) {
      contextParts.push(`Current IDE file context: ${contextPath}`);
    }
    if (terminalContext?.isOpen) {
      contextParts.push(
        `IDE terminal context: open (${terminalContext.sessionCount} session${terminalContext.sessionCount === 1 ? "" : "s"})${terminalContext.activeSessionId ? `, active=${terminalContext.activeSessionId}` : ""}`
      );
    }
    const contextualPrompt =
      contextParts.length > 0 ? `${trimmed}\n\n${contextParts.join("\n")}` : trimmed;

    try {
      const response = await chatApi.send(
        contextualPrompt,
        selectedAgentId || undefined,
        requestSessionId,
        workspaceDir || null,
        controller.signal
      );
      if (activeRequestAbortRef.current !== controller) return;
      if (!response.success || !response.data) {
        clearLiveRunState();
        setError(response.error || "Failed to send message");
        return;
      }
      setSessionId(response.data.sessionId || requestSessionId);
      const mappedAssistant = mapApiMessageToIde(response.data.message);
      const bufferedActivities = finalizeCompletedActivities(
        mergeActivityLists([], liveRunBufferRef.current)
      );
      const assistantMessageBase: IdeChatMessage =
        mappedAssistant ||
        ({
          role: "assistant",
          content: response.data.message?.content || "(No assistant response)",
          timestamp: new Date().toISOString(),
        } satisfies IdeChatMessage);
      const toolFallbackActivities =
        bufferedActivities.length === 0
          ? finalizeCompletedActivities(
              buildActivitiesFromToolCalls(
                assistantMessageBase.tool_calls,
                (toolName, _args, phase) => formatIdeStatusEventText(toolName, phase)
              )
            )
          : [];
      const resolvedFallbackActivities =
        bufferedActivities.length > 0 ? bufferedActivities : toolFallbackActivities;
      const assistantMessage: IdeChatMessage =
        !assistantMessageBase.process_activities ||
        assistantMessageBase.process_activities.length === 0
          ? resolvedFallbackActivities.length > 0
            ? {
                ...assistantMessageBase,
                process_activities: resolvedFallbackActivities.map((activity) => ({ ...activity })),
              }
            : assistantMessageBase
          : assistantMessageBase;
      setMessages((previous) => [...previous, assistantMessage]);
      clearLiveRunState();
    } catch (sendError) {
      clearLiveRunState();
      const isAbortError =
        sendError instanceof DOMException
          ? sendError.name === "AbortError"
          : !!sendError &&
            typeof sendError === "object" &&
            "name" in sendError &&
            (sendError as { name?: string }).name === "AbortError";
      if (isAbortError) return;
      setError(String(sendError));
    } finally {
      if (activeRequestAbortRef.current === controller) {
        activeRequestAbortRef.current = null;
      }
      setIsSending(false);
    }
  }, [
    activeAgentId,
    clearLiveRunState,
    contextPath,
    input,
    isReverting,
    isSending,
    liveActivities.length,
    liveCurrentStep,
    liveStatus,
    mapApiMessageToIde,
    selectedAgentId,
    sessionId,
    terminalContext,
    workspaceDir,
  ]);

  const handleStopActive = useCallback(async () => {
    activeRequestAbortRef.current?.abort();
    activeRequestAbortRef.current = null;
    setIsSending(false);
    clearLiveRunState();
    const targetAgentId = activeAgentId || selectedAgentId || null;
    if (!targetAgentId) return;
    try {
      await stopAgent.mutateAsync(targetAgentId);
    } catch {
      // Keep the UI responsive even if the stop request fails.
    }
  }, [activeAgentId, clearLiveRunState, selectedAgentId, stopAgent]);

  const handleNewChat = useCallback(() => {
    activeRequestAbortRef.current?.abort();
    activeRequestAbortRef.current = null;
    setSessionId(null);
    setSessionTitle(null);
    setActiveAgentId(selectedAgentId || null);
    setMessages([]);
    setInput("");
    setIsSending(false);
    setError(null);
    setFileDiffDecision({});
    setResolvedPendingDiffs({});
    setExpandedDiffs({});
    clearLiveRunState();
  }, [clearLiveRunState, selectedAgentId]);

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
        setFileDiffDecision({});
        setResolvedPendingDiffs({});
        setExpandedDiffs({});
        setInput(target.content);
      } catch (revertError) {
        setError(String(revertError));
      } finally {
        setIsReverting(false);
      }
    },
    [isReverting, isSending, mapApiMessageToIde, messages, sessionId]
  );

  const setDecisionForFileKeys = useCallback((keys: string[], decision: "accepted" | "rejected") => {
    if (keys.length === 0) return;
    setFileDiffDecision((previous) => {
      const next = { ...previous };
      for (const key of keys) {
        next[key] = decision;
      }
      return next;
    });
  }, []);

  const applyReversePatchForFiles = useCallback(
    async (files: IdePendingFileDiff[]): Promise<boolean> => {
      const patchParts: string[] = [];
      for (const file of files) {
        const diff = typeof file.diff === "string" ? file.diff : "";
        if (!diff.trim()) continue;
        const reversePatch = reverseUnifiedDiff(diff, file.type);
        if (!reversePatch) {
          setError(`Cannot auto-reject ${file.path} because its diff is missing or truncated.`);
          return false;
        }
        patchParts.push(reversePatch.trimEnd());
      }

      if (patchParts.length === 0) {
        setError("No reversible file diffs found for this selection.");
        return false;
      }

      setIsApplyingDiffAction(true);
      setError(null);
      try {
        const response = await apiFetch("/api/tools/execute", {
          method: "POST",
          body: JSON.stringify({
            name: "apply_patch",
            args: { patch: `${patchParts.join("\n\n")}\n` },
            context: {
              workspaceDir,
              sessionId: sessionId || "ide-chat",
              agentId: selectedAgentId || "ide-chat",
              channel: "ide",
              userId: "ide-user",
              allowDangerousTools: true,
            },
          }),
        });
        const payload = (await response.json()) as Record<string, unknown>;
        if (!response.ok) {
          const message =
            typeof payload.error === "string" && payload.error.trim()
              ? payload.error
              : "Failed to apply reverse patch.";
          setError(message);
          return false;
        }
        if (payload.success === false) {
          const failed = Array.isArray(payload.failed)
            ? payload.failed
                .map((entry) =>
                  isPlainRecord(entry) && typeof entry.error === "string" ? entry.error : null
                )
                .filter((entry): entry is string => !!entry)
            : [];
          const message = failed.length > 0 ? failed.join(" | ") : "Failed to apply reverse patch.";
          setError(message);
          return false;
        }

        onWorkspaceMutated();
        return true;
      } catch (applyError) {
        setError(String(applyError));
        return false;
      } finally {
        setIsApplyingDiffAction(false);
      }
    },
    [onWorkspaceMutated, selectedAgentId, sessionId, workspaceDir]
  );

  const getPendingFilesForMessage = useCallback(
    (messageKey: string): IdePendingFileDiff[] =>
      (resolvedFileEntriesByMessageKey.get(messageKey) || []).filter((file) => !fileDiffDecision[file.key]),
    [fileDiffDecision, resolvedFileEntriesByMessageKey]
  );

  const handleAcceptFileChange = useCallback(
    (fileKey: string) => {
      setDecisionForFileKeys([fileKey], "accepted");
    },
    [setDecisionForFileKeys]
  );

  const handleAcceptMessageChanges = useCallback(
    (messageKey: string) => {
      const files = getPendingFilesForMessage(messageKey);
      if (files.length === 0) return;
      setDecisionForFileKeys(
        files.map((file) => file.key),
        "accepted"
      );
    },
    [getPendingFilesForMessage, setDecisionForFileKeys]
  );

  const handleAcceptAllMessageChanges = useCallback(() => {
    if (pendingFileDiffs.length === 0) return;
    setDecisionForFileKeys(
      pendingFileDiffs.map((file) => file.key),
      "accepted"
    );
  }, [pendingFileDiffs, setDecisionForFileKeys]);

  const handleRejectFileChange = useCallback(
    async (fileKey: string) => {
      if (isSending || isReverting || isApplyingDiffAction) return;
      const file = pendingFileDiffs.find((entry) => entry.key === fileKey);
      if (!file) return;
      const confirmed = window.confirm(
        `Reject changes for ${file.path}? Cybara will apply a reverse patch to undo them.`
      );
      if (!confirmed) return;
      const ok = await applyReversePatchForFiles([file]);
      if (ok) {
        setDecisionForFileKeys([file.key], "rejected");
      }
    },
    [applyReversePatchForFiles, isApplyingDiffAction, isReverting, isSending, pendingFileDiffs, setDecisionForFileKeys]
  );

  const handleRejectMessageChanges = useCallback(
    async (messageKey: string) => {
      if (isSending || isReverting || isApplyingDiffAction) return;
      const files = getPendingFilesForMessage(messageKey);
      if (files.length === 0) return;
      const confirmed = window.confirm(
        "Reject these file changes? Cybara will apply a reverse patch to undo them."
      );
      if (!confirmed) return;
      const ok = await applyReversePatchForFiles(files);
      if (ok) {
        setDecisionForFileKeys(
          files.map((file) => file.key),
          "rejected"
        );
      }
    },
    [
      applyReversePatchForFiles,
      getPendingFilesForMessage,
      isApplyingDiffAction,
      isReverting,
      isSending,
      setDecisionForFileKeys,
    ]
  );

  const handleRejectAllMessageChanges = useCallback(async () => {
    if (pendingFileDiffs.length === 0 || isSending || isReverting || isApplyingDiffAction) {
      return;
    }
    const confirmed = window.confirm(
      `Reject all pending file changes (${pendingFileDiffs.length} file${pendingFileDiffs.length === 1 ? "" : "s"})?`
    );
    if (!confirmed) return;
    const ok = await applyReversePatchForFiles(pendingFileDiffs);
    if (ok) {
      setDecisionForFileKeys(
        pendingFileDiffs.map((file) => file.key),
        "rejected"
      );
    }
  }, [
    applyReversePatchForFiles,
    isApplyingDiffAction,
    isReverting,
    isSending,
    pendingFileDiffs,
    setDecisionForFileKeys,
  ]);

  const handleCopyToolCommand = useCallback(async (key: string, command: string) => {
    if (!command.trim()) return;
    try {
      await navigator.clipboard.writeText(command);
      setCopiedToolCallKey(key);
      window.setTimeout(() => {
        setCopiedToolCallKey((current) => (current === key ? null : current));
      }, 1500);
    } catch {
      // noop
    }
  }, []);

  useEffect(() => {
    onPendingFileDiffControllerChange?.({
      items: pendingFileDiffs,
      acceptFile: handleAcceptFileChange,
      rejectFile: handleRejectFileChange,
      acceptAll: handleAcceptAllMessageChanges,
      rejectAll: handleRejectAllMessageChanges,
    });
  }, [
    handleAcceptAllMessageChanges,
    handleAcceptFileChange,
    handleRejectAllMessageChanges,
    handleRejectFileChange,
    onPendingFileDiffControllerChange,
    pendingFileDiffs,
  ]);

  useEffect(() => {
    return () => {
      onPendingFileDiffControllerChange?.(null);
    };
  }, [onPendingFileDiffControllerChange]);

  return (
    <div className="h-full flex flex-col bg-[#0a0a12]">
      <div className="px-3 py-2 border-b border-white/10 flex items-start justify-between gap-3">
        <div className="min-w-0 flex items-start gap-2 text-xs text-gray-300">
          <div className="mt-0.5 rounded-md border border-indigo-500/30 bg-indigo-500/10 p-1.5">
            <MessageSquare className="w-3.5 h-3.5 text-indigo-300" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="truncate font-medium text-gray-100">{conversationTitle}</span>
              {showWorkingTimeline && (
                <span className="rounded border border-emerald-500/30 bg-emerald-500/10 px-1.5 py-0.5 text-[10px] text-emerald-200">
                  Working
                </span>
              )}
            </div>
            <div className="mt-0.5 flex items-center gap-2 text-[10px] text-gray-500">
              <span>{conversationAgentLabel}</span>
              {sessionId && (
                <span className="font-mono text-gray-600">{sessionId.slice(0, 8)}</span>
              )}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {showWorkingTimeline && (
            <button
              type="button"
              onClick={() => void handleStopActive()}
              disabled={stopAgent.isPending}
              className="inline-flex h-7 items-center gap-1 rounded border border-red-500/30 bg-red-500/10 px-2 text-[11px] text-red-200 hover:bg-red-500/20 disabled:opacity-50"
              title="Stop active run"
            >
              {stopAgent.isPending ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Square className="w-3.5 h-3.5" />
              )}
              Stop
            </button>
          )}
          <button
            type="button"
            onClick={() => setCollapseProgressUpdates((previous) => !previous)}
            className="h-7 px-2 rounded text-[11px] text-gray-400 hover:text-gray-200 hover:bg-white/5"
            title={
              collapseProgressUpdates ? "Expand progress updates" : "Collapse progress updates"
            }
          >
            {collapseProgressUpdates ? "Expand all" : "Collapse all"}
          </button>
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
        <div
          className="px-3 py-2 border-b border-white/10 text-[11px] text-gray-500 truncate"
          title={contextPath}
        >
          Context: {contextPath}
        </div>
      )}

      <div ref={listRef} className="flex-1 overflow-y-auto px-3 py-2 space-y-2">
        {messages.length === 0 ? (
          <div className="text-xs text-gray-500">
            Ask about the current workspace or file. This panel shares session context while open.
          </div>
        ) : (
          messages.map((message, index) =>
            (() => {
              const messageKey = getMessageKey(message, index);
              const changeSummary =
                message.role === "assistant"
                  ? messageChangeSummaryByKey.get(messageKey) || null
                  : null;
              const resolvedMessageFiles =
                message.role === "assistant"
                  ? resolvedFileEntriesByMessageKey.get(messageKey) || []
                  : [];
              const pendingMessageFiles = resolvedMessageFiles.filter(
                (file) => !fileDiffDecision[file.key]
              );
              const acceptedMessageFiles = resolvedMessageFiles.filter(
                (file) => fileDiffDecision[file.key] === "accepted"
              ).length;
              const rejectedMessageFiles = resolvedMessageFiles.filter(
                (file) => fileDiffDecision[file.key] === "rejected"
              ).length;
              const messageResolutionLabel =
                pendingMessageFiles.length > 0 || resolvedMessageFiles.length === 0
                  ? null
                  : acceptedMessageFiles === resolvedMessageFiles.length
                    ? "Accepted"
                    : rejectedMessageFiles === resolvedMessageFiles.length
                      ? "Rejected"
                      : "Resolved";
              const processActivities =
                message.role === "assistant" && Array.isArray(message.process_activities)
                  ? message.process_activities
                  : [];
              const orderedToolCalls =
                message.role === "assistant" && Array.isArray(message.tool_calls)
                  ? getIdeToolCallsInTimelineOrder(message.tool_calls)
                  : [];
              const richToolCalls = orderedToolCalls.filter((toolCall) => {
                return (
                  !!getIdeToolCallCommand(toolCall) ||
                  !!getIdeToolCallResultSummary(toolCall) ||
                  getIdeToolCallExitCode(toolCall) !== null
                );
              });
              return (
                <div
                  key={messageKey}
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
                          disabled={isReverting || isSending || isApplyingDiffAction}
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
                  {message.role === "assistant" ? (
                    <div className="text-[12px] leading-6">
                      <ReactMarkdown remarkPlugins={[remarkGfm]} components={ideMarkdownComponents}>
                        {message.content}
                      </ReactMarkdown>
                    </div>
                  ) : (
                    <div>{message.content}</div>
                  )}

                  {message.role === "assistant" && message.thinking && (
                    <div className="mt-2 rounded border border-indigo-500/20 bg-indigo-500/10 px-2 py-1 text-[11px] text-indigo-200">
                      {message.thinking}
                    </div>
                  )}

                  {message.role === "assistant" && changeSummary && (
                    <div className="mt-2 rounded border border-white/10 bg-black/25 px-2 py-1.5">
                      <div className="text-[10px] uppercase tracking-wide text-gray-500">
                        Files Edited
                      </div>
                      <div className="mt-1 space-y-1">
                        {resolvedMessageFiles.map((file) => (
                          <div
                            key={`${messageKey}:files-edited:${file.path}`}
                            className="flex items-center justify-between gap-2 text-[11px]"
                          >
                            <span className="truncate text-gray-200" title={file.path}>
                              {file.path}
                            </span>
                            <span className="shrink-0 text-gray-500">
                              <span className="text-emerald-300">+{file.added}</span>{" "}
                              <span className="text-red-300">-{file.removed}</span>
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {message.role === "assistant" &&
                    (processActivities.length > 0 || richToolCalls.length > 0) && (
                      <div className="mt-2 rounded border border-white/10 bg-black/25 px-2 py-1.5">
                        <div className="flex items-center justify-between gap-2">
                          <div className="text-[10px] uppercase tracking-wide text-gray-500">
                            Progress Updates
                          </div>
                          <button
                            type="button"
                            onClick={() => setCollapseProgressUpdates((previous) => !previous)}
                            className="text-[10px] text-gray-500 hover:text-gray-300"
                            title={
                              collapseProgressUpdates
                                ? "Expand all progress updates"
                                : "Collapse all progress updates"
                            }
                          >
                            {collapseProgressUpdates ? "Expand all" : "Collapse all"}
                          </button>
                        </div>
                        {!collapseProgressUpdates && (
                          <div className="mt-1 space-y-2">
                            {processActivities.length > 0 && (
                              <div className="rounded border border-white/10 bg-black/30 px-2 py-2">
                                <IdeProcessActivityList activities={processActivities} />
                              </div>
                            )}
                            {richToolCalls.map((toolCall, toolIndex) => {
                              const toolKey = `${messageKey}:tool:${toolCall.id || toolIndex}`;
                              const toolName =
                                typeof toolCall.name === "string" ? toolCall.name : "tool";
                              const toolStatus =
                                typeof toolCall.status === "string" ? toolCall.status : "completed";
                              const command = getIdeToolCallCommand(toolCall);
                              const resultSummary = getIdeToolCallResultSummary(toolCall);
                              const exitCode = getIdeToolCallExitCode(toolCall);
                              return (
                                <div
                                  key={toolKey}
                                  className="rounded border border-white/10 bg-black/35 px-2 py-1.5"
                                >
                                  <div className="flex items-center justify-between gap-2 text-[10px] text-gray-500">
                                    <span className="uppercase tracking-wide">
                                      {command ? "Ran command" : toolName}
                                    </span>
                                    <span>{toolStatus}</span>
                                  </div>
                                  {command && (
                                    <div className="mt-1 rounded border border-white/10 bg-black/40 px-2 py-1 font-mono text-[11px] text-gray-200 whitespace-pre-wrap break-words">
                                      <div className="flex items-start justify-between gap-2">
                                        <span className="break-all">{command}</span>
                                        <button
                                          type="button"
                                          onClick={() =>
                                            void handleCopyToolCommand(toolKey, command)
                                          }
                                          className="shrink-0 rounded border border-white/10 p-1 text-gray-400 hover:text-gray-200 hover:bg-white/5"
                                          title={
                                            copiedToolCallKey === toolKey
                                              ? "Copied"
                                              : "Copy command"
                                          }
                                        >
                                          <Copy className="w-3 h-3" />
                                        </button>
                                      </div>
                                    </div>
                                  )}
                                  {resultSummary && (
                                    <div className="mt-1 max-h-52 overflow-auto rounded border border-white/10 bg-[#06060b] px-2 py-1.5 font-mono text-[10px] leading-5 text-gray-300 whitespace-pre-wrap break-words">
                                      {resultSummary}
                                    </div>
                                  )}
                                  <div className="mt-1 flex items-center justify-between gap-2 text-[10px] text-gray-500">
                                    <span>
                                      {exitCode !== null ? `Exit code ${exitCode}` : "Completed"}
                                    </span>
                                    {copiedToolCallKey === toolKey && (
                                      <span className="text-emerald-300">Copied</span>
                                    )}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    )}

                  {message.role === "assistant" && changeSummary && (
                    <div className="mt-2 rounded border border-white/10 bg-black/35 px-2 py-2">
                      <div className="flex items-center justify-between gap-2">
                        <div className="text-[11px] text-gray-300">
                          Edited files {resolvedMessageFiles.length}{" "}
                          <span className="text-emerald-300">+{changeSummary.totalAdded}</span>{" "}
                          <span className="text-red-300">-{changeSummary.totalRemoved}</span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          {messageResolutionLabel ? (
                            <span
                              className={cn(
                                "text-[10px] px-1.5 py-0.5 rounded border",
                                messageResolutionLabel === "Accepted"
                                  ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-200"
                                  : messageResolutionLabel === "Rejected"
                                    ? "border-red-500/30 bg-red-500/10 text-red-200"
                                    : "border-white/15 bg-white/5 text-gray-300"
                              )}
                            >
                              {messageResolutionLabel}
                            </span>
                          ) : (
                            <>
                              <button
                                type="button"
                                onClick={() => handleAcceptMessageChanges(messageKey)}
                                disabled={
                                  pendingMessageFiles.length === 0 ||
                                  isSending ||
                                  isReverting ||
                                  isApplyingDiffAction
                                }
                                className="inline-flex items-center rounded border border-emerald-500/30 bg-emerald-500/10 px-1.5 py-0.5 text-[10px] text-emerald-200 hover:bg-emerald-500/20 disabled:opacity-50"
                                title="Accept these file changes"
                              >
                                <Check className="w-3 h-3 mr-1" />
                                Accept
                              </button>
                              <button
                                type="button"
                                onClick={() => void handleRejectMessageChanges(messageKey)}
                                disabled={
                                  pendingMessageFiles.length === 0 ||
                                  isSending ||
                                  isReverting ||
                                  isApplyingDiffAction
                                }
                                className="inline-flex items-center rounded border border-red-500/30 bg-red-500/10 px-1.5 py-0.5 text-[10px] text-red-200 hover:bg-red-500/20 disabled:opacity-50"
                                title="Reject and undo these file changes"
                              >
                                {isApplyingDiffAction ? (
                                  <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                                ) : (
                                  <RotateCcw className="w-3 h-3 mr-1" />
                                )}
                                Reject
                              </button>
                            </>
                          )}
                        </div>
                      </div>
                      <div className="mt-2 space-y-1.5">
                        {resolvedMessageFiles.map((file) => {
                          const diffKey = `${messageKey}:${file.path}`;
                          const isExpanded = !!expandedDiffs[diffKey];
                          const fileDecision = fileDiffDecision[file.key];
                          return (
                            <div
                              key={`${messageKey}:file:${file.path}`}
                              className="rounded border border-white/10 bg-black/30"
                            >
                              <div className="flex items-center justify-between gap-2 px-2 py-1.5 text-[11px]">
                                <div className="min-w-0">
                                  <div className="truncate text-gray-200" title={file.path}>
                                    {file.path}
                                  </div>
                                  <div className="text-[10px] text-gray-500">
                                    {file.type} ·{" "}
                                    <span className="text-emerald-300">+{file.added}</span>{" "}
                                    <span className="text-red-300">-{file.removed}</span>
                                  </div>
                                </div>
                                <div className="flex items-center gap-1.5">
                                  {fileDecision && (
                                    <span
                                      className={cn(
                                        "rounded border px-1.5 py-0.5 text-[10px]",
                                        fileDecision === "accepted"
                                          ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-200"
                                          : "border-red-500/30 bg-red-500/10 text-red-200"
                                      )}
                                    >
                                      {fileDecision === "accepted" ? "Accepted" : "Rejected"}
                                    </span>
                                  )}
                                  {file.diff && (
                                    <button
                                      type="button"
                                      onClick={() =>
                                        setExpandedDiffs((previous) => ({
                                          ...previous,
                                          [diffKey]: !previous[diffKey],
                                        }))
                                      }
                                      className="rounded border border-white/10 px-1.5 py-0.5 text-[10px] text-gray-300 hover:bg-white/5"
                                    >
                                      {isExpanded ? "Hide diff" : "Show diff"}
                                    </button>
                                  )}
                                </div>
                              </div>
                              {isExpanded && file.diff && (
                                <div className="max-h-52 overflow-auto border-t border-white/10 bg-[#06060b] px-2 py-1.5 font-mono text-[10px] leading-4">
                                  {file.diff.split(/\r?\n/).map((line, lineIndex) => {
                                    const isAdd = line.startsWith("+") && !line.startsWith("+++");
                                    const isRemove =
                                      line.startsWith("-") && !line.startsWith("---");
                                    const isHeader =
                                      line.startsWith("diff --git") ||
                                      line.startsWith("--- ") ||
                                      line.startsWith("+++ ");
                                    const isHunk = line.startsWith("@@");
                                    return (
                                      <div
                                        key={`${diffKey}:line:${lineIndex}`}
                                        className={cn(
                                          "whitespace-pre",
                                          isAdd && "bg-emerald-500/15 text-emerald-200",
                                          isRemove && "bg-red-500/15 text-red-200",
                                          isHeader && "text-sky-300",
                                          isHunk && "text-indigo-300",
                                          !isAdd &&
                                            !isRemove &&
                                            !isHeader &&
                                            !isHunk &&
                                            "text-gray-300"
                                        )}
                                      >
                                        {line || " "}
                                      </div>
                                    );
                                  })}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              );
            })()
          )
        )}
        {showWorkingTimeline && (
          <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 px-3 py-2">
            <div className="mb-1 flex items-center gap-2 text-[10px] uppercase tracking-[0.12em] text-emerald-200/80">
              <Sparkles className="w-3 h-3" />
              Working
            </div>
            <IdeLiveActivityTimeline
              status={liveStatus}
              activities={liveActivities}
              currentStep={liveCurrentStep}
            />
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

      {pendingMessageChangeKeys.length > 0 && (
        <div className="px-3 py-2 border-t border-indigo-500/20 bg-[#121423] flex items-center justify-between gap-2">
          <div className="text-[11px] text-gray-200 min-w-0 truncate">
            {pendingChangeAggregate.fileCount} file
            {pendingChangeAggregate.fileCount === 1 ? "" : "s"} with changes{" "}
            <span className="text-emerald-300">+{pendingChangeAggregate.totalAdded}</span>{" "}
            <span className="text-red-300">-{pendingChangeAggregate.totalRemoved}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => void handleRejectAllMessageChanges()}
              disabled={isApplyingDiffAction || isSending || isReverting}
              className="inline-flex items-center rounded border border-red-500/30 bg-red-500/10 px-2 py-1 text-[10px] text-red-200 hover:bg-red-500/20 disabled:opacity-50"
              title="Reject all pending file changes"
            >
              {isApplyingDiffAction ? (
                <Loader2 className="w-3 h-3 mr-1 animate-spin" />
              ) : (
                <RotateCcw className="w-3 h-3 mr-1" />
              )}
              Reject all
            </button>
            <button
              type="button"
              onClick={handleAcceptAllMessageChanges}
              disabled={isApplyingDiffAction || isSending || isReverting}
              className="inline-flex items-center rounded border border-emerald-500/30 bg-emerald-500/10 px-2 py-1 text-[10px] text-emerald-200 hover:bg-emerald-500/20 disabled:opacity-50"
              title="Accept all pending file changes"
            >
              <Check className="w-3 h-3 mr-1" />
              Accept all
            </button>
          </div>
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
          disabled={isApplyingDiffAction}
          className="w-full min-h-[82px] max-h-56 px-2 py-1.5 rounded border border-white/10 bg-black/40 text-xs text-gray-200 !outline-none focus:border-indigo-500/40 resize-y"
        />
        <div className="flex items-center gap-2">
          <select
            value={selectedAgentId}
            onChange={(event) => onSelectedAgentIdChange(event.target.value)}
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
            disabled={
              isSending ||
              isReverting ||
              isApplyingDiffAction ||
              showWorkingTimeline ||
              !input.trim()
            }
            onClick={() => void handleSend()}
            className="h-7 px-2.5"
          >
            {showWorkingTimeline ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <MessageSquare className="w-3.5 h-3.5" />
            )}
            <span className="ml-1 text-xs">{showWorkingTimeline ? "Running" : "Send"}</span>
          </Button>
        </div>
      </div>
    </div>
  );
}

function IDEWelcomeScreen({
  workspacePath,
  onNewFile,
  onOpenWorkspace,
  onOpenCommandPalette,
  onOpenSettings,
  onOpenAiSettings,
  onOpenIndexerSettings,
}: {
  workspacePath: string;
  onNewFile: () => void;
  onOpenWorkspace: () => void;
  onOpenCommandPalette: () => void;
  onOpenSettings: () => void;
  onOpenAiSettings: () => void;
  onOpenIndexerSettings: () => void;
}) {
  const normalizedWorkspace = workspacePath
    .replace(/^\/Users\/[^/]+/, "~")
    .replace(/^C:\\Users\\[^\\]+/, "~");

  return (
    <div className="flex-1 min-h-0 overflow-auto bg-[#070811]">
      <div className="mx-auto flex w-full max-w-3xl flex-col px-8 py-14">
        <div className="mb-9">
          <h1 className="text-2xl font-semibold tracking-tight text-gray-100">
            Welcome to Cybara IDE
          </h1>
          <p className="mt-1 text-sm text-gray-500">Current workspace: {normalizedWorkspace}</p>
        </div>

        <div className="mb-8">
          <div className="mb-3 text-[11px] uppercase tracking-[0.12em] text-gray-600">
            Get Started
          </div>
          <div className="divide-y divide-white/10 rounded-lg border border-white/10 bg-black/20">
            <button
              type="button"
              onClick={onNewFile}
              className="flex w-full items-center justify-between px-4 py-3 text-left text-sm text-gray-200 hover:bg-white/5"
            >
              <span className="flex items-center gap-2">
                <FilePlus className="h-4 w-4 text-indigo-300" />
                New File
              </span>
              <span className="text-xs text-gray-500">Ctrl/Cmd+N</span>
            </button>
            <button
              type="button"
              onClick={onOpenWorkspace}
              className="flex w-full items-center justify-between px-4 py-3 text-left text-sm text-gray-200 hover:bg-white/5"
            >
              <span className="flex items-center gap-2">
                <FolderOpen className="h-4 w-4 text-amber-300" />
                Open Workspace
              </span>
              <span className="text-xs text-gray-500">Folder Path</span>
            </button>
            <button
              type="button"
              onClick={onOpenCommandPalette}
              className="flex w-full items-center justify-between px-4 py-3 text-left text-sm text-gray-200 hover:bg-white/5"
            >
              <span className="flex items-center gap-2">
                <ListTree className="h-4 w-4 text-indigo-300" />
                Open Command Palette
              </span>
              <span className="text-xs text-gray-500">Ctrl/Cmd+Shift+P</span>
            </button>
          </div>
        </div>

        <div className="mb-8">
          <div className="mb-3 text-[11px] uppercase tracking-[0.12em] text-gray-600">
            Configure
          </div>
          <div className="divide-y divide-white/10 rounded-lg border border-white/10 bg-black/20">
            <button
              type="button"
              onClick={onOpenSettings}
              className="flex w-full items-center justify-between px-4 py-3 text-left text-sm text-gray-200 hover:bg-white/5"
            >
              <span>Open Settings</span>
              <span className="text-xs text-gray-500">/settings</span>
            </button>
            <button
              type="button"
              onClick={onOpenAiSettings}
              className="flex w-full items-center justify-between px-4 py-3 text-left text-sm text-gray-200 hover:bg-white/5"
            >
              <span>Open AI Provider Settings</span>
              <span className="text-xs text-gray-500">/providers</span>
            </button>
            <button
              type="button"
              onClick={onOpenIndexerSettings}
              className="flex w-full items-center justify-between px-4 py-3 text-left text-sm text-gray-300 hover:bg-white/5"
            >
              <span>Open Indexer Settings</span>
              <span className="text-xs text-gray-500">Workspace Indexer</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export function IDE() {
  const navigate = useNavigate();
  const location = useLocation();
  const [currentPath, setCurrentPath] = useState<string>(() => readPersistedWorkspacePath());
  const [selectedFile, setSelectedFile] = useState<FileEntry | null>(null);
  const [openTabs, setOpenTabs] = useState<IdeTab[]>([]);
  const [activeTabPath, setActiveTabPath] = useState<string | null>(null);
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set());
  const [treeFilter, setTreeFilter] = useState("");
  const deferredTreeFilter = useDeferredValue(treeFilter);
  const [rootInfo, setRootInfo] = useState<BrowseResult | null>(null);
  const [createType, setCreateType] = useState<"file" | "directory" | null>(null);
  const [createParentPath, setCreateParentPath] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [saveRequestToken, setSaveRequestToken] = useState(0);
  const [requestedJumpLine, setRequestedJumpLine] = useState<number | null>(null);
  const [cursorPosition, setCursorPosition] = useState<{ line: number; column: number } | null>(
    null
  );
  const [gitHistoryStatus, setGitHistoryStatus] = useState<GitHistoryStatus>("idle");
  const [sidebarWidth, setSidebarWidth] = useState<number>(() => readPersistedSidebarWidth());
  const [sidebarMode, setSidebarMode] = useState<"explorer" | "search" | "outline">("explorer");
  const [openMenu, setOpenMenu] = useState<"file" | null>(null);
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
  const [ideChatSelectedAgentId, setIdeChatSelectedAgentId] = useState<string>(() =>
    readPersistedIdeChatAgentId()
  );
  const [ideAgentOptions, setIdeAgentOptions] = useState<IdeChatAgentOption[]>([]);
  const [showIdeSettings, setShowIdeSettings] = useState(false);
  const [ideSettingsSection, setIdeSettingsSection] = useState<IdeSettingsSectionId>("general");
  const [ideSettingsSearch, setIdeSettingsSearch] = useState("");
  const [idePreferences, setIdePreferences] = useState<IdePreferences>(() =>
    readPersistedIdePreferences()
  );
  const [showIndexerSettings, setShowIndexerSettings] = useState(false);
  const [indexStatus, setIndexStatus] = useState<WorkspaceIndexerStatusResponse | null>(null);
  const [indexSettingsDraft, setIndexSettingsDraft] = useState<WorkspaceIndexerSettings | null>(
    null
  );
  const [indexSettingsDirty, setIndexSettingsDirty] = useState(false);
  const [indexStatusLoading, setIndexStatusLoading] = useState(false);
  const [indexActionLoading, setIndexActionLoading] = useState(false);
  const [indexSettingsError, setIndexSettingsError] = useState<string | null>(null);
  const [indexSettingsMessage, setIndexSettingsMessage] = useState<string | null>(null);
  const [embeddingProviders, setEmbeddingProviders] = useState<WorkspaceEmbeddingProviderOption[]>(
    []
  );
  const [embeddingCatalogLoading, setEmbeddingCatalogLoading] = useState(false);
  const [embeddingRuntime, setEmbeddingRuntime] =
    useState<WorkspaceEmbeddingRuntimeResponse | null>(null);
  const [embeddingRuntimeLoading, setEmbeddingRuntimeLoading] = useState(false);
  const [embeddingRuntimeActionLoading, setEmbeddingRuntimeActionLoading] = useState(false);
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
  const lastIndexedWorkspaceAssignmentRef = useRef<string | null>(null);
  const pendingCursorPositionRef = useRef<{ line: number; column: number } | null>(null);
  const cursorPublishTimeoutRef = useRef<number | null>(null);
  const settingsSearchRef = useRef<HTMLInputElement | null>(null);
  const effectiveWorkspacePath = rootInfo?.path || currentPath;

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
        setIdeAgentOptions(options);
      } catch {
        // Keep previously fetched options on transient API failures.
      }
    };
    void loadAgents();
    return () => {
      isCancelled = true;
    };
  }, []);

  const fetchIndexStatus = useCallback(
    async (workspacePath?: string, options?: { silent?: boolean }) => {
      const targetPath = workspacePath || effectiveWorkspacePath;
      const silent = options?.silent === true;
      if (!silent) {
        setIndexStatusLoading(true);
      }
      try {
        const params = new URLSearchParams();
        if (targetPath) params.set("workspacePath", targetPath);
        const query = params.toString();
        const response = await apiFetch(`/api/ide/index/status${query ? `?${query}` : ""}`);
        const data: WorkspaceIndexerStatusResponse = await response.json();
        if (data.success) {
          setIndexStatus(data);
          if (!indexSettingsDirty) {
            setIndexSettingsDraft(data.settings);
          }
          if (!silent) {
            setIndexSettingsError(null);
          }
        } else {
          if (!silent) {
            setIndexSettingsError(data.error || "Failed to load indexer status");
          }
        }
      } catch (error) {
        if (!silent && (error as Error)?.name !== "AbortError") {
          setIndexSettingsError(String(error));
        }
      } finally {
        if (!silent) {
          setIndexStatusLoading(false);
        }
      }
    },
    [effectiveWorkspacePath, indexSettingsDirty]
  );

  const fetchEmbeddingCatalog = useCallback(async () => {
    setEmbeddingCatalogLoading(true);
    try {
      const response = await apiFetch("/api/ide/index/embeddings");
      const data: WorkspaceEmbeddingCatalogResponse = await response.json();
      if (data.success) {
        setEmbeddingProviders(Array.isArray(data.providers) ? data.providers : []);
      } else {
        setEmbeddingProviders([]);
        setIndexSettingsError(data.error || "Failed to load embedding providers");
      }
    } catch (error) {
      setEmbeddingProviders([]);
      setIndexSettingsError(String(error));
    } finally {
      setEmbeddingCatalogLoading(false);
    }
  }, []);

  const resolveEmbeddingRuntimeSelection = useCallback(() => {
    const activeSettings =
      indexSettingsDraft || indexStatus?.settings || DEFAULT_INDEXER_SETTINGS_DRAFT;
    const explicitProvider = activeSettings.embeddingProvider;
    const runtimeProvider =
      explicitProvider === "auto"
        ? embeddingRuntime?.vectorProvider === "transformers_js" ||
          embeddingRuntime?.vectorProvider === "ollama"
          ? embeddingRuntime.vectorProvider
          : "transformers_js"
        : explicitProvider;
    const runtimeModel =
      activeSettings.embeddingModel ||
      (runtimeProvider === "transformers_js"
        ? embeddingRuntime?.transformers?.selectedModel || ""
        : embeddingRuntime?.vectorModel || "");

    return {
      provider: runtimeProvider,
      model: runtimeModel,
    };
  }, [
    embeddingRuntime?.transformers?.selectedModel,
    embeddingRuntime?.vectorModel,
    embeddingRuntime?.vectorProvider,
    indexSettingsDraft,
    indexStatus?.settings,
  ]);

  const fetchEmbeddingRuntimeStatus = useCallback(
    async (options?: { silent?: boolean }) => {
      const selection = resolveEmbeddingRuntimeSelection();
      const silent = options?.silent === true;
      if (!silent) setEmbeddingRuntimeLoading(true);
      try {
        const params = new URLSearchParams();
        if (selection.provider) params.set("provider", selection.provider);
        if (selection.model) params.set("model", selection.model);
        const query = params.toString();
        const response = await apiFetch(
          `/api/ide/index/embedding/runtime${query ? `?${query}` : ""}`
        );
        const data: WorkspaceEmbeddingRuntimeResponse = await response.json();
        if (data.success) {
          setEmbeddingRuntime(data);
          if (!silent) {
            setIndexSettingsError(null);
          }
        } else if (!silent) {
          setIndexSettingsError(data.error || "Failed to load embedding runtime status");
        }
      } catch (error) {
        if (!silent) {
          setIndexSettingsError(String(error));
        }
      } finally {
        if (!silent) setEmbeddingRuntimeLoading(false);
      }
    },
    [resolveEmbeddingRuntimeSelection]
  );

  const assignWorkspaceToIndexer = useCallback(
    async (workspacePath: string) => {
      try {
        const response = await apiFetch("/api/ide/index/workspace", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ workspacePath }),
        });
        const data: WorkspaceIndexerStatusResponse = await response.json();
        if (data.success) {
          setIndexStatus(data);
          if (!indexSettingsDirty) {
            setIndexSettingsDraft(data.settings);
          }
        } else {
          setIndexSettingsError(data.error || "Failed to start workspace indexing");
        }
      } catch (error) {
        setIndexSettingsError(String(error));
      }
    },
    [indexSettingsDirty]
  );

  const saveIndexSettings = useCallback(async () => {
    if (!indexSettingsDraft) return;
    setIndexActionLoading(true);
    setIndexSettingsError(null);
    setIndexSettingsMessage(null);
    try {
      const response = await apiFetch("/api/ide/index/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(indexSettingsDraft),
      });
      const data: WorkspaceIndexerStatusResponse = await response.json();
      if (data.success) {
        setIndexStatus(data);
        setIndexSettingsDraft(data.settings);
        setIndexSettingsDirty(false);
        setIndexSettingsMessage("Indexer settings saved.");
        void fetchEmbeddingCatalog();
      } else {
        setIndexSettingsError(data.error || "Failed to save indexer settings");
      }
    } catch (error) {
      setIndexSettingsError(String(error));
    } finally {
      setIndexActionLoading(false);
    }
  }, [fetchEmbeddingCatalog, indexSettingsDraft]);

  const runWorkspaceReindex = useCallback(async () => {
    setIndexActionLoading(true);
    setIndexSettingsError(null);
    setIndexSettingsMessage(null);
    try {
      const response = await apiFetch("/api/ide/index/reindex", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspacePath: effectiveWorkspacePath }),
      });
      const data: WorkspaceIndexerStatusResponse = await response.json();
      if (data.success) {
        setIndexStatus(data);
        setIndexSettingsMessage("Workspace reindex started.");
      } else {
        setIndexSettingsError(data.error || "Failed to reindex workspace");
      }
    } catch (error) {
      setIndexSettingsError(String(error));
    } finally {
      setIndexActionLoading(false);
    }
  }, [effectiveWorkspacePath]);

  const stopWorkspaceIndexing = useCallback(async () => {
    setIndexActionLoading(true);
    setIndexSettingsError(null);
    setIndexSettingsMessage(null);
    try {
      const response = await apiFetch("/api/ide/index/stop", {
        method: "POST",
      });
      const data: WorkspaceIndexerStatusResponse = await response.json();
      if (data.success) {
        setIndexStatus(data);
        setIndexSettingsMessage("Workspace indexing stopped.");
      } else {
        setIndexSettingsError(data.error || "Failed to stop workspace indexer");
      }
    } catch (error) {
      setIndexSettingsError(String(error));
    } finally {
      setIndexActionLoading(false);
    }
  }, []);

  const loadEmbeddingRuntime = useCallback(async () => {
    const selection = resolveEmbeddingRuntimeSelection();
    setEmbeddingRuntimeActionLoading(true);
    setIndexSettingsError(null);
    setIndexSettingsMessage(null);
    try {
      const response = await apiFetch("/api/ide/index/embedding/load", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(selection),
      });
      const data = (await response.json()) as {
        success: boolean;
        message?: string;
        status?: WorkspaceIndexerStatusResponse;
        runtime?: WorkspaceEmbeddingRuntimeResponse;
        error?: string;
      };
      if (data.success) {
        if (data.status) setIndexStatus(data.status);
        if (data.runtime) setEmbeddingRuntime(data.runtime);
        setIndexSettingsMessage(data.message || "Local embedding runtime loaded.");
      } else {
        setIndexSettingsError(data.error || data.message || "Failed to load embedding runtime");
      }
    } catch (error) {
      setIndexSettingsError(String(error));
    } finally {
      setEmbeddingRuntimeActionLoading(false);
    }
  }, [resolveEmbeddingRuntimeSelection]);

  const stopEmbeddingRuntime = useCallback(async () => {
    const selection = resolveEmbeddingRuntimeSelection();
    setEmbeddingRuntimeActionLoading(true);
    setIndexSettingsError(null);
    setIndexSettingsMessage(null);
    try {
      const response = await apiFetch("/api/ide/index/embedding/stop", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(selection),
      });
      const data = (await response.json()) as {
        success: boolean;
        message?: string;
        status?: WorkspaceIndexerStatusResponse;
        runtime?: WorkspaceEmbeddingRuntimeResponse;
        error?: string;
      };
      if (data.success) {
        if (data.status) {
          setIndexStatus(data.status);
        }
        if (data.runtime) {
          setEmbeddingRuntime(data.runtime);
        }
        setIndexSettingsMessage(data.message || "Local embedding runtime stopped.");
      } else {
        setIndexSettingsError(data.error || data.message || "Failed to stop embedding runtime");
      }
    } catch (error) {
      setIndexSettingsError(String(error));
    } finally {
      setEmbeddingRuntimeActionLoading(false);
    }
  }, [resolveEmbeddingRuntimeSelection]);

  useEffect(() => {
    const fetchRoot = async () => {
      const res = await apiFetch(`/api/ide/browse?path=${encodeURIComponent(currentPath)}`);
      const data: BrowseResult = await res.json();
      if (data.success) {
        setRootInfo(data);
        return;
      }
      setRootInfo(null);
      if (currentPath !== "~") {
        setCurrentPath("~");
      }
    };
    fetchRoot();
  }, [currentPath, refreshKey]);

  useEffect(() => {
    if (!effectiveWorkspacePath) return;
    if (lastIndexedWorkspaceAssignmentRef.current === effectiveWorkspacePath) return;
    lastIndexedWorkspaceAssignmentRef.current = effectiveWorkspacePath;
    setIndexSettingsError(null);
    void assignWorkspaceToIndexer(effectiveWorkspacePath);
  }, [assignWorkspaceToIndexer, effectiveWorkspacePath]);

  useEffect(() => {
    void fetchIndexStatus(currentPath);
  }, [currentPath, fetchIndexStatus]);

  useEffect(() => {
    const indexingSettingsVisible =
      showIndexerSettings || (showIdeSettings && ideSettingsSection === "indexing");
    if (!indexingSettingsVisible && !indexStatus?.isIndexing) return;
    const interval = window.setInterval(() => {
      void fetchIndexStatus(effectiveWorkspacePath, { silent: true });
      if (indexingSettingsVisible) {
        void fetchEmbeddingRuntimeStatus({ silent: true });
      }
    }, 1200);
    return () => window.clearInterval(interval);
  }, [
    effectiveWorkspacePath,
    fetchEmbeddingRuntimeStatus,
    fetchIndexStatus,
    ideSettingsSection,
    indexStatus?.isIndexing,
    showIdeSettings,
    showIndexerSettings,
  ]);

  useEffect(() => {
    const indexingSettingsVisible =
      showIndexerSettings || (showIdeSettings && ideSettingsSection === "indexing");
    if (!indexingSettingsVisible) return;
    void fetchIndexStatus(effectiveWorkspacePath);
  }, [
    effectiveWorkspacePath,
    fetchIndexStatus,
    ideSettingsSection,
    showIdeSettings,
    showIndexerSettings,
  ]);

  useEffect(() => {
    const indexingSettingsVisible =
      showIndexerSettings || (showIdeSettings && ideSettingsSection === "indexing");
    if (!indexingSettingsVisible) return;
    void fetchEmbeddingCatalog();
  }, [fetchEmbeddingCatalog, ideSettingsSection, showIdeSettings, showIndexerSettings]);

  useEffect(() => {
    const indexingSettingsVisible =
      showIndexerSettings || (showIdeSettings && ideSettingsSection === "indexing");
    if (!indexingSettingsVisible) return;
    void fetchEmbeddingRuntimeStatus();
  }, [fetchEmbeddingRuntimeStatus, ideSettingsSection, showIdeSettings, showIndexerSettings]);

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

  const handleSetWorkspacePath = useCallback((nextPath: string) => {
    setCurrentPath(nextPath);
    setSelectedFile(null);
    setActiveTabPath(null);
    setRequestedJumpLine(null);
    setExpandedDirs(new Set());
    setTreeFilter("");
    treeBrowseCache.clear();
    setRefreshKey((previous) => previous + 1);
    setIndexSettingsError(null);
  }, []);

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
    treeBrowseCache.clear();
  }, []);

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
      openFileInEditor(fileEntryFromPath(filePath), line, { previewMode: previewMode === true });

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
          if (data.source === "filesystem" && data.indexError) {
            setQuickOpenError(
              `Indexer unavailable (${data.indexError}). Showing filesystem search.`
            );
          }
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

  const openIdeSettings = useCallback((section: IdeSettingsSectionId = "general") => {
    setIdeSettingsSection(section);
    setShowIdeSettings(true);
    setIdeSettingsSearch("");
    window.requestAnimationFrame(() => {
      settingsSearchRef.current?.focus();
      settingsSearchRef.current?.select();
    });
  }, []);

  const updateIdePreferences = useCallback((patch: Partial<IdePreferences>) => {
    setIdePreferences((previous) => {
      const merged: IdePreferences = {
        ...previous,
        ...patch,
      };
      merged.editorFontSizePx = Math.max(11, Math.min(22, Math.round(merged.editorFontSizePx)));
      merged.editorLineHeightPx = Math.max(16, Math.min(38, Math.round(merged.editorLineHeightPx)));
      merged.completionDebounceMs = Math.max(
        30,
        Math.min(800, Math.round(merged.completionDebounceMs))
      );
      merged.ghostDebounceMs = Math.max(60, Math.min(1400, Math.round(merged.ghostDebounceMs)));
      merged.terminalPanelHeight = clampTerminalHeight(merged.terminalPanelHeight);
      return merged;
    });
  }, []);

  useEffect(() => {
    if (ideAgentOptions.length === 0) return;
    if (!ideChatSelectedAgentId) return;
    if (ideAgentOptions.some((agent) => agent.id === ideChatSelectedAgentId)) return;
    setIdeChatSelectedAgentId("");
  }, [ideAgentOptions, ideChatSelectedAgentId]);

  useEffect(() => {
    if (ideAgentOptions.length === 0) return;
    if (idePreferences.useChatAgentForCompletions) return;
    const selected = idePreferences.completionAgentId;
    if (!selected) return;
    if (ideAgentOptions.some((agent) => agent.id === selected)) return;
    updateIdePreferences({ completionAgentId: "" });
  }, [
    ideAgentOptions,
    idePreferences.completionAgentId,
    idePreferences.useChatAgentForCompletions,
    updateIdePreferences,
  ]);

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

      if ((event.metaKey || event.ctrlKey) && event.shiftKey && event.key.toLowerCase() === "p") {
        event.preventDefault();
        openCommandPalette();
        return;
      }

      if ((event.metaKey || event.ctrlKey) && !event.shiftKey && event.key === ",") {
        event.preventDefault();
        openIdeSettings("general");
        return;
      }

      if ((event.metaKey || event.ctrlKey) && !event.shiftKey && event.code === "Backquote") {
        event.preventDefault();
        toggleTerminalPanel();
        return;
      }

      if ((event.metaKey || event.ctrlKey) && event.shiftKey && event.code === "Backquote") {
        event.preventDefault();
        openNewTerminal();
        return;
      }

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

      if ((event.metaKey || event.ctrlKey) && event.shiftKey && event.key.toLowerCase() === "o") {
        event.preventDefault();
        setSidebarMode("outline");
        window.requestAnimationFrame(() => {
          outlineInputRef.current?.focus();
          outlineInputRef.current?.select();
        });
        return;
      }

      if ((event.metaKey || event.ctrlKey) && !event.shiftKey && event.key.toLowerCase() === "p") {
        event.preventDefault();
        openQuickOpenPalette();
        return;
      }

      if ((event.metaKey || event.ctrlKey) && !event.shiftKey && event.key.toLowerCase() === "o") {
        event.preventDefault();
        void handlePromptOpenWorkspace();
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
    persistIdeChatAgentId(ideChatSelectedAgentId);
  }, [ideChatSelectedAgentId]);

  useEffect(() => {
    persistIdePreferences(idePreferences);
  }, [idePreferences]);

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
    const matchingIndex = pendingEditorFiles.findIndex((file) => isSameIdePath(activePath, file.path));
    return matchingIndex >= 0 ? matchingIndex : 0;
  }, [activeTabPath, pendingEditorFiles, selectedFile?.path]);
  const activePendingEditorFile =
    activePendingEditorFileIndex >= 0 ? pendingEditorFiles[activePendingEditorFileIndex] || null : null;
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
      pendingEditorFiles[currentIndex + 1] ||
      pendingEditorFiles[currentIndex - 1] ||
      null,
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
    if (gitHistoryStatus === "loading") return "Git history: loading";
    if (gitHistoryStatus === "ready") return "Git history: ready";
    if (gitHistoryStatus === "unavailable") return "Git history: unavailable";
    if (gitHistoryStatus === "error") return "Git history: error";
    return "Git history: idle";
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
  const indexStatusLabel = useMemo(() => {
    if (!indexStatus) return null;
    if (indexStatus.isIndexing) {
      return `Indexing ${indexStatus.filesIndexed.toLocaleString()} files`;
    }
    if (indexStatus.state === "ready") {
      return `Indexed ${indexStatus.filesIndexed.toLocaleString()} files`;
    }
    if (indexStatus.state === "error") {
      return "Index error";
    }
    if (!indexStatus.settings.enabled) {
      return "Index disabled";
    }
    if (indexStatus.state === "stopped") {
      return "Index stopped";
    }
    return "Index idle";
  }, [indexStatus]);
  const activeIndexSettings =
    indexSettingsDraft || indexStatus?.settings || DEFAULT_INDEXER_SETTINGS_DRAFT;
  const selectedEmbeddingProvider = useMemo(
    () =>
      embeddingProviders.find((option) => option.id === activeIndexSettings.embeddingProvider) ||
      null,
    [activeIndexSettings.embeddingProvider, embeddingProviders]
  );
  const selectedEmbeddingModelOptions = useMemo(() => {
    if (!selectedEmbeddingProvider) return [];
    return selectedEmbeddingProvider.models || [];
  }, [selectedEmbeddingProvider]);
  const runtimeTargetProvider = useMemo(() => {
    if (activeIndexSettings.embeddingProvider !== "auto") {
      return activeIndexSettings.embeddingProvider;
    }
    if (
      embeddingRuntime?.vectorProvider === "transformers_js" ||
      embeddingRuntime?.vectorProvider === "ollama"
    ) {
      return embeddingRuntime.vectorProvider;
    }
    return "transformers_js";
  }, [activeIndexSettings.embeddingProvider, embeddingRuntime?.vectorProvider]);
  const runtimeTargetModel = useMemo(() => {
    if (activeIndexSettings.embeddingModel.trim()) {
      return activeIndexSettings.embeddingModel.trim();
    }
    if (runtimeTargetProvider === "transformers_js") {
      return (
        embeddingRuntime?.transformers?.selectedModel ||
        selectedEmbeddingProvider?.defaultModel ||
        ""
      );
    }
    return embeddingRuntime?.vectorModel || selectedEmbeddingProvider?.defaultModel || "";
  }, [
    activeIndexSettings.embeddingModel,
    embeddingRuntime?.transformers?.selectedModel,
    embeddingRuntime?.vectorModel,
    runtimeTargetProvider,
    selectedEmbeddingProvider?.defaultModel,
  ]);
  const canManageLocalRuntime =
    runtimeTargetProvider === "transformers_js" || runtimeTargetProvider === "ollama";
  const canUnloadLocalRuntime =
    canManageLocalRuntime &&
    (runtimeTargetProvider !== "transformers_js"
      ? true
      : embeddingRuntime?.transformers?.selectedState === "ready" ||
        embeddingRuntime?.transformers?.selectedState === "loading" ||
        (embeddingRuntime?.transformers?.loadedModels?.length || 0) > 0);
  const selectedTransformersRuntimeError = useMemo(() => {
    if (!embeddingRuntime?.transformers) return null;
    const selectedModel = embeddingRuntime.transformers.selectedModel;
    const selectedEntry = embeddingRuntime.transformers.loadedModels.find(
      (entry) => entry.model === selectedModel
    );
    return selectedEntry?.lastError || null;
  }, [embeddingRuntime?.transformers]);
  const effectiveRuntimeNote = useMemo(() => {
    if (runtimeTargetProvider === "transformers_js" && selectedTransformersRuntimeError) {
      return selectedTransformersRuntimeError;
    }
    if (
      runtimeTargetProvider === "transformers_js" &&
      embeddingRuntime?.transformers?.selectedState === "ready"
    ) {
      return null;
    }
    if (runtimeTargetProvider === "ollama" && embeddingRuntime?.vectorProvider === "ollama") {
      return null;
    }
    return embeddingRuntime?.vectorFallbackReason || null;
  }, [
    embeddingRuntime?.transformers?.selectedState,
    embeddingRuntime?.vectorFallbackReason,
    embeddingRuntime?.vectorProvider,
    runtimeTargetProvider,
    selectedTransformersRuntimeError,
  ]);

  useEffect(() => {
    const indexingSettingsVisible =
      showIndexerSettings || (showIdeSettings && ideSettingsSection === "indexing");
    if (!indexingSettingsVisible) return;
    const timeout = window.setTimeout(() => {
      void fetchEmbeddingRuntimeStatus({ silent: true });
    }, 180);
    return () => window.clearTimeout(timeout);
  }, [
    activeIndexSettings.embeddingModel,
    activeIndexSettings.embeddingProvider,
    fetchEmbeddingRuntimeStatus,
    ideSettingsSection,
    showIdeSettings,
    showIndexerSettings,
  ]);
  const normalizedSettingsSearch = ideSettingsSearch.trim().toLowerCase();
  const matchesIdeSettingsSearch = (...parts: string[]) => {
    if (!normalizedSettingsSearch) return true;
    return parts.join(" ").toLowerCase().includes(normalizedSettingsSearch);
  };
  const settingsSections: Array<{ id: IdeSettingsSectionId; label: string; description: string }> =
    [
      { id: "general", label: "General", description: "Workspace and layout defaults" },
      { id: "editor", label: "Editor", description: "Font, line-height, minimap" },
      { id: "completion", label: "AI & Completion", description: "Completions and agent usage" },
      { id: "indexing", label: "Indexing", description: "Workspace index and semantic search" },
      { id: "terminal", label: "Terminal", description: "Integrated terminal behavior" },
    ];
  const visibleSettingsSectionIds = useMemo(() => {
    if (!normalizedSettingsSearch) return settingsSections.map((section) => section.id);
    return settingsSections
      .filter((section) =>
        [section.label, section.description]
          .join(" ")
          .toLowerCase()
          .includes(normalizedSettingsSearch)
      )
      .map((section) => section.id);
  }, [normalizedSettingsSearch, settingsSections]);
  const terminalCapabilityLabel =
    terminalPanelState.capability === "checking"
      ? "Checking..."
      : terminalPanelState.capability === "enabled"
        ? "Enabled"
        : "Disabled";

  useEffect(() => {
    if (!showIdeSettings) return;
    if (visibleSettingsSectionIds.length === 0) return;
    if (!visibleSettingsSectionIds.includes(ideSettingsSection)) {
      setIdeSettingsSection(visibleSettingsSectionIds[0] || "general");
    }
  }, [ideSettingsSection, showIdeSettings, visibleSettingsSectionIds]);

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
              <button
                type="button"
                onClick={() => {
                  setOpenMenu(null);
                  void handlePromptOpenWorkspace();
                }}
                className="w-full text-left px-3 py-2 text-gray-200 hover:bg-white/5 text-sm"
              >
                Open Workspace Folder
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
                  setSidebarMode("outline");
                  setOpenMenu(null);
                  window.requestAnimationFrame(() => {
                    outlineInputRef.current?.focus();
                    outlineInputRef.current?.select();
                  });
                }}
                className="w-full text-left px-3 py-2 text-gray-200 hover:bg-white/5 text-sm flex items-center justify-between"
              >
                <span>Show Outline</span>
                <span className="text-xs text-gray-500">Ctrl/Cmd+Shift+O</span>
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
                  toggleTerminalPanel();
                  setOpenMenu(null);
                }}
                className="w-full text-left px-3 py-2 text-gray-200 hover:bg-white/5 text-sm flex items-center justify-between"
              >
                <span>{isTerminalPanelOpen ? "Hide Terminal Panel" : "Show Terminal Panel"}</span>
                <span className="text-xs text-gray-500">Ctrl/Cmd+`</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  openNewTerminal();
                  setOpenMenu(null);
                }}
                className="w-full text-left px-3 py-2 text-gray-200 hover:bg-white/5 text-sm flex items-center justify-between"
              >
                <span>New Terminal</span>
                <span className="text-xs text-gray-500">Ctrl/Cmd+Shift+`</span>
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
              <button
                type="button"
                onClick={() => {
                  openIdeSettings("indexing");
                  setOpenMenu(null);
                }}
                className="w-full text-left px-3 py-2 text-gray-200 hover:bg-white/5 text-sm"
              >
                IDE Settings
              </button>
              <div className="h-px bg-white/10" />
              <button
                type="button"
                onClick={() => {
                  openCommandPalette();
                  setOpenMenu(null);
                }}
                className="w-full text-left px-3 py-2 text-gray-200 hover:bg-white/5 text-sm flex items-center justify-between"
              >
                <span>Command Palette</span>
                <span className="text-xs text-gray-500">Ctrl/Cmd+Shift+P</span>
              </button>
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
            onClick={() => toggleTerminalPanel()}
            className={cn(
              "px-2 py-1 rounded text-xs border transition-colors flex items-center gap-1",
              isTerminalPanelOpen
                ? "border-indigo-500/40 bg-indigo-500/20 text-indigo-200"
                : "border-white/10 text-gray-400 hover:text-gray-200 hover:bg-white/5"
            )}
            title={isTerminalPanelOpen ? "Hide terminal panel" : "Show terminal panel"}
          >
            <TerminalSquare className="w-3.5 h-3.5" />
            Terminal
          </button>
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
          <button
            type="button"
            onClick={() => openIdeSettings("general")}
            className="px-2 py-1 rounded text-xs border border-white/10 text-gray-400 hover:text-gray-200 hover:bg-white/5 transition-colors flex items-center gap-1"
            title="Open IDE settings"
          >
            <Settings2 className="w-3.5 h-3.5" />
            Settings
          </button>
        </div>
      </div>

      <div className="flex-1 flex overflow-hidden" ref={workspacePaneRef}>
        <div
          className="border-r border-white/10 flex flex-col overflow-hidden bg-white/[0.01] relative"
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
            className="absolute top-0 right-0 h-full w-1.5 cursor-col-resize bg-transparent hover:bg-indigo-500/40 transition-colors"
          />
        </div>

        <div className="flex-1 flex overflow-hidden bg-[#0d0d12]">
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
                    enableCompletions={idePreferences.enableCompletions}
                    enableGhostCompletions={idePreferences.enableGhostCompletions}
                    completionDebounceMs={idePreferences.completionDebounceMs}
                    ghostDebounceMs={idePreferences.ghostDebounceMs}
                    pendingFileDiffs={idePendingFileDiffs}
                  />
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
                            <span className="text-emerald-300">+{activePendingEditorFile.added}</span>{" "}
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
              style={{ height: isTerminalPanelOpen ? `${terminalPanelHeight}px` : "0px" }}
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
                className="w-1.5 cursor-col-resize bg-transparent hover:bg-indigo-500/40 transition-colors"
              />
              <div
                className="border-l border-white/10 bg-[#0b0b12] h-full"
                style={{ width: `${chatPanelWidth}px` }}
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
                  onPendingFileDiffsChange={setIdePendingFileDiffs}
                  onPendingFileDiffControllerChange={setIdePendingFileDiffController}
                />
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
                    Editor, completion, indexing, and terminal preferences.
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
                      <label className="flex items-start gap-2 text-xs text-gray-300">
                        <input
                          type="checkbox"
                          checked={isIdeChatOpen}
                          onChange={(event) => setIsIdeChatOpen(event.target.checked)}
                          className="mt-0.5 rounded border-white/20 bg-black/40"
                        />
                        <span>
                          <span className="text-gray-200 font-medium">Open IDE chat panel</span>
                          <span className="block text-gray-500 mt-0.5">
                            Persist this as your default chat panel state.
                          </span>
                        </span>
                      </label>
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
                      <label className="flex items-start gap-2 text-xs text-gray-300">
                        <input
                          type="checkbox"
                          checked={idePreferences.showMinimap}
                          onChange={(event) =>
                            updateIdePreferences({ showMinimap: event.target.checked })
                          }
                          className="mt-0.5 rounded border-white/20 bg-black/40"
                        />
                        <span>
                          <span className="text-gray-200 font-medium">Show minimap</span>
                          <span className="block text-gray-500 mt-0.5">
                            Display the minimap in the editor gutter.
                          </span>
                        </span>
                      </label>
                    )}
                  </div>
                )}

                {ideSettingsSection === "completion" && (
                  <div className="space-y-3">
                    {matchesIdeSettingsSearch("completion", "enable") && (
                      <label className="flex items-start gap-2 text-xs text-gray-300">
                        <input
                          type="checkbox"
                          checked={idePreferences.enableCompletions}
                          onChange={(event) =>
                            updateIdePreferences({ enableCompletions: event.target.checked })
                          }
                          className="mt-0.5 rounded border-white/20 bg-black/40"
                        />
                        <span>
                          <span className="text-gray-200 font-medium">Enable code completions</span>
                          <span className="block text-gray-500 mt-0.5">
                            Use local + LSP completions in the editor.
                          </span>
                        </span>
                      </label>
                    )}
                    {matchesIdeSettingsSearch("ghost", "inline", "completion") && (
                      <label className="flex items-start gap-2 text-xs text-gray-300">
                        <input
                          type="checkbox"
                          checked={idePreferences.enableGhostCompletions}
                          onChange={(event) =>
                            updateIdePreferences({ enableGhostCompletions: event.target.checked })
                          }
                          className="mt-0.5 rounded border-white/20 bg-black/40"
                        />
                        <span>
                          <span className="text-gray-200 font-medium">
                            Enable inline ghost completions
                          </span>
                          <span className="block text-gray-500 mt-0.5">
                            Show AI completion suggestions inline.
                          </span>
                        </span>
                      </label>
                    )}
                    {matchesIdeSettingsSearch("debounce", "completion") && (
                      <label className="block text-xs text-gray-400 space-y-1.5">
                        <span>Completion debounce (ms)</span>
                        <input
                          type="number"
                          min={30}
                          max={800}
                          value={idePreferences.completionDebounceMs}
                          onChange={(event) =>
                            updateIdePreferences({
                              completionDebounceMs: Number.parseInt(
                                event.target.value || "110",
                                10
                              ),
                            })
                          }
                          className="w-40 rounded border border-white/10 bg-black/35 px-2 py-1.5 text-xs text-gray-100 !outline-none focus:border-indigo-500/50"
                        />
                      </label>
                    )}
                    {matchesIdeSettingsSearch("ghost", "debounce") && (
                      <label className="block text-xs text-gray-400 space-y-1.5">
                        <span>Ghost completion debounce (ms)</span>
                        <input
                          type="number"
                          min={60}
                          max={1400}
                          value={idePreferences.ghostDebounceMs}
                          onChange={(event) =>
                            updateIdePreferences({
                              ghostDebounceMs: Number.parseInt(event.target.value || "240", 10),
                            })
                          }
                          className="w-40 rounded border border-white/10 bg-black/35 px-2 py-1.5 text-xs text-gray-100 !outline-none focus:border-indigo-500/50"
                        />
                      </label>
                    )}
                    {matchesIdeSettingsSearch("agent", "completion") && (
                      <div className="space-y-2.5">
                        <label className="flex items-start gap-2 text-xs text-gray-300">
                          <input
                            type="checkbox"
                            checked={idePreferences.useChatAgentForCompletions}
                            onChange={(event) =>
                              updateIdePreferences({
                                useChatAgentForCompletions: event.target.checked,
                              })
                            }
                            className="mt-0.5 rounded border-white/20 bg-black/40"
                          />
                          <span>
                            <span className="text-gray-200 font-medium">
                              Use IDE chat-selected agent for AI completion
                            </span>
                            <span className="block text-gray-500 mt-0.5">
                              Uses the live agent from IDE chat.
                            </span>
                          </span>
                        </label>
                        {!idePreferences.useChatAgentForCompletions && (
                          <label className="block text-xs text-gray-400 space-y-1.5">
                            <span>Completion agent override</span>
                            <select
                              value={idePreferences.completionAgentId}
                              onChange={(event) =>
                                updateIdePreferences({
                                  completionAgentId: event.target.value || "",
                                })
                              }
                              className="w-full rounded border border-white/10 bg-black/35 px-2 py-1.5 text-xs text-gray-100 !outline-none focus:border-indigo-500/50"
                            >
                              <option value="">Backend default routing</option>
                              {ideAgentOptions.map((agent) => (
                                <option key={`ide-completion-agent:${agent.id}`} value={agent.id}>
                                  {agent.name}
                                  {agent.status ? ` (${agent.status})` : ""}
                                </option>
                              ))}
                            </select>
                            <span className="block text-gray-500">
                              Choose a dedicated agent for AI inline completion when chat-agent mode
                              is off.
                            </span>
                          </label>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {ideSettingsSection === "indexing" && (
                  <div className="space-y-3">
                    <div className="rounded border border-white/10 bg-white/[0.02] px-3 py-2.5 text-xs">
                      <div className="text-gray-200 font-medium">Workspace index status</div>
                      <div className="mt-1 text-gray-500">
                        {indexStatus?.state || "idle"} •{" "}
                        {indexStatus?.filesIndexed?.toLocaleString() || "0"} files
                      </div>
                    </div>
                    <div className="rounded border border-white/10 bg-white/[0.02] px-3 py-3 space-y-3">
                      <div className="text-xs font-medium text-gray-200">Embedding Runtime</div>
                      <div className="grid grid-cols-2 gap-3">
                        <label className="text-xs text-gray-400 space-y-1">
                          <span>Embedding provider</span>
                          <select
                            value={activeIndexSettings.embeddingProvider}
                            onChange={(event) => {
                              const nextProvider = event.target
                                .value as WorkspaceIndexerSettings["embeddingProvider"];
                              const option = embeddingProviders.find(
                                (candidate) => candidate.id === nextProvider
                              );
                              const nextModel =
                                option && option.defaultModel
                                  ? option.defaultModel
                                  : activeIndexSettings.embeddingModel;
                              setIndexSettingsDraft({
                                ...activeIndexSettings,
                                embeddingProvider: nextProvider,
                                embeddingModel: nextModel,
                              });
                              setIndexSettingsDirty(true);
                            }}
                            className="w-full rounded border border-white/10 bg-black/35 px-2 py-1.5 text-xs text-gray-100 !outline-none focus:border-indigo-500/50"
                          >
                            {embeddingProviders.length === 0 && (
                              <option value={activeIndexSettings.embeddingProvider}>
                                {activeIndexSettings.embeddingProvider}
                              </option>
                            )}
                            {embeddingProviders.map((option) => (
                              <option key={option.id} value={option.id}>
                                {option.label}
                                {!option.available ? " (unavailable)" : ""}
                              </option>
                            ))}
                          </select>
                          {selectedEmbeddingProvider?.reason && (
                            <span className="block text-[11px] text-amber-300/90">
                              {selectedEmbeddingProvider.reason}
                            </span>
                          )}
                        </label>

                        <label className="text-xs text-gray-400 space-y-1">
                          <span>Embedding model</span>
                          <input
                            type="text"
                            list="ide-settings-embedding-models"
                            value={activeIndexSettings.embeddingModel}
                            onChange={(event) => {
                              setIndexSettingsDraft({
                                ...activeIndexSettings,
                                embeddingModel: event.target.value,
                              });
                              setIndexSettingsDirty(true);
                            }}
                            placeholder={
                              selectedEmbeddingProvider?.defaultModel || "provider default"
                            }
                            className="w-full rounded border border-white/10 bg-black/35 px-2 py-1.5 text-xs text-gray-100 !outline-none focus:border-indigo-500/50"
                          />
                          <datalist id="ide-settings-embedding-models">
                            {selectedEmbeddingModelOptions.map((model) => (
                              <option key={model} value={model} />
                            ))}
                          </datalist>
                          {selectedEmbeddingModelOptions.length > 0 && (
                            <span className="block text-[11px] text-gray-500 truncate">
                              Suggested: {selectedEmbeddingModelOptions.slice(0, 3).join(", ")}
                            </span>
                          )}
                        </label>
                      </div>

                      <div className="grid grid-cols-2 gap-3 text-xs">
                        <div>
                          <div className="text-gray-500">Runtime target</div>
                          <div className="text-gray-200 truncate">
                            {runtimeTargetProvider}
                            {runtimeTargetModel ? ` · ${runtimeTargetModel}` : ""}
                          </div>
                        </div>
                        <div>
                          <div className="text-gray-500">Transformers state</div>
                          <div
                            className={cn(
                              "font-medium",
                              embeddingRuntime?.transformers?.selectedState === "ready"
                                ? "text-emerald-300"
                                : embeddingRuntime?.transformers?.selectedState === "loading"
                                  ? "text-indigo-300"
                                  : embeddingRuntime?.transformers?.selectedState === "error"
                                    ? "text-red-300"
                                    : "text-gray-300"
                            )}
                          >
                            {embeddingRuntime?.transformers?.selectedState || "idle"}
                          </div>
                        </div>
                      </div>

                      {effectiveRuntimeNote && (
                        <div
                          className={cn(
                            "rounded px-2 py-1.5 text-[11px]",
                            runtimeTargetProvider === "transformers_js" &&
                              embeddingRuntime?.transformers?.selectedState === "error"
                              ? "border border-red-500/25 bg-red-500/10 text-red-300"
                              : "border border-amber-500/25 bg-amber-500/10 text-amber-200"
                          )}
                        >
                          Runtime note: {effectiveRuntimeNote}
                        </div>
                      )}

                      <div className="flex items-center gap-2">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => void fetchEmbeddingCatalog()}
                          disabled={
                            embeddingCatalogLoading ||
                            embeddingRuntimeActionLoading ||
                            embeddingRuntimeLoading
                          }
                          className="h-7 px-2 text-xs"
                        >
                          Refresh Models
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => void fetchEmbeddingRuntimeStatus()}
                          disabled={embeddingRuntimeLoading || embeddingRuntimeActionLoading}
                          className="h-7 px-2 text-xs"
                        >
                          {embeddingRuntimeLoading ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          ) : (
                            "Refresh Runtime"
                          )}
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => void loadEmbeddingRuntime()}
                          disabled={
                            !canManageLocalRuntime ||
                            embeddingRuntimeActionLoading ||
                            embeddingRuntimeLoading
                          }
                          className="h-7 px-2 text-xs"
                        >
                          {embeddingRuntimeActionLoading ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          ) : (
                            "Load Runtime"
                          )}
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => void stopEmbeddingRuntime()}
                          disabled={
                            !canUnloadLocalRuntime ||
                            embeddingRuntimeActionLoading ||
                            embeddingRuntimeLoading
                          }
                          className="h-7 px-2 text-xs"
                        >
                          Unload Runtime
                        </Button>
                      </div>
                    </div>
                    {matchesIdeSettingsSearch("indexer", "open", "advanced") && (
                      <div className="flex items-center gap-2">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            setShowIndexerSettings(true);
                            setIndexSettingsError(null);
                            setIndexSettingsDirty(false);
                            void fetchIndexStatus(effectiveWorkspacePath);
                          }}
                          className="h-7 px-2 text-xs"
                        >
                          Open Advanced Indexer Settings
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => void saveIndexSettings()}
                          disabled={indexActionLoading || !indexSettingsDirty}
                          className="h-7 px-2 text-xs"
                        >
                          Save Index Settings
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => void runWorkspaceReindex()}
                          disabled={indexActionLoading}
                          className="h-7 px-2 text-xs"
                        >
                          Reindex Workspace
                        </Button>
                      </div>
                    )}
                  </div>
                )}

                {ideSettingsSection === "terminal" && (
                  <div className="space-y-3">
                    <div className="rounded border border-white/10 bg-white/[0.02] px-3 py-2.5 text-xs">
                      <div className="text-gray-200 font-medium">Terminal capability</div>
                      <div
                        className={cn(
                          "mt-1",
                          terminalPanelState.capability === "enabled"
                            ? "text-emerald-300"
                            : terminalPanelState.capability === "disabled"
                              ? "text-amber-300"
                              : "text-gray-400"
                        )}
                      >
                        {terminalCapabilityLabel}
                      </div>
                      {terminalPanelState.capability === "disabled" && (
                        <div className="mt-1 text-gray-500">
                          Enable via <code>--enable-terminal</code> or{" "}
                          <code>terminal_enabled=true</code>.
                        </div>
                      )}
                    </div>
                    <label className="flex items-start gap-2 text-xs text-gray-300">
                      <input
                        type="checkbox"
                        checked={idePreferences.openTerminalOnStartup}
                        onChange={(event) => {
                          updateIdePreferences({ openTerminalOnStartup: event.target.checked });
                          setIsTerminalPanelOpen(event.target.checked);
                        }}
                        className="mt-0.5 rounded border-white/20 bg-black/40"
                      />
                      <span>
                        <span className="text-gray-200 font-medium">
                          Open terminal panel on IDE startup
                        </span>
                        <span className="block text-gray-500 mt-0.5">
                          Uses the stored terminal panel visibility at startup.
                        </span>
                      </span>
                    </label>
                    <label className="flex items-start gap-2 text-xs text-gray-300">
                      <input
                        type="checkbox"
                        checked={idePreferences.autoCreateTerminalOnOpen}
                        onChange={(event) =>
                          updateIdePreferences({ autoCreateTerminalOnOpen: event.target.checked })
                        }
                        className="mt-0.5 rounded border-white/20 bg-black/40"
                      />
                      <span>
                        <span className="text-gray-200 font-medium">
                          Auto-create terminal when panel opens
                        </span>
                        <span className="block text-gray-500 mt-0.5">
                          Create one terminal tab automatically.
                        </span>
                      </span>
                    </label>
                    <label className="block text-xs text-gray-400 space-y-1.5">
                      <span>Terminal panel height (px)</span>
                      <input
                        type="number"
                        min={IDE_TERMINAL_MIN_HEIGHT}
                        max={IDE_TERMINAL_MAX_HEIGHT}
                        value={idePreferences.terminalPanelHeight}
                        onChange={(event) =>
                          updateIdePreferences({
                            terminalPanelHeight: Number.parseInt(
                              event.target.value || String(IDE_TERMINAL_DEFAULT_HEIGHT),
                              10
                            ),
                          })
                        }
                        className="w-44 rounded border border-white/10 bg-black/35 px-2 py-1.5 text-xs text-gray-100 !outline-none focus:border-indigo-500/50"
                      />
                    </label>
                    <div className="flex items-center gap-2">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={openNewTerminal}
                        className="h-7 px-2 text-xs"
                        disabled={terminalPanelState.capability !== "enabled"}
                      >
                        New Terminal
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={toggleTerminalPanel}
                        className="h-7 px-2 text-xs"
                      >
                        {isTerminalPanelOpen ? "Hide Panel" : "Show Panel"}
                      </Button>
                    </div>
                  </div>
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
        <div
          className="absolute inset-0 z-50 bg-black/45 flex items-start justify-center pt-14"
          onMouseDown={() => setShowIndexerSettings(false)}
        >
          <div
            className="w-[760px] max-w-[94vw] rounded-xl border border-white/15 bg-[#0b0b12] shadow-2xl overflow-hidden"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="px-4 py-3 border-b border-white/10 flex items-center justify-between">
              <div>
                <div className="text-sm font-semibold text-gray-100">Workspace Indexer</div>
                <div className="text-xs text-gray-500">
                  Auto-index workspace files for faster quick-open and IDE navigation.
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowIndexerSettings(false)}
                className="p-1 rounded text-gray-500 hover:text-gray-200 hover:bg-white/5"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-4 space-y-4 max-h-[70vh] overflow-y-auto">
              <div className="rounded-lg border border-white/10 bg-white/[0.02] p-3">
                <div className="grid grid-cols-2 gap-3 text-xs">
                  <div>
                    <div className="text-gray-500">Workspace</div>
                    <div className="text-gray-200 truncate" title={effectiveWorkspacePath}>
                      {effectiveWorkspacePath}
                    </div>
                  </div>
                  <div>
                    <div className="text-gray-500">State</div>
                    <div
                      className={cn(
                        "font-medium",
                        indexStatus?.state === "error"
                          ? "text-red-300"
                          : indexStatus?.isIndexing
                            ? "text-indigo-300"
                            : indexStatus?.state === "ready"
                              ? "text-emerald-300"
                              : "text-gray-300"
                      )}
                    >
                      {indexStatus?.state || "idle"}
                      {indexStatus?.isIndexing && " (running)"}
                    </div>
                  </div>
                  <div>
                    <div className="text-gray-500">Indexed Files</div>
                    <div className="text-gray-200 tabular-nums">
                      {indexStatus?.filesIndexed?.toLocaleString() || "0"}
                    </div>
                  </div>
                  <div>
                    <div className="text-gray-500">Last Duration</div>
                    <div className="text-gray-200 tabular-nums">
                      {formatDurationMs(indexStatus?.durationMs)}
                    </div>
                  </div>
                  <div>
                    <div className="text-gray-500">Progress</div>
                    <div className="text-gray-200 tabular-nums">
                      {typeof indexStatus?.progress === "number"
                        ? `${indexStatus.progress}%`
                        : "0%"}
                    </div>
                  </div>
                  <div>
                    <div className="text-gray-500">Last Indexed</div>
                    <div className="text-gray-200">
                      {indexStatus?.lastIndexedAt
                        ? new Date(indexStatus.lastIndexedAt).toLocaleString()
                        : "Never"}
                    </div>
                  </div>
                  <div>
                    <div className="text-gray-500">Semantic Index</div>
                    <div
                      className={cn(
                        "font-medium",
                        indexStatus?.semanticReady ? "text-emerald-300" : "text-gray-300"
                      )}
                    >
                      {indexStatus?.semanticReady ? "ready" : "disabled/unavailable"}
                    </div>
                  </div>
                  <div>
                    <div className="text-gray-500">Semantic Chunks</div>
                    <div className="text-gray-200 tabular-nums">
                      {indexStatus?.semanticIndexedChunks?.toLocaleString() || "0"}
                    </div>
                  </div>
                  <div>
                    <div className="text-gray-500">Embedding Provider</div>
                    <div className="text-gray-200 truncate">
                      {indexStatus?.semanticProvider && indexStatus?.semanticProvider !== "none"
                        ? `${indexStatus.semanticProvider}${indexStatus.semanticModel ? ` · ${indexStatus.semanticModel}` : ""}`
                        : "none"}
                    </div>
                  </div>
                  <div>
                    <div className="text-gray-500">Configured Embedding</div>
                    <div className="text-gray-200 truncate">
                      {activeIndexSettings.embeddingProvider}
                      {activeIndexSettings.embeddingModel
                        ? ` · ${activeIndexSettings.embeddingModel}`
                        : ""}
                    </div>
                  </div>
                </div>
                <div className="mt-3 h-1.5 w-full rounded bg-white/10 overflow-hidden">
                  <div
                    className={cn(
                      "h-full transition-all",
                      indexStatus?.state === "error" ? "bg-red-500/80" : "bg-indigo-500/80"
                    )}
                    style={{ width: `${Math.max(0, Math.min(indexStatus?.progress || 0, 100))}%` }}
                  />
                </div>
                {indexStatus?.semanticError && (
                  <div className="mt-2 text-[11px] text-amber-300/90">
                    Semantic index note: {indexStatus.semanticError}
                  </div>
                )}
              </div>

              <div className="rounded-lg border border-white/10 bg-white/[0.02] p-3 space-y-3">
                <label className="flex items-center gap-2 text-xs text-gray-200">
                  <input
                    type="checkbox"
                    checked={activeIndexSettings.enabled}
                    onChange={(event) => {
                      setIndexSettingsDraft({
                        ...activeIndexSettings,
                        enabled: event.target.checked,
                      });
                      setIndexSettingsDirty(true);
                    }}
                    className="rounded border-white/20 bg-black/40"
                  />
                  Enable workspace indexer
                </label>
                <label className="flex items-center gap-2 text-xs text-gray-300">
                  <input
                    type="checkbox"
                    checked={activeIndexSettings.autoReindexOnWorkspaceSet}
                    onChange={(event) => {
                      setIndexSettingsDraft({
                        ...activeIndexSettings,
                        autoReindexOnWorkspaceSet: event.target.checked,
                      });
                      setIndexSettingsDirty(true);
                    }}
                    className="rounded border-white/20 bg-black/40"
                  />
                  Auto-reindex when workspace is set
                </label>
                <label className="flex items-center gap-2 text-xs text-gray-300">
                  <input
                    type="checkbox"
                    checked={activeIndexSettings.includeHidden}
                    onChange={(event) => {
                      setIndexSettingsDraft({
                        ...activeIndexSettings,
                        includeHidden: event.target.checked,
                      });
                      setIndexSettingsDirty(true);
                    }}
                    className="rounded border-white/20 bg-black/40"
                  />
                  Include hidden files/folders
                </label>
                <label className="flex items-center gap-2 text-xs text-gray-300">
                  <input
                    type="checkbox"
                    checked={activeIndexSettings.semanticEnabled}
                    onChange={(event) => {
                      setIndexSettingsDraft({
                        ...activeIndexSettings,
                        semanticEnabled: event.target.checked,
                      });
                      setIndexSettingsDirty(true);
                    }}
                    className="rounded border-white/20 bg-black/40"
                  />
                  Enable semantic vector index (embeddings)
                </label>

                <div className="grid grid-cols-2 gap-3">
                  <label className="text-xs text-gray-400 space-y-1">
                    <span>Max files</span>
                    <input
                      type="number"
                      min={100}
                      max={1000000}
                      value={activeIndexSettings.maxFiles}
                      onChange={(event) => {
                        const parsed = Number.parseInt(event.target.value || "", 10);
                        setIndexSettingsDraft({
                          ...activeIndexSettings,
                          maxFiles: Number.isFinite(parsed) ? Math.max(100, parsed) : 100,
                        });
                        setIndexSettingsDirty(true);
                      }}
                      className="w-full rounded border border-white/10 bg-black/35 px-2 py-1.5 text-xs text-gray-100 !outline-none focus:border-indigo-500/50"
                    />
                  </label>
                  <label className="text-xs text-gray-400 space-y-1">
                    <span>Max file size (MB)</span>
                    <input
                      type="number"
                      min={0.1}
                      max={100}
                      step={0.1}
                      value={(activeIndexSettings.maxFileSizeBytes / (1024 * 1024)).toFixed(1)}
                      onChange={(event) => {
                        const parsed = Number.parseFloat(event.target.value || "");
                        const nextMb = Number.isFinite(parsed) ? Math.max(0.1, parsed) : 0.1;
                        setIndexSettingsDraft({
                          ...activeIndexSettings,
                          maxFileSizeBytes: Math.round(nextMb * 1024 * 1024),
                        });
                        setIndexSettingsDirty(true);
                      }}
                      className="w-full rounded border border-white/10 bg-black/35 px-2 py-1.5 text-xs text-gray-100 !outline-none focus:border-indigo-500/50"
                    />
                  </label>
                  <label className="text-xs text-gray-400 space-y-1">
                    <span>Semantic max files</span>
                    <input
                      type="number"
                      min={100}
                      max={50000}
                      value={activeIndexSettings.semanticMaxFiles}
                      onChange={(event) => {
                        const parsed = Number.parseInt(event.target.value || "", 10);
                        setIndexSettingsDraft({
                          ...activeIndexSettings,
                          semanticMaxFiles: Number.isFinite(parsed) ? Math.max(100, parsed) : 100,
                        });
                        setIndexSettingsDirty(true);
                      }}
                      className="w-full rounded border border-white/10 bg-black/35 px-2 py-1.5 text-xs text-gray-100 !outline-none focus:border-indigo-500/50"
                    />
                  </label>
                  <label className="text-xs text-gray-400 space-y-1">
                    <span>Semantic min score</span>
                    <input
                      type="number"
                      min={0.05}
                      max={0.99}
                      step={0.05}
                      value={activeIndexSettings.semanticMinScore}
                      onChange={(event) => {
                        const parsed = Number.parseFloat(event.target.value || "");
                        const nextValue = Number.isFinite(parsed)
                          ? Math.min(0.99, Math.max(0.05, parsed))
                          : 0.45;
                        setIndexSettingsDraft({
                          ...activeIndexSettings,
                          semanticMinScore: Number(nextValue.toFixed(2)),
                        });
                        setIndexSettingsDirty(true);
                      }}
                      className="w-full rounded border border-white/10 bg-black/35 px-2 py-1.5 text-xs text-gray-100 !outline-none focus:border-indigo-500/50"
                    />
                  </label>
                </div>

                <label className="block text-xs text-gray-400 space-y-1">
                  <span>Ignored directories (comma separated)</span>
                  <input
                    type="text"
                    value={activeIndexSettings.ignoreDirs.join(", ")}
                    onChange={(event) => {
                      const values = event.target.value
                        .split(",")
                        .map((item) => item.trim())
                        .filter(Boolean)
                        .map((item) => item.toLowerCase());
                      setIndexSettingsDraft({
                        ...activeIndexSettings,
                        ignoreDirs: values,
                      });
                      setIndexSettingsDirty(true);
                    }}
                    className="w-full rounded border border-white/10 bg-black/35 px-2 py-1.5 text-xs text-gray-100 !outline-none focus:border-indigo-500/50"
                    placeholder=".git, node_modules, dist"
                  />
                </label>

                <label className="block text-xs text-gray-400 space-y-1">
                  <span>Include extensions (optional, comma separated)</span>
                  <input
                    type="text"
                    value={activeIndexSettings.includeExtensions.join(", ")}
                    onChange={(event) => {
                      const values = event.target.value
                        .split(",")
                        .map((item) => item.trim().toLowerCase())
                        .filter(Boolean)
                        .map((item) => (item.startsWith(".") ? item : `.${item}`));
                      setIndexSettingsDraft({
                        ...activeIndexSettings,
                        includeExtensions: values,
                      });
                      setIndexSettingsDirty(true);
                    }}
                    className="w-full rounded border border-white/10 bg-black/35 px-2 py-1.5 text-xs text-gray-100 !outline-none focus:border-indigo-500/50"
                    placeholder=".ts, .tsx, .js"
                  />
                </label>
              </div>

              {indexSettingsMessage && (
                <div className="rounded border border-emerald-500/25 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-300">
                  {indexSettingsMessage}
                </div>
              )}
              {indexSettingsError && (
                <div className="rounded border border-red-500/25 bg-red-500/10 px-3 py-2 text-xs text-red-300">
                  {indexSettingsError}
                </div>
              )}
            </div>

            <div className="px-4 py-3 border-t border-white/10 flex items-center justify-between gap-2">
              <div className="text-[11px] text-gray-500">
                {indexStatusLoading ? "Refreshing status..." : "Status updates while indexing."}
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => void runWorkspaceReindex()}
                  disabled={indexActionLoading || indexStatus?.isIndexing}
                  className="h-7 px-2 text-xs"
                >
                  Reindex Now
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => void stopWorkspaceIndexing()}
                  disabled={indexActionLoading || !indexStatus?.isIndexing}
                  className="h-7 px-2 text-xs"
                >
                  Stop
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => void fetchEmbeddingCatalog()}
                  disabled={embeddingCatalogLoading || indexActionLoading}
                  className="h-7 px-2 text-xs"
                >
                  Refresh Models
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => void saveIndexSettings()}
                  disabled={indexActionLoading || !indexSettingsDirty}
                  className="h-7 px-2 text-xs"
                >
                  Save Settings
                </Button>
              </div>
            </div>
          </div>
        </div>
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

      <div className="h-8 border-t border-white/10 bg-black/30 px-3 flex items-center justify-between text-xs">
        <div className="flex items-center gap-3">
          <span className="text-gray-600">Ready</span>
          <GitStatus path={rootInfo?.path || currentPath} compact />
        </div>
        <div className="flex items-center gap-3">
          <span className="text-gray-500 tabular-nums">
            {selectedFile
              ? `Ln ${cursorPosition?.line || 1}, Col ${cursorPosition?.column || 1}`
              : "Ln -, Col -"}
          </span>
          <span className="text-gray-600">{statusEncoding || "-"}</span>
          <span className="text-gray-600">{statusEol || "-"}</span>
          <span className="text-gray-600">{statusIndent || "-"}</span>
          <span className="text-gray-500">{statusLanguage || "-"}</span>
          {gitHistoryStatusLabel && (
            <span
              className={cn(
                "inline-flex items-center gap-1",
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
          <span className="text-gray-600">
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
              "text-xs transition-colors inline-flex items-center gap-1",
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
                "text-xs transition-colors",
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
          <LSPStatus
            compact
            activeFilePath={selectedFile?.path || null}
            activeExtension={selectedFile?.extension || null}
          />
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
