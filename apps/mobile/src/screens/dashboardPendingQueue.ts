import type { MobilePendingChatMessage } from "../lib/api";

export type CachedMobileOptimisticPendingMessage = MobilePendingChatMessage & {
  updatedAt: number;
};

const MOBILE_OPTIMISTIC_PENDING_QUEUE_STALE_MS = 15 * 60 * 1000;
const mobileOptimisticPendingQueueCache = new Map<string, CachedMobileOptimisticPendingMessage[]>();

function normalizeLiveSessionId(sessionId?: string | null): string | null {
  const trimmed = typeof sessionId === "string" ? sessionId.trim() : "";
  return trimmed || null;
}

function cloneMessage(
  message: CachedMobileOptimisticPendingMessage
): CachedMobileOptimisticPendingMessage {
  return { ...message };
}

function pruneStaleEntries(): void {
  const now = Date.now();
  for (const [sessionId, messages] of mobileOptimisticPendingQueueCache) {
    const fresh = messages.filter(
      (message) => now - message.updatedAt <= MOBILE_OPTIMISTIC_PENDING_QUEUE_STALE_MS
    );
    if (fresh.length === 0) {
      mobileOptimisticPendingQueueCache.delete(sessionId);
    } else if (fresh.length !== messages.length) {
      mobileOptimisticPendingQueueCache.set(sessionId, fresh);
    }
  }
}

export function readCachedMobileOptimisticPendingMessages(
  sessionId?: string | null
): CachedMobileOptimisticPendingMessage[] {
  const key = normalizeLiveSessionId(sessionId);
  if (!key) return [];
  pruneStaleEntries();
  const cached = mobileOptimisticPendingQueueCache.get(key);
  if (!cached) return [];
  return cached.map(cloneMessage);
}

export function writeCachedMobileOptimisticPendingMessages(
  sessionId: string | null | undefined,
  messages: CachedMobileOptimisticPendingMessage[]
): void {
  const key = normalizeLiveSessionId(sessionId);
  if (!key) return;
  const optimisticOnly = messages
    .filter((message) => message.id.startsWith("optimistic-"))
    .map(cloneMessage);
  if (optimisticOnly.length === 0) {
    mobileOptimisticPendingQueueCache.delete(key);
    return;
  }
  mobileOptimisticPendingQueueCache.set(key, optimisticOnly);
}

export function clearCachedMobileOptimisticPendingMessages(sessionId?: string | null): void {
  const key = normalizeLiveSessionId(sessionId);
  if (!key) return;
  mobileOptimisticPendingQueueCache.delete(key);
}
