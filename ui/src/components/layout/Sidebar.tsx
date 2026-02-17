import { NavLink, useLocation } from 'react-router-dom';
import {
  LayoutDashboard,
  Bot,
  Plug,
  Smartphone,
  MessageSquare,
  MessagesSquare,
  Brain,
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
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useState, useEffect, useRef, createContext, useContext } from 'react';
import { appendApiTokenParam } from '@/lib/auth';

// Context for sidebar state (shared with App layout)
interface SidebarContextType {
  collapsed: boolean;
  setCollapsed: (collapsed: boolean) => void;
  mobileOpen: boolean;
  setMobileOpen: (open: boolean) => void;
}

const SidebarContext = createContext<SidebarContextType>({
  collapsed: false,
  setCollapsed: () => { },
  mobileOpen: false,
  setMobileOpen: () => { },
});

export function useSidebar() {
  return useContext(SidebarContext);
}

export function SidebarProvider({ children }: { children: React.ReactNode }) {
  const [collapsed, setCollapsed] = useState(() => {
    const saved = localStorage.getItem('sidebar-collapsed');
    return saved === 'true';
  });
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    localStorage.setItem('sidebar-collapsed', String(collapsed));
  }, [collapsed]);

  return (
    <SidebarContext.Provider value={{ collapsed, setCollapsed, mobileOpen, setMobileOpen }}>
      {children}
    </SidebarContext.Provider>
  );
}

function useAgentStatus() {
  const [status, setStatus] = useState<'idle' | 'thinking' | 'active'>('idle');
  const eventSourceRef = useRef<EventSource | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const connectSSE = () => {
      const eventSource = new EventSource(appendApiTokenParam('/api/sse/status'));
      eventSourceRef.current = eventSource;

      eventSource.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          const statusValue = data.status || data;

          if (statusValue && (statusValue === 'thinking' || statusValue === 'idle')) {
            setStatus(statusValue);

            if (timeoutRef.current) {
              clearTimeout(timeoutRef.current);
            }

            if (statusValue === 'thinking') {
              timeoutRef.current = setTimeout(() => {
                setStatus('idle');
              }, 30000);
            }
          }
        } catch {
          // Ignore parse errors
        }
      };

      eventSource.onerror = () => {
        eventSource.close();
        setTimeout(connectSSE, 5000);
      };
    };

    connectSSE();

    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
      }
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  return status;
}

// Navigation items grouped by category
const navCategories = [
  {
    id: 'main',
    label: null,
    items: [
      { path: '/', icon: LayoutDashboard, label: 'Dashboard' },
      { path: '/agents', icon: Bot, label: 'Agents' },
      { path: '/providers', icon: Plug, label: 'Providers' },
      { path: '/channels', icon: Smartphone, label: 'Channels' },
    ],
  },
  {
    id: 'developer',
    label: 'Developer',
    items: [
      { path: '/mcp', icon: Terminal, label: 'MCP Servers' },
      { path: '/lsp', icon: Code, label: 'LSP' },
      { path: '/ide', icon: FolderOpen, label: 'IDE' },
      { path: '/skills', icon: LibraryBig, label: 'Skills' },
      { path: '/tools', icon: Wrench, label: 'Tools' },
      { path: '/terminal', icon: SquareTerminal, label: 'Terminal' },
    ],
  },
  {
    id: 'chat',
    label: null,
    items: [
      { path: '/chat', icon: MessageSquare, label: 'Chat' },
      { path: '/sessions', icon: MessagesSquare, label: 'Sessions' },
    ],
  },
  {
    id: 'system',
    label: 'System',
    items: [
      { path: '/memory', icon: Brain, label: 'Memory' },
      { path: '/wallet', icon: WalletIcon, label: 'Wallet' },
      { path: '/metrics', icon: BarChart3, label: 'Metrics' },
      { path: '/tasks', icon: ListTodo, label: 'Tasks' },
      { path: '/logs', icon: Logs, label: 'Logs' },
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

  // Close sidebar on route change (mobile)
  useEffect(() => {
    setMobileOpen(false);
  }, [location.pathname, setMobileOpen]);

  const toggleSection = (id: string) => {
    setExpandedSections((prev) => ({
      ...prev,
      [id]: !prev[id],
    }));
  };

  const renderNavItem = (item: { path: string; icon: React.ComponentType<{ className?: string }>; label: string }) => {
    const Icon = item.icon;
    const isActive = location.pathname === item.path ||
      (item.path !== '/' && location.pathname.startsWith(item.path));

    return (
      <NavLink
        key={item.path}
        to={item.path}
        title={collapsed ? item.label : undefined}
        className={cn(
          'flex items-center gap-3 rounded-xl text-sm font-medium transition-all duration-200',
          '!outline-none !ring-0 !border-transparent focus:!outline-none focus-visible:!outline-none active:!outline-none',
          collapsed ? 'px-3 py-2.5 justify-center' : 'px-4 py-2.5',
          isActive
            ? 'bg-[rgba(var(--accent-primary),0.15)] text-white border border-[rgba(var(--accent-primary),0.3)] shadow-lg'
            : 'text-gray-400 hover:text-white hover:bg-white/5'
        )}
        style={isActive ? { boxShadow: 'inset 0 1px 8px rgba(var(--accent-primary), 0.15)' } : undefined}
      >
        <Icon className={cn(
          'w-5 h-5 flex-shrink-0 transition-colors',
          isActive ? 'accent-text' : 'text-gray-500'
        )} />
        {!collapsed && <span className="truncate">{item.label}</span>}
      </NavLink>
    );
  };

  return (
    <>
      {/* Mobile Menu Button */}
      <button
        onClick={() => setMobileOpen(!mobileOpen)}
        className="fixed top-4 right-4 z-50 p-2 rounded-lg glass-button text-white md:hidden !outline-none !ring-0 focus:!outline-none active:!outline-none"
        aria-label="Toggle menu"
      >
        {mobileOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
      </button>

      {/* Mobile Overlay */}
      {mobileOpen && (
        <div
          className="fixed inset-0 bg-black/60 backdrop-blur-sm z-30 md:hidden animate-in fade-in"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside className={cn(
        'fixed left-0 top-0 h-full glass border-r border-white/5 z-40 overflow-hidden transition-all duration-300',
        collapsed ? 'w-16' : 'w-64',
        // Mobile: slide in from left
        'max-md:-translate-x-full max-md:w-64',
        mobileOpen && 'max-md:translate-x-0'
      )}>
        <div className="h-full flex flex-col">
          {/* Logo Header */}
          <div className={cn(
            'border-b border-white/5 flex items-center',
            collapsed ? 'px-3 py-4 justify-center' : 'px-5 py-4 gap-3'
          )}>
            <div className="relative flex-shrink-0">
              <div
                className={cn(
                  'w-10 h-10 rounded-xl overflow-hidden transition-all duration-300',
                  status === 'thinking' && 'ring-2 ring-amber-400/60 ring-offset-2 ring-offset-[#12121a]'
                )}
              >
                <img
                  src="/cybara.png"
                  alt="Cybara"
                  className={cn(
                    'w-full h-full object-cover transition-all duration-300'
                  )}
                />
              </div>
              {status === 'thinking' && (
                <div className="absolute -inset-1 rounded-xl bg-amber-400/20" />
              )}
            </div>
            {!collapsed && (
              <div className="flex-1 min-w-0">
                <h1 className="font-bold text-lg text-white">Cybara</h1>
                <p className="text-[10px] text-gray-400 leading-tight">Agent Platform</p>
              </div>
            )}
          </div>

          {/* Navigation */}
          <nav className={cn(
            'flex-1 p-2 space-y-1 pb-20',
            collapsed ? 'overflow-hidden' : 'overflow-y-auto'
          )}>
            {navCategories.map((category) => (
              <div key={category.id}>
                {category.label && !collapsed ? (
                  <>
                    <button
                      onClick={() => toggleSection(category.id)}
                      className="w-full flex items-center justify-between px-3 py-2 mt-3 mb-1 text-xs font-semibold text-gray-500 uppercase tracking-wider hover:text-gray-400 transition-colors !outline-none !ring-0 focus:!outline-none active:!outline-none"
                    >
                      <span>{category.label}</span>
                      <ChevronDown
                        className={cn(
                          'w-4 h-4 transition-transform duration-200',
                          !expandedSections[category.id] && '-rotate-90'
                        )}
                      />
                    </button>
                    <div
                      className={cn(
                        'space-y-0.5 overflow-hidden transition-all duration-200',
                        expandedSections[category.id] ? 'max-h-96 opacity-100' : 'max-h-0 opacity-0'
                      )}
                    >
                      {category.items.map(renderNavItem)}
                    </div>
                  </>
                ) : (
                  <div className="space-y-0.5">
                    {category.items.map(renderNavItem)}
                  </div>
                )}
              </div>
            ))}
          </nav>

          {/* Footer */}
          <div className="border-t border-white/5 bg-black/20 p-2 backdrop-blur-md">
            {/* Settings */}
            <NavLink
              to="/settings"
              title={collapsed ? 'Settings' : undefined}
              className={cn(
                'flex items-center gap-3 rounded-xl text-sm font-medium transition-all duration-200 mb-2',
                '!outline-none !ring-0 !border-transparent focus:!outline-none focus-visible:!outline-none active:!outline-none',
                collapsed ? 'px-3 py-2.5 justify-center' : 'px-4 py-2.5',
                location.pathname === '/settings'
                  ? 'bg-[rgba(var(--accent-primary),0.15)] text-white border border-[rgba(var(--accent-primary),0.3)] shadow-lg'
                  : 'text-gray-400 hover:text-white hover:bg-white/5'
              )}
              style={location.pathname === '/settings' ? { boxShadow: 'inset 0 1px 8px rgba(var(--accent-primary), 0.15)' } : undefined}
            >
              <Settings className={cn(
                'w-5 h-5 flex-shrink-0 transition-colors',
                location.pathname === '/settings' ? 'accent-text' : 'text-gray-500'
              )} />
              {!collapsed && <span>Settings</span>}
            </NavLink>

            {/* Collapse Toggle (desktop only) */}
            <button
              onClick={() => setCollapsed(!collapsed)}
              className="hidden md:flex w-full items-center justify-center gap-2 px-3 py-2 rounded-lg text-sm text-gray-500 hover:text-white hover:bg-white/5 transition-colors !outline-none"
              title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
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
