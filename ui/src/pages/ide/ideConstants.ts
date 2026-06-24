/** IDE layout/storage constants and default preferences — extracted from IDE.tsx. */
import type { IdePreferences, WorkspaceIndexerSettings } from "./ideTypes";

export const IDE_SIDEBAR_WIDTH_STORAGE_KEY = "cybara.ide.sidebar.width";
export const IDE_SIDEBAR_DEFAULT_WIDTH = 280;
export const IDE_SIDEBAR_MIN_WIDTH = 220;
export const IDE_SIDEBAR_MAX_WIDTH = 520;
export const IDE_CHAT_WIDTH_STORAGE_KEY = "cybara.ide.chat.width";
export const IDE_CHAT_OPEN_STORAGE_KEY = "cybara.ide.chat.open";
export const IDE_CHAT_DEFAULT_WIDTH = 420;
export const IDE_CHAT_MIN_WIDTH = 320;
export const IDE_CHAT_MAX_WIDTH = 720;
export const IDE_WORKSPACE_PATH_STORAGE_KEY = "cybara.ide.workspace.path";
export const IDE_CHAT_AGENT_STORAGE_KEY = "cybara.ide.chat.agent";
export const IDE_TERMINAL_OPEN_STORAGE_KEY = "cybara.ide.terminal.open";
export const IDE_SETTINGS_STORAGE_KEY = "cybara.ide.settings";
export const EXPLORER_VIRTUALIZATION_MIN_ENTRIES = 400;
export const EXPLORER_VIRTUALIZATION_ROW_HEIGHT = 30;
export const EXPLORER_VIRTUALIZATION_OVERSCAN = 12;
export const EDITOR_LARGE_FILE_CHAR_THRESHOLD = 400_000;
export const EDITOR_LARGE_FILE_LINE_THRESHOLD = 8_000;
export const COMPLETION_LOCAL_SCAN_BEFORE = 24_000;
export const COMPLETION_LOCAL_SCAN_AFTER = 8_000;
export const COMPLETION_CACHE_TTL_MS = 20_000;
export const COMPLETION_CACHE_MAX_ENTRIES = 180;
export const EDITOR_TYPING_BURST_MS = 160;
export const EDITOR_FONT_SIZE_PX = 14;
export const EDITOR_LINE_HEIGHT_PX = 22;
export const IDE_TERMINAL_DEFAULT_HEIGHT = 240;
export const IDE_TERMINAL_MIN_HEIGHT = 120;
export const IDE_TERMINAL_MAX_HEIGHT = 520;
export const IDE_DEFAULT_PREFERENCES: IdePreferences = {
  editorFontSizePx: EDITOR_FONT_SIZE_PX,
  editorLineHeightPx: EDITOR_LINE_HEIGHT_PX,
  showMinimap: true,
  enableCompletions: false,
  enableGhostCompletions: false,
  completionDebounceMs: 110,
  ghostDebounceMs: 240,
  useChatAgentForCompletions: false,
  completionAgentId: "",
  openTerminalOnStartup: false,
  autoCreateTerminalOnOpen: false,
  terminalPanelHeight: IDE_TERMINAL_DEFAULT_HEIGHT,
};
export const DEFAULT_INDEXER_SETTINGS_DRAFT: WorkspaceIndexerSettings = {
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
