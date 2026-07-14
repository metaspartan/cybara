import {
  AudioLines,
  BarChart3,
  Bot,
  Brain,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Code,
  FileText,
  FlaskConical,
  FolderOpen,
  Gauge,
  LayoutDashboard,
  LibraryBig,
  ListTodo,
  Logs,
  Menu,
  MessageSquare,
  MessageSquarePlus,
  MessagesSquare,
  Network,
  Package,
  Plug,
  Settings,
  Smartphone,
  Sparkles,
  SquareTerminal,
  TabletSmartphone,
  Terminal,
  Wallet as WalletIcon,
  Wrench,
  X,
} from "lucide-react";
import type { KeyboardEvent, PointerEvent as ReactPointerEvent } from "react";
import { createContext, useContext, useEffect, useRef, useState } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { CybaraThinkingMark } from "@/components/CybaraThinkingMark";
import { providerPlansApi } from "@/lib/api";
import { useInfo } from "@/hooks/useApi";
import { useI18n } from "@/lib/i18n";
import { connectStatusStream } from "@/lib/status-stream";
import { cn } from "@/lib/utils";
import type { TranslationKey } from "../../../../shared/i18n/catalog";
import {
  clampMainSidebarWidth,
  MAIN_SIDEBAR_DEFAULT_WIDTH,
  MAIN_SIDEBAR_MAX_WIDTH,
  MAIN_SIDEBAR_MIN_WIDTH,
  MAIN_SIDEBAR_WIDTH_STORAGE_KEY,
  parseMainSidebarWidth,
} from "./sidebarSizing";
import { UpdateButton } from "./UpdateButton";

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
  const activeSessionLastSeenRef = useRef<Map<string, number>>(new Map());
  const globalLastSeenRef = useRef<number>(0);

  useEffect(() => {
    const ACTIVE_WINDOW_MS = 60_000;
    const ACTIVE_STATUSES = new Set(["thinking", "generating", "tool_executing", "compacting"]);

    const refreshDerivedStatus = () => {
      const now = Date.now();
      for (const [sessionId, lastSeen] of activeSessionLastSeenRef.current.entries()) {
        if (now - lastSeen > ACTIVE_WINDOW_MS) {
          activeSessionLastSeenRef.current.delete(sessionId);
        }
      }
      const globalActive =
        globalLastSeenRef.current > 0 && now - globalLastSeenRef.current <= ACTIVE_WINDOW_MS;
      const hasActiveSessions = activeSessionLastSeenRef.current.size > 0;
      setStatus(globalActive || hasActiveSessions ? "active" : "idle");
    };

    const sweepInterval = setInterval(() => {
      refreshDerivedStatus();
    }, 2000);

    const disconnect = connectStatusStream({
      onEvent: (data) => {
        if (!data || typeof data !== "object" || typeof data.type !== "string") return;
        const now = Date.now();

        if (data.type === "snapshot") {
          activeSessionLastSeenRef.current.clear();
          const activeSessions = Array.isArray(data.activeSessions) ? data.activeSessions : [];
          if (activeSessions.length === 0) {
            globalLastSeenRef.current = 0;
          }
          for (const snapshot of activeSessions) {
            const sessionId =
              typeof snapshot?.sessionId === "string" ? snapshot.sessionId.trim() : "";
            const snapshotStatus = typeof snapshot?.status === "string" ? snapshot.status : "";
            if (!sessionId || !ACTIVE_STATUSES.has(snapshotStatus)) continue;
            const lastSeen =
              typeof snapshot.timestamp === "number" && Number.isFinite(snapshot.timestamp)
                ? snapshot.timestamp
                : now;
            activeSessionLastSeenRef.current.set(sessionId, lastSeen);
          }
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

        const statusValue = typeof data.status === "string" ? data.status : "";
        const sessionId = typeof data.sessionId === "string" ? data.sessionId.trim() : "";
        if (!statusValue) return;
        const isActiveStatus = ACTIVE_STATUSES.has(statusValue);

        if (sessionId) {
          if (isActiveStatus) {
            activeSessionLastSeenRef.current.set(sessionId, now);
          } else if (
            statusValue === "idle" ||
            statusValue === "error" ||
            statusValue === "tool_completed"
          ) {
            activeSessionLastSeenRef.current.delete(sessionId);
          }
        } else {
          if (isActiveStatus) {
            globalLastSeenRef.current = now;
          } else if (
            statusValue === "idle" ||
            statusValue === "error" ||
            statusValue === "tool_completed"
          ) {
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

  return status;
}

type SidebarNavItem = {
  path: string;
  icon: React.ComponentType<{ className?: string }>;
  label?: string;
  labelKey?: TranslationKey;
  requiresUsage?: boolean;
};

type SidebarNavCategory = {
  id: string;
  labelKey: TranslationKey | null;
  items: SidebarNavItem[];
};

const navCategories: SidebarNavCategory[] = [
  {
    id: "main",
    labelKey: null,
    items: [
      { path: "/", icon: LayoutDashboard, labelKey: "nav.dashboard" },
      { path: "/agents", icon: Bot, labelKey: "nav.agents" },
      { path: "/providers", icon: Plug, labelKey: "nav.providers" },
      { path: "/router", icon: Network, labelKey: "nav.router" },
      { path: "/channels", icon: Smartphone, labelKey: "nav.channels" },
      { path: "/mobile", icon: TabletSmartphone, labelKey: "nav.mobile" },
      { path: "/plugins", icon: Package, labelKey: "nav.plugins" },
    ],
  },
  {
    id: "developer",
    labelKey: "nav.developer",
    items: [
      { path: "/mcp", icon: Terminal, labelKey: "nav.mcp" },
      { path: "/lsp", icon: Code, labelKey: "nav.lsp" },
      { path: "/ide", icon: FolderOpen, labelKey: "nav.ide" },
      { path: "/sessions", icon: MessagesSquare, labelKey: "nav.sessions" },
      {
        path: "/usage",
        icon: Gauge,
        labelKey: "nav.usage",
        requiresUsage: true,
      },
      { path: "/lab", icon: FlaskConical, label: "Lab" },
      { path: "/skills", icon: LibraryBig, labelKey: "nav.skills" },
      { path: "/tools", icon: Wrench, labelKey: "nav.tools" },
      { path: "/terminal", icon: SquareTerminal, labelKey: "nav.terminal" },
    ],
  },
  {
    id: "chat",
    labelKey: null,
    items: [
      { path: "/chat", icon: MessageSquare, labelKey: "nav.chat" },
      { path: "/voice", icon: AudioLines, label: "Voice" },
    ],
  },
  {
    id: "system",
    labelKey: "nav.system",
    items: [
      { path: "/memory", icon: Brain, labelKey: "nav.memory" },
      { path: "/journey", icon: Sparkles, labelKey: "nav.journey" },
      { path: "/wallet", icon: WalletIcon, labelKey: "nav.wallet" },
      { path: "/artifacts", icon: FileText, labelKey: "nav.artifacts" },
      { path: "/metrics", icon: BarChart3, labelKey: "nav.metrics" },
      { path: "/tasks", icon: ListTodo, labelKey: "nav.tasks" },
      { path: "/logs", icon: Logs, labelKey: "nav.logs" },
    ],
  },
];

export function Sidebar() {
  const location = useLocation();
  const status = useAgentStatus();
  const { data: info } = useInfo();
  const onChatPage = location.pathname === "/chat" || location.pathname.startsWith("/chat/");
  const hasAgents = (info?.stats?.agents?.total ?? 0) > 0;
  const showNewChatShortcut = hasAgents && !onChatPage;
  const { t } = useI18n();
  const { collapsed, setCollapsed, width, setWidth, mobileOpen, setMobileOpen } = useSidebar();
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({
    developer: false,
    system: true,
  });
  const [usageAvailable, setUsageAvailable] = useState(false);

  useEffect(() => {
    setMobileOpen(false);
  }, [location.pathname, setMobileOpen]);

  useEffect(() => {
    let mounted = true;
    const loadUsageAvailability = async () => {
      try {
        const response = await providerPlansApi.availability();
        if (!mounted || !response.success) return;
        setUsageAvailable(response.data?.available === true);
      } catch {
        if (mounted) setUsageAvailable(false);
      }
    };
    void loadUsageAvailability();
    const interval = window.setInterval(() => void loadUsageAvailability(), 60000);
    return () => {
      mounted = false;
      window.clearInterval(interval);
    };
  }, []);

  const toggleSection = (id: string) => {
    setExpandedSections((prev) => ({
      ...prev,
      [id]: !prev[id],
    }));
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
          collapsed ? "px-3 py-2.5 justify-center" : "px-3.5 py-2.5",
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
          "fixed left-0 top-0 h-full glass border-r border-white/5 z-40 overflow-hidden transition-[width,transform] duration-200",
          collapsed ? "md:w-16" : "md:w-[var(--main-sidebar-width)]",
          "max-md:-translate-x-full max-md:w-64",
          mobileOpen && "max-md:translate-x-0"
        )}
      >
        <div className="h-full flex flex-col">
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
              <div className="flex-1 min-w-0">
                <h1 className="font-bold text-lg text-white">Cybara</h1>
                <p className="text-[10px] text-gray-400 leading-tight">{t("app.tagline")}</p>
              </div>
            )}
          </div>

          <nav
            className={cn(
              "flex-1 p-2 space-y-1 pb-20",
              collapsed ? "overflow-hidden" : "overflow-y-auto"
            )}
          >
            {showNewChatShortcut ? (
              <div className="mb-1 pb-2 border-b border-white/5">
                <NavLink
                  to="/chat?fresh=1"
                  title={collapsed ? t("chat.sidebar.newChat") : undefined}
                  className={cn(
                    "flex items-center gap-2.5 rounded-lg text-[13px] font-semibold transition-all duration-200 !ring-0",
                    "border border-[rgba(var(--accent-primary),0.3)] bg-[rgba(var(--accent-primary),0.12)] text-white hover:bg-[rgba(var(--accent-primary),0.2)]",
                    collapsed ? "px-3 py-2.5 justify-center" : "px-3.5 py-2.5"
                  )}
                >
                  <MessageSquarePlus className="w-4 h-4 flex-shrink-0 accent-text" />
                  {!collapsed && <span className="truncate">{t("chat.sidebar.newChat")}</span>}
                </NavLink>
              </div>
            ) : null}
            {navCategories.map((category) => (
              <div key={category.id}>
                {category.labelKey && !collapsed ? (
                  <>
                    <button
                      onClick={() => toggleSection(category.id)}
                      className="w-full flex items-center justify-between px-3 py-1.5 mt-3 mb-1 text-[11px] font-semibold text-gray-500 uppercase tracking-wider hover:text-gray-400 transition-colors !ring-0"
                    >
                      <span>{t(category.labelKey)}</span>
                      <ChevronDown
                        className={cn(
                          "w-3.5 h-3.5 transition-transform duration-200",
                          !expandedSections[category.id] && "-rotate-90"
                        )}
                      />
                    </button>
                    <div
                      className={cn(
                        "space-y-0.5 overflow-hidden transition-all duration-200",
                        expandedSections[category.id] ? "max-h-96 opacity-100" : "max-h-0 opacity-0"
                      )}
                    >
                      {category.items
                        .filter((item) => !item.requiresUsage || usageAvailable)
                        .map(renderNavItem)}
                    </div>
                  </>
                ) : (
                  <div className="space-y-0.5">
                    {category.items
                      .filter((item) => !item.requiresUsage || usageAvailable)
                      .map(renderNavItem)}
                  </div>
                )}
              </div>
            ))}
          </nav>

          <div className="sidebar-footer border-t border-white/5 p-2 backdrop-blur-md">
            <div className={cn("mb-2 flex items-center gap-2", collapsed && "flex-col")}>
              <NavLink
                to="/settings"
                title={collapsed ? t("nav.settings") : undefined}
                className={cn(
                  "flex items-center gap-2.5 rounded-lg text-[13px] font-medium transition-all duration-200",
                  "!ring-0 !border-transparent",
                  collapsed ? "px-3 py-2.5 justify-center" : "min-w-0 flex-1 px-3.5 py-2.5",
                  location.pathname === "/settings"
                    ? "bg-[rgba(var(--accent-primary),0.15)] text-white border border-[rgba(var(--accent-primary),0.3)] shadow-lg"
                    : "text-gray-400 hover:text-white hover:bg-white/5"
                )}
                style={
                  location.pathname === "/settings"
                    ? {
                        boxShadow: "inset 0 1px 8px rgba(var(--accent-primary), 0.15)",
                      }
                    : undefined
                }
              >
                <Settings
                  className={cn(
                    "w-4 h-4 flex-shrink-0 transition-colors",
                    location.pathname === "/settings" ? "accent-text" : "text-gray-500"
                  )}
                />
                {!collapsed && <span className="truncate">{t("nav.settings")}</span>}
              </NavLink>
              <UpdateButton collapsed={collapsed} />
            </div>

            <button
              onClick={() => setCollapsed(!collapsed)}
              className="hidden md:flex w-full items-center justify-center gap-2 px-3 py-2 rounded-lg text-xs text-gray-500 hover:text-white hover:bg-white/5 transition-colors"
              title={collapsed ? t("nav.expand") : t("nav.collapse")}
            >
              {collapsed ? (
                <ChevronRight className="w-3.5 h-3.5" />
              ) : (
                <>
                  <ChevronLeft className="w-3.5 h-3.5" />
                  <span className="text-xs">{t("nav.collapse")}</span>
                </>
              )}
            </button>
          </div>
        </div>
        {!collapsed && (
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
