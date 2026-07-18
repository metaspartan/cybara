import db from "./database";

export interface SessionRuntimeMetricsRow {
  sessionId: string;
  title: string;
  agentId: string;
  workspaceDir: string | null;
  updatedAt: string;
  provider: string | null;
  model: string | null;
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  cacheWriteTokens: number;
  totalTokens: number;
  callCount: number;
  durationMs: number;
  tokensPerSecond: number | null;
  firstTokenMs: number | null;
  latencyCallCount: number;
  compactionCount: number;
  compactedTokens: number;
}

export interface SessionRuntimeMetricsTotals {
  sessions: number;
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  cacheWriteTokens: number;
  totalTokens: number;
  callCount: number;
  durationMs: number;
  tokensPerSecond: number | null;
  firstTokenMs: number | null;
  compactionCount: number;
  compactedTokens: number;
}

export interface SessionRuntimeMetrics {
  totals: SessionRuntimeMetricsTotals;
  sessions: SessionRuntimeMetricsRow[];
  pagination: {
    page: number;
    pageSize: number;
    totalPages: number;
    totalItems: number;
    hasNextPage: boolean;
    hasPreviousPage: boolean;
  };
}

interface SessionRuntimeMetricsDatabaseRow {
  sessionId: string;
  title: string | null;
  agentId: string;
  workspaceDir: string | null;
  updatedAt: string;
  provider: string | null;
  model: string | null;
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  cacheWriteTokens: number;
  totalTokens: number;
  callCount: number;
  durationMs: number;
  generationDurationMs: number;
  throughputOutputTokens: number;
  firstTokenMs: number | null;
  latencyCallCount: number;
  compactionCount: number;
  compactedTokens: number;
}

interface SessionRuntimeMetricsTotalsDatabaseRow {
  sessions: number;
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  cacheWriteTokens: number;
  totalTokens: number;
  callCount: number;
  durationMs: number;
  generationDurationMs: number;
  throughputOutputTokens: number;
  firstTokenTotal: number;
  firstTokenCalls: number;
  compactionCount: number;
  compactedTokens: number;
}

function nonNegative(value: number | null | undefined): number {
  return Math.max(0, Number.isFinite(value) ? Number(value) : 0);
}

function runtimeRow(row: SessionRuntimeMetricsDatabaseRow): SessionRuntimeMetricsRow {
  const inputTokens = Math.round(nonNegative(row.inputTokens));
  const outputTokens = Math.round(nonNegative(row.outputTokens));
  const durationMs = nonNegative(row.durationMs);
  const generationDurationMs = nonNegative(row.generationDurationMs);
  const throughputOutputTokens = nonNegative(row.throughputOutputTokens);
  const totalTokens = Math.max(
    inputTokens + outputTokens,
    Math.round(nonNegative(row.totalTokens))
  );
  const firstTokenMs = row.firstTokenMs === null ? null : Number(row.firstTokenMs);
  return {
    sessionId: row.sessionId,
    title: row.title?.trim() || "Untitled chat",
    agentId: row.agentId,
    workspaceDir: row.workspaceDir?.trim() || null,
    updatedAt: row.updatedAt,
    provider: row.provider?.trim() || null,
    model: row.model?.trim() || null,
    inputTokens,
    outputTokens,
    cachedInputTokens: Math.round(nonNegative(row.cachedInputTokens)),
    cacheWriteTokens: Math.round(nonNegative(row.cacheWriteTokens)),
    totalTokens,
    callCount: Math.round(nonNegative(row.callCount)),
    durationMs: Math.round(durationMs),
    tokensPerSecond:
      generationDurationMs > 0
        ? Number(((throughputOutputTokens / generationDurationMs) * 1000).toFixed(2))
        : null,
    firstTokenMs:
      firstTokenMs !== null && Number.isFinite(firstTokenMs)
        ? Math.round(nonNegative(firstTokenMs))
        : null,
    latencyCallCount: Math.round(nonNegative(row.latencyCallCount)),
    compactionCount: Math.round(nonNegative(row.compactionCount)),
    compactedTokens: Math.round(nonNegative(row.compactedTokens)),
  };
}

function runtimeTotals(row: SessionRuntimeMetricsTotalsDatabaseRow): SessionRuntimeMetricsTotals {
  const durationMs = nonNegative(row.durationMs);
  const generationDurationMs = nonNegative(row.generationDurationMs);
  const throughputOutputTokens = nonNegative(row.throughputOutputTokens);
  const outputTokens = Math.round(nonNegative(row.outputTokens));
  const firstTokenCalls = Math.round(nonNegative(row.firstTokenCalls));
  return {
    sessions: Math.round(nonNegative(row.sessions)),
    inputTokens: Math.round(nonNegative(row.inputTokens)),
    outputTokens,
    cachedInputTokens: Math.round(nonNegative(row.cachedInputTokens)),
    cacheWriteTokens: Math.round(nonNegative(row.cacheWriteTokens)),
    totalTokens: Math.round(nonNegative(row.totalTokens)),
    callCount: Math.round(nonNegative(row.callCount)),
    durationMs: Math.round(durationMs),
    tokensPerSecond:
      generationDurationMs > 0
        ? Number(((throughputOutputTokens / generationDurationMs) * 1000).toFixed(2))
        : null,
    firstTokenMs:
      firstTokenCalls > 0 ? Math.round(nonNegative(row.firstTokenTotal) / firstTokenCalls) : null,
    compactionCount: Math.round(nonNegative(row.compactionCount)),
    compactedTokens: Math.round(nonNegative(row.compactedTokens)),
  };
}

function loadSessionRuntimeTotals(): SessionRuntimeMetricsTotals {
  const row = db
    .prepare(
      `WITH usage AS (
         SELECT
           key AS sessionId,
           SUM(CAST(json_extract(metadata, '$.inputTokens') AS REAL)) AS inputTokens,
           SUM(CAST(json_extract(metadata, '$.outputTokens') AS REAL)) AS outputTokens,
           SUM(CAST(json_extract(metadata, '$.cachedInputTokens') AS REAL)) AS cachedInputTokens,
           SUM(CAST(json_extract(metadata, '$.cacheWriteTokens') AS REAL)) AS cacheWriteTokens,
           SUM(value) AS totalTokens,
           SUM(CASE
             WHEN CAST(json_extract(metadata, '$.durationMs') AS REAL) > 0
             THEN CAST(json_extract(metadata, '$.durationMs') AS REAL)
             ELSE 0
           END) AS durationMs,
           SUM(CASE
             WHEN CAST(json_extract(metadata, '$.generationDurationMs') AS REAL) > 0
             THEN CAST(json_extract(metadata, '$.generationDurationMs') AS REAL)
             ELSE 0
           END) AS generationDurationMs,
           SUM(CASE
             WHEN CAST(json_extract(metadata, '$.generationDurationMs') AS REAL) > 0
             THEN CAST(json_extract(metadata, '$.outputTokens') AS REAL)
             ELSE 0
           END) AS throughputOutputTokens,
           SUM(CASE
             WHEN json_type(metadata, '$.firstTokenMs') IN ('integer', 'real')
               AND CAST(json_extract(metadata, '$.firstTokenMs') AS REAL) > 0
             THEN CAST(json_extract(metadata, '$.firstTokenMs') AS REAL)
             ELSE 0
           END) AS firstTokenTotal,
           SUM(CASE
             WHEN json_type(metadata, '$.firstTokenMs') IN ('integer', 'real')
               AND CAST(json_extract(metadata, '$.firstTokenMs') AS REAL) > 0
             THEN 1
             ELSE 0
           END) AS firstTokenCalls,
           COUNT(*) AS callCount
         FROM metrics
         WHERE type = 'token_usage_by_session'
         GROUP BY key
       ), compaction AS (
         SELECT key AS sessionId, COUNT(*) AS compactionCount, SUM(value) AS compactedTokens
         FROM metrics
         WHERE type = 'context_compaction'
         GROUP BY key
       )
       SELECT
         COUNT(*) AS sessions,
         COALESCE(SUM(usage.inputTokens), 0) AS inputTokens,
         COALESCE(SUM(usage.outputTokens), 0) AS outputTokens,
         COALESCE(SUM(usage.cachedInputTokens), 0) AS cachedInputTokens,
         COALESCE(SUM(usage.cacheWriteTokens), 0) AS cacheWriteTokens,
         COALESCE(SUM(usage.totalTokens), 0) AS totalTokens,
         COALESCE(SUM(usage.callCount), 0) AS callCount,
         COALESCE(SUM(usage.durationMs), 0) AS durationMs,
         COALESCE(SUM(usage.generationDurationMs), 0) AS generationDurationMs,
         COALESCE(SUM(usage.throughputOutputTokens), 0) AS throughputOutputTokens,
         COALESCE(SUM(usage.firstTokenTotal), 0) AS firstTokenTotal,
         COALESCE(SUM(usage.firstTokenCalls), 0) AS firstTokenCalls,
         COALESCE(SUM(compaction.compactionCount), 0) AS compactionCount,
         COALESCE(SUM(compaction.compactedTokens), 0) AS compactedTokens
       FROM usage
       JOIN chat_sessions cs ON cs.id = usage.sessionId
       LEFT JOIN compaction ON compaction.sessionId = usage.sessionId`
    )
    .get() as SessionRuntimeMetricsTotalsDatabaseRow;
  return runtimeTotals(row);
}

export function listSessionRuntimeMetrics(page = 1, pageSize = 25): SessionRuntimeMetrics {
  const normalizedPageSize = Math.max(5, Math.min(100, Math.floor(pageSize)));
  const totals = loadSessionRuntimeTotals();
  const totalPages = Math.max(1, Math.ceil(totals.sessions / normalizedPageSize));
  const normalizedPage = Math.max(1, Math.min(totalPages, Math.floor(page)));
  const offset = (normalizedPage - 1) * normalizedPageSize;
  const rows = db
    .prepare(
      `WITH selected AS (
         SELECT DISTINCT metrics.key AS sessionId
         FROM metrics
         JOIN chat_sessions cs ON cs.id = metrics.key
         WHERE metrics.type = 'token_usage_by_session'
         ORDER BY cs.updated_at DESC
         LIMIT ? OFFSET ?
       ), usage AS (
         SELECT
           metrics.key AS sessionId,
           SUM(CAST(json_extract(metrics.metadata, '$.inputTokens') AS REAL)) AS inputTokens,
           SUM(CAST(json_extract(metrics.metadata, '$.outputTokens') AS REAL)) AS outputTokens,
           SUM(CAST(json_extract(metrics.metadata, '$.cachedInputTokens') AS REAL)) AS cachedInputTokens,
           SUM(CAST(json_extract(metrics.metadata, '$.cacheWriteTokens') AS REAL)) AS cacheWriteTokens,
           SUM(metrics.value) AS totalTokens,
           SUM(CASE
             WHEN CAST(json_extract(metrics.metadata, '$.durationMs') AS REAL) > 0
             THEN CAST(json_extract(metrics.metadata, '$.durationMs') AS REAL)
             ELSE 0
           END) AS durationMs,
           SUM(CASE
             WHEN CAST(json_extract(metrics.metadata, '$.generationDurationMs') AS REAL) > 0
             THEN CAST(json_extract(metrics.metadata, '$.generationDurationMs') AS REAL)
             ELSE 0
           END) AS generationDurationMs,
           SUM(CASE
             WHEN CAST(json_extract(metrics.metadata, '$.generationDurationMs') AS REAL) > 0
             THEN CAST(json_extract(metrics.metadata, '$.outputTokens') AS REAL)
             ELSE 0
           END) AS throughputOutputTokens,
           AVG(CASE
             WHEN json_type(metrics.metadata, '$.firstTokenMs') IN ('integer', 'real')
               AND CAST(json_extract(metrics.metadata, '$.firstTokenMs') AS REAL) > 0
             THEN CAST(json_extract(metrics.metadata, '$.firstTokenMs') AS REAL)
           END) AS firstTokenMs,
           SUM(CASE
             WHEN json_type(metrics.metadata, '$.firstTokenMs') IN ('integer', 'real')
               AND CAST(json_extract(metrics.metadata, '$.firstTokenMs') AS REAL) > 0
             THEN 1
             ELSE 0
           END) AS latencyCallCount,
           COUNT(*) AS callCount,
           MAX(metrics.rowid) AS latestRowId
         FROM metrics
         JOIN selected ON selected.sessionId = metrics.key
         WHERE metrics.type = 'token_usage_by_session'
         GROUP BY metrics.key
       ), compaction AS (
         SELECT metrics.key AS sessionId, COUNT(*) AS compactionCount, SUM(metrics.value) AS compactedTokens
         FROM metrics
         JOIN selected ON selected.sessionId = metrics.key
         WHERE metrics.type = 'context_compaction'
         GROUP BY metrics.key
       )
       SELECT
         cs.id AS sessionId,
         cs.title,
         cs.agent_id AS agentId,
         cs.workspace_dir AS workspaceDir,
         cs.updated_at AS updatedAt,
         json_extract(latest.metadata, '$.provider') AS provider,
         json_extract(latest.metadata, '$.model') AS model,
         COALESCE(usage.inputTokens, 0) AS inputTokens,
         COALESCE(usage.outputTokens, 0) AS outputTokens,
         COALESCE(usage.cachedInputTokens, 0) AS cachedInputTokens,
         COALESCE(usage.cacheWriteTokens, 0) AS cacheWriteTokens,
         COALESCE(usage.totalTokens, 0) AS totalTokens,
         COALESCE(usage.callCount, 0) AS callCount,
         COALESCE(usage.durationMs, 0) AS durationMs,
         COALESCE(usage.generationDurationMs, 0) AS generationDurationMs,
         COALESCE(usage.throughputOutputTokens, 0) AS throughputOutputTokens,
         usage.firstTokenMs,
         COALESCE(usage.latencyCallCount, 0) AS latencyCallCount,
         COALESCE(compaction.compactionCount, 0) AS compactionCount,
         COALESCE(compaction.compactedTokens, 0) AS compactedTokens
       FROM usage
       JOIN chat_sessions cs ON cs.id = usage.sessionId
       JOIN metrics latest ON latest.rowid = usage.latestRowId
       LEFT JOIN compaction ON compaction.sessionId = usage.sessionId
       ORDER BY cs.updated_at DESC`
    )
    .all(normalizedPageSize, offset) as SessionRuntimeMetricsDatabaseRow[];
  const sessions = rows.map(runtimeRow);
  return {
    totals,
    sessions,
    pagination: {
      page: normalizedPage,
      pageSize: normalizedPageSize,
      totalPages,
      totalItems: totals.sessions,
      hasNextPage: normalizedPage < totalPages,
      hasPreviousPage: normalizedPage > 1,
    },
  };
}
