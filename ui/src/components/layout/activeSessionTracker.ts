import type { StatusSessionSnapshot, StreamAgentStatus } from "@/lib/status-stream";

export const SIDEBAR_ACTIVE_SESSION_WINDOW_MS = 60_000;

export const SIDEBAR_ACTIVE_STATUSES = new Set<StreamAgentStatus>([
  "thinking",
  "generating",
  "tool_executing",
  "tool_completed",
  "compacting",
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

export function pruneInactiveSessions(
  previous: ReadonlyMap<string, number>,
  now = Date.now(),
  activeWindowMs = SIDEBAR_ACTIVE_SESSION_WINDOW_MS
): Map<string, number> {
  return new Map([...previous].filter(([, lastSeen]) => now - lastSeen <= activeWindowMs));
}
