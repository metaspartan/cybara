import { Routes, Route, Navigate, useLocation } from "react-router-dom";
import { Sidebar, SidebarProvider, useSidebar } from "@/components/layout/Sidebar";
import { UpdateBanner } from "@/components/layout/UpdateBanner";
import { ToastContainer } from "@/components/ui/Toast";
import { CybaraPet } from "@/components/CybaraPet";
import { PetOverlay } from "@/pages/PetOverlay";
import { isPetWindow } from "@/lib/tauriPet";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { Dashboard } from "@/pages/Dashboard";
import { Agents } from "@/pages/Agents";
import { Providers } from "@/pages/Providers";
import { RouterSettings } from "@/pages/RouterSettings";
import { Channels } from "@/pages/Channels";
import { Tasks } from "@/pages/Tasks";
import { Skills } from "@/pages/Skills";
import { Journey } from "@/pages/Journey";
import { Tools } from "@/pages/Tools";
import { Memory } from "@/pages/Memory";
import { Settings } from "@/pages/Settings";
import { Chat } from "@/pages/Chat";
import { Logs } from "@/pages/Logs";
import { Sessions } from "@/pages/Sessions";
import { Metrics } from "@/pages/Metrics";
import { Usage } from "@/pages/Usage";
import { MCPServers } from "@/pages/MCPServers";
import { LSP } from "@/pages/LSP";
import { IDE } from "@/pages/IDE";
import { TerminalPage } from "@/pages/Terminal";
import { Wallet } from "@/pages/Wallet";
import { Artifacts } from "@/pages/Artifacts";
import { Mobile } from "@/pages/Mobile";
import { Setup } from "@/pages/Setup";
import { settingsApi, setupApi } from "@/lib/api";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { resolveSetupGate } from "@/lib/setupGate";
import { useEffect } from "react";
import { readThemeAccentFromConfig, readThemeModeFromIdentity, useUIStore } from "@/stores/uiStore";
import { useQuery } from "@tanstack/react-query";

const SETUP_COMPLETE_KEY = "cybara.setupComplete";

function readSetupComplete(): boolean {
  try {
    return localStorage.getItem(SETUP_COMPLETE_KEY) === "1";
  } catch {
    return false;
  }
}

function writeSetupComplete(done: boolean): void {
  try {
    if (done) localStorage.setItem(SETUP_COMPLETE_KEY, "1");
    else localStorage.removeItem(SETUP_COMPLETE_KEY);
  } catch {
    /* ignore */
  }
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

  useEffect(() => {
    if (setupReady) writeSetupComplete(setupComplete);
  }, [setupComplete, setupReady]);

  const decision = resolveSetupGate({
    pathname: location.pathname,
    setupReady,
    setupComplete,
    cachedSetupComplete,
  });

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
  const { collapsed } = useSidebar();

  return (
    <div
      className={cn(
        "flex-1 overflow-auto transition-all duration-300",
        collapsed ? "md:ml-16" : "md:ml-64",
        "ml-0"
      )}
    >
      <UpdateBanner />
      {children}
    </div>
  );
}

function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<Dashboard />} />
      <Route path="/dashboard" element={<Dashboard />} />
      <Route path="/agents" element={<Agents />} />
      <Route path="/providers" element={<Providers />} />
      <Route path="/router" element={<RouterSettings />} />
      <Route path="/mcp" element={<MCPServers />} />
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
      <Route path="/settings" element={<Settings />} />
      <Route path="/chat" element={<Chat />} />
      <Route path="/logs" element={<Logs />} />
      <Route path="/sessions" element={<Sessions />} />
      <Route path="/wallet" element={<Wallet />} />
      <Route path="/artifacts" element={<Artifacts />} />
    </Routes>
  );
}

function ThemeConfigSync() {
  const setAccent = useUIStore((state) => state.setAccent);
  const setMode = useUIStore((state) => state.setMode);

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
  }, [setAccent, setMode]);

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
          <ToastContainer />
        </div>
      </SidebarProvider>
    </ErrorBoundary>
  );
}

export default App;
