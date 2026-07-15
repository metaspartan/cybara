export interface SessionEventCursor {
  runId: string | null;
  sequence: number;
  timestamp: number;
}

export interface SessionEventIdentity {
  runId?: string | null;
  sequence?: number | null;
  timestamp?: number | null;
}

export interface SessionEventDecision {
  accepted: boolean;
  runChanged: boolean;
  cursor: SessionEventCursor;
}

function normalizeRunId(value?: string | null): string | null {
  const normalized = typeof value === "string" ? value.trim() : "";
  return normalized || null;
}

function normalizePositiveNumber(value?: number | null): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;
}

export function resolveSessionEventOrder(
  previous: SessionEventCursor | undefined,
  incoming: SessionEventIdentity
): SessionEventDecision {
  const runId = normalizeRunId(incoming.runId);
  const sequence = normalizePositiveNumber(incoming.sequence);
  const timestamp = normalizePositiveNumber(incoming.timestamp);
  const current = previous ?? { runId: null, sequence: 0, timestamp: 0 };
  const sequenceIsStale = sequence > 0 && current.sequence > 0 && sequence <= current.sequence;
  const timestampIsStale =
    sequence === 0 && timestamp > 0 && current.timestamp > 0 && timestamp + 25 < current.timestamp;

  if (sequenceIsStale || timestampIsStale) {
    return { accepted: false, runChanged: false, cursor: current };
  }

  const runChanged = !!current.runId && !!runId && current.runId !== runId;
  return {
    accepted: true,
    runChanged,
    cursor: {
      runId: runId ?? current.runId,
      sequence: Math.max(current.sequence, sequence),
      timestamp: Math.max(current.timestamp, timestamp),
    },
  };
}
