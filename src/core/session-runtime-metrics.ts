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
  firstTokenMs: number | null;
  latencyCallCount: number;
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
      durationMs > 0 ? Number(((outputTokens / durationMs) * 1000).toFixed(2)) : null,
    firstTokenMs:
      firstTokenMs !== null && Number.isFinite(firstTokenMs)
        ? Math.round(nonNegative(firstTokenMs))
        : null,
    latencyCallCount: Math.round(nonNegative(row.latencyCallCount)),
    compactionCount: Math.round(nonNegative(row.compactionCount)),
    compactedTokens: Math.round(nonNegative(row.compactedTokens)),
  };
}

function runtimeTotals(rows: SessionRuntimeMetricsRow[]): SessionRuntimeMetricsTotals {
  const totals = rows.reduce(
    (current, row) => ({
      inputTokens: current.inputTokens + row.inputTokens,
      outputTokens: current.outputTokens + row.outputTokens,
      cachedInputTokens: current.cachedInputTokens + row.cachedInputTokens,
      cacheWriteTokens: current.cacheWriteTokens + row.cacheWriteTokens,
      totalTokens: current.totalTokens + row.totalTokens,
      callCount: current.callCount + row.callCount,
      durationMs: current.durationMs + row.durationMs,
      compactionCount: current.compactionCount + row.compactionCount,
      compactedTokens: current.compactedTokens + row.compactedTokens,
      firstTokenTotal:
        current.firstTokenTotal +
        (row.firstTokenMs === null ? 0 : row.firstTokenMs * row.latencyCallCount),
      firstTokenCalls: current.firstTokenCalls + row.latencyCallCount,
    }),
    {
      inputTokens: 0,
      outputTokens: 0,
      cachedInputTokens: 0,
      cacheWriteTokens: 0,
      totalTokens: 0,
      callCount: 0,
      durationMs: 0,
      compactionCount: 0,
      compactedTokens: 0,
      firstTokenTotal: 0,
      firstTokenCalls: 0,
    }
  );
  return {
    sessions: rows.length,
    inputTokens: totals.inputTokens,
    outputTokens: totals.outputTokens,
    cachedInputTokens: totals.cachedInputTokens,
    cacheWriteTokens: totals.cacheWriteTokens,
    totalTokens: totals.totalTokens,
    callCount: totals.callCount,
    durationMs: totals.durationMs,
    tokensPerSecond:
      totals.durationMs > 0
        ? Number(((totals.outputTokens / totals.durationMs) * 1000).toFixed(2))
        : null,
    firstTokenMs:
      totals.firstTokenCalls > 0
        ? Math.round(totals.firstTokenTotal / totals.firstTokenCalls)
        : null,
    compactionCount: totals.compactionCount,
    compactedTokens: totals.compactedTokens,
  };
}

export function listSessionRuntimeMetrics(limit = 200): SessionRuntimeMetrics {
  const normalizedLimit = Math.max(1, Math.min(500, Math.floor(limit)));
  const rows = db
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
           AVG(CASE
             WHEN json_type(metadata, '$.firstTokenMs') IN ('integer', 'real')
               AND CAST(json_extract(metadata, '$.firstTokenMs') AS REAL) > 0
             THEN CAST(json_extract(metadata, '$.firstTokenMs') AS REAL)
           END) AS firstTokenMs,
           SUM(CASE
             WHEN json_type(metadata, '$.firstTokenMs') IN ('integer', 'real')
               AND CAST(json_extract(metadata, '$.firstTokenMs') AS REAL) > 0
             THEN 1
             ELSE 0
           END) AS latencyCallCount,
           COUNT(*) AS callCount,
           MAX(rowid) AS latestRowId
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
         usage.firstTokenMs,
         COALESCE(usage.latencyCallCount, 0) AS latencyCallCount,
         COALESCE(compaction.compactionCount, 0) AS compactionCount,
         COALESCE(compaction.compactedTokens, 0) AS compactedTokens
       FROM usage
       JOIN chat_sessions cs ON cs.id = usage.sessionId
       JOIN metrics latest ON latest.rowid = usage.latestRowId
       LEFT JOIN compaction ON compaction.sessionId = usage.sessionId
       ORDER BY cs.updated_at DESC
       LIMIT ?`
    )
    .all(normalizedLimit) as SessionRuntimeMetricsDatabaseRow[];
  const sessions = rows.map(runtimeRow);
  return { totals: runtimeTotals(sessions), sessions };
}
