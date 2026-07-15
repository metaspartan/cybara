export interface StoppedRunSuppression {
  runId: string | null;
  until: number;
}

export type StoppedRunSuppressions = Record<string, StoppedRunSuppression>;

function normalizeId(value?: string | null): string | null {
  const normalized = typeof value === "string" ? value.trim() : "";
  return normalized || null;
}

export function markStoppedRun(
  suppressions: StoppedRunSuppressions,
  sessionId: string | null | undefined,
  runId: string | null | undefined,
  now: number,
  durationMs: number
): void {
  const normalizedSessionId = normalizeId(sessionId);
  if (!normalizedSessionId) return;
  suppressions[normalizedSessionId] = {
    runId: normalizeId(runId),
    until: now + durationMs,
  };
}

export function isStoppedRunSuppressed(
  suppressions: StoppedRunSuppressions,
  sessionId: string | null | undefined,
  runId: string | null | undefined,
  now: number
): boolean {
  const normalizedSessionId = normalizeId(sessionId);
  if (!normalizedSessionId) return false;
  const suppression = suppressions[normalizedSessionId];
  if (!suppression) return false;
  if (suppression.until <= now) {
    delete suppressions[normalizedSessionId];
    return false;
  }
  const normalizedRunId = normalizeId(runId);
  return !suppression.runId || !normalizedRunId || suppression.runId === normalizedRunId;
}
