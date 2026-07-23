import type { LiveActivityItem } from "@/lib/chatActivities";

export interface CachedLiveSessionState {
  status: "thinking" | "generating" | "compacting" | "idle";
  activities: LiveActivityItem[];
  currentStep: string | null;
  streamingContent: string | null;
  runId: string | null;
  sequence: number;
  startedAtMs: number | null;
  updatedAt: number;
}

interface CachedLiveSessionWrite
  extends Omit<CachedLiveSessionState, "updatedAt" | "runId" | "sequence" | "startedAtMs"> {
  runId?: string | null;
  sequence?: number;
  startedAtMs?: number | null;
  updatedAt?: number;
}

const LIVE_SESSION_STATE_STALE_MS = 15 * 60 * 1000;
const liveSessionStateCache = new Map<string, CachedLiveSessionState>();

interface LiveSessionSnapshotTiming {
  startedAt?: unknown;
  timestamp?: unknown;
  activities?: Array<{ timestamp?: unknown }>;
}

function validTimestamp(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

export function resolveLiveSessionStartedAtMs(
  snapshot: LiveSessionSnapshotTiming,
  fallback = Date.now()
): number {
  const explicit = validTimestamp(snapshot.startedAt);
  if (explicit !== null) return explicit;
  let earliest = validTimestamp(snapshot.timestamp);
  for (const activity of snapshot.activities || []) {
    const timestamp = validTimestamp(activity.timestamp);
    if (timestamp !== null && (earliest === null || timestamp < earliest)) {
      earliest = timestamp;
    }
  }
  return earliest ?? fallback;
}

function normalizeSessionId(sessionId?: string | null): string | null {
  const trimmed = typeof sessionId === "string" ? sessionId.trim() : "";
  return trimmed || null;
}

export function isLiveSessionRunning(
  sessionId: string | null | undefined,
  activeSessionIds: readonly string[],
  requestLoading: boolean,
  loadingSessionId?: string | null
): boolean {
  const sessionKey = normalizeSessionId(sessionId);
  const loadingKey = normalizeSessionId(loadingSessionId);
  if (requestLoading && (!loadingKey || loadingKey === sessionKey)) return true;
  if (!sessionKey) return false;
  return activeSessionIds.some((candidate) => normalizeSessionId(candidate) === sessionKey);
}

export function readCachedLiveSessionState(
  sessionId?: string | null
): CachedLiveSessionState | null {
  const key = normalizeSessionId(sessionId);
  if (!key) return null;
  const cached = liveSessionStateCache.get(key);
  if (!cached) return null;
  if (Date.now() - cached.updatedAt > LIVE_SESSION_STATE_STALE_MS) {
    liveSessionStateCache.delete(key);
    return null;
  }
  return {
    ...cached,
    activities: cached.activities.map((activity) => ({ ...activity })),
  };
}

export function writeCachedLiveSessionState(
  sessionId: string | null | undefined,
  state: CachedLiveSessionWrite
): void {
  const key = normalizeSessionId(sessionId);
  if (!key) return;
  const previous = liveSessionStateCache.get(key);
  liveSessionStateCache.set(key, {
    ...state,
    activities: state.activities.map((activity) => ({ ...activity })),
    runId: state.runId === undefined ? (previous?.runId ?? null) : state.runId,
    sequence: state.sequence === undefined ? (previous?.sequence ?? 0) : state.sequence,
    startedAtMs:
      state.startedAtMs === undefined ? (previous?.startedAtMs ?? null) : state.startedAtMs,
    updatedAt: state.updatedAt ?? Date.now(),
  });
}

export function clearCachedLiveSessionState(sessionId?: string | null): void {
  const key = normalizeSessionId(sessionId);
  if (key) {
    liveSessionStateCache.delete(key);
  }
}
