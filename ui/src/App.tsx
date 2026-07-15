import { useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { lazy, Suspense, useEffect, useState } from "react";
import { Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { CybaraPet } from "@/components/CybaraPet";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { GatewayStartupFailure } from "@/components/GatewayStartupFailure";
import { Sidebar, SidebarProvider, useSidebar } from "@/components/layout/Sidebar";
import { ToastContainer } from "@/components/ui/Toast";
import { settingsApi, setupApi } from "@/lib/api";
import {
  APP_HOTKEYS_CHANGED_EVENT,
  appHotkeyActionForEvent,
  dispatchAppHotkey,
  readAppHotkeyOverrides,
  resolveAppHotkeys,
  storePendingChatHotkey,
  type AppHotkeyActionId,
} from "@/lib/appHotkeys";
import { readGatewayStartupStatus } from "@/lib/desktopGatewayStartup";
import { readSetupComplete, resolveSetupGate, writeSetupComplete } from "@/lib/setupGate";
import { isPetWindow } from "@/lib/tauriPet";
import { cn } from "@/lib/utils";
import { PetOverlay } from "@/pages/PetOverlay";
import { readThemeAccentFromConfig, readThemeModeFromIdentity, useUIStore } from "@/stores/uiStore";
import { readChatAppearanceFromConfig } from "../../shared/chat-appearance";

const Dashboard = lazy(() =>
  import("@/pages/Dashboard").then((module) => ({ default: module.Dashboard }))
);
const Agents = lazy(() => import("@/pages/Agents").then((module) => ({ default: module.Agents })));
const Providers = lazy(() =>
  import("@/pages/Providers").then((module) => ({ default: module.Providers }))
);
const RouterSettings = lazy(() =>
  import("@/pages/RouterSettings").then((module) => ({
    default: module.RouterSettings,
  }))
);
const Channels = lazy(() =>
  import("@/pages/Channels").then((module) => ({ default: module.Channels }))
);
const Tasks = lazy(() => import("@/pages/Tasks").then((module) => ({ default: module.Tasks })));
const Skills = lazy(() => import("@/pages/Skills").then((module) => ({ default: module.Skills })));
const Journey = lazy(() =>
  import("@/pages/Journey").then((module) => ({ default: module.Journey }))
);
const Tools = lazy(() => import("@/pages/Tools").then((module) => ({ default: module.Tools })));
const Memory = lazy(() => import("@/pages/Memory").then((module) => ({ default: module.Memory })));
const Settings = lazy(() =>
  import("@/pages/Settings").then((module) => ({ default: module.Settings }))
);
const Chat = lazy(() => import("@/pages/Chat").then((module) => ({ default: module.Chat })));
const Logs = lazy(() => import("@/pages/Logs").then((module) => ({ default: module.Logs })));
const Sessions = lazy(() =>
  import("@/pages/Sessions").then((module) => ({ default: module.Sessions }))
);
const Metrics = lazy(() =>
  import("@/pages/Metrics").then((module) => ({ default: module.Metrics }))
);
const Usage = lazy(() => import("@/pages/Usage").then((module) => ({ default: module.Usage })));
const Evals = lazy(() => import("@/pages/Evals").then((module) => ({ default: module.Evals })));
const MCPServers = lazy(() =>
  import("@/pages/MCPServers").then((module) => ({
    default: module.MCPServers,
  }))
);
const Plugins = lazy(() =>
  import("@/pages/Plugins").then((module) => ({ default: module.Plugins }))
);
const LSP = lazy(() => import("@/pages/LSP").then((module) => ({ default: module.LSP })));
const IDE = lazy(() => import("@/pages/IDE").then((module) => ({ default: module.IDE })));
const TerminalPage = lazy(() =>
  import("@/pages/Terminal").then((module) => ({
    default: module.TerminalPage,
  }))
);
const Wallet = lazy(() => import("@/pages/Wallet").then((module) => ({ default: module.Wallet })));
const Artifacts = lazy(() =>
  import("@/pages/Artifacts").then((module) => ({ default: module.Artifacts }))
);
const Mobile = lazy(() => import("@/pages/Mobile").then((module) => ({ default: module.Mobile })));
const Voice = lazy(() => import("@/pages/Voice").then((module) => ({ default: module.Voice })));
const Setup = lazy(() => import("@/pages/Setup").then((module) => ({ default: module.Setup })));

function PageLoader() {
  return (
    <div className="flex min-h-[45vh] items-center justify-center">
      <Loader2 className="h-7 w-7 animate-spin text-indigo-500" />
    </div>
  );
}

function SetupGuard({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  const cachedSetupComplete = readSetupComplete();
  const setupStatusQuery = useQuery({
    queryKey: ["setup", "status"],
    queryFn: async () => {
      const response = await setupApi.status();
      if (!response.success || !response.data) {
        throw new Error(response.error || "Failed to load setup status");
      }
      return response.data;
    },
    staleTime: 30_000,
    retry: false,
  });
  const setupReady = setupStatusQuery.isSuccess;
  const setupComplete = setupStatusQuery.data?.complete === true;
  const gatewayStartupQuery = useQuery({
    queryKey: ["desktop", "gateway-startup"],
    queryFn: readGatewayStartupStatus,
    refetchInterval: (query) => (query.state.data?.phase === "ready" ? false : 500),
    staleTime: 0,
  });
  const gatewayStartup = gatewayStartupQuery.data;

  useEffect(() => {
    if (setupReady) writeSetupComplete(setupComplete);
  }, [setupComplete, setupReady]);

  const decision = resolveSetupGate({
    pathname: location.pathname,
    setupReady,
    setupComplete,
    cachedSetupComplete,
  });

  if (gatewayStartup?.phase === "failed") {
    return (
      <GatewayStartupFailure
        message={gatewayStartup.message || "The packaged gateway exited before it was ready."}
      />
    );
  }

  if (decision === "redirect") {
    return <Navigate to="/setup" replace />;
  }

  if (decision === "spinner") {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#0a0a0f]">
        <Loader2 className="w-8 h-8 text-indigo-500 animate-spin" />
      </div>
    );
  }

  return <>{children}</>;
}

function MainContent({ children }: { children: React.ReactNode }) {
  const { collapsed, width } = useSidebar();

  return (
    <div
      style={{ "--main-sidebar-width": `${width}px` } as React.CSSProperties}
      className={cn(
        "flex-1 overflow-auto transition-[margin] duration-200",
        collapsed ? "md:ml-16" : "md:ml-[var(--main-sidebar-width)]",
        "ml-0"
      )}
    >
      {children}
    </div>
  );
}

function AppHotkeys() {
  const location = useLocation();
  const navigate = useNavigate();
  const { collapsed, setCollapsed } = useSidebar();
  const [bindings, setBindings] = useState(() => resolveAppHotkeys(readAppHotkeyOverrides()));

  useEffect(() => {
    const refresh = () => setBindings(resolveAppHotkeys(readAppHotkeyOverrides()));
    window.addEventListener(APP_HOTKEYS_CHANGED_EVENT, refresh);
    return () => window.removeEventListener(APP_HOTKEYS_CHANGED_EVENT, refresh);
  }, []);

  useEffect(() => {
    const openChatAction = (action: AppHotkeyActionId) => {
      if (location.pathname === "/chat") {
        dispatchAppHotkey(action);
        return;
      }
      storePendingChatHotkey(action);
      navigate("/chat");
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (location.pathname === "/setup" || event.defaultPrevented || event.repeat) return;
      const action = appHotkeyActionForEvent(event, bindings);
      if (!action) return;
      event.preventDefault();
      if (action === "newChat" || action === "focusComposer" || action === "toggleWorkspace") {
        openChatAction(action);
        return;
      }
      if (action === "toggleSidebar") {
        setCollapsed(!collapsed);
        return;
      }
      const routes: Partial<Record<AppHotkeyActionId, string>> = {
        openChat: "/chat",
        openIde: "/ide",
        openTerminal: "/terminal",
        openSettings: "/settings",
      };
      const route = routes[action];
      if (route) navigate(route);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [bindings, collapsed, location.pathname, navigate, setCollapsed]);

  return null;
}

function AppRoutes() {
  return (
    <Suspense fallback={<PageLoader />}>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/agents" element={<Agents />} />
        <Route path="/providers" element={<Providers />} />
        <Route path="/router" element={<RouterSettings />} />
        <Route path="/mcp" element={<MCPServers />} />
        <Route path="/plugins" element={<Plugins />} />
        <Route path="/connectors" element={<Navigate to="/plugins" replace />} />
        <Route path="/channels" element={<Channels />} />
        <Route path="/mobile" element={<Mobile />} />
        <Route path="/tasks" element={<Tasks />} />
        <Route path="/skills" element={<Skills />} />
        <Route path="/journey" element={<Journey />} />
        <Route path="/lsp" element={<LSP />} />
        <Route path="/ide" element={<IDE />} />
        <Route path="/terminal" element={<TerminalPage />} />
        <Route path="/tools" element={<Tools />} />
        <Route path="/memory" element={<Memory />} />
        <Route path="/metrics" element={<Metrics />} />
        <Route path="/usage" element={<Usage />} />
        <Route path="/lab" element={<Evals />} />
        <Route path="/evals" element={<Navigate to="/lab" replace />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="/chat" element={<Chat />} />
        <Route path="/voice" element={<Voice />} />
        <Route path="/logs" element={<Logs />} />
        <Route path="/sessions" element={<Sessions />} />
        <Route path="/wallet" element={<Wallet />} />
        <Route path="/artifacts" element={<Artifacts />} />
      </Routes>
    </Suspense>
  );
}

function ThemeConfigSync() {
  const setAccent = useUIStore((state) => state.setAccent);
  const setMode = useUIStore((state) => state.setMode);
  const setChatAppearance = useUIStore((state) => state.setChatAppearance);

  useEffect(() => {
    let mounted = true;
    const syncTheme = async () => {
      try {
        const result = await settingsApi.getConfig();
        if (!mounted || !result.success) return;
        const accent = readThemeAccentFromConfig(result.data);
        if (accent) setAccent(accent);
        const identity = result.data?.identity as Record<string, unknown> | undefined;
        setMode(readThemeModeFromIdentity(identity));
        const chatAppearance = readChatAppearanceFromConfig(result.data);
        if (chatAppearance) setChatAppearance(chatAppearance);
      } catch {
        // The persisted local accent remains active while the gateway is unavailable.
      }
    };
    void syncTheme();
    const interval = window.setInterval(() => {
      void syncTheme();
    }, 30000);
    window.addEventListener("focus", syncTheme);
    return () => {
      mounted = false;
      window.clearInterval(interval);
      window.removeEventListener("focus", syncTheme);
    };
  }, [setAccent, setChatAppearance, setMode]);

  return null;
}

function App() {
  if (isPetWindow()) {
    return <PetOverlay />;
  }

  return (
    <ErrorBoundary>
      <SidebarProvider>
        <div className="flex min-h-screen bg-[#0a0a0f] overflow-hidden">
          <ThemeConfigSync />
          <AppHotkeys />
          <Suspense fallback={<PageLoader />}>
            <Routes>
              <Route path="/setup" element={<Setup />} />

              <Route
                path="*"
                element={
                  <SetupGuard>
                    <Sidebar />
                    <MainContent>
                      <AppRoutes />
                    </MainContent>
                    <CybaraPet />
                  </SetupGuard>
                }
              />
            </Routes>
          </Suspense>
          <ToastContainer />
        </div>
      </SidebarProvider>
    </ErrorBoundary>
  );
}

export default App;
