import {
  ArrowLeft,
  AudioLines,
  BarChart3,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Code,
  FileText,
  FlaskConical,
  FolderOpen,
  Gauge,
  GripHorizontal,
  LayoutDashboard,
  ListTodo,
  Menu,
  MessageSquarePlus,
  MessagesSquare,
  MoreHorizontal,
  Search,
  Settings,
  Sparkles,
  SquareTerminal,
  Wallet as WalletIcon,
  X,
} from "lucide-react";
import type { KeyboardEvent, PointerEvent as ReactPointerEvent } from "react";
import { createContext, useContext, useEffect, useRef, useState } from "react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import { CybaraThinkingMark } from "@/components/CybaraThinkingMark";
import { SettingsNavigation } from "@/components/settings/SettingsNavigation";
import { useInfo } from "@/hooks/useApi";
import { useSidebarNavigationLayout } from "@/hooks/useSidebarNavigationLayout";
import { useI18n } from "@/lib/i18n";
import { resolveSettingsSectionId, type SettingsSectionId } from "@/lib/settingsNavigation";
import { settingsApi } from "@/lib/api";
import { readLabSettings } from "@/lib/labSettings";
import type { SidebarDestinationId, SidebarPrimaryItemId } from "@/lib/sidebarNavigation";
import { connectStatusStream } from "@/lib/status-stream";
import { cn } from "@/lib/utils";
import { SessionsPanel } from "@/pages/chat/SessionSidebar";
import { buildFreshChatPath } from "@/pages/chat/chatRoute";
import { buildMultiChatPath, isMultiChatSearch } from "@/pages/chat/multiChatLayout";
import type { TranslationKey } from "../../../../shared/i18n/catalog";
import {
  clampMainSidebarChatHeight,
  clampMainSidebarWidth,
  MAIN_SIDEBAR_CHAT_HEIGHT_DEFAULT,
  MAIN_SIDEBAR_CHAT_HEIGHT_MAX,
  MAIN_SIDEBAR_CHAT_HEIGHT_MIN,
  MAIN_SIDEBAR_CHAT_HEIGHT_MORE_OPEN_MIN,
  MAIN_SIDEBAR_CHAT_HEIGHT_STORAGE_KEY,
  MAIN_SIDEBAR_DEFAULT_WIDTH,
  MAIN_SIDEBAR_MAX_WIDTH,
  MAIN_SIDEBAR_MIN_WIDTH,
  MAIN_SIDEBAR_WIDTH_STORAGE_KEY,
  parseMainSidebarChatHeight,
  parseMainSidebarWidth,
  resolveMainSidebarChatHeight,
  resolveMainSidebarChatMaxHeight,
  usesAvailableMainSidebarChatHeight,
} from "./sidebarSizing";
import { UpdateButton } from "./UpdateButton";
import {
  pruneInactiveSessions,
  reconcileActiveSessionSnapshot,
  SIDEBAR_ACTIVE_SESSION_WINDOW_MS,
  SIDEBAR_ACTIVE_STATUSES,
} from "./activeSessionTracker";
import { isRunEndingStatus } from "@/pages/chat/sessionRunStatus";

interface SidebarContextType {
  collapsed: boolean;
  setCollapsed: (collapsed: boolean) => void;
  width: number;
  setWidth: (width: number | ((current: number) => number)) => void;
  mobileOpen: boolean;
  setMobileOpen: (open: boolean) => void;
}

const SidebarContext = createContext<SidebarContextType>({
  collapsed: false,
  setCollapsed: () => {},
  width: MAIN_SIDEBAR_DEFAULT_WIDTH,
  setWidth: () => {},
  mobileOpen: false,
  setMobileOpen: () => {},
});

export function useSidebar() {
  return useContext(SidebarContext);
}

export function SidebarProvider({ children }: { children: React.ReactNode }) {
  const [collapsed, setCollapsed] = useState(() => {
    const saved = localStorage.getItem("sidebar-collapsed");
    return saved === "true";
  });
  const [mobileOpen, setMobileOpen] = useState(false);
  const [width, setWidth] = useState(() =>
    parseMainSidebarWidth(localStorage.getItem(MAIN_SIDEBAR_WIDTH_STORAGE_KEY))
  );

  useEffect(() => {
    localStorage.setItem("sidebar-collapsed", String(collapsed));
  }, [collapsed]);

  useEffect(() => {
    localStorage.setItem(MAIN_SIDEBAR_WIDTH_STORAGE_KEY, String(width));
  }, [width]);

  return (
    <SidebarContext.Provider
      value={{
        collapsed,
        setCollapsed,
        width,
        setWidth,
        mobileOpen,
        setMobileOpen,
      }}
    >
      {children}
    </SidebarContext.Provider>
  );
}

function useAgentStatus() {
  const [status, setStatus] = useState<"idle" | "active">("idle");
  const [activeSessionIds, setActiveSessionIds] = useState<string[]>([]);
  const activeSessionLastSeenRef = useRef<Map<string, number>>(new Map());
  const globalLastSeenRef = useRef<number>(0);

  useEffect(() => {
    const refreshDerivedStatus = () => {
      const now = Date.now();
      activeSessionLastSeenRef.current = pruneInactiveSessions(
        activeSessionLastSeenRef.current,
        now,
        SIDEBAR_ACTIVE_SESSION_WINDOW_MS
      );
      const globalActive =
        globalLastSeenRef.current > 0 &&
        now - globalLastSeenRef.current <= SIDEBAR_ACTIVE_SESSION_WINDOW_MS;
      const hasActiveSessions = activeSessionLastSeenRef.current.size > 0;
      setStatus(globalActive || hasActiveSessions ? "active" : "idle");
      setActiveSessionIds([...activeSessionLastSeenRef.current.keys()]);
    };

    const sweepInterval = setInterval(() => {
      refreshDerivedStatus();
    }, 2000);

    const disconnect = connectStatusStream({
      onEvent: (data) => {
        if (!data || typeof data !== "object" || typeof data.type !== "string") return;
        const now = Date.now();

        if (data.type === "snapshot") {
          const activeSessions = Array.isArray(data.activeSessions) ? data.activeSessions : [];
          activeSessionLastSeenRef.current = reconcileActiveSessionSnapshot(
            activeSessionLastSeenRef.current,
            activeSessions,
            now
          );
          refreshDerivedStatus();
          return;
        }

        if (data.type === "task_completed") {
          const sessionId = typeof data.sessionId === "string" ? data.sessionId.trim() : "";
          if (sessionId) {
            activeSessionLastSeenRef.current.delete(sessionId);
          } else {
            activeSessionLastSeenRef.current.clear();
            globalLastSeenRef.current = 0;
          }
          refreshDerivedStatus();
          return;
        }

        if (data.type !== "status") return;

        const statusValue = data.status;
        const sessionId = typeof data.sessionId === "string" ? data.sessionId.trim() : "";
        const runEnded = isRunEndingStatus(data);
        const isActiveStatus = !runEnded && SIDEBAR_ACTIVE_STATUSES.has(statusValue);

        if (sessionId) {
          if (isActiveStatus) {
            activeSessionLastSeenRef.current.set(sessionId, now);
          } else if (runEnded) {
            activeSessionLastSeenRef.current.delete(sessionId);
          }
        } else {
          if (isActiveStatus) {
            globalLastSeenRef.current = now;
          } else if (runEnded) {
            globalLastSeenRef.current = 0;
          }
        }
        refreshDerivedStatus();
      },
    });

    return () => {
      disconnect();
      clearInterval(sweepInterval);
    };
  }, []);

  return { activeSessionIds, status };
}

type SidebarNavItem = {
  path: string;
  icon: React.ComponentType<{ className?: string }>;
  label?: string;
  labelKey?: TranslationKey;
};

const sidebarDestinations: Record<SidebarDestinationId, SidebarNavItem> = {
  dashboard: { path: "/", icon: LayoutDashboard, labelKey: "nav.dashboard" },
  ide: { path: "/ide", icon: FolderOpen, labelKey: "nav.ide" },
  usage: { path: "/usage", icon: Gauge, labelKey: "nav.usage" },
  voice: { path: "/voice", icon: AudioLines, label: "Voice" },
  lab: { path: "/lab", icon: FlaskConical, label: "Lab" },
  terminal: { path: "/terminal", icon: SquareTerminal, labelKey: "nav.terminal" },
  lsp: { path: "/lsp", icon: Code, labelKey: "nav.lsp" },
  sessions: { path: "/sessions", icon: MessagesSquare, labelKey: "nav.sessions" },
  journey: { path: "/journey", icon: Sparkles, labelKey: "nav.journey" },
  wallet: { path: "/wallet", icon: WalletIcon, labelKey: "nav.wallet" },
  artifacts: { path: "/artifacts", icon: FileText, labelKey: "nav.artifacts" },
  metrics: { path: "/metrics", icon: BarChart3, labelKey: "nav.metrics" },
  tasks: { path: "/tasks", icon: ListTodo, labelKey: "nav.tasks" },
};

export function Sidebar() {
  const location = useLocation();
  const navigate = useNavigate();
  const { activeSessionIds, status } = useAgentStatus();
  const { data: info } = useInfo();
  const onChatPage = location.pathname === "/chat" || location.pathname.startsWith("/chat/");
  const settingsMode = location.pathname === "/settings";
  const hasAgents = (info?.stats?.agents?.total ?? 0) > 0;
  const { t } = useI18n();
  const { collapsed, setCollapsed, width, setWidth, mobileOpen, setMobileOpen } = useSidebar();
  const [moreOpen, setMoreOpen] = useState(false);
  const [sessionSearchOpen, setSessionSearchOpen] = useState(false);
  const [labEnabled, setLabEnabled] = useState(true);
  const { layout: navigationLayout } = useSidebarNavigationLayout();

  useEffect(() => {
    let mounted = true;
    void settingsApi
      .getConfig()
      .then((response) => {
        if (mounted && response.success) {
          setLabEnabled(readLabSettings(response.data?.lab).enabled);
        }
      })
      .catch(() => undefined);
    return () => {
      mounted = false;
    };
  }, [location.pathname]);
  const [chatHistoryHeight, setChatHistoryHeight] = useState(() =>
    parseMainSidebarChatHeight(localStorage.getItem(MAIN_SIDEBAR_CHAT_HEIGHT_STORAGE_KEY))
  );
  const visibleChatHistoryHeight = resolveMainSidebarChatHeight(
    chatHistoryHeight,
    moreOpen ? navigationLayout.more.length : 0
  );
  const chatHistoryUsesAvailableHeight = usesAvailableMainSidebarChatHeight(chatHistoryHeight);
  const chatHistoryMaxHeight = resolveMainSidebarChatMaxHeight(
    moreOpen ? navigationLayout.more.length : 0
  );

  useEffect(() => {
    setMobileOpen(false);
  }, [location.pathname, setMobileOpen]);

  const currentSessionId = onChatPage ? new URLSearchParams(location.search).get("session") : null;
  const multiChatActive = onChatPage && isMultiChatSearch(location.search);
  const activeSettingsSection =
    resolveSettingsSectionId(new URLSearchParams(location.search).get("section")) ?? "general";

  const selectSettingsSection = (section: SettingsSectionId) => {
    navigate(section === "general" ? "/settings" : `/settings?section=${section}`);
  };

  const beginResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = width;

    const handlePointerMove = (moveEvent: globalThis.PointerEvent) => {
      setWidth(clampMainSidebarWidth(startWidth + moveEvent.clientX - startX));
    };

    const handlePointerUp = () => {
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("pointercancel", handlePointerUp);
    };

    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    window.addEventListener("pointercancel", handlePointerUp);
  };

  const resizeWithKeyboard = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const delta = event.key === "ArrowLeft" ? -8 : 8;
    setWidth((current) => clampMainSidebarWidth(current + delta));
  };

  const beginResizeChatHistory = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const startY = event.clientY;
    const historyElement = event.currentTarget.nextElementSibling;
    const startHeight =
      historyElement instanceof HTMLElement
        ? historyElement.getBoundingClientRect().height
        : chatHistoryHeight;

    const handlePointerMove = (moveEvent: globalThis.PointerEvent) => {
      setChatHistoryHeight(clampMainSidebarChatHeight(startHeight + startY - moveEvent.clientY));
    };

    const handlePointerUp = (upEvent: globalThis.PointerEvent) => {
      const nextHeight = clampMainSidebarChatHeight(startHeight + startY - upEvent.clientY);
      setChatHistoryHeight(nextHeight);
      localStorage.setItem(MAIN_SIDEBAR_CHAT_HEIGHT_STORAGE_KEY, String(nextHeight));
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("pointercancel", handlePointerUp);
    };

    document.body.style.cursor = "row-resize";
    document.body.style.userSelect = "none";
    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    window.addEventListener("pointercancel", handlePointerUp);
  };

  const resizeChatHistoryWithKeyboard = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
    event.preventDefault();
    const delta = event.key === "ArrowUp" ? 16 : -16;
    const historyElement = event.currentTarget.nextElementSibling;
    const currentHeight =
      historyElement instanceof HTMLElement
        ? historyElement.getBoundingClientRect().height
        : chatHistoryHeight;
    const nextHeight = clampMainSidebarChatHeight(currentHeight + delta);
    setChatHistoryHeight(nextHeight);
    localStorage.setItem(MAIN_SIDEBAR_CHAT_HEIGHT_STORAGE_KEY, String(nextHeight));
  };

  const renderNavItem = (item: SidebarNavItem) => {
    const Icon = item.icon;
    const label = item.label ?? (item.labelKey ? t(item.labelKey) : "");
    const isActive =
      location.pathname === item.path ||
      (item.path !== "/" && location.pathname.startsWith(item.path));

    return (
      <NavLink
        key={item.path}
        to={item.path}
        title={collapsed ? label : undefined}
        className={cn(
          "flex items-center gap-2.5 rounded-lg text-[13px] font-medium transition-all duration-200",
          "!ring-0 !border-transparent",
          collapsed ? "px-3 py-2.5 justify-center" : "px-3.5 py-1.5",
          isActive
            ? "bg-[rgba(var(--accent-primary),0.15)] text-white border border-[rgba(var(--accent-primary),0.3)] shadow-lg"
            : "text-gray-400 hover:text-white hover:bg-white/5"
        )}
        style={
          isActive ? { boxShadow: "inset 0 1px 8px rgba(var(--accent-primary), 0.15)" } : undefined
        }
      >
        <Icon
          className={cn(
            "w-4 h-4 flex-shrink-0 transition-colors",
            isActive ? "accent-text" : "text-gray-500"
          )}
        />
        {!collapsed && <span className="truncate">{label}</span>}
      </NavLink>
    );
  };

  const renderMoreNavigation = () => (
    <div key="more" className="space-y-0.5">
      <button
        type="button"
        onClick={() => setMoreOpen((open) => !open)}
        title={collapsed ? "More" : undefined}
        aria-expanded={moreOpen}
        className={cn(
          "flex w-full items-center gap-2.5 rounded-lg text-[13px] font-medium text-gray-400 transition-all duration-200 hover:bg-white/5 hover:text-white !border-0 !ring-0",
          collapsed ? "justify-center px-3 py-2.5" : "px-3.5 py-1.5"
        )}
      >
        <MoreHorizontal className="h-4 w-4 flex-shrink-0 text-gray-500" />
        {!collapsed ? (
          <>
            <span className="min-w-0 flex-1 truncate text-left">More</span>
            <ChevronDown
              className={cn("h-3.5 w-3.5 transition-transform", !moreOpen && "-rotate-90")}
            />
          </>
        ) : null}
      </button>
      {!collapsed && moreOpen ? (
        <div className="animate-in space-y-0.5 py-1 pl-2 duration-150 fade-in slide-in-from-top-1">
          {navigationLayout.more
            .filter((item) => item !== "lab" || labEnabled)
            .map((item) => renderNavItem(sidebarDestinations[item]))}
        </div>
      ) : null}
    </div>
  );

  const renderOrderedNavigationItem = (item: SidebarPrimaryItemId) => {
    if (item === "more") return renderMoreNavigation();
    if (item === "lab" && !labEnabled) return null;
    return renderNavItem(sidebarDestinations[item]);
  };

  return (
    <>
      <button
        onClick={() => setMobileOpen(!mobileOpen)}
        className="fixed top-4 right-4 z-50 p-2 rounded-lg glass-button text-white md:hidden !ring-0"
        aria-label="Toggle menu"
      >
        {mobileOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
      </button>

      {mobileOpen && (
        <div
          className="fixed inset-0 bg-black/60 backdrop-blur-sm z-30 md:hidden animate-in fade-in"
          onClick={() => setMobileOpen(false)}
        />
      )}

      <aside
        style={{ "--main-sidebar-width": `${width}px` } as React.CSSProperties}
        className={cn(
          "cybara-main-sidebar fixed left-0 top-0 h-full glass border-r border-white/5 z-40 overflow-hidden transition-[width,transform] duration-200",
          settingsMode || !collapsed ? "md:w-[var(--main-sidebar-width)]" : "md:w-16",
          "max-md:-translate-x-full max-md:w-64",
          mobileOpen && "max-md:translate-x-0"
        )}
      >
        <div className="h-full flex flex-col">
          {settingsMode ? (
            <>
              <div className="border-b border-white/5 px-3 py-3">
                <button
                  type="button"
                  onClick={() => navigate("/chat")}
                  className="theme-text-secondary flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-sm font-medium transition-colors hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)]"
                >
                  <ArrowLeft className="h-4 w-4" />
                  <span>Back to Cybara</span>
                </button>
              </div>
              <SettingsNavigation
                activeSection={activeSettingsSection}
                onSelect={selectSettingsSection}
              />
            </>
          ) : (
            <>
              <div
                className={cn(
                  "border-b border-white/5 flex items-center",
                  collapsed ? "px-3 py-4 justify-center" : "px-5 py-4 gap-3"
                )}
              >
                <div className="relative flex-shrink-0 w-10 h-10">
                  <div
                    className={cn(
                      "w-10 h-10 rounded-xl overflow-hidden",
                      status === "active" && "opacity-0"
                    )}
                  >
                    <img src="/cybara.png" alt="Cybara" className="h-full w-full object-contain" />
                  </div>
                  {status === "active" && <CybaraThinkingMark />}
                </div>
                {!collapsed && (
                  <div className="flex min-w-0 flex-1 items-center gap-2">
                    <h1 className="min-w-0 flex-1 truncate text-lg font-bold text-white">Cybara</h1>
                    <button
                      type="button"
                      onClick={() =>
                        navigate(buildMultiChatPath(currentSessionId ? [currentSessionId] : []))
                      }
                      className={cn(
                        "theme-muted-icon-button flex h-8 w-8 shrink-0 items-center justify-center rounded-lg",
                        multiChatActive && "bg-[var(--surface-hover)] text-[var(--text-primary)]"
                      )}
                      aria-label="Open multi-chat"
                      title="Open multi-chat"
                    >
                      <MessagesSquare className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setSessionSearchOpen(true)}
                      className="theme-muted-icon-button flex h-8 w-8 shrink-0 items-center justify-center rounded-lg"
                      aria-label="Search chats"
                      title="Search chats"
                    >
                      <Search className="h-4 w-4" />
                    </button>
                  </div>
                )}
              </div>

              <nav className="flex min-h-0 flex-1 flex-col p-2 pb-3">
                <div className="min-h-[108px] shrink-0 space-y-0.5 overflow-y-auto pb-2">
                  <button
                    type="button"
                    onClick={() => navigate(buildFreshChatPath())}
                    title={collapsed ? t("chat.sidebar.newChat") : undefined}
                    aria-disabled={!hasAgents}
                    className={cn(
                      "flex w-full items-center gap-2.5 rounded-lg text-[13px] font-medium text-gray-400 transition-all duration-200 hover:bg-white/5 hover:text-white !ring-0 !border-transparent",
                      collapsed ? "justify-center px-3 py-2.5" : "px-3.5 py-1.5",
                      !hasAgents && "pointer-events-none opacity-45"
                    )}
                  >
                    <MessageSquarePlus className="h-4 w-4 flex-shrink-0 text-gray-500" />
                    {!collapsed ? (
                      <span className="truncate">{t("chat.sidebar.newChat")}</span>
                    ) : null}
                  </button>
                  {navigationLayout.primary.map(renderOrderedNavigationItem)}
                </div>

                {!collapsed ? (
                  <>
                    <div
                      role="separator"
                      aria-orientation="horizontal"
                      aria-label="Resize chat history"
                      aria-valuemin={MAIN_SIDEBAR_CHAT_HEIGHT_MIN}
                      aria-valuemax={MAIN_SIDEBAR_CHAT_HEIGHT_MAX}
                      aria-valuenow={chatHistoryHeight}
                      tabIndex={0}
                      onPointerDown={beginResizeChatHistory}
                      onKeyDown={resizeChatHistoryWithKeyboard}
                      onDoubleClick={() => {
                        setChatHistoryHeight(MAIN_SIDEBAR_CHAT_HEIGHT_DEFAULT);
                        localStorage.setItem(
                          MAIN_SIDEBAR_CHAT_HEIGHT_STORAGE_KEY,
                          String(MAIN_SIDEBAR_CHAT_HEIGHT_DEFAULT)
                        );
                      }}
                      className="group relative z-10 flex h-3 shrink-0 cursor-row-resize touch-none items-center justify-center border-t border-[var(--surface-border)]"
                      title="Drag to resize chat history · Double-click to reset"
                    >
                      <GripHorizontal className="theme-text-subtle h-3.5 w-3.5 opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100" />
                    </div>
                    <div
                      className={cn(
                        "min-w-0 transition-[height,min-height,max-height] duration-200 ease-out",
                        chatHistoryUsesAvailableHeight ? "min-h-0 flex-1" : "shrink-0"
                      )}
                      style={{
                        height: chatHistoryUsesAvailableHeight
                          ? undefined
                          : visibleChatHistoryHeight,
                        minHeight: moreOpen
                          ? MAIN_SIDEBAR_CHAT_HEIGHT_MORE_OPEN_MIN
                          : MAIN_SIDEBAR_CHAT_HEIGHT_MIN,
                        maxHeight: chatHistoryUsesAvailableHeight
                          ? undefined
                          : chatHistoryMaxHeight,
                      }}
                    >
                      <SessionsPanel
                        isOpen
                        placement="main"
                        showNewChatButton={false}
                        searchOpen={sessionSearchOpen}
                        onSearchOpenChange={setSessionSearchOpen}
                        currentSessionId={currentSessionId}
                        activeSessionIds={activeSessionIds}
                        currentSessionLoading={false}
                        onClose={() => undefined}
                        onLoadSession={() => undefined}
                        onNewSession={(workspaceDir) => {
                          navigate(buildFreshChatPath(workspaceDir));
                        }}
                      />
                    </div>
                  </>
                ) : null}
              </nav>

              <div className="sidebar-footer border-t border-white/5 p-2 backdrop-blur-md">
                <div className={cn("mb-1.5 flex items-center gap-1.5", collapsed && "flex-col")}>
                  <NavLink
                    to="/settings"
                    title={collapsed ? t("nav.settings") : undefined}
                    className={cn(
                      "flex items-center gap-2 rounded-lg text-[12px] font-medium text-gray-400 transition-all duration-200 hover:bg-white/5 hover:text-white !ring-0 !border-transparent",
                      collapsed ? "justify-center px-2.5 py-2" : "min-w-0 flex-1 px-3 py-1.5"
                    )}
                  >
                    <Settings className="h-3.5 w-3.5 flex-shrink-0 text-gray-500" />
                    {!collapsed && <span className="truncate">{t("nav.settings")}</span>}
                  </NavLink>
                  <UpdateButton collapsed={collapsed} />
                </div>

                <button
                  onClick={() => setCollapsed(!collapsed)}
                  className="hidden w-full items-center justify-center gap-1.5 rounded-lg px-2 py-1 text-[11px] text-gray-500 transition-colors hover:bg-white/5 hover:text-white md:flex"
                  title={collapsed ? t("nav.expand") : t("nav.collapse")}
                >
                  {collapsed ? (
                    <ChevronRight className="h-3 w-3" />
                  ) : (
                    <>
                      <ChevronLeft className="h-3 w-3" />
                      <span>{t("nav.collapse")}</span>
                    </>
                  )}
                </button>
              </div>
            </>
          )}
        </div>
        {(settingsMode || !collapsed) && (
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize main sidebar"
            aria-valuemin={MAIN_SIDEBAR_MIN_WIDTH}
            aria-valuemax={MAIN_SIDEBAR_MAX_WIDTH}
            aria-valuenow={width}
            tabIndex={0}
            onPointerDown={beginResize}
            onKeyDown={resizeWithKeyboard}
            onDoubleClick={() => setWidth(MAIN_SIDEBAR_DEFAULT_WIDTH)}
            className="absolute right-[-3px] top-0 z-50 hidden h-full w-1.5 cursor-col-resize touch-none bg-transparent transition-colors hover:bg-[color-mix(in_srgb,var(--surface-border)_75%,transparent)] focus-visible:bg-[rgba(var(--accent-primary),0.45)] md:block"
            title="Drag to resize · Double-click to reset"
          />
        )}
      </aside>
    </>
  );
}
