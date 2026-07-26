import db, { tables } from "../core/database";
import { closeSync, existsSync, fstatSync, openSync, readSync } from "fs";
import { join } from "path";
import { cybaraDir, logsDir } from "../core/paths";

export interface CountResult {
  count: number;
}

export interface ValueResult {
  value: number;
}

export interface MetricsEntry {
  type: string;
  key: string;
  value: number;
  metadata?: string;
  created_at?: string;
}

export interface LogEntry {
  id: string;
  level?: string;
  source?: string;
  message?: string;
  metadata?: string;
  created_at: string;
  logType?: string;
}

export interface AgentLogEntry {
  id: string;
  agent_id: string;
  action: string;
  details?: string;
  metadata?: string;
  created_at: string;
}

export interface ChannelLogEntry {
  id: string;
  channel_type: string;
  channel_id?: string;
  direction: string;
  sender_id?: string;
  content?: string;
  metadata?: string;
  created_at: string;
}

export interface CombinedLogEntry {
  id: string;
  level: string;
  source: string;
  message: string;
  metadata?: string;
  created_at: string;
  logType: string;
}

export interface CombinedLogPage {
  logs: CombinedLogEntry[];
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
}

export interface LogCategoryCounts {
  system: number;
  messages: number;
  agent: number;
  channel: number;
  cli: number;
}

export interface LogStats {
  counts: LogCategoryCounts;
  totals: LogCategoryCounts & { combined: number };
  hours: number;
}

export interface ModelMetrics {
  model: string;
  provider: string;
  avgTps: number;
  maxTps: number;
  minTps: number;
  avgLatencyMs: number;
  totalTokens: number;
  callCount: number;
}

export interface DailyLogCounts {
  systemCount: number;
  channelCount: number;
  messageCount: number;
}

export function normalizeTimestamp(timestamp: string | undefined): string | undefined {
  if (!timestamp) return timestamp;
  if (timestamp.includes("Z") || timestamp.includes("+") || timestamp.includes("-", 10)) {
    return timestamp;
  }
  return timestamp.replace(" ", "T") + "Z";
}

export function getCombinedLogs(
  options: { limit?: number; offset?: number } = {}
): CombinedLogEntry[] {
  const offset = Math.max(0, options.offset ?? 0);
  const perSourceCap = 1000;
  const windowSize =
    options.limit === undefined
      ? perSourceCap
      : Math.min(perSourceCap, Math.max(offset + Math.max(0, options.limit), 1));

  const sorted = [
    ...combinedSystemLogs(windowSize),
    ...combinedAgentLogs(windowSize),
    ...combinedChannelLogs(windowSize),
    ...getCliLogs(windowSize),
  ].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

  if (options.limit === undefined) {
    return offset > 0 ? sorted.slice(offset) : sorted;
  }
  return sorted.slice(offset, offset + Math.max(0, options.limit));
}

const COUNTABLE_TABLES = new Set(["system_logs", "agent_logs", "channel_logs", "session_messages"]);

export function assertCountableTable(table: string): string {
  if (!COUNTABLE_TABLES.has(table)) {
    throw new Error(`Invalid table name: ${table}`);
  }
  return table;
}

function countRows(table: string): number {
  const safe = assertCountableTable(table);
  const row = db.prepare(`SELECT COUNT(*) as count FROM ${safe}`).get() as CountResult | null;
  return Number(row?.count || 0);
}

function normalizeCombinedLogRow(row: CombinedLogEntry): CombinedLogEntry {
  return {
    ...row,
    created_at: normalizeTimestamp(row.created_at)!,
  };
}

function combinedSystemLogs(limit: number): CombinedLogEntry[] {
  return (
    db
      .prepare(
        "SELECT id, COALESCE(level, 'info') as level, COALESCE(source, 'system') as source, COALESCE(message, '') as message, metadata, created_at, 'system' as logType FROM system_logs ORDER BY created_at DESC LIMIT ?"
      )
      .all(limit) as CombinedLogEntry[]
  ).map(normalizeCombinedLogRow);
}

function combinedAgentLogs(limit: number): CombinedLogEntry[] {
  const rows = db
    .prepare("SELECT * FROM agent_logs ORDER BY created_at DESC LIMIT ?")
    .all(limit) as AgentLogEntry[];
  return rows.map((row) => ({
    id: row.id,
    level: "info",
    source: "agent",
    message: `Agent ${row.agent_id.slice(0, 8)}... ${row.action}${row.details ? `: ${row.details}` : ""}`,
    metadata: row.metadata,
    created_at: normalizeTimestamp(row.created_at)!,
    logType: "agent",
  }));
}

function combinedChannelLogs(limit: number): CombinedLogEntry[] {
  const rows = db
    .prepare("SELECT * FROM channel_logs ORDER BY created_at DESC LIMIT ?")
    .all(limit) as ChannelLogEntry[];
  return rows.map((row) => ({
    id: row.id,
    level: "info",
    source: "channel",
    message: `${row.direction} ${row.channel_type}${row.sender_id ? ` from ${row.sender_id}` : ""}: ${row.content?.substring(0, 100)}${(row.content?.length || 0) > 100 ? "..." : ""}`,
    metadata: row.metadata,
    created_at: normalizeTimestamp(row.created_at)!,
    logType: "channel",
  }));
}

const CLI_LOG_TAIL_BYTES = 256 * 1024;
const CLI_LOG_LEVELS = new Set(["debug", "info", "warn", "error"]);

function readLogFileTail(path: string): string | null {
  if (!existsSync(path)) return null;
  let fd: number | null = null;
  try {
    fd = openSync(path, "r");
    const size = fstatSync(fd).size;
    if (size === 0) return null;
    const readSize = Math.min(size, CLI_LOG_TAIL_BYTES);
    const buffer = Buffer.alloc(readSize);
    readSync(fd, buffer, 0, readSize, size - readSize);
    const text = buffer.toString("utf-8");
    return readSize < size ? text.slice(text.indexOf("\n") + 1) : text;
  } catch {
    return null;
  } finally {
    if (fd !== null) closeSync(fd);
  }
}

function parseRuntimeLogText(
  text: string,
  idPrefix: string,
  defaultSource: string
): CombinedLogEntry[] {
  const entries: CombinedLogEntry[] = [];
  let lastTimestamp = new Date().toISOString();
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    let level = "info";
    let message = line;
    let created_at: string | null = null;
    let metadata: string | undefined;
    let source = defaultSource;
    if (line.startsWith("{")) {
      try {
        const parsed = JSON.parse(line) as {
          timestamp?: string;
          level?: string;
          module?: string;
          source?: string;
          message?: string;
          context?: unknown;
        };
        if (typeof parsed.timestamp === "string") created_at = parsed.timestamp;
        if (typeof parsed.level === "string" && CLI_LOG_LEVELS.has(parsed.level)) {
          level = parsed.level;
        }
        if (typeof parsed.source === "string" && parsed.source.trim()) source = parsed.source;
        message = `${parsed.module ? `[${parsed.module}] ` : ""}${parsed.message ?? line}`;
        if (parsed.context !== undefined) metadata = JSON.stringify(parsed.context);
      } catch {}
    } else {
      const stamped = line.match(/^\[(\d{4}-\d{2}-\d{2}T[^\]]+)\]\s*(.*)$/);
      if (stamped) {
        created_at = stamped[1];
        message = stamped[2] || line;
      }
      if (/\berror\b|\bfailed\b|\bfatal\b/i.test(message)) level = "error";
      else if (/\bwarn(ing)?\b/i.test(message)) level = "warn";
    }
    if (created_at) lastTimestamp = created_at;
    entries.push({
      id: `${idPrefix}-${i}`,
      level,
      source,
      message: message.length > 500 ? `${message.slice(0, 500)}...` : message,
      metadata,
      created_at: normalizeTimestamp(created_at ?? lastTimestamp)!,
      logType: defaultSource,
    });
  }
  return entries.reverse();
}

export function getCliLogs(limit: number = 1000): CombinedLogEntry[] {
  const files = [
    { path: join(cybaraDir, "cybara.log"), id: "cli", source: "cli" },
    { path: join(logsDir, "gateway.out.1.log"), id: "gateway-1", source: "gateway" },
    { path: join(logsDir, "gateway.out.log"), id: "gateway", source: "gateway" },
  ];
  return files
    .flatMap((file) => {
      const text = readLogFileTail(file.path);
      return text ? parseRuntimeLogText(text, file.id, file.source) : [];
    })
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    .slice(0, Math.max(1, limit));
}

export function getCombinedLogTotal(): number {
  return (
    countRows("system_logs") +
    countRows("agent_logs") +
    countRows("channel_logs") +
    getCliLogs().length
  );
}

export function getCombinedLogsPage(options: { limit: number; offset?: number }): CombinedLogPage {
  const limit = Math.max(1, Math.min(1000, Math.floor(options.limit)));
  const offset = Math.max(0, Math.floor(options.offset ?? 0));
  const windowSize = Math.max(offset + limit, limit);
  const cliLogs = getCliLogs(windowSize);
  const logs = [
    ...combinedSystemLogs(windowSize),
    ...combinedAgentLogs(windowSize),
    ...combinedChannelLogs(windowSize),
    ...cliLogs,
  ]
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    .slice(offset, offset + limit);
  const total =
    countRows("system_logs") +
    countRows("agent_logs") +
    countRows("channel_logs") +
    (cliLogs.length >= windowSize ? getCliLogs().length : cliLogs.length);
  return {
    logs,
    total,
    limit,
    offset,
    hasMore: offset + logs.length < total,
  };
}

export function getLogStats(hours: number = 24): LogStats {
  const sinceIso = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
  const countSince = (table: string): number => {
    const safe = assertCountableTable(table);
    const row = db
      .prepare(`SELECT COUNT(*) as count FROM ${safe} WHERE datetime(created_at) > datetime(?)`)
      .get(sinceIso) as CountResult | null;
    return Number(row?.count || 0);
  };

  const sinceMs = Date.parse(sinceIso);
  const cliEntries = getCliLogs();
  const cliInWindow = cliEntries.filter((entry) => {
    const at = Date.parse(entry.created_at);
    return Number.isFinite(at) && at > sinceMs;
  }).length;

  const totals = {
    system: countRows("system_logs"),
    messages: countRows("session_messages"),
    agent: countRows("agent_logs"),
    channel: countRows("channel_logs"),
    cli: cliEntries.length,
  };

  return {
    counts: {
      system: countSince("system_logs"),
      messages: countSince("session_messages"),
      agent: countSince("agent_logs"),
      channel: countSince("channel_logs"),
      cli: cliInWindow,
    },
    totals: {
      ...totals,
      combined: totals.system + totals.agent + totals.channel + totals.cli,
    },
    hours,
  };
}

export function getDailyLogCounts(dateStr: string): DailyLogCounts {
  const dayStart = dateStr;
  const dayEnd = `${dateStr}~`;
  const countDay = (table: string): number => {
    const row = db
      .prepare(`SELECT COUNT(*) as count FROM ${table} WHERE created_at >= ? AND created_at < ?`)
      .get(dayStart, dayEnd) as CountResult | undefined;
    return row?.count || 0;
  };

  return {
    systemCount: countDay("system_logs"),
    channelCount: countDay("channel_logs"),
    messageCount: countDay("session_messages"),
  };
}

interface TpsRow {
  model: string;
  avgTps: number;
  maxTps: number;
  minTps: number;
  callCount: number;
  provider: string | null;
}

interface LatencyRow {
  model: string;
  avgLatency: number;
  provider: string | null;
}

interface TokenRow {
  model: string;
  totalTokens: number;
}

interface TokenCallModelRow {
  model: string;
  provider: string | null;
  totalTokens: number;
  outputTokens: number;
  throughputOutputTokens: number;
  durationTotalMs: number;
  generationDurationTotalMs: number;
  avgLatencyMs: number;
  maxTps: number;
  minTps: number;
  callCount: number;
}

export function getModelTpsMetrics(): TpsRow[] {
  return db
    .prepare(
      `
    SELECT
      key as model,
      AVG(value) as avgTps,
      MAX(value) as maxTps,
      MIN(value) as minTps,
      COUNT(*) as callCount,
      json_extract(metadata, '$.provider') as provider
    FROM metrics
    WHERE type = 'model_tps'
    GROUP BY key
    ORDER BY AVG(value) DESC
  `
    )
    .all() as TpsRow[];
}

export function getModelLatencyMetrics(): LatencyRow[] {
  return db
    .prepare(
      `
    SELECT
      key as model,
      AVG(value) as avgLatency,
      json_extract(metadata, '$.provider') as provider
    FROM metrics
    WHERE type = 'model_latency'
    GROUP BY key
  `
    )
    .all() as LatencyRow[];
}

export function getTokensByModel(): TokenRow[] {
  return db
    .prepare(
      `
    SELECT
      key as model,
      total as totalTokens
    FROM metrics_totals
    WHERE type = 'token_usage_by_model'
  `
    )
    .all() as TokenRow[];
}

function getModelTokenCallMetrics(): TokenCallModelRow[] {
  return db
    .prepare(
      `
    SELECT
      COALESCE(json_extract(metadata, '$.model'), 'unknown') as model,
      COALESCE(json_extract(metadata, '$.provider'), 'unknown') as provider,
      SUM(value) as totalTokens,
      SUM(COALESCE(CAST(json_extract(metadata, '$.outputTokens') AS REAL), 0)) as outputTokens,
      SUM(CASE
        WHEN CAST(json_extract(metadata, '$.generationDurationMs') AS REAL) >= 100
        THEN COALESCE(CAST(json_extract(metadata, '$.outputTokens') AS REAL), 0)
        ELSE 0
      END) as throughputOutputTokens,
      SUM(CASE
        WHEN CAST(json_extract(metadata, '$.durationMs') AS REAL) > 0
        THEN CAST(json_extract(metadata, '$.durationMs') AS REAL)
        ELSE 0
      END) as durationTotalMs,
      SUM(CASE
        WHEN CAST(json_extract(metadata, '$.generationDurationMs') AS REAL) >= 100
        THEN CAST(json_extract(metadata, '$.generationDurationMs') AS REAL)
        ELSE 0
      END) as generationDurationTotalMs,
      AVG(CASE
        WHEN CAST(json_extract(metadata, '$.durationMs') AS REAL) > 0
        THEN CAST(json_extract(metadata, '$.durationMs') AS REAL)
        ELSE NULL
      END) as avgLatencyMs,
      MAX(CASE
        WHEN CAST(json_extract(metadata, '$.generationDurationMs') AS REAL) >= 100
        THEN (COALESCE(CAST(json_extract(metadata, '$.outputTokens') AS REAL), 0) /
          CAST(json_extract(metadata, '$.generationDurationMs') AS REAL)) * 1000
        ELSE NULL
      END) as maxTps,
      MIN(CASE
        WHEN CAST(json_extract(metadata, '$.generationDurationMs') AS REAL) >= 100
        THEN (COALESCE(CAST(json_extract(metadata, '$.outputTokens') AS REAL), 0) /
          CAST(json_extract(metadata, '$.generationDurationMs') AS REAL)) * 1000
        ELSE NULL
      END) as minTps,
      COUNT(*) as callCount
    FROM (
      SELECT value, metadata
      FROM metrics
      WHERE type = 'token_usage'
        AND key = 'all'
        AND metadata IS NOT NULL
      ORDER BY created_at DESC
      LIMIT 6000
    ) recent_calls
    WHERE json_extract(metadata, '$.model') IS NOT NULL
    GROUP BY provider, model
    ORDER BY
      CASE
        WHEN generationDurationTotalMs > 0
        THEN throughputOutputTokens / generationDurationTotalMs
        ELSE 0
      END DESC
  `
    )
    .all() as TokenCallModelRow[];
}

export function getModelMetrics(): ModelMetrics[] {
  const tokenCallData = getModelTokenCallMetrics();
  const modernMetrics = tokenCallData.map((row) => ({
    model: row.model,
    provider: row.provider || "unknown",
    avgTps:
      row.generationDurationTotalMs > 0
        ? Number(((row.throughputOutputTokens / row.generationDurationTotalMs) * 1000).toFixed(2))
        : 0,
    maxTps: Number(Number(row.maxTps || 0).toFixed(2)),
    minTps: Number(Number(row.minTps || 0).toFixed(2)),
    avgLatencyMs: Math.round(row.avgLatencyMs || 0),
    totalTokens: Math.round(row.totalTokens || 0),
    callCount: Math.round(row.callCount || 0),
  }));

  const tpsData = getModelTpsMetrics();
  const latencyData = getModelLatencyMetrics();
  const tokenData = getTokensByModel();
  const modernKeys = new Set(modernMetrics.map((metric) => `${metric.provider}:${metric.model}`));

  const latencyMap = new Map(latencyData.map((l) => [l.model, l.avgLatency]));
  const tokenMap = new Map(tokenData.map((t) => [t.model, t.totalTokens]));

  const legacyMetrics = tpsData
    .map((t) => ({
      model: t.model,
      provider: t.provider || "unknown",
      avgTps: Math.round(t.avgTps),
      maxTps: t.maxTps,
      minTps: t.minTps,
      avgLatencyMs: Math.round(latencyMap.get(t.model) || 0),
      totalTokens: tokenMap.get(t.model) || 0,
      callCount: t.callCount,
    }))
    .filter((metric) => !modernKeys.has(`${metric.provider}:${metric.model}`));

  return [...modernMetrics, ...legacyMetrics];
}
