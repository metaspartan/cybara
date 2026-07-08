import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  AlertTriangle,
  Bot,
  ChevronDown,
  ChevronRight,
  Circle,
  Download,
  Info,
  Pause,
  Play,
  Radio,
  RefreshCw,
  Search,
  Terminal,
  Wrench,
  XCircle,
} from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { PageLayout } from "@/components/layout";
import { logsApi } from "@/lib/api";
import { connectStatusStream } from "@/lib/status-stream";
import { cn } from "@/lib/utils";

interface LogEntry {
  id: string;
  level: "debug" | "info" | "warn" | "error" | string;
  source: string;
  message: string;
  metadata?: string;
  created_at: string;
  logType?: string;
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

const LOGS_PAGE_SIZE = 200;
const LEVEL_ORDER = ["error", "warn", "info", "debug"];

const levelIcons: Record<string, ReactNode> = {
  debug: <Terminal className="h-4 w-4 text-gray-400" />,
  info: <Info className="h-4 w-4 text-blue-300" />,
  warn: <AlertTriangle className="h-4 w-4 text-amber-300" />,
  error: <XCircle className="h-4 w-4 text-red-300" />,
};

const levelPillClasses: Record<string, string> = {
  debug: "border-gray-500/30 bg-gray-500/10 text-gray-300",
  info: "border-blue-500/30 bg-blue-500/10 text-blue-200",
  warn: "border-amber-500/30 bg-amber-500/10 text-amber-200",
  error: "border-red-500/30 bg-red-500/10 text-red-200",
};

const sourceIcons: Record<string, ReactNode> = {
  agent: <Bot className="h-4 w-4" />,
  channel: <Radio className="h-4 w-4" />,
  cli: <Terminal className="h-4 w-4" />,
  session: <Bot className="h-4 w-4" />,
  skill: <Bot className="h-4 w-4" />,
  subagent: <Bot className="h-4 w-4" />,
  system: <Terminal className="h-4 w-4" />,
  tool: <Wrench className="h-4 w-4" />,
};

function normalizeLevel(level: string | undefined): string {
  const value = String(level || "info").toLowerCase();
  return value === "warning" ? "warn" : value;
}

function formatTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(date);
}

function formatDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "medium",
  }).format(date);
}

function metadataText(metadata: string | undefined): string | null {
  if (!metadata) return null;
  try {
    return JSON.stringify(JSON.parse(metadata), null, 2);
  } catch {
    return metadata;
  }
}

function sourceLabel(source: string): string {
  if (source === "cli") return "gateway/app";
  return source.replace(/_/g, " ");
}

function LogMetric({
  label,
  value,
  detail,
  tone,
}: {
  detail: string;
  label: string;
  tone: string;
  value: string;
}) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.035] px-4 py-3">
      <p className="text-[11px] font-semibold uppercase text-gray-500">{label}</p>
      <p className={cn("mt-1 text-2xl font-semibold", tone)}>{value}</p>
      <p className="mt-0.5 truncate text-xs text-gray-500">{detail}</p>
    </div>
  );
}

function FilterChip({
  active,
  children,
  onClick,
}: {
  active: boolean;
  children: ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
        active
          ? "border-amber-400/40 bg-amber-400/15 text-amber-100"
          : "border-white/10 bg-white/[0.03] text-gray-400 hover:border-white/20 hover:text-gray-200"
      )}
    >
      {children}
    </button>
  );
}

function LogsSkeleton() {
  return (
    <div className="space-y-0 divide-y divide-white/10" aria-label="Loading logs">
      {Array.from({ length: 9 }).map((_, index) => (
        <div key={index} className="animate-pulse px-4 py-3">
          <div className="flex items-center gap-3">
            <div className="h-4 w-14 rounded bg-white/10" />
            <div className="h-4 w-20 rounded bg-white/10" />
            <div className="h-4 flex-1 rounded bg-white/10" />
            <div className="h-4 w-16 rounded bg-white/10" />
          </div>
        </div>
      ))}
    </div>
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
  const [liveEnabled, setLiveEnabled] = useState(true);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<Date | null>(null);
  const parentRef = useRef<HTMLDivElement>(null);
  const refreshTimerRef = useRef<number | null>(null);

  const fetchLogs = useCallback(async (options?: { silent?: boolean }) => {
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
        setLastUpdatedAt(new Date());
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
  }, []);

  const loadMore = useCallback(async () => {
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
        setLastUpdatedAt(new Date());
      }
    } catch (error) {
      console.error("Failed to load more logs:", error);
    } finally {
      setIsLoadingMore(false);
    }
  }, [isLoadingMore, logs.length]);

  useEffect(() => {
    void fetchLogs();
  }, [fetchLogs]);

  useEffect(() => {
    if (!liveEnabled || isSearchResults || searchQuery.trim()) return;
    const pollTimer = window.setInterval(() => {
      if (!document.hidden) void fetchLogs({ silent: true });
    }, 15_000);
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
        }, 700);
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
  }, [fetchLogs, isSearchResults, liveEnabled, searchQuery]);

  const handleSearch = useCallback(async () => {
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
          ...(searchData?.system || []).map((entry: LogEntry) => ({ ...entry })),
          ...(searchData?.sessionMessages || []).map((entry: SessionMessageLog) => ({
            id: entry.id,
            level: "info",
            source: "session",
            message: `${entry.role}: ${entry.content.substring(0, 120)}${entry.content.length > 120 ? "..." : ""}`,
            created_at: entry.created_at,
            logType: "session",
          })),
          ...(searchData?.agent || []).map((entry: AgentActionLog) => ({
            id: entry.id,
            level: "info",
            source: "agent",
            message: `Action: ${entry.action}${entry.details ? ` - ${entry.details}` : ""}`,
            created_at: entry.created_at,
            logType: "agent",
          })),
          ...(searchData?.channel || []).map((entry: ChannelMessageLog) => ({
            id: entry.id,
            level: "info",
            source: "channel",
            message: `${entry.direction || "message"}: ${entry.content.substring(0, 120)}${entry.content.length > 120 ? "..." : ""}`,
            created_at: entry.created_at,
            logType: "channel",
          })),
        ].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
        setLogs(allLogs);
        setTotalLogs(allLogs.length);
        setHasMore(false);
        setIsSearchResults(true);
        setLastUpdatedAt(new Date());
      }
    } catch (error) {
      console.error("Search failed:", error);
    } finally {
      setIsLoading(false);
    }
  }, [fetchLogs, searchQuery]);

  const sourceOptions = useMemo(() => {
    const values = new Set(logs.map((log) => log.source).filter(Boolean));
    return Array.from(values).sort((a, b) => sourceLabel(a).localeCompare(sourceLabel(b)));
  }, [logs]);

  const filteredLogs = useMemo(
    () =>
      logs.filter((log) => {
        if (filterLevel && normalizeLevel(log.level) !== filterLevel) return false;
        if (filterSource && log.source !== filterSource) return false;
        return true;
      }),
    [filterLevel, filterSource, logs]
  );

  const visibleLevelCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const log of logs) {
      const level = normalizeLevel(log.level);
      counts[level] = (counts[level] || 0) + 1;
    }
    return counts;
  }, [logs]);

  const exportLogs = () => {
    const data = JSON.stringify(filteredLogs, null, 2);
    const blob = new Blob([data], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `logs-${new Date().toISOString()}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const virtualizer = useVirtualizer({
    count: filteredLogs.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 74,
    overscan: 12,
  });

  const totalCombined = stats?.totals?.combined ?? totalLogs ?? logs.length;
  const windowTotal =
    (stats?.counts.system || 0) +
    (stats?.counts.agent || 0) +
    (stats?.counts.channel || 0) +
    (stats?.counts.cli || 0);
  const totalMessages = stats?.totals?.messages ?? 0;
  const lastUpdatedLabel = lastUpdatedAt ? formatTime(lastUpdatedAt.toISOString()) : "not loaded";

  return (
    <PageLayout
      title="Logs"
      subtitle="Live gateway, agent, channel, tool, and app log stream"
      actions={
        <div className="flex items-center gap-2">
          <Button
            variant={liveEnabled ? "primary" : "secondary"}
            size="sm"
            onClick={() => setLiveEnabled((current) => !current)}
            leftIcon={liveEnabled ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
          >
            {liveEnabled ? "Pause" : "Live"}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => void fetchLogs()}
            leftIcon={<RefreshCw className="h-4 w-4" />}
          >
            Refresh
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={exportLogs}
            leftIcon={<Download className="h-4 w-4" />}
          >
            Export
          </Button>
        </div>
      }
    >
      <div className="space-y-5">
        <div className="grid gap-3 md:grid-cols-4">
          <LogMetric
            label="Combined stream"
            value={totalCombined.toLocaleString()}
            detail={`${windowTotal.toLocaleString()} in ${stats?.hours ?? 24}h`}
            tone="text-white"
          />
          <LogMetric
            label="Errors"
            value={(visibleLevelCounts.error || 0).toLocaleString()}
            detail="visible page"
            tone="text-red-200"
          />
          <LogMetric
            label="Warnings"
            value={(visibleLevelCounts.warn || 0).toLocaleString()}
            detail="visible page"
            tone="text-amber-200"
          />
          <LogMetric
            label="Session messages"
            value={totalMessages.toLocaleString()}
            detail="searchable activity"
            tone="text-cyan-200"
          />
        </div>

        <section className="overflow-hidden rounded-2xl border border-white/10 bg-black/25 shadow-2xl shadow-black/20">
          <div className="border-b border-white/10 bg-white/[0.035] px-4 py-3">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div className="flex min-w-0 items-center gap-3">
                <span
                  className={cn(
                    "flex h-8 w-8 items-center justify-center rounded-full border",
                    liveEnabled
                      ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-300"
                      : "border-white/10 bg-white/5 text-gray-400"
                  )}
                >
                  <Circle className={cn("h-3 w-3", liveEnabled && "fill-current")} />
                </span>
                <div className="min-w-0">
                  <h2 className="text-sm font-semibold text-white">Unified log stream</h2>
                  <p className="truncate text-xs text-gray-500">
                    {liveEnabled ? "Live updates enabled" : "Paused"} - last refresh{" "}
                    {lastUpdatedLabel}
                  </p>
                </div>
              </div>
              <div className="flex flex-col gap-2 md:flex-row md:items-center">
                <div className="relative min-w-[260px] flex-1 md:w-[360px]">
                  <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-500" />
                  <Input
                    placeholder="Search logs, metadata, sessions..."
                    value={searchQuery}
                    onChange={(event) => setSearchQuery(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") void handleSearch();
                      if (event.key === "Escape") {
                        setSearchQuery("");
                        void fetchLogs();
                      }
                    }}
                    className="pl-9"
                  />
                </div>
                <Button onClick={() => void handleSearch()} size="sm">
                  Search
                </Button>
              </div>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <FilterChip active={!filterLevel} onClick={() => setFilterLevel(null)}>
                All levels
              </FilterChip>
              {LEVEL_ORDER.map((level) => (
                <FilterChip
                  key={level}
                  active={filterLevel === level}
                  onClick={() => setFilterLevel(filterLevel === level ? null : level)}
                >
                  {level} {visibleLevelCounts[level] ? visibleLevelCounts[level] : ""}
                </FilterChip>
              ))}
              <span className="mx-1 h-5 w-px bg-white/10" />
              <FilterChip active={!filterSource} onClick={() => setFilterSource(null)}>
                All sources
              </FilterChip>
              {sourceOptions.map((source) => (
                <FilterChip
                  key={source}
                  active={filterSource === source}
                  onClick={() => setFilterSource(filterSource === source ? null : source)}
                >
                  {sourceLabel(source)}
                </FilterChip>
              ))}
            </div>
          </div>

          <div className="flex items-center justify-between border-b border-white/10 px-4 py-2 text-xs text-gray-500">
            <span>
              {filterLevel || filterSource || isSearchResults || totalLogs === null
                ? `${filteredLogs.length.toLocaleString()} entries`
                : `${logs.length.toLocaleString()} of ${totalLogs.toLocaleString()} entries`}
            </span>
            <span>Newest first</span>
          </div>

          {isLoading ? (
            <LogsSkeleton />
          ) : filteredLogs.length === 0 ? (
            <div className="flex min-h-[320px] flex-col items-center justify-center px-4 py-12 text-center">
              <Terminal className="mb-3 h-10 w-10 text-gray-600" />
              <p className="text-sm font-medium text-gray-300">No logs match this view</p>
              <p className="mt-1 text-xs text-gray-500">Clear filters or resume live mode.</p>
            </div>
          ) : (
            <div ref={parentRef} className="h-[640px] overflow-auto">
              <div
                style={{
                  height: `${virtualizer.getTotalSize()}px`,
                  position: "relative",
                  width: "100%",
                }}
              >
                {virtualizer.getVirtualItems().map((virtualItem) => {
                  const log = filteredLogs[virtualItem.index];
                  const level = normalizeLevel(log.level);
                  const expanded = expandedLog === log.id;
                  const details = metadataText(log.metadata);
                  return (
                    <button
                      type="button"
                      key={virtualItem.key}
                      data-index={virtualItem.index}
                      ref={virtualizer.measureElement}
                      className="absolute left-0 top-0 w-full border-b border-white/10 px-4 py-3 text-left transition-colors hover:bg-white/[0.04]"
                      style={{ transform: `translateY(${virtualItem.start}px)` }}
                      onClick={() => setExpandedLog(expanded ? null : log.id)}
                    >
                      <div className="grid gap-3 md:grid-cols-[86px_130px_minmax(0,1fr)_32px] md:items-start">
                        <div className="flex items-center gap-2 font-mono text-xs text-gray-500">
                          {levelIcons[level] || levelIcons.info}
                          <span>{formatTime(log.created_at)}</span>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          <span
                            className={cn(
                              "rounded-full border px-2 py-0.5 text-[11px] font-semibold uppercase",
                              levelPillClasses[level] || levelPillClasses.info
                            )}
                          >
                            {level}
                          </span>
                          <span className="flex items-center gap-1 rounded-full border border-white/10 bg-white/[0.035] px-2 py-0.5 text-[11px] font-medium text-gray-300">
                            {sourceIcons[log.source] || <Terminal className="h-3 w-3" />}
                            {sourceLabel(log.source)}
                          </span>
                        </div>
                        <div className="min-w-0">
                          <p className="truncate text-sm text-gray-100">{log.message}</p>
                          <p className="mt-1 text-xs text-gray-600">
                            {formatDateTime(log.created_at)}
                            {log.logType ? ` - ${log.logType}` : ""}
                          </p>
                          {expanded && details ? (
                            <pre className="mt-3 max-h-56 overflow-auto rounded-xl border border-white/10 bg-black/40 p-3 text-xs leading-5 text-gray-300">
                              {details}
                            </pre>
                          ) : null}
                        </div>
                        <span className="hidden justify-self-end text-gray-500 md:block">
                          {expanded ? (
                            <ChevronDown className="h-4 w-4" />
                          ) : (
                            <ChevronRight className="h-4 w-4" />
                          )}
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>
              {hasMore && !isSearchResults ? (
                <div className="sticky bottom-0 border-t border-white/10 bg-black/80 p-3 text-center backdrop-blur">
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => void loadMore()}
                    disabled={isLoadingMore}
                    leftIcon={
                      isLoadingMore ? <RefreshCw className="h-4 w-4 animate-spin" /> : undefined
                    }
                  >
                    {isLoadingMore ? "Loading" : "Load older logs"}
                  </Button>
                </div>
              ) : null}
            </div>
          )}
        </section>
      </div>
    </PageLayout>
  );
}
