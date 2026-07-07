/**
 * Database query functions for API routes
 * Centralizes all SQL logic with proper types
 */

import db, { tables } from "../core/database";
import { closeSync, existsSync, fstatSync, openSync, readSync } from "fs";
import { join } from "path";
import { cybaraDir } from "../core/paths";

// ============================================
// TYPES
// ============================================

/** Result from COUNT(*) SQL queries */
export interface CountResult {
  count: number;
}

/** Result from SUM/aggregate value queries */
export interface ValueResult {
  value: number;
}

/** Metrics table entry */
export interface MetricsEntry {
  type: string;
  key: string;
  value: number;
  metadata?: string;
  created_at?: string;
}

/** System log entry */
export interface LogEntry {
  id: string;
  level?: string;
  source?: string;
  message?: string;
  metadata?: string;
  created_at: string;
  logType?: string;
}

/** Agent log entry (raw from DB) */
export interface AgentLogEntry {
  id: string;
  agent_id: string;
  action: string;
  details?: string;
  metadata?: string;
  created_at: string;
}

/** Channel log entry (raw from DB) */
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

/** Combined log from multiple sources */
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

/** Log statistics by category */
export interface LogCategoryCounts {
  system: number;
  messages: number;
  agent: number;
  channel: number;
  cli: number;
}

export interface LogStats {
  /** Entries within the trailing window (`hours`). */
  counts: LogCategoryCounts;
  /**
   * All-time entries per category. system + agent + channel + cli equals the
   * combined Log Entries total; messages live in their own table and are not
   * part of the combined list.
   */
  totals: LogCategoryCounts & { combined: number };
  hours: number;
}

/** Model performance metrics */
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

/** Daily log counts for time series */
export interface DailyLogCounts {
  systemCount: number;
  channelCount: number;
  messageCount: number;
}

// ============================================
// UTILITIES
// ============================================

/**
 * Normalize SQLite timestamps to UTC ISO format.
 * SQLite CURRENT_TIMESTAMP stores UTC but without 'Z' suffix,
 * so JS Date() parses it as local time. This adds the 'Z' suffix.
 */
export function normalizeTimestamp(timestamp: string | undefined): string | undefined {
  if (!timestamp) return timestamp;
  // If already has timezone info, return as-is
  if (timestamp.includes("Z") || timestamp.includes("+") || timestamp.includes("-", 10)) {
    return timestamp;
  }
  // SQLite format: "YYYY-MM-DD HH:MM:SS" - convert to ISO with Z
  return timestamp.replace(" ", "T") + "Z";
}

// ============================================
// LOG QUERIES
// ============================================

/**
 * Get combined logs from all log tables (system, agent, channel)
 * Returns unified format sorted by created_at descending
 */
export function getCombinedLogs(
  options: { limit?: number; offset?: number } = {}
): CombinedLogEntry[] {
  const offset = Math.max(0, options.offset ?? 0);
  // The pre-existing contract capped each source at 1000 rows (the list()
  // helpers' LIMIT); fetch only the window each table can contribute instead
  // of materializing and formatting all rows before slicing.
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

// SQLite cannot parameterize a table name, so an allowlist is the only safe way
// to interpolate one. Every caller passes a hardcoded literal today; this guard
// ensures a future (or user-influenced) caller can never inject SQL.
const COUNTABLE_TABLES = new Set([
  "system_logs",
  "agent_logs",
  "channel_logs",
  "session_messages",
]);

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

/** Reads only the last CLI_LOG_TAIL_BYTES of the file so huge logs stay cheap. */
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
    // Drop the first (possibly truncated) line when we didn't read the whole file.
    return readSize < size ? text.slice(text.indexOf("\n") + 1) : text;
  } catch {
    return null;
  } finally {
    if (fd !== null) closeSync(fd);
  }
}

/**
 * Parse the CLI/daemon log file (~/.cybara/cybara.log) into combined-log
 * entries. Lines are structured JSON, "[ISO] message" daemon lines, or plain
 * stdout; plain lines inherit the most recent timestamp seen above them.
 */
export function getCliLogs(limit: number = 1000): CombinedLogEntry[] {
  const text = readLogFileTail(join(cybaraDir, "cybara.log"));
  if (!text) return [];
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
    if (line.startsWith("{")) {
      try {
        const parsed = JSON.parse(line) as {
          timestamp?: string;
          level?: string;
          module?: string;
          message?: string;
          context?: unknown;
        };
        if (typeof parsed.timestamp === "string") created_at = parsed.timestamp;
        if (typeof parsed.level === "string" && CLI_LOG_LEVELS.has(parsed.level)) {
          level = parsed.level;
        }
        message = `${parsed.module ? `[${parsed.module}] ` : ""}${parsed.message ?? line}`;
        if (parsed.context !== undefined) metadata = JSON.stringify(parsed.context);
      } catch {
        // Not JSON after all; fall through as plain text.
      }
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
      id: `cli-${i}`,
      level,
      source: "cli",
      message: message.length > 500 ? `${message.slice(0, 500)}...` : message,
      metadata,
      created_at: normalizeTimestamp(created_at ?? lastTimestamp)!,
      logType: "cli",
    });
  }
  return entries.slice(-Math.max(1, limit)).reverse();
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

/**
 * Get log statistics for a time window
 * @param hours Number of hours to look back (default 24)
 */
export function getLogStats(hours: number = 24): LogStats {
  const sinceIso = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
  // datetime() normalizes both SQLite "YYYY-MM-DD HH:MM:SS" rows and ISO input,
  // so the window compares real instants instead of raw strings. Counting in SQL
  // also avoids the LIMIT 1000 cap of the list() helpers.
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

/**
 * Get log counts for a specific date (for time series)
 * @param dateStr Date in YYYY-MM-DD format
 */
export function getDailyLogCounts(dateStr: string): DailyLogCounts {
  // Range-compare on the raw column instead of date(created_at) so the
  // created_at indexes are usable; rows are stored as "YYYY-MM-DD HH:MM:SS"
  // (or ISO "YYYY-MM-DDT..."), and both sort correctly against these bounds.
  const dayStart = dateStr;
  const dayEnd = `${dateStr}~`; // "~" sorts after both " " and "T" separators
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

// ============================================
// METRICS QUERIES
// ============================================

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

/**
 * Get model TPS (tokens per second) metrics
 */
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

/**
 * Get model latency metrics
 */
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

/**
 * Get total tokens by model
 */
export function getTokensByModel(): TokenRow[] {
  return db
    .prepare(
      `
    SELECT 
      key as model,
      SUM(value) as totalTokens
    FROM metrics 
    WHERE type = 'token_usage_by_model'
    GROUP BY key
  `
    )
    .all() as TokenRow[];
}

/**
 * Get aggregated model metrics (combines TPS, latency, and tokens)
 */
export function getModelMetrics(): ModelMetrics[] {
  const tpsData = getModelTpsMetrics();
  const latencyData = getModelLatencyMetrics();
  const tokenData = getTokensByModel();

  const latencyMap = new Map(latencyData.map((l) => [l.model, l.avgLatency]));
  const tokenMap = new Map(tokenData.map((t) => [t.model, t.totalTokens]));

  return tpsData.map((t) => ({
    model: t.model,
    provider: t.provider || "unknown",
    avgTps: Math.round(t.avgTps),
    maxTps: t.maxTps,
    minTps: t.minTps,
    avgLatencyMs: Math.round(latencyMap.get(t.model) || 0),
    totalTokens: tokenMap.get(t.model) || 0,
    callCount: t.callCount,
  }));
}
