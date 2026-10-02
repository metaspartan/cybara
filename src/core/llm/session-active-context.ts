import db from "../database";
import { SESSION_SUMMARY_COMPACTION_PREDICATE } from "../metrics";
import { broadcastStatus } from "../status";
import type { SessionContextUsage } from "../session-context";

export interface ActiveContextSnapshot {
  usedTokens: number;
  limitTokens?: number;
  transcriptTokensAtObservation?: number;
  messagesAtObservation?: number;
  observedAt: number;
  source?: "provider" | "estimated";
}

function finiteTokens(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

export function loadActiveContextUsage(
  sessionId: string | undefined
): ActiveContextSnapshot | null {
  if (!sessionId?.trim()) return null;
  const row = db
    .query<{ snapshot: string | null }, [string]>(
      "SELECT json_extract(context_state, '$.activeUsage') AS snapshot FROM chat_sessions WHERE id = ? AND json_valid(context_state)"
    )
    .get(sessionId);
  if (!row?.snapshot) return null;
  try {
    const value = JSON.parse(row.snapshot) as Record<string, unknown>;
    if (
      !value ||
      typeof value !== "object" ||
      !finiteTokens(value.usedTokens) ||
      !finiteTokens(value.observedAt)
    )
      return null;
    return {
      usedTokens: Math.ceil(value.usedTokens),
      observedAt: value.observedAt,
      source: value.source === "provider" ? "provider" : "estimated",
      ...(finiteTokens(value.messagesAtObservation)
        ? { messagesAtObservation: Math.floor(value.messagesAtObservation) }
        : {}),
      ...(finiteTokens(value.limitTokens) && value.limitTokens > 0
        ? { limitTokens: Math.ceil(value.limitTokens) }
        : {}),
      ...(finiteTokens(value.transcriptTokensAtObservation)
        ? { transcriptTokensAtObservation: Math.ceil(value.transcriptTokensAtObservation) }
        : {}),
    };
  } catch {
    return null;
  }
}

export function recordActiveContextUsage(
  sessionId: string | undefined | null,
  usedTokens: number,
  limitTokens?: number,
  messageCount = 0,
  source: "provider" | "estimated" = "estimated"
): void {
  if (!sessionId?.trim() || !finiteTokens(usedTokens)) return;
  const previous = loadActiveContextUsage(sessionId);
  const limit =
    finiteTokens(limitTokens) && limitTokens > 0 ? Math.ceil(limitTokens) : previous?.limitTokens;
  const snapshot: ActiveContextSnapshot = {
    usedTokens: Math.ceil(usedTokens),
    observedAt: Date.now(),
    source,
    ...(limit ? { limitTokens: limit } : {}),
  };
  const persisted = db
    .query(
      "UPDATE chat_sessions SET context_state = json_set(COALESCE(context_state, '{}'), '$.activeUsage', json(?)) WHERE id = ?"
    )
    .run(JSON.stringify(snapshot), sessionId);
  if (persisted.changes === 0 || !limit) return;
  const compaction = db
    .query<{ count: number; tokens: number }, [string]>(
      `SELECT COUNT(*) AS count, COALESCE(SUM(value), 0) AS tokens FROM metrics WHERE key = ? AND (type='tool_transcript_compaction' OR (type='context_compaction' AND ${SESSION_SUMMARY_COMPACTION_PREDICATE}))`
    )
    .get(sessionId);
  const contextUsage: SessionContextUsage = {
    usedTokens: snapshot.usedTokens,
    limitTokens: limit,
    remainingTokens: Math.max(0, limit - snapshot.usedTokens),
    usedPercent: Math.min(100, Math.round((snapshot.usedTokens / limit) * 1000) / 10),
    messageCount,
    transcriptTokens: snapshot.usedTokens,
    metadataTokens: 0,
    compacted: (compaction?.count ?? 0) > 0,
    compactionCount: compaction?.count ?? 0,
    compactedTokens: compaction?.tokens ?? 0,
    source,
  };
  broadcastStatus({ status: "thinking", sessionId, timestamp: snapshot.observedAt, contextUsage });
}

export function anchorActiveContextUsage(
  sessionId: string,
  transcriptTokens: number,
  messageCount?: number
): void {
  if (!finiteTokens(transcriptTokens)) return;
  db.query(
    "UPDATE chat_sessions SET context_state = json_set(context_state, '$.activeUsage.transcriptTokensAtObservation', ?, '$.activeUsage.messagesAtObservation', ?) WHERE id = ? AND json_type(context_state, '$.activeUsage') = 'object'"
  ).run(
    Math.ceil(transcriptTokens),
    finiteTokens(messageCount) ? Math.floor(messageCount) : null,
    sessionId
  );
}

export function clearActiveContextUsage(sessionId: string): void {
  db.query(
    "UPDATE chat_sessions SET context_state = json_remove(COALESCE(context_state, '{}'), '$.activeUsage') WHERE id = ?"
  ).run(sessionId);
}
