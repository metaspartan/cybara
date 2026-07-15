/** IDE localStorage persistence helpers — extracted from IDE.tsx. */
import type { IdePreferences, IdeTab } from "./ideTypes";
import {
  IDE_SIDEBAR_DEFAULT_WIDTH,
  IDE_SIDEBAR_MIN_WIDTH,
  IDE_SIDEBAR_MAX_WIDTH,
  IDE_CHAT_DEFAULT_WIDTH,
  IDE_CHAT_MIN_WIDTH,
  IDE_CHAT_MAX_WIDTH,
  IDE_TERMINAL_DEFAULT_HEIGHT,
  IDE_TERMINAL_MIN_HEIGHT,
  IDE_TERMINAL_MAX_HEIGHT,
  IDE_DEFAULT_PREFERENCES,
  IDE_SIDEBAR_WIDTH_STORAGE_KEY,
  IDE_CHAT_WIDTH_STORAGE_KEY,
  IDE_CHAT_OPEN_STORAGE_KEY,
  IDE_CHAT_SESSIONS_STORAGE_KEY,
  IDE_WORKSPACE_PATH_STORAGE_KEY,
  IDE_CHAT_AGENT_STORAGE_KEY,
  IDE_TERMINAL_OPEN_STORAGE_KEY,
  IDE_SETTINGS_STORAGE_KEY,
  EDITOR_FONT_SIZE_PX,
  EDITOR_LINE_HEIGHT_PX,
} from "./ideConstants";

export function clampSidebarWidth(width: number): number {
  if (!Number.isFinite(width)) return IDE_SIDEBAR_DEFAULT_WIDTH;
  return Math.min(IDE_SIDEBAR_MAX_WIDTH, Math.max(IDE_SIDEBAR_MIN_WIDTH, Math.round(width)));
}

export function readPersistedSidebarWidth(): number {
  if (typeof window === "undefined") return IDE_SIDEBAR_DEFAULT_WIDTH;
  const raw = window.localStorage.getItem(IDE_SIDEBAR_WIDTH_STORAGE_KEY);
  if (!raw) return IDE_SIDEBAR_DEFAULT_WIDTH;
  const parsed = Number.parseInt(raw, 10);
  return clampSidebarWidth(parsed);
}

export function persistSidebarWidth(width: number): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(IDE_SIDEBAR_WIDTH_STORAGE_KEY, String(clampSidebarWidth(width)));
}

export function clampChatWidth(width: number): number {
  if (!Number.isFinite(width)) return IDE_CHAT_DEFAULT_WIDTH;
  return Math.min(IDE_CHAT_MAX_WIDTH, Math.max(IDE_CHAT_MIN_WIDTH, Math.round(width)));
}

export function readPersistedChatWidth(): number {
  if (typeof window === "undefined") return IDE_CHAT_DEFAULT_WIDTH;
  const raw = window.localStorage.getItem(IDE_CHAT_WIDTH_STORAGE_KEY);
  if (!raw) return IDE_CHAT_DEFAULT_WIDTH;
  const parsed = Number.parseInt(raw, 10);
  return clampChatWidth(parsed);
}

export function persistChatWidth(width: number): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(IDE_CHAT_WIDTH_STORAGE_KEY, String(clampChatWidth(width)));
}

export function readPersistedChatOpen(): boolean {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(IDE_CHAT_OPEN_STORAGE_KEY) === "1";
}

export function persistChatOpen(isOpen: boolean): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(IDE_CHAT_OPEN_STORAGE_KEY, isOpen ? "1" : "0");
}

const IDE_CHAT_SESSION_LIMIT = 40;

function normalizeWorkspaceSessionKey(workspaceDir: string): string {
  return workspaceDir.trim().replace(/[\\/]+$/, "") || "~";
}

function readIdeChatSessionMap(): Record<string, string> {
  if (typeof window === "undefined") return {};
  try {
    const parsed = JSON.parse(
      window.localStorage.getItem(IDE_CHAT_SESSIONS_STORAGE_KEY) || "{}"
    ) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const sessions: Record<string, string> = {};
    for (const [workspaceDir, sessionId] of Object.entries(parsed)) {
      if (typeof sessionId === "string" && sessionId.trim()) {
        sessions[workspaceDir] = sessionId.trim();
      }
    }
    return sessions;
  } catch {
    return {};
  }
}

export function readPersistedIdeChatSessionId(workspaceDir: string): string | null {
  return readIdeChatSessionMap()[normalizeWorkspaceSessionKey(workspaceDir)] || null;
}

export function persistIdeChatSessionId(workspaceDir: string, sessionId: string | null): void {
  if (typeof window === "undefined") return;
  const workspaceKey = normalizeWorkspaceSessionKey(workspaceDir);
  const sessions = readIdeChatSessionMap();
  delete sessions[workspaceKey];
  if (sessionId?.trim()) sessions[workspaceKey] = sessionId.trim();
  const entries = Object.entries(sessions).slice(-IDE_CHAT_SESSION_LIMIT);
  window.localStorage.setItem(
    IDE_CHAT_SESSIONS_STORAGE_KEY,
    JSON.stringify(Object.fromEntries(entries))
  );
}

export function readPersistedWorkspacePath(): string {
  if (typeof window === "undefined") return "~";
  const raw = window.localStorage.getItem(IDE_WORKSPACE_PATH_STORAGE_KEY);
  if (!raw || !raw.trim()) return "~";
  return raw.trim();
}

export function persistWorkspacePath(pathValue: string): void {
  if (typeof window === "undefined") return;
  const normalized = pathValue.trim();
  if (!normalized) return;
  window.localStorage.setItem(IDE_WORKSPACE_PATH_STORAGE_KEY, normalized);
}

export function readPersistedIdeChatAgentId(): string {
  if (typeof window === "undefined") return "";
  const raw = window.localStorage.getItem(IDE_CHAT_AGENT_STORAGE_KEY);
  return raw && raw.trim() ? raw.trim() : "";
}

export function persistIdeChatAgentId(agentId: string): void {
  if (typeof window === "undefined") return;
  const normalized = agentId.trim();
  if (!normalized) {
    window.localStorage.removeItem(IDE_CHAT_AGENT_STORAGE_KEY);
    return;
  }
  window.localStorage.setItem(IDE_CHAT_AGENT_STORAGE_KEY, normalized);
}

export function clampTerminalHeight(height: number): number {
  if (!Number.isFinite(height)) return IDE_TERMINAL_DEFAULT_HEIGHT;
  return Math.min(IDE_TERMINAL_MAX_HEIGHT, Math.max(IDE_TERMINAL_MIN_HEIGHT, Math.round(height)));
}

export function readPersistedTerminalOpen(defaultOpen: boolean): boolean {
  if (typeof window === "undefined") return defaultOpen;
  const raw = window.localStorage.getItem(IDE_TERMINAL_OPEN_STORAGE_KEY);
  if (raw === "1") return true;
  if (raw === "0") return false;
  return defaultOpen;
}

export function persistTerminalOpen(isOpen: boolean): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(IDE_TERMINAL_OPEN_STORAGE_KEY, isOpen ? "1" : "0");
}

export function readPersistedIdePreferences(): IdePreferences {
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

export function persistIdePreferences(preferences: IdePreferences): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(IDE_SETTINGS_STORAGE_KEY, JSON.stringify(preferences));
}

// --- Open-tab persistence (restore open files on reload) ---

const IDE_OPEN_TABS_STORAGE_KEY = "cybara.ide.openTabs";
const IDE_ACTIVE_TAB_STORAGE_KEY = "cybara.ide.activeTab";

export function readPersistedOpenTabs(): { tabs: IdeTab[]; activeTabPath: string | null } {
  if (typeof window === "undefined") return { tabs: [], activeTabPath: null };
  try {
    const raw = window.localStorage.getItem(IDE_OPEN_TABS_STORAGE_KEY);
    const parsed = raw ? (JSON.parse(raw) as IdeTab[]) : [];
    const tabs = Array.isArray(parsed)
      ? parsed
          .filter(
            (t) =>
              t &&
              typeof t === "object" &&
              typeof (t as IdeTab).path === "string" &&
              typeof (t as IdeTab).name === "string"
          )
          .slice(0, 20) // cap to avoid unbounded restore
      : [];
    const activeTabPath = window.localStorage.getItem(IDE_ACTIVE_TAB_STORAGE_KEY);
    return {
      tabs,
      activeTabPath: activeTabPath && typeof activeTabPath === "string" ? activeTabPath : null,
    };
  } catch {
    return { tabs: [], activeTabPath: null };
  }
}

export function persistOpenTabs(tabs: IdeTab[], activeTabPath: string | null): void {
  if (typeof window === "undefined") return;
  try {
    // Only persist path + name (not transient fields); cap to 20.
    const minimal = tabs.slice(0, 20).map((t) => ({
      path: t.path,
      name: t.name,
      extension: t.extension,
      previewMode: t.previewMode,
    }));
    window.localStorage.setItem(IDE_OPEN_TABS_STORAGE_KEY, JSON.stringify(minimal));
    if (activeTabPath) {
      window.localStorage.setItem(IDE_ACTIVE_TAB_STORAGE_KEY, activeTabPath);
    } else {
      window.localStorage.removeItem(IDE_ACTIVE_TAB_STORAGE_KEY);
    }
  } catch {
    /* localStorage may be full or unavailable — best-effort */
  }
}
