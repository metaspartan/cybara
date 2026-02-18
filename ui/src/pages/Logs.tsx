import { useState, useEffect } from 'react';
import {
  Terminal,
  Search,
  Filter,
  AlertCircle,
  Info,
  AlertTriangle,
  XCircle,
  RefreshCw,
  Calendar,
  Download,
  ChevronDown,
  ChevronRight,
  MessageSquare,
  Logs as LogsIcon,
  Bot,
  Radio,
  Wrench
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Badge } from '@/components/ui/Badge';
import { PageLayout } from '@/components/layout';
import { logsApi } from '@/lib/api';

interface LogEntry {
  id: string;
  level: 'debug' | 'info' | 'warn' | 'error' | string;
  source: string;
  message: string;
  metadata?: string;
  created_at: string;
}

interface LogStats {
  counts: {
    system: number;
    messages: number;
    agent: number;
    channel: number;
  };
  hours: number;
}

const levelIcons = {
  debug: <Terminal className="w-4 h-4 text-gray-400" />,
  info: <Info className="w-4 h-4 text-blue-400" />,
  warn: <AlertTriangle className="w-4 h-4 text-amber-400" />,
  error: <XCircle className="w-4 h-4 text-red-400" />,
};

const levelColors = {
  debug: 'bg-gray-500/20 text-gray-400',
  info: 'bg-blue-500/20 text-blue-400',
  warn: 'bg-amber-500/20 text-amber-400',
  error: 'bg-red-500/20 text-red-400',
};

const sourceIcons: Record<string, React.ReactNode> = {
  agent: <Bot className="w-4 h-4" />,
  channel: <Radio className="w-4 h-4" />,
  tool: <Wrench className="w-4 h-4" />,
  system: <Terminal className="w-4 h-4" />,
  skill: <MessageSquare className="w-4 h-4" />,
  subagent: <Bot className="w-4 h-4" />,
};

export function Logs() {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [stats, setStats] = useState<LogStats | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterLevel, setFilterLevel] = useState<string | null>(null);
  const [filterSource, setFilterSource] = useState<string | null>(null);
  const [expandedLog, setExpandedLog] = useState<string | null>(null);

  const fetchLogs = async () => {
    setIsLoading(true);
    try {
      const [logsResponse, statsResponse] = await Promise.all([
        logsApi.getSystem(),
        logsApi.getStats(24),
      ]);

      if (logsResponse.success) {
        setLogs(logsResponse.data || []);
      }
      if (statsResponse.success) {
        setStats(statsResponse.data);
      }
    } catch (error) {
      console.error('Failed to fetch logs:', error);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchLogs();
    const interval = setInterval(fetchLogs, 30000); // Refresh every 30s
    return () => clearInterval(interval);
  }, []);

  const handleSearch = async () => {
    if (!searchQuery.trim()) {
      fetchLogs();
      return;
    }

    setIsLoading(true);
    try {
      const response = await logsApi.search(searchQuery);
      if (response.success) {
        const allLogs: LogEntry[] = [
          ...(response.data?.system || []).map((l: any) => ({ ...l })),
          ...(response.data?.sessionMessages || []).map((l: any) => ({
            id: l.id,
            level: 'info' as const,
            source: 'session',
            message: `${l.role}: ${l.content.substring(0, 100)}${l.content.length > 100 ? '...' : ''}`,
            created_at: l.created_at
          })),
          ...(response.data?.agent || []).map((l: any) => ({
            id: l.id,
            level: 'info' as const,
            source: 'agent',
            message: `Action: ${l.action}${l.details ? ` - ${l.details}` : ''}`,
            created_at: l.created_at
          })),
          ...(response.data?.channel || []).map((l: any) => ({
            id: l.id,
            level: 'info' as const,
            source: 'channel',
            message: `${l.direction}: ${l.content.substring(0, 100)}${l.content.length > 100 ? '...' : ''}`,
            created_at: l.created_at
          })),
        ].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
        setLogs(allLogs);
      }
    } catch (error) {
      console.error('Search failed:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const filteredLogs = logs.filter(log => {
    if (filterLevel && log.level !== filterLevel) return false;
    if (filterSource && log.source !== filterSource) return false;
    return true;
  });

  const exportLogs = () => {
    const data = JSON.stringify(filteredLogs, null, 2);
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `logs-${new Date().toISOString()}.json`;
    a.click();
  };

  return (
    <PageLayout
      title="Logs"
      subtitle="View and search system logs"
      actions={
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={fetchLogs} leftIcon={<RefreshCw className="w-4 h-4" />}>
            Refresh
          </Button>
          <Button variant="secondary" size="sm" onClick={exportLogs} leftIcon={<Download className="w-4 h-4" />}>
            Export
          </Button>
        </div>
      }
    >
      <div className="space-y-6">
        {stats && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Card>
              <CardContent className="p-4">
                <div className="flex items-center gap-3">
                  <LogsIcon className="w-8 h-8 text-blue-400" />
                  <div>
                    <p className="text-sm text-gray-400">System Logs</p>
                    <p className="text-2xl font-bold text-white">{stats.counts.system}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <div className="flex items-center gap-3">
                  <MessageSquare className="w-8 h-8 text-emerald-400" />
                  <div>
                    <p className="text-sm text-gray-400">Messages</p>
                    <p className="text-2xl font-bold text-white">{stats.counts.messages}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <div className="flex items-center gap-3">
                  <Bot className="w-8 h-8 text-violet-400" />
                  <div>
                    <p className="text-sm text-gray-400">Agent Logs</p>
                    <p className="text-2xl font-bold text-white">{stats.counts.agent}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <div className="flex items-center gap-3">
                  <Radio className="w-8 h-8 text-amber-400" />
                  <div>
                    <p className="text-sm text-gray-400">Channel Logs</p>
                    <p className="text-2xl font-bold text-white">{stats.counts.channel}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        <Card>
          <CardContent className="p-4">
            <div className="flex flex-col md:flex-row gap-4">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-500" />
                <Input
                  placeholder="Search logs..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                  className="pl-10"
                />
              </div>
              <div className="flex gap-2">
                <select
                  value={filterLevel || ''}
                  onChange={(e) => setFilterLevel(e.target.value || null)}
                  className="px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-white text-sm"
                >
                  <option value="">All Levels</option>
                  <option value="debug">Debug</option>
                  <option value="info">Info</option>
                  <option value="warn">Warn</option>
                  <option value="error">Error</option>
                </select>
                <select
                  value={filterSource || ''}
                  onChange={(e) => setFilterSource(e.target.value || null)}
                  className="px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-white text-sm"
                >
                  <option value="">All Sources</option>
                  <option value="agent">Agent</option>
                  <option value="channel">Channel</option>
                  <option value="tool">Tool</option>
                  <option value="system">System</option>
                  <option value="skill">Skill</option>
                </select>
                <Button onClick={handleSearch}>Search</Button>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center justify-between">
              <span>Log Entries</span>
              <Badge variant="default">{filteredLogs.length} entries</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {isLoading ? (
              <div className="p-8 text-center">
                <RefreshCw className="w-8 h-8 animate-spin mx-auto mb-4 text-gray-500" />
                <p className="text-gray-400">Loading logs...</p>
              </div>
            ) : filteredLogs.length === 0 ? (
              <div className="p-8 text-center">
                <Terminal className="w-12 h-12 mx-auto mb-4 text-gray-600" />
                <p className="text-gray-400">No logs found</p>
              </div>
            ) : (
              <div className="divide-y divide-white/10">
                {filteredLogs.map((log) => (
                  <div
                    key={log.id}
                    className="p-4 hover:bg-white/5 cursor-pointer transition-colors"
                    onClick={() => setExpandedLog(expandedLog === log.id ? null : log.id)}
                  >
                    <div className="flex items-start gap-3">
                      {levelIcons[log.level]}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <Badge className={levelColors[log.level]} size="sm">
                            {log.level}
                          </Badge>
                          <Badge variant="default" size="sm" className="flex items-center gap-1">
                            {sourceIcons[log.source] || <Terminal className="w-3 h-3" />}
                            {log.source}
                          </Badge>
                          <span className="text-xs text-gray-500">
                            {new Date(log.created_at).toLocaleString()}
                          </span>
                        </div>
                        <p className="text-sm text-white truncate">{log.message}</p>

                        {expandedLog === log.id && log.metadata && (
                          <div className="mt-3 p-3 rounded-lg bg-black/30">
                            <p className="text-xs text-gray-400 mb-1">Metadata:</p>
                            <pre className="text-xs text-gray-300 overflow-auto max-h-40">
                              {JSON.stringify(JSON.parse(log.metadata), null, 2)}
                            </pre>
                          </div>
                        )}
                      </div>
                      {expandedLog === log.id ? (
                        <ChevronDown className="w-4 h-4 text-gray-500" />
                      ) : (
                        <ChevronRight className="w-4 h-4 text-gray-500" />
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </PageLayout>
  );
}
