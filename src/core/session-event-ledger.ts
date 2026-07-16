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
const pendingAssistantDeltas = new Map<
  string,
  {
    sessionId: string;
    runId: string;
    agentId?: string;
    delta: string;
    timestamp: number;
    timeout?: ReturnType<typeof setTimeout>;
  }
>();
const ASSISTANT_DELTA_FLUSH_MS = 250;
const ASSISTANT_DELTA_FLUSH_CHARS = 4096;

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

function assistantDeltaKey(sessionId: string, runId: string): string {
  return `${sessionId}\u0000${runId}`;
}

function flushAssistantDeltaByKey(key: string): SessionLedgerEvent | null {
  const pending = pendingAssistantDeltas.get(key);
  if (!pending) return null;
  const event = appendSessionEvent({
    sessionId: pending.sessionId,
    runId: pending.runId,
    type: "assistant_delta",
    payload: {
      agentId: pending.agentId,
      delta: pending.delta,
      timestamp: pending.timestamp,
    },
  });
  pendingAssistantDeltas.delete(key);
  if (pending.timeout) clearTimeout(pending.timeout);
  return event;
}

function scheduleAssistantDeltaFlush(key: string, delay = ASSISTANT_DELTA_FLUSH_MS): void {
  const pending = pendingAssistantDeltas.get(key);
  if (!pending) return;
  if (pending.timeout) clearTimeout(pending.timeout);
  pending.timeout = setTimeout(() => {
    try {
      flushAssistantDeltaByKey(key);
    } catch {
      const latest = pendingAssistantDeltas.get(key);
      if (latest && activeRunIds.get(latest.sessionId) === latest.runId) {
        scheduleAssistantDeltaFlush(key, ASSISTANT_DELTA_FLUSH_MS * 4);
      }
    }
  }, delay);
}

export function appendBufferedAssistantDelta(input: {
  sessionId: string;
  runId: string;
  agentId?: string;
  delta: string;
  timestamp: number;
}): void {
  const sessionId = input.sessionId.trim();
  const runId = input.runId.trim();
  if (!sessionId || !runId || !input.delta) return;
  const key = assistantDeltaKey(sessionId, runId);
  const previous = pendingAssistantDeltas.get(key);
  if (previous) {
    previous.delta += input.delta;
    previous.timestamp = Math.max(previous.timestamp, input.timestamp);
    previous.agentId = input.agentId ?? previous.agentId;
    if (previous.delta.length >= ASSISTANT_DELTA_FLUSH_CHARS) {
      flushAssistantDeltaByKey(key);
    }
    return;
  }
  pendingAssistantDeltas.set(key, {
    sessionId,
    runId,
    agentId: input.agentId,
    delta: input.delta,
    timestamp: input.timestamp,
  });
  scheduleAssistantDeltaFlush(key);
}

export function flushBufferedAssistantDeltas(
  sessionId: string,
  runId?: string
): SessionLedgerEvent[] {
  const normalizedSessionId = sessionId.trim();
  const normalizedRunId = runId?.trim();
  if (!normalizedSessionId) return [];
  const flushed: SessionLedgerEvent[] = [];
  for (const [key, pending] of pendingAssistantDeltas.entries()) {
    if (pending.sessionId !== normalizedSessionId) continue;
    if (normalizedRunId && pending.runId !== normalizedRunId) continue;
    const event = flushAssistantDeltaByKey(key);
    if (event) flushed.push(event);
  }
  return flushed;
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
  try {
    flushBufferedAssistantDeltas(key, runId);
  } catch {
    void 0;
  }
  activeRunIds.delete(key);
  return runId;
}

export function listSessionEvents(
  sessionId: string,
  afterSequence = 0,
  limit = 1000
): SessionLedgerEvent[] {
  flushBufferedAssistantDeltas(sessionId);
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
  const normalizedRunId = runId.trim();
  for (const pending of pendingAssistantDeltas.values()) {
    if (pending.runId !== normalizedRunId) continue;
    flushBufferedAssistantDeltas(pending.sessionId, normalizedRunId);
    break;
  }
  const boundedLimit = Number.isFinite(limit)
    ? Math.min(5000, Math.max(1, Math.floor(limit)))
    : 1000;
  return (tables.sessionEvents.byRun(runId.trim(), boundedLimit) as StoredSessionEvent[]).map(
    toLedgerEvent
  );
}

export function latestSessionEventSequence(sessionId: string): number {
  flushBufferedAssistantDeltas(sessionId);
  return tables.sessionEvents.latestSequence(sessionId.trim());
}
