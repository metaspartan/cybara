import {
  Bot,
  Cloud,
  MessageSquare,
  Clock,
  Activity,
  ArrowRight,
  Database,
  Cpu,
  CheckCircle
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { PageLayout } from '@/components/layout';
import { useInfo, useHealth, useSystemMonitor } from '@/hooks/useApi';
import { Link } from 'react-router-dom';

function getCheckStatus(value: unknown): { status: 'healthy' | 'warning' | 'error'; details?: string } {
  if (typeof value === 'string') {
    return { status: value === 'healthy' ? 'healthy' : 'error' };
  }
  if (typeof value === 'object' && value !== null) {
    const obj = value as Record<string, unknown>;
    if (obj.status === 'healthy') return { status: 'healthy' };
    if (obj.status) return { status: obj.status as 'error' };
    if ('total' in obj) {
      return { status: 'healthy', details: `${obj.total} total` };
    }
    if ('heapUsed' in obj) {
      return { status: 'healthy', details: `${obj.heapUsed}MB used` };
    }
  }
  return { status: 'healthy' };
}

function formatBytes(bytes?: number): string {
  const value = Number(bytes || 0);
  if (value >= 1024 * 1024 * 1024) return `${(value / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  if (value >= 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(1)} MB`;
  if (value >= 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${Math.round(value)} B`;
}

function formatPct(value?: number | null): string {
  return typeof value === 'number' && Number.isFinite(value) ? `${value.toFixed(1)}%` : 'n/a';
}

function ResourceBar({ label, value, detail }: { label: string; value?: number | null; detail: string }) {
  const pct = typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : 0;
  return (
    <div className="space-y-2 rounded-xl bg-white/5 p-3">
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm font-medium text-white">{label}</span>
        <span className="text-sm font-semibold text-cyan-300">{formatPct(value)}</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-white/10">
        <div className="h-full rounded-full bg-cyan-400" style={{ width: `${pct}%` }} />
      </div>
      <p className="text-xs text-gray-500">{detail}</p>
    </div>
  );
}

export function Dashboard() {
  const { data: info } = useInfo();
  const { data: health } = useHealth();
  const { data: systemMonitor } = useSystemMonitor();

  const stats = [
    { name: 'Agents', value: info?.stats.agents.total || 0, icon: Bot, href: '/agents', color: 'from-indigo-500 to-violet-500' },
    { name: 'Providers', value: info?.stats.providers.total || 0, icon: Cloud, href: '/providers', color: 'from-blue-500 to-cyan-500' },
    { name: 'Channels', value: info?.stats.channels.total || 0, icon: MessageSquare, href: '/channels', color: 'from-emerald-500 to-teal-500' },
    { name: 'Tasks', value: info?.stats.tasks.total || 0, icon: Clock, href: '/tasks', color: 'from-amber-500 to-orange-500' },
  ];

  const checks = health?.checks
    ? Object.entries(health.checks).filter(([key]) => key !== 'memory' && key !== 'system')
    : [];

  return (
    <PageLayout title="Dashboard" subtitle="Overview of your agent platform">
      <div className="space-y-6">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 p-1">
          {stats.map((stat) => (
            <Link key={stat.name} to={stat.href} className="block focus:outline-none active:outline-none">
              <Card className="h-full" variant="liquid">
                <CardContent>
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="text-sm font-medium text-gray-400">{stat.name}</p>
                      <p className="text-3xl font-bold text-white mt-2">{stat.value}</p>
                    </div>
                    <div className={cn(
                      'w-12 h-12 rounded-xl flex items-center justify-center bg-gradient-to-br shadow-lg',
                      stat.color
                    )}>
                      <stat.icon className="w-6 h-6 text-white" />
                    </div>
                  </div>
                  <div className="flex items-center gap-1 mt-4 text-sm text-gray-400">
                    <span>Manage</span>
                    <ArrowRight className="w-4 h-4" />
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Card variant="liquid">
            <CardHeader>
              <CardTitle>Quick Start</CardTitle>
              <CardDescription>Get started with common actions</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <Link to="/agents" className="block focus:outline-none active:outline-none">
                <div className="flex items-center gap-3 p-3 rounded-xl bg-white/5 hover:bg-white/10 cursor-pointer">
                  <div className="w-10 h-10 rounded-lg bg-indigo-500/20 flex items-center justify-center">
                    <Bot className="w-5 h-5 text-indigo-400" />
                  </div>
                  <div className="flex-1">
                    <h4 className="text-white font-medium">Create an Agent</h4>
                    <p className="text-sm text-gray-400">Set up a new AI agent with custom settings</p>
                  </div>
                  <ArrowRight className="w-5 h-5 text-gray-500" />
                </div>
              </Link>

              <Link to="/providers" className="block focus:outline-none active:outline-none">
                <div className="flex items-center gap-3 p-3 rounded-xl bg-white/5 hover:bg-white/10 cursor-pointer">
                  <div className="w-10 h-10 rounded-lg bg-blue-500/20 flex items-center justify-center">
                    <Cloud className="w-5 h-5 text-blue-400" />
                  </div>
                  <div className="flex-1">
                    <h4 className="text-white font-medium">Add a Provider</h4>
                    <p className="text-sm text-gray-400">Connect to an AI model provider</p>
                  </div>
                  <ArrowRight className="w-5 h-5 text-gray-500" />
                </div>
              </Link>

              <Link to="/channels" className="block focus:outline-none active:outline-none">
                <div className="flex items-center gap-3 p-3 rounded-xl bg-white/5 hover:bg-white/10 cursor-pointer">
                  <div className="w-10 h-10 rounded-lg bg-emerald-500/20 flex items-center justify-center">
                    <MessageSquare className="w-5 h-5 text-emerald-400" />
                  </div>
                  <div className="flex-1">
                    <h4 className="text-white font-medium">Configure Channels</h4>
                    <p className="text-sm text-gray-400">Set up Telegram, Discord, or other channels</p>
                  </div>
                  <ArrowRight className="w-5 h-5 text-gray-500" />
                </div>
              </Link>
            </CardContent>
          </Card>

          <Card variant="liquid">
            <CardHeader>
              <CardTitle>System Status</CardTitle>
              <CardDescription>Current platform health metrics</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-center justify-between p-3 rounded-xl bg-white/5">
                <div className="flex items-center gap-3">
                  <div className={cn(
                    'w-2 h-2 rounded-full',
                    health?.status === 'healthy' ? 'bg-emerald-500 animate-pulse' : 'bg-red-500'
                  )} />
                  <span className="text-white font-medium">Overall Status</span>
                </div>
                <Badge variant={health?.status === 'healthy' ? 'success' : 'error'}>
                  {health?.status || 'Unknown'}
                </Badge>
              </div>

              <ResourceBar
                label="CPU"
                value={systemMonitor?.cpu.usagePct}
                detail={`${systemMonitor?.cpu.cores || 0} cores - ${systemMonitor?.cpu.model || 'Loading CPU'}`}
              />
              <ResourceBar
                label="Memory"
                value={systemMonitor?.memory.usedPct}
                detail={`${formatBytes(systemMonitor?.memory.usedBytes)} / ${formatBytes(systemMonitor?.memory.totalBytes)} used`}
              />
              <ResourceBar
                label="Process"
                value={systemMonitor?.process.cpuUsagePct}
                detail={`${formatBytes(systemMonitor?.process.memory.rssBytes)} RSS - PID ${systemMonitor?.process.pid || 'n/a'}`}
              />
              <ResourceBar
                label="Disk"
                value={systemMonitor?.disk?.usedPct}
                detail={
                  systemMonitor?.disk
                    ? `${formatBytes(systemMonitor.disk.freeBytes)} free at ${systemMonitor.disk.path}`
                    : 'Disk telemetry unavailable'
                }
              />

              {checks.map(([key, value]) => {
                const check = getCheckStatus(value);
                const icons: Record<string, React.ReactNode> = {
                  database: <Database className="w-4 h-4" />,
                  agents: <Bot className="w-4 h-4" />,
                  providers: <Cloud className="w-4 h-4" />,
                  memory: <Cpu className="w-4 h-4" />,
                };

                return (
                  <div key={key} className="flex items-center justify-between p-3 rounded-xl bg-white/5">
                    <div className="flex items-center gap-3">
                      <div className={cn(
                        'w-8 h-8 rounded-lg flex items-center justify-center',
                        check.status === 'healthy' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-red-500/20 text-red-400'
                      )}>
                        {icons[key] || <Activity className="w-4 h-4" />}
                      </div>
                      <div>
                        <span className="text-white capitalize">{key}</span>
                        {check.details && (
                          <p className="text-xs text-gray-500">{check.details}</p>
                        )}
                      </div>
                    </div>
                    <Badge variant={check.status === 'healthy' ? 'success' : 'error'}>
                      {check.status === 'healthy' ? <CheckCircle className="w-3 h-3 mr-1" /> : <Activity className="w-3 h-3 mr-1" />}
                      {check.status}
                    </Badge>
                  </div>
                );
              })}
            </CardContent>
          </Card>
        </div>
      </div>
    </PageLayout>
  );
}

function cn(...classes: (string | boolean | undefined)[]) {
  return classes.filter(Boolean).join(' ');
}
