import { NavLink, useLocation } from "react-router-dom";
import {
  LayoutDashboard,
  Bot,
  Plug,
  Network,
  Smartphone,
  MessageSquare,
  MessagesSquare,
  Brain,
  Sparkles,
  ListTodo,
  Logs,
  LibraryBig,
  Wrench,
  Settings,
  Terminal,
  SquareTerminal,
  BarChart3,
  Code,
  FolderOpen,
  Menu,
  X,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Wallet as WalletIcon,
  FileText,
  TabletSmartphone,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useState, useEffect, useRef, createContext, useContext } from "react";
import { connectStatusStream } from "@/lib/status-stream";

interface SidebarContextType {
  collapsed: boolean;
  setCollapsed: (collapsed: boolean) => void;
  mobileOpen: boolean;
  setMobileOpen: (open: boolean) => void;
}

const SidebarContext = createContext<SidebarContextType>({
  collapsed: false,
  setCollapsed: () => {},
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

  useEffect(() => {
    localStorage.setItem("sidebar-collapsed", String(collapsed));
  }, [collapsed]);

  return (
    <SidebarContext.Provider value={{ collapsed, setCollapsed, mobileOpen, setMobileOpen }}>
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
          for (const snapshot of Array.isArray(data.activeSessions) ? data.activeSessions : []) {
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

const navCategories = [
  {
    id: "main",
    label: null,
    items: [
      { path: "/", icon: LayoutDashboard, label: "Dashboard" },
      { path: "/agents", icon: Bot, label: "Agents" },
      { path: "/providers", icon: Plug, label: "Providers" },
      { path: "/router", icon: Network, label: "Model Router" },
      { path: "/channels", icon: Smartphone, label: "Channels" },
      { path: "/mobile", icon: TabletSmartphone, label: "Mobile" },
    ],
  },
  {
    id: "developer",
    label: "Developer",
    items: [
      { path: "/mcp", icon: Terminal, label: "MCP Servers" },
      { path: "/lsp", icon: Code, label: "LSP" },
      { path: "/ide", icon: FolderOpen, label: "IDE" },
      { path: "/skills", icon: LibraryBig, label: "Skills" },
      { path: "/tools", icon: Wrench, label: "Tools" },
      { path: "/terminal", icon: SquareTerminal, label: "Terminal" },
    ],
  },
  {
    id: "chat",
    label: null,
    items: [
      { path: "/chat", icon: MessageSquare, label: "Chat" },
      { path: "/sessions", icon: MessagesSquare, label: "Sessions" },
    ],
  },
  {
    id: "system",
    label: "System",
    items: [
      { path: "/memory", icon: Brain, label: "Memory" },
      { path: "/journey", icon: Sparkles, label: "Journey" },
      { path: "/wallet", icon: WalletIcon, label: "Wallet" },
      { path: "/artifacts", icon: FileText, label: "Artifacts" },
      { path: "/metrics", icon: BarChart3, label: "Metrics" },
      { path: "/tasks", icon: ListTodo, label: "Tasks" },
      { path: "/logs", icon: Logs, label: "Logs" },
    ],
  },
];

export function Sidebar() {
  const location = useLocation();
  const status = useAgentStatus();
  const { collapsed, setCollapsed, mobileOpen, setMobileOpen } = useSidebar();
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({
    developer: false,
    system: true,
  });

  useEffect(() => {
    setMobileOpen(false);
  }, [location.pathname, setMobileOpen]);

  const toggleSection = (id: string) => {
    setExpandedSections((prev) => ({
      ...prev,
      [id]: !prev[id],
    }));
  };

  const renderNavItem = (item: {
    path: string;
    icon: React.ComponentType<{ className?: string }>;
    label: string;
  }) => {
    const Icon = item.icon;
    const isActive =
      location.pathname === item.path ||
      (item.path !== "/" && location.pathname.startsWith(item.path));

    return (
      <NavLink
        key={item.path}
        to={item.path}
        title={collapsed ? item.label : undefined}
        className={cn(
          "flex items-center gap-3 rounded-xl text-sm font-medium transition-all duration-200",
          "!ring-0 !border-transparent",
          collapsed ? "px-3 py-2.5 justify-center" : "px-4 py-2.5",
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
            "w-5 h-5 flex-shrink-0 transition-colors",
            isActive ? "accent-text" : "text-gray-500"
          )}
        />
        {!collapsed && <span className="truncate">{item.label}</span>}
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
        className={cn(
          "fixed left-0 top-0 h-full glass border-r border-white/5 z-40 overflow-hidden transition-all duration-300",
          collapsed ? "w-16" : "w-64",
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
                <img src="/cybara.png" alt="Cybara" className="w-full h-full object-cover" />
              </div>
              {status === "active" && (
                <span className="cybara-thinking-sprite" aria-hidden="true" />
              )}
            </div>
            {!collapsed && (
              <div className="flex-1 min-w-0">
                <h1 className="font-bold text-lg text-white">Cybara</h1>
                <p className="text-[10px] text-gray-400 leading-tight">Agent Platform</p>
              </div>
            )}
          </div>

          <nav
            className={cn(
              "flex-1 p-2 space-y-1 pb-20",
              collapsed ? "overflow-hidden" : "overflow-y-auto"
            )}
          >
            {navCategories.map((category) => (
              <div key={category.id}>
                {category.label && !collapsed ? (
                  <>
                    <button
                      onClick={() => toggleSection(category.id)}
                      className="w-full flex items-center justify-between px-3 py-2 mt-3 mb-1 text-xs font-semibold text-gray-500 uppercase tracking-wider hover:text-gray-400 transition-colors !ring-0"
                    >
                      <span>{category.label}</span>
                      <ChevronDown
                        className={cn(
                          "w-4 h-4 transition-transform duration-200",
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
                      {category.items.map(renderNavItem)}
                    </div>
                  </>
                ) : (
                  <div className="space-y-0.5">{category.items.map(renderNavItem)}</div>
                )}
              </div>
            ))}
          </nav>

          <div className="border-t border-white/5 bg-black/20 p-2 backdrop-blur-md">
            <NavLink
              to="/settings"
              title={collapsed ? "Settings" : undefined}
              className={cn(
                "flex items-center gap-3 rounded-xl text-sm font-medium transition-all duration-200 mb-2",
                "!ring-0 !border-transparent",
                collapsed ? "px-3 py-2.5 justify-center" : "px-4 py-2.5",
                location.pathname === "/settings"
                  ? "bg-[rgba(var(--accent-primary),0.15)] text-white border border-[rgba(var(--accent-primary),0.3)] shadow-lg"
                  : "text-gray-400 hover:text-white hover:bg-white/5"
              )}
              style={
                location.pathname === "/settings"
                  ? { boxShadow: "inset 0 1px 8px rgba(var(--accent-primary), 0.15)" }
                  : undefined
              }
            >
              <Settings
                className={cn(
                  "w-5 h-5 flex-shrink-0 transition-colors",
                  location.pathname === "/settings" ? "accent-text" : "text-gray-500"
                )}
              />
              {!collapsed && <span>Settings</span>}
            </NavLink>

            <button
              onClick={() => setCollapsed(!collapsed)}
              className="hidden md:flex w-full items-center justify-center gap-2 px-3 py-2 rounded-lg text-sm text-gray-500 hover:text-white hover:bg-white/5 transition-colors"
              title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            >
              {collapsed ? (
                <ChevronRight className="w-4 h-4" />
              ) : (
                <>
                  <ChevronLeft className="w-4 h-4" />
                  <span className="text-xs">Collapse</span>
                </>
              )}
            </button>
          </div>
        </div>
      </aside>
    </>
  );
}
