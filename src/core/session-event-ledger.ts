import { tables } from "./database";
import { redactSecrets } from "./redaction";

export type SessionEventType =
  | "run_started"
  | "run_completed"
  | "status"
  | "assistant_delta"
  | "message"
  | "approval"
  | "error";

export interface SessionLedgerEvent<T = unknown> {
  id: string;
  sessionId: string;
  runId: string;
  sequence: number;
  type: SessionEventType;
  payload: T;
  createdAt: string;
}

interface StoredSessionEvent {
  id: string;
  session_id: string;
  run_id: string;
  sequence: number;
  event_type: SessionEventType;
  payload: string;
  created_at: string;
}

const activeRunIds = new Map<string, string>();

function parsePayload(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function toLedgerEvent(row: StoredSessionEvent): SessionLedgerEvent {
  return {
    id: row.id,
    sessionId: row.session_id,
    runId: row.run_id,
    sequence: row.sequence,
    type: row.event_type,
    payload: parsePayload(row.payload),
    createdAt: row.created_at,
  };
}

export function appendSessionEvent<T>(input: {
  sessionId: string;
  runId: string;
  type: SessionEventType;
  payload: T;
}): SessionLedgerEvent<T> {
  const sessionId = input.sessionId.trim();
  const runId = input.runId.trim();
  if (!sessionId || !runId) {
    throw new Error("Session events require session and run identifiers");
  }
  const row = tables.sessionEvents.append({
    id: crypto.randomUUID(),
    session_id: sessionId,
    run_id: runId,
    event_type: input.type,
    payload: JSON.stringify(redactSecrets(input.payload)),
  }) as StoredSessionEvent;
  return toLedgerEvent(row) as SessionLedgerEvent<T>;
}

export function ensureSessionRunId(sessionId: string): string {
  return beginSessionRun(sessionId);
}

export function beginSessionRun(sessionId: string, requestedRunId?: string): string {
  const key = sessionId.trim();
  if (!key) throw new Error("Session identifier is required");
  const existing = activeRunIds.get(key);
  if (existing) return existing;
  const runId = requestedRunId?.trim() || crypto.randomUUID();
  activeRunIds.set(key, runId);
  return runId;
}

export function getActiveSessionRunId(sessionId: string): string | undefined {
  return activeRunIds.get(sessionId.trim());
}

export function completeSessionRun(sessionId: string): string | undefined {
  const key = sessionId.trim();
  const runId = activeRunIds.get(key);
  activeRunIds.delete(key);
  return runId;
}

export function listSessionEvents(
  sessionId: string,
  afterSequence = 0,
  limit = 1000
): SessionLedgerEvent[] {
  const boundedAfter = Number.isFinite(afterSequence) ? Math.max(0, Math.floor(afterSequence)) : 0;
  const boundedLimit = Number.isFinite(limit)
    ? Math.min(5000, Math.max(1, Math.floor(limit)))
    : 1000;
  return (
    tables.sessionEvents.bySession(
      sessionId.trim(),
      boundedAfter,
      boundedLimit
    ) as StoredSessionEvent[]
  ).map(toLedgerEvent);
}

export function listRunEvents(runId: string, limit = 1000): SessionLedgerEvent[] {
  const boundedLimit = Number.isFinite(limit)
    ? Math.min(5000, Math.max(1, Math.floor(limit)))
    : 1000;
  return (tables.sessionEvents.byRun(runId.trim(), boundedLimit) as StoredSessionEvent[]).map(
    toLedgerEvent
  );
}

export function latestSessionEventSequence(sessionId: string): number {
  return tables.sessionEvents.latestSequence(sessionId.trim());
}
