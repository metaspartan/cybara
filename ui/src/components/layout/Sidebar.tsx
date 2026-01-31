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
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useState, useEffect, useRef } from 'react';

function StatusIndicator() {
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

  const statusColors = {
    idle: 'bg-gray-500',
    thinking: 'bg-amber-500 animate-pulse',
    active: 'bg-green-500 animate-pulse',
  };

  const statusLabels = {
    idle: 'Idle',
    thinking: 'Thinking',
    active: 'Active',
  };

  return (
    <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/5 border border-white/10">
      <div className={cn('w-2 h-2 rounded-full', statusColors[status])} />
      <span className="text-xs text-gray-400">{statusLabels[status]}</span>
    </div>
  );
}

const navItems = [
  { path: '/', icon: LayoutDashboard, label: 'Dashboard' },
  { path: '/agents', icon: Bot, label: 'Agents' },
  { path: '/providers', icon: Plug, label: 'Providers' },
  { path: '/channels', icon: MessageSquare, label: 'Channels' },
  { path: '/memory', icon: Brain, label: 'Memory' },
  { path: '/metrics', icon: BarChart3, label: 'Metrics' },
  { path: '/tasks', icon: ListTodo, label: 'Tasks' },
  { path: '/skills', icon: LibraryBig, label: 'Skills' },
  { path: '/tools', icon: Wrench, label: 'Tools' },
  { path: '/chat', icon: MessageSquare, label: 'Chat' },
  { path: '/sessions', icon: MessagesSquare, label: 'Sessions' },
  { path: '/logs', icon: Logs, label: 'Logs' },
];

export function Sidebar() {
  const location = useLocation();

  return (
    <aside className="fixed left-0 top-0 h-full w-64 bg-[#12121a] border-r border-white/10 z-40">
      {/* Logo with glow effect */}
      <div className="p-6 border-b border-white/10">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-xl overflow-hidden">
              <img src="/cybara.png" alt="Cybara" className="w-full h-full object-cover" />
            </div>
            <div>
              <h1 className="font-bold text-lg gradient-text">Cybara</h1>
              <p className="text-xs text-gray-400">Agent Platform</p>
            </div>
          </div>
        </div>
        <div className="mt-3">
          <StatusIndicator />
        </div>
      </div>

      {/* Navigation */}
      <nav className="p-4 space-y-1">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = location.pathname === item.path ||
            (item.path !== '/' && location.pathname.startsWith(item.path));

          return (
            <NavLink
              key={item.path}
              to={item.path}
              className={cn(
                'flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition-all duration-200',
                isActive
                  ? 'bg-gradient-to-r from-indigo-500/20 to-violet-500/10 text-white border border-indigo-500/30 shadow-lg shadow-indigo-500/10'
                  : 'text-gray-400 hover:text-white hover:bg-white/5 hover:translate-x-1'
              )}
            >
              <Icon className={cn(
                'w-5 h-5 transition-colors',
                isActive ? 'text-indigo-400' : 'text-gray-500'
              )} />
              <span>{item.label}</span>
            </NavLink>
          );
        })}
      </nav>

      {/* Footer */}
      <div className="absolute bottom-0 left-0 right-0 p-4 border-t border-white/10">
        <NavLink
          to="/settings"
          className={cn(
            'flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition-all duration-200',
            location.pathname === '/settings'
              ? 'bg-gradient-to-r from-indigo-500/20 to-violet-500/10 text-white border border-indigo-500/30 shadow-lg shadow-indigo-500/10'
              : 'text-gray-400 hover:text-white hover:bg-white/5 hover:translate-x-1'
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
  );
}
