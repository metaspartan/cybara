import { useState, useEffect, useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
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
  Wrench,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Badge } from "@/components/ui/Badge";
import { PageLayout } from "@/components/layout";
import { logsApi } from "@/lib/api";
import { connectStatusStream } from "@/lib/status-stream";

interface LogEntry {
  id: string;
  level: "debug" | "info" | "warn" | "error" | string;
  source: string;
  message: string;
  metadata?: string;
  created_at: string;
}

interface LogCategoryCounts {
  system: number;
  messages: number;
  agent: number;
  channel: number;
  cli: number;
}

interface LogStats {
  counts: LogCategoryCounts;
  totals: LogCategoryCounts & { combined: number };
  hours: number;
}

const LOGS_PAGE_SIZE = 200;

interface SessionMessageLog {
  id: string;
  role: string;
  content: string;
  created_at: string;
}

interface AgentActionLog {
  id: string;
  action: string;
  details?: string;
  created_at: string;
}

interface ChannelMessageLog {
  id: string;
  direction?: string;
  content: string;
  created_at: string;
}

const levelIcons = {
  debug: <Terminal className="w-4 h-4 text-gray-400" />,
  info: <Info className="w-4 h-4 text-blue-400" />,
  warn: <AlertTriangle className="w-4 h-4 text-amber-400" />,
  error: <XCircle className="w-4 h-4 text-red-400" />,
};

const levelColors = {
  debug: "bg-gray-500/20 text-gray-400",
  info: "bg-blue-500/20 text-blue-400",
  warn: "bg-amber-500/20 text-amber-400",
  error: "bg-red-500/20 text-red-400",
};

const sourceIcons: Record<string, React.ReactNode> = {
  agent: <Bot className="w-4 h-4" />,
  channel: <Radio className="w-4 h-4" />,
  tool: <Wrench className="w-4 h-4" />,
  system: <Terminal className="w-4 h-4" />,
  skill: <MessageSquare className="w-4 h-4" />,
  subagent: <Bot className="w-4 h-4" />,
  cli: <Terminal className="w-4 h-4" />,
};

function LogStatCard({
  icon,
  label,
  total,
  inWindow,
  hours,
}: {
  icon: React.ReactNode;
  label: string;
  total: number;
  inWindow: number;
  hours: number;
}) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center gap-3">
          {icon}
          <div className="min-w-0">
            <p className="text-sm text-gray-400 truncate">{label}</p>
            <p className="text-2xl font-bold text-white">{total.toLocaleString()}</p>
            <p className="text-[11px] text-gray-500">
              +{inWindow.toLocaleString()} in {hours}h
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export function Logs() {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [totalLogs, setTotalLogs] = useState<number | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [isSearchResults, setIsSearchResults] = useState(false);
  const [stats, setStats] = useState<LogStats | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [filterLevel, setFilterLevel] = useState<string | null>(null);
  const [filterSource, setFilterSource] = useState<string | null>(null);
  const [expandedLog, setExpandedLog] = useState<string | null>(null);
  const parentRef = useRef<HTMLDivElement>(null);
  const refreshTimerRef = useRef<number | null>(null);

  const fetchLogs = async (options?: { silent?: boolean }) => {
    if (!options?.silent) {
      setIsLoading(true);
    }
    try {
      const [logsResponse, statsResponse] = await Promise.all([
        logsApi.getPage(LOGS_PAGE_SIZE, 0),
        logsApi.getStats(24),
      ]);

      if (logsResponse.success && logsResponse.data) {
        setLogs(logsResponse.data.logs || []);
        setTotalLogs(logsResponse.data.total ?? null);
        setHasMore(Boolean(logsResponse.data.hasMore));
        setIsSearchResults(false);
      }
      if (statsResponse.success) {
        setStats(statsResponse.data);
      }
    } catch (error) {
      console.error("Failed to fetch logs:", error);
    } finally {
      if (!options?.silent) {
        setIsLoading(false);
      }
    }
  };

  const loadMore = async () => {
    if (isLoadingMore) return;
    setIsLoadingMore(true);
    try {
      const response = await logsApi.getPage(LOGS_PAGE_SIZE, logs.length);
      if (response.success && response.data) {
        const next = response.data.logs || [];
        setLogs((current) => {
          const seen = new Set(current.map((log) => log.id));
          return [...current, ...next.filter((log) => !seen.has(log.id))];
        });
        setTotalLogs(response.data.total ?? null);
        setHasMore(Boolean(response.data.hasMore));
      }
    } catch (error) {
      console.error("Failed to load more logs:", error);
    } finally {
      setIsLoadingMore(false);
    }
  };

  useEffect(() => {
    void fetchLogs();
    const pollTimer = window.setInterval(() => {
      if (!document.hidden) void fetchLogs({ silent: true });
    }, 20_000);
    const disconnect = connectStatusStream({
      onEvent: (event) => {
        if (!event || typeof event !== "object") return;
        if (
          event.type !== "status" &&
          event.type !== "snapshot" &&
          event.type !== "task_completed"
        ) {
          return;
        }
        if (refreshTimerRef.current !== null) {
          window.clearTimeout(refreshTimerRef.current);
        }
        refreshTimerRef.current = window.setTimeout(() => {
          void fetchLogs({ silent: true });
          refreshTimerRef.current = null;
        }, 800);
      },
    });
    return () => {
      disconnect();
      window.clearInterval(pollTimer);
      if (refreshTimerRef.current !== null) {
        window.clearTimeout(refreshTimerRef.current);
        refreshTimerRef.current = null;
      }
    };
  }, []);

  const handleSearch = async () => {
    if (!searchQuery.trim()) {
      void fetchLogs();
      return;
    }

    setIsLoading(true);
    try {
      const response = await logsApi.search(searchQuery);
      if (response.success) {
        const searchData = response.data as
          | {
              system?: LogEntry[];
              sessionMessages?: SessionMessageLog[];
              agent?: AgentActionLog[];
              channel?: ChannelMessageLog[];
            }
          | undefined;
        const allLogs: LogEntry[] = [
          ...(searchData?.system || []).map((l: LogEntry) => ({ ...l })),
          ...(searchData?.sessionMessages || []).map((l: SessionMessageLog) => ({
            id: l.id,
            level: "info" as const,
            source: "session",
            message: `${l.role}: ${l.content.substring(0, 100)}${l.content.length > 100 ? "..." : ""}`,
            created_at: l.created_at,
          })),
          ...(searchData?.agent || []).map((l: AgentActionLog) => ({
            id: l.id,
            level: "info" as const,
            source: "agent",
            message: `Action: ${l.action}${l.details ? ` - ${l.details}` : ""}`,
            created_at: l.created_at,
          })),
          ...(searchData?.channel || []).map((l: ChannelMessageLog) => ({
            id: l.id,
            level: "info" as const,
            source: "channel",
            message: `${l.direction || "message"}: ${l.content.substring(0, 100)}${l.content.length > 100 ? "..." : ""}`,
            created_at: l.created_at,
          })),
        ].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
        setLogs(allLogs);
        setTotalLogs(allLogs.length);
        setHasMore(false);
        setIsSearchResults(true);
      }
    } catch (error) {
      console.error("Search failed:", error);
    } finally {
      setIsLoading(false);
    }
  };

  const filteredLogs = logs.filter((log) => {
    if (filterLevel && log.level !== filterLevel) return false;
    if (filterSource && log.source !== filterSource) return false;
    return true;
  });

  const exportLogs = () => {
    const data = JSON.stringify(filteredLogs, null, 2);
    const blob = new Blob([data], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `logs-${new Date().toISOString()}.json`;
    a.click();
  };

  const virtualizer = useVirtualizer({
    count: filteredLogs.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 72,
    overscan: 10,
  });

  return (
    <PageLayout
      title="Logs"
      subtitle="View and search system logs"
      actions={
        <div className="flex items-center gap-2">
          <Button
            variant="secondary"
            size="sm"
            onClick={exportLogs}
            leftIcon={<Download className="w-4 h-4" />}
          >
            Export
          </Button>
        </div>
      }
    >
      <div className="space-y-6">
        {stats && (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
            <LogStatCard
              icon={<LogsIcon className="w-8 h-8 text-blue-400" />}
              label="System Logs"
              total={stats.totals?.system ?? stats.counts.system}
              inWindow={stats.counts.system}
              hours={stats.hours}
            />
            <LogStatCard
              icon={<MessageSquare className="w-8 h-8 text-emerald-400" />}
              label="Messages"
              total={stats.totals?.messages ?? stats.counts.messages}
              inWindow={stats.counts.messages}
              hours={stats.hours}
            />
            <LogStatCard
              icon={<Bot className="w-8 h-8 text-violet-400" />}
              label="Agent Logs"
              total={stats.totals?.agent ?? stats.counts.agent}
              inWindow={stats.counts.agent}
              hours={stats.hours}
            />
            <LogStatCard
              icon={<Radio className="w-8 h-8 text-amber-400" />}
              label="Channel Logs"
              total={stats.totals?.channel ?? stats.counts.channel}
              inWindow={stats.counts.channel}
              hours={stats.hours}
            />
            <LogStatCard
              icon={<Terminal className="w-8 h-8 text-cyan-400" />}
              label="CLI Logs"
              total={stats.totals?.cli ?? stats.counts.cli ?? 0}
              inWindow={stats.counts.cli ?? 0}
              hours={stats.hours}
            />
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
                  onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                  className="pl-10"
                />
              </div>
              <div className="flex gap-2">
                <select
                  value={filterLevel || ""}
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
                  value={filterSource || ""}
                  onChange={(e) => setFilterSource(e.target.value || null)}
                  className="px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-white text-sm"
                >
                  <option value="">All Sources</option>
                  <option value="agent">Agent</option>
                  <option value="channel">Channel</option>
                  <option value="cli">CLI</option>
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
              <span title="Combined system, agent, channel, and CLI logs. Session messages are tracked separately.">
                <Badge variant="default">
                  {filterLevel || filterSource || isSearchResults || totalLogs === null
                    ? `${filteredLogs.length} entries`
                    : `${logs.length.toLocaleString()} of ${totalLogs.toLocaleString()} entries`}
                </Badge>
              </span>
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
              <div ref={parentRef} className="h-[600px] overflow-auto">
                <div
                  style={{
                    height: `${virtualizer.getTotalSize()}px`,
                    width: "100%",
                    position: "relative",
                  }}
                >
                  {virtualizer.getVirtualItems().map((virtualItem) => {
                    const log = filteredLogs[virtualItem.index];
                    return (
                      <div
                        key={virtualItem.key}
                        data-index={virtualItem.index}
                        ref={virtualizer.measureElement}
                        className="absolute top-0 left-0 w-full p-3 sm:p-4 hover:bg-white/5 cursor-pointer transition-colors border-b border-white/10"
                        style={{
                          transform: `translateY(${virtualItem.start}px)`,
                        }}
                        onClick={() => setExpandedLog(expandedLog === log.id ? null : log.id)}
                      >
                        <div className="flex items-start gap-3">
                          {levelIcons[log.level]}
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-1">
                              <Badge className={levelColors[log.level]} size="sm">
                                {log.level}
                              </Badge>
                              <Badge
                                variant="default"
                                size="sm"
                                className="flex items-center gap-1"
                              >
                                {sourceIcons[log.source] || <Terminal className="w-3 h-3" />}
                                {log.source}
                              </Badge>
                              <span className="text-xs text-gray-500">
                                {new Date(log.created_at).toLocaleString()}
                              </span>
                            </div>
                            <p className="text-sm text-white truncate">{log.message}</p>

                            {expandedLog === log.id && log.metadata && (
                              <div className="mt-2 p-2 rounded-lg bg-black/30">
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
                    );
                  })}
                </div>
                {hasMore && !isSearchResults && (
                  <div className="p-3 text-center border-t border-white/10">
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => void loadMore()}
                      disabled={isLoadingMore}
                      leftIcon={
                        isLoadingMore ? <RefreshCw className="w-4 h-4 animate-spin" /> : undefined
                      }
                    >
                      {isLoadingMore ? "Loading..." : "Load more"}
                    </Button>
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </PageLayout>
  );
}
