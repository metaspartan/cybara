import type { LiveActivityItem } from "@/lib/chatActivities";

export interface CachedLiveSessionState {
  status: "thinking" | "generating" | "idle";
  activities: LiveActivityItem[];
  currentStep: string | null;
  streamingContent: string | null;
  updatedAt: number;
}

const LIVE_SESSION_STATE_STALE_MS = 15 * 60 * 1000;
const liveSessionStateCache = new Map<string, CachedLiveSessionState>();

function normalizeSessionId(sessionId?: string | null): string | null {
  const trimmed = typeof sessionId === "string" ? sessionId.trim() : "";
  return trimmed || null;
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
  state: Omit<CachedLiveSessionState, "updatedAt"> & { updatedAt?: number }
): void {
  const key = normalizeSessionId(sessionId);
  if (!key) return;
  liveSessionStateCache.set(key, {
    ...state,
    activities: state.activities.map((activity) => ({ ...activity })),
    updatedAt: state.updatedAt ?? Date.now(),
  });
}

export function clearCachedLiveSessionState(sessionId?: string | null): void {
  const key = normalizeSessionId(sessionId);
  if (key) {
    liveSessionStateCache.delete(key);
  }
}
