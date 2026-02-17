import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { Sidebar, SidebarProvider, useSidebar } from '@/components/layout/Sidebar';
import { ToastContainer } from '@/components/ui/Toast';
import { Dashboard } from '@/pages/Dashboard';
import { Agents } from '@/pages/Agents';
import { Providers } from '@/pages/Providers';
import { Channels } from '@/pages/Channels';
import { Tasks } from '@/pages/Tasks';
import { Skills } from '@/pages/Skills';
import { Tools } from '@/pages/Tools';
import { Memory } from '@/pages/Memory';
import { Settings } from '@/pages/Settings';
import { Chat } from '@/pages/Chat';
import { Logs } from '@/pages/Logs';
import { Sessions } from '@/pages/Sessions';
import { Metrics } from '@/pages/Metrics';
import { MCPServers } from '@/pages/MCPServers';
import { LSP } from '@/pages/LSP';
import { IDE } from '@/pages/IDE';
import { TerminalPage } from '@/pages/Terminal';
import { Wallet } from '@/pages/Wallet';
import { Setup } from '@/pages/Setup';
import { useProviders, useAgents } from '@/hooks/useApi';
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

// Redirect to setup if no providers/agents configured
function SetupGuard({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  const { data: providers, isLoading: providersLoading } = useProviders();
  const { data: agents, isLoading: agentsLoading } = useAgents();

  // Skip guard on setup page
  if (location.pathname === '/setup') {
    return <>{children}</>;
  }

  // Show loading indicator while checking setup status
  if (providersLoading || agentsLoading) {
    return (
      <div className="flex-1 flex items-center justify-center bg-[#0a0a0f]">
        <Loader2 className="w-8 h-8 text-indigo-500 animate-spin" />
      </div>
    );
  }

  // Redirect to setup if no providers OR no agents
  const needsSetup = (!providers || providers.length === 0) || (!agents || agents.length === 0);
  if (needsSetup) {
    return <Navigate to="/setup" replace />;
  }

  return <>{children}</>;
}

// Main content wrapper that responds to sidebar state
function MainContent({ children }: { children: React.ReactNode }) {
  const { collapsed } = useSidebar();

  return (
    <div className={cn(
      'flex-1 overflow-auto transition-all duration-300',
      // Desktop: adjust margin based on sidebar width
      collapsed ? 'md:ml-16' : 'md:ml-64',
      // Mobile: no margin (sidebar overlays)
      'ml-0'
    )}>
      {children}
    </div>
  );
}

function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<Dashboard />} />
      <Route path="/agents" element={<Agents />} />
      <Route path="/providers" element={<Providers />} />
      <Route path="/mcp" element={<MCPServers />} />
      <Route path="/channels" element={<Channels />} />
      <Route path="/tasks" element={<Tasks />} />
      <Route path="/skills" element={<Skills />} />
      <Route path="/lsp" element={<LSP />} />
      <Route path="/ide" element={<IDE />} />
      <Route path="/terminal" element={<TerminalPage />} />
      <Route path="/tools" element={<Tools />} />
      <Route path="/memory" element={<Memory />} />
      <Route path="/metrics" element={<Metrics />} />
      <Route path="/settings" element={<Settings />} />
      <Route path="/chat" element={<Chat />} />
      <Route path="/logs" element={<Logs />} />
      <Route path="/sessions" element={<Sessions />} />
      <Route path="/wallet" element={<Wallet />} />
    </Routes>
  );
}

function App() {
  return (
    <SidebarProvider>
      <div className="flex min-h-screen bg-[#0a0a0f] overflow-hidden">
        <Routes>
          {/* Setup wizard - no sidebar */}
          <Route path="/setup" element={<Setup />} />

          {/* Main app with sidebar */}
          <Route path="*" element={
            <>
              <Sidebar />
              <SetupGuard>
                <MainContent>
                  <AppRoutes />
                </MainContent>
              </SetupGuard>
            </>
          } />
        </Routes>
        <ToastContainer />
      </div>
    </SidebarProvider>
  );
}

export default App;
