/**
 * Database query functions for API routes
 * Centralizes all SQL logic with proper types
 */

import db, { tables } from "../core/database";

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
export interface LogStats {
  counts: {
    system: number;
    messages: number;
    agent: number;
    channel: number;
  };
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
  const system = (tables.systemLogs.list ? tables.systemLogs.list() : []) as LogEntry[];
  const agent = (tables.agentLogs.list ? tables.agentLogs.list() : []) as AgentLogEntry[];
  const channel = (tables.channelLogs.list ? tables.channelLogs.list() : []) as ChannelLogEntry[];

  const combined: CombinedLogEntry[] = [
    ...system.map((l) => ({
      id: l.id,
      level: l.level || "info",
      source: l.source || "system",
      message: l.message || "",
      metadata: l.metadata,
      created_at: normalizeTimestamp(l.created_at)!,
      logType: "system",
    })),
    ...agent.map((l) => ({
      id: l.id,
      level: "info",
      source: "agent",
      message: `Agent ${l.agent_id.slice(0, 8)}... ${l.action}${l.details ? `: ${l.details}` : ""}`,
      metadata: l.metadata,
      created_at: normalizeTimestamp(l.created_at)!,
      logType: "agent",
    })),
    ...channel.map((l) => ({
      id: l.id,
      level: "info",
      source: "channel",
      message: `${l.direction} ${l.channel_type}${l.sender_id ? ` from ${l.sender_id}` : ""}: ${l.content?.substring(0, 100)}${(l.content?.length || 0) > 100 ? "..." : ""}`,
      metadata: l.metadata,
      created_at: normalizeTimestamp(l.created_at)!,
      logType: "channel",
    })),
  ];

  const sorted = combined.sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  );
  const offset = Math.max(0, options.offset ?? 0);
  if (options.limit === undefined) {
    return offset > 0 ? sorted.slice(offset) : sorted;
  }
  return sorted.slice(offset, offset + Math.max(0, options.limit));
}

function countRows(table: string): number {
  const row = db.prepare(`SELECT COUNT(*) as count FROM ${table}`).get() as CountResult | null;
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

export function getCombinedLogTotal(): number {
  return countRows("system_logs") + countRows("agent_logs") + countRows("channel_logs");
}

export function getCombinedLogsPage(options: { limit: number; offset?: number }): CombinedLogPage {
  const limit = Math.max(1, Math.min(1000, Math.floor(options.limit)));
  const offset = Math.max(0, Math.floor(options.offset ?? 0));
  const windowSize = Math.max(offset + limit, limit);
  const logs = [
    ...combinedSystemLogs(windowSize),
    ...combinedAgentLogs(windowSize),
    ...combinedChannelLogs(windowSize),
  ]
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    .slice(offset, offset + limit);
  const total = getCombinedLogTotal();
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
  const since = Date.now() - hours * 60 * 60 * 1000;

  // Use the same table helpers for consistency
  const system = (tables.systemLogs.list ? tables.systemLogs.list() : []) as LogEntry[];
  const agent = (tables.agentLogs.list ? tables.agentLogs.list() : []) as AgentLogEntry[];
  const channel = (tables.channelLogs.list ? tables.channelLogs.list() : []) as ChannelLogEntry[];

  const messages = db
    .prepare("SELECT COUNT(*) as count FROM session_messages WHERE created_at > ?")
    .get(new Date(since).toISOString()) as CountResult | null;

  // Filter by time window and count
  const systemCount = system.filter((l) => new Date(l.created_at).getTime() > since).length;
  const agentCount = agent.filter((l) => new Date(l.created_at).getTime() > since).length;
  const channelCount = channel.filter((l) => new Date(l.created_at).getTime() > since).length;

  return {
    counts: {
      system: systemCount,
      messages: messages?.count || 0,
      agent: agentCount,
      channel: channelCount,
    },
    hours,
  };
}

/**
 * Get log counts for a specific date (for time series)
 * @param dateStr Date in YYYY-MM-DD format
 */
export function getDailyLogCounts(dateStr: string): DailyLogCounts {
  const systemCount = db
    .prepare(`SELECT COUNT(*) as count FROM system_logs WHERE date(created_at) = ?`)
    .get(dateStr) as CountResult | undefined;

  const channelCount = db
    .prepare(`SELECT COUNT(*) as count FROM channel_logs WHERE date(created_at) = ?`)
    .get(dateStr) as CountResult | undefined;

  const messageCount = db
    .prepare(`SELECT COUNT(*) as count FROM session_messages WHERE date(created_at) = ?`)
    .get(dateStr) as CountResult | undefined;

  return {
    systemCount: systemCount?.count || 0,
    channelCount: channelCount?.count || 0,
    messageCount: messageCount?.count || 0,
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
