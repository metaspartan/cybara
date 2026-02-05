import { NavLink, useLocation } from 'react-router-dom';
import {
  LayoutDashboard,
  Bot,
  Plug,
  MessageSquare,
  MessagesSquare,
  Brain,
  ListTodo,
  Logs,
  LibraryBig,
  Wrench,
  Settings,
  Terminal,
  BarChart3,
  Code,
  Menu,
  X,
  ChevronDown,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useState, useEffect, useRef } from 'react';

function useAgentStatus() {
  const [status, setStatus] = useState<'idle' | 'thinking' | 'active'>('idle');
  const eventSourceRef = useRef<EventSource | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    console.log('[Status] Initializing...');

    const connectSSE = () => {
      console.log('[Status] Connecting to /api/sse/status...');
      const eventSource = new EventSource('/api/sse/status');
      eventSourceRef.current = eventSource;

      eventSource.onopen = () => {
        console.log('[Status] Connected!');
      };

      // Use onmessage for all messages, then parse
      eventSource.onmessage = (event) => {
        console.log('[Status] Raw message:', event.data);
        try {
          const data = JSON.parse(event.data);
          console.log('[Status] Parsed:', data);

          // Handle both "status" and direct status objects
          const statusValue = data.status || data;

          if (statusValue && (statusValue === 'thinking' || statusValue === 'idle')) {
            console.log('[Status] Updating UI to:', statusValue);
            setStatus(statusValue);

            if (timeoutRef.current) {
              clearTimeout(timeoutRef.current);
            }

            if (statusValue === 'thinking') {
              timeoutRef.current = setTimeout(() => {
                console.log('[Status] Auto-idle');
                setStatus('idle');
              }, 30000);
            }
          }
        } catch (e) {
          console.log('[Status] Parse error:', e);
        }
      };

      eventSource.onerror = (e) => {
        console.log('[Status] Error, reconnecting in 5s...');
        eventSource.close();
        setTimeout(connectSSE, 5000);
      };
    };

    connectSSE();

    return () => {
      console.log('[Status] Cleanup');
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
    label: null, // No label = no collapsible header
    items: [
      { path: '/', icon: LayoutDashboard, label: 'Dashboard' },
      { path: '/agents', icon: Bot, label: 'Agents' },
      { path: '/providers', icon: Plug, label: 'Providers' },
      { path: '/channels', icon: MessageSquare, label: 'Channels' },
    ],
  },
  {
    id: 'developer',
    label: 'Developer',
    items: [
      { path: '/mcp', icon: Terminal, label: 'MCP Servers' },
      { path: '/lsp', icon: Code, label: 'LSP' },
      { path: '/skills', icon: LibraryBig, label: 'Skills' },
      { path: '/tools', icon: Wrench, label: 'Tools' },
    ],
  },
  {
    id: 'chat',
    label: null, // No label = no collapsible header
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
      { path: '/metrics', icon: BarChart3, label: 'Metrics' },
      { path: '/tasks', icon: ListTodo, label: 'Tasks' },
      { path: '/logs', icon: Logs, label: 'Logs' },
    ],
  },
];

export function Sidebar() {
  const location = useLocation();
  const status = useAgentStatus();
  const [mobileOpen, setMobileOpen] = useState(false);
  // Track which collapsible sections are expanded (default: all expanded)
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({
    developer: false,
    system: true,
  });

  // Close sidebar on route change (mobile)
  useEffect(() => {
    setMobileOpen(false);
  }, [location.pathname]);

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
        className={cn(
          'flex items-center gap-3 px-4 py-2.5 rounded-xl text-sm font-medium transition-colors duration-200',
          '!outline-none !ring-0 !border-transparent focus:!outline-none focus-visible:!outline-none active:!outline-none',
          isActive
            ? 'bg-gradient-to-r from-indigo-500/20 to-violet-500/10 text-white border border-indigo-500/30 shadow-lg shadow-indigo-500/10'
            : 'text-gray-400 hover:text-white hover:bg-white/5'
        )}
      >
        <Icon className={cn(
          'w-5 h-5 transition-colors',
          isActive ? 'text-indigo-400' : 'text-gray-500'
        )} />
        <span>{item.label}</span>
      </NavLink>
    );
  };

  return (
    <>
      {/* Mobile Menu Button - positioned on the right */}
      <button
        onClick={() => setMobileOpen(!mobileOpen)}
        className="mobile-menu-btn fixed top-4 right-4 z-50 p-2 rounded-lg bg-[#12121a] border border-white/10 text-white hidden md:hidden !outline-none !ring-0 focus:!outline-none active:!outline-none"
        aria-label="Toggle menu"
      >
        {mobileOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
      </button>

      {/* Mobile Overlay */}
      <div
        className={cn('sidebar-overlay', mobileOpen && 'open')}
        onClick={() => setMobileOpen(false)}
      />

      {/* Sidebar */}
      <aside className={cn(
        'sidebar fixed left-0 top-0 h-full w-64 bg-[#12121a] border-r border-white/10 z-40 overflow-y-auto',
        mobileOpen && 'open'
      )}>
        {/* Compact Logo Header */}
        <div className="px-5 py-4 border-b border-white/10">
          <div className="flex items-center gap-3">
            {/* Logo with thinking animation */}
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
                    'w-full h-full object-cover transition-all duration-300',
                    status === 'thinking' && 'animate-pulse'
                  )}
                />
              </div>
              {/* Thinking glow effect */}
              {status === 'thinking' && (
                <div className="absolute -inset-1 rounded-xl bg-amber-400/20 animate-ping" />
              )}
            </div>
            <div className="flex-1 min-w-0">
              <h1 className="font-bold text-lg gradient-text">Cybara</h1>
              <p className="text-[10px] text-gray-500 leading-tight">Agent Platform</p>
            </div>
          </div>
        </div>

        {/* Navigation with collapsible sections */}
        <nav className="p-3 space-y-1 pb-20">
          {navCategories.map((category) => (
            <div key={category.id}>
              {/* Section header (if has label) */}
              {category.label ? (
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
                  {/* Collapsible content */}
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
                // Non-collapsible section
                <div className="space-y-0.5">
                  {category.items.map(renderNavItem)}
                </div>
              )}
            </div>
          ))}
        </nav>

        {/* Footer */}
        <div className="absolute bottom-0 left-0 right-0 p-3 border-t border-white/10 bg-[#12121a]">
          <NavLink
            to="/settings"
            className={cn(
              'flex items-center gap-3 px-4 py-2.5 rounded-xl text-sm font-medium transition-colors duration-200',
              '!outline-none !ring-0 !border-transparent focus:!outline-none focus-visible:!outline-none active:!outline-none',
              location.pathname === '/settings'
                ? 'bg-gradient-to-r from-indigo-500/20 to-violet-500/10 text-white border border-indigo-500/30 shadow-lg shadow-indigo-500/10'
                : 'text-gray-400 hover:text-white hover:bg-white/5'
            )}
          >
            <Settings className={cn(
              'w-5 h-5 transition-colors',
              location.pathname === '/settings' ? 'text-indigo-400' : 'text-gray-500'
            )} />
            <span>Settings</span>
          </NavLink>
        </div>
      </aside>
    </>
  );
}

