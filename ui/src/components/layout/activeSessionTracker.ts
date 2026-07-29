import type { StatusSessionSnapshot, StreamAgentStatus } from "@/lib/status-stream";

export const SIDEBAR_ACTIVE_STATUSES = new Set<StreamAgentStatus>([
  "thinking",
  "generating",
  "tool_executing",
  "tool_completed",
  "compacting",
  "error",
]);

export function reconcileActiveSessionSnapshot(
  previous: ReadonlyMap<string, number>,
  snapshots: readonly StatusSessionSnapshot[],
  observedAt = Date.now()
): Map<string, number> {
  const next = new Map(previous);
  for (const snapshot of snapshots) {
    const sessionId = snapshot.sessionId.trim();
    if (!sessionId || !SIDEBAR_ACTIVE_STATUSES.has(snapshot.status)) continue;
    next.set(sessionId, observedAt);
  }
  return next;
}

export function reconcileAuthoritativeActiveSessions(
  previous: ReadonlyMap<string, number>,
  activeSessionIds: readonly string[],
  requestedAt: number,
  observedAt = Date.now()
): Map<string, number> {
  const confirmed = new Set(activeSessionIds.map((sessionId) => sessionId.trim()).filter(Boolean));
  const next = new Map<string, number>();
  for (const sessionId of confirmed) next.set(sessionId, observedAt);
  for (const [sessionId, lastSeen] of previous) {
    if (!confirmed.has(sessionId) && lastSeen > requestedAt) next.set(sessionId, lastSeen);
  }
  return next;
}
