/** Shared IDE type definitions — extracted from IDE.tsx. */
import type { LiveActivityItem, ToolCallLike } from "@/lib/chatActivities";
export interface FileEntry {
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

export interface BrowseResult {
  success: boolean;
  path: string;
  parent: string | null;
  entries: FileEntry[];
  error?: string;
}

export interface ReadResult {
  success: boolean;
  path: string;
  content?: string;
  size?: number;
  extension?: string;
  isBinary?: boolean;
  error?: string;
}

export interface Diagnostic {
  line: number;
  character: number;
  endLine: number;
  endCharacter: number;
  severity: "error" | "warning" | "info";
  message: string;
  source?: string;
  code?: string | number;
}

export interface LspActiveServer {
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

export interface IdeSearchMatch {
  line: number;
  column: number;
  text: string;
}

export interface IdeSearchFileResult {
  file: string;
  matches: IdeSearchMatch[];
  count: number;
}

export interface IdeSearchResult {
  success: boolean;
  path: string;
  query: string;
  totalMatches: number;
  truncated: boolean;
  files: IdeSearchFileResult[];
  error?: string;
}

export interface IdeReplaceResult {
  success: boolean;
  path: string;
  query: string;
  replacement: string;
  changedFiles: Array<{ file: string; replacements: number }>;
  totalReplacements: number;
  error?: string;
}

export interface IdeReplacePreviewFile {
  file: string;
  replacements: number;
  preview: Array<{ line: number; before: string; after: string }>;
}

export interface IdeReplacePreviewResult {
  success: boolean;
  path: string;
  query: string;
  replacement: string;
  totalReplacements: number;
  files: IdeReplacePreviewFile[];
  truncated: boolean;
  error?: string;
}

export interface IdeListFilesResult {
  success: boolean;
  path: string;
  query: string;
  totalFiles: number;
  truncated: boolean;
  files: Array<{ path: string; relativePath: string }>;
  error?: string;
}

export interface WorkspaceIndexerSettings {
  enabled: boolean;
  autoReindexOnWorkspaceSet: boolean;
  includeHidden: boolean;
  maxFileSizeBytes: number;
  maxFiles: number;
  semanticEnabled: boolean;
  semanticMaxFiles: number;
  semanticMinScore: number;
  embeddingProvider:
    | "auto"
    | "openai"
    | "voyage"
    | "gemini"
    | "ollama"
    | "transformers_js"
    | "local";
  embeddingModel: string;
  ignoreDirs: string[];
  includeExtensions: string[];
}

export interface WorkspaceEmbeddingProviderOption {
  id: "auto" | "openai" | "voyage" | "gemini" | "ollama" | "transformers_js" | "local";
  label: string;
  local: boolean;
  available: boolean;
  reason?: string;
  defaultModel: string;
  models: string[];
}

export interface WorkspaceEmbeddingCatalogResponse {
  success: boolean;
  selected?: {
    provider: WorkspaceIndexerSettings["embeddingProvider"];
    model: string;
  };
  providers?: WorkspaceEmbeddingProviderOption[];
  error?: string;
}

export interface WorkspaceEmbeddingRuntimeModelStatus {
  model: string;
  state: "idle" | "loading" | "ready" | "error";
  loadedAt: string | null;
  lastUsedAt: string | null;
  lastError: string | null;
  device?: string;
  dtype?: string;
  cacheDir?: string;
  loadProgress?: number | null;
  loadStatus?: string | null;
  estimatedModelBytes?: number | null;
  residentMemoryBytes?: number | null;
  vramBytes?: number | null;
  memoryNote?: string | null;
}

export interface WorkspaceEmbeddingRuntimeResponse {
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

export interface WorkspaceIndexerStatusResponse {
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

export interface WorkspaceIndexerSearchResult extends IdeListFilesResult {
  source?: "index" | "filesystem";
  indexed?: boolean;
  indexState?: "idle" | "indexing" | "ready" | "stopped" | "error";
  indexError?: string;
  workspacePath?: string;
}

export interface IdeBlameLine {
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

export interface IdeBlameResult {
  success: boolean;
  path: string;
  isRepo: boolean;
  truncated: boolean;
  lines: IdeBlameLine[];
  error?: string;
}

export type GitHistoryStatus = "idle" | "loading" | "ready" | "unavailable" | "error";

export interface IdeTab {
  path: string;
  name: string;
  extension?: string;
  previewMode?: boolean;
}

export interface IdeChatMessage {
  role: "user" | "assistant";
  content: string;
  timestamp: string;
  thinking?: string;
  tool_calls?: ToolCallLike[];
  process_activities?: IdeProcessActivity[];
}

export interface IdeChatAgentOption {
  id: string;
  name: string;
  status?: string;
}

export type IdeProcessActivity = LiveActivityItem;

export interface IdeFileChangeItem {
  path: string;
  type: "created" | "updated" | "deleted";
  added: number;
  removed: number;
  diff?: string;
}

export interface IdeFileChangeSummary {
  files: IdeFileChangeItem[];
  totalAdded: number;
  totalRemoved: number;
}

export interface IdePendingFileDiff {
  key: string;
  messageKey: string;
  path: string;
  type: IdeFileChangeItem["type"];
  added: number;
  removed: number;
  diff?: string;
}

export interface IdePendingFileDiffController {
  items: IdePendingFileDiff[];
  acceptFile: (fileKey: string) => void;
  rejectFile: (fileKey: string) => Promise<void>;
  acceptAll: () => void;
  rejectAll: () => Promise<void>;
}

export interface TreeContextMenuState {
  x: number;
  y: number;
  entry: FileEntry;
}

export interface IdeCommandItem {
  id: string;
  label: string;
  detail?: string;
  shortcut?: string;
  run: () => void;
}

export interface IdeOutlineSymbol {
  name: string;
  kind: number;
  detail?: string;
  line: number;
  character: number;
  endLine: number;
  endCharacter: number;
  children?: IdeOutlineSymbol[];
}

export interface IdeOutlineResponse {
  success: boolean;
  path: string;
  symbols: IdeOutlineSymbol[];
  error?: string;
}

export interface IdeCompletionItem {
  label: string;
  detail?: string;
  kind?: number;
  insertText?: string;
  sortText?: string;
}

export interface IdeCompletionResponse {
  success: boolean;
  items: IdeCompletionItem[];
  error?: string;
}

export interface IdeInlineCompletionResponse {
  success: boolean;
  completion?: string;
  error?: string;
  agentId?: string;
  model?: string;
  provider?: string;
}

export interface FlattenedOutlineSymbol extends IdeOutlineSymbol {
  depth: number;
  key: string;
}

export interface IdeBreadcrumb {
  label: string;
  path: string;
  isFile: boolean;
}

export type IdeSettingsSectionId = "general" | "editor" | "indexing" | "terminal";
export type IdeTopMenuId = "file" | "edit" | "view" | "terminal" | "go";

export interface IdePreferences {
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
