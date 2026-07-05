import type { PendingChatMessage } from "@/lib/status-stream";

export interface CachedOptimisticPendingMessage extends PendingChatMessage {
  updatedAt: number;
}

const OPTIMISTIC_PENDING_QUEUE_STALE_MS = 15 * 60 * 1000;
const optimisticPendingQueueCache = new Map<string, CachedOptimisticPendingMessage[]>();

function normalizeSessionId(sessionId?: string | null): string | null {
  const trimmed = typeof sessionId === "string" ? sessionId.trim() : "";
  return trimmed || null;
}

function cloneMessage(message: CachedOptimisticPendingMessage): CachedOptimisticPendingMessage {
  return { ...message };
}

function pruneStaleEntries(): void {
  const now = Date.now();
  for (const [sessionId, messages] of optimisticPendingQueueCache) {
    const fresh = messages.filter(
      (message) => now - message.updatedAt <= OPTIMISTIC_PENDING_QUEUE_STALE_MS
    );
    if (fresh.length === 0) {
      optimisticPendingQueueCache.delete(sessionId);
    } else if (fresh.length !== messages.length) {
      optimisticPendingQueueCache.set(sessionId, fresh);
    }
  }
}

export function readCachedOptimisticPendingMessages(
  sessionId?: string | null
): CachedOptimisticPendingMessage[] {
  const key = normalizeSessionId(sessionId);
  if (!key) return [];
  pruneStaleEntries();
  const cached = optimisticPendingQueueCache.get(key);
  if (!cached) return [];
  return cached.map(cloneMessage);
}

export function writeCachedOptimisticPendingMessages(
  sessionId: string | null | undefined,
  messages: CachedOptimisticPendingMessage[]
): void {
  const key = normalizeSessionId(sessionId);
  if (!key) return;
  const optimisticOnly = messages
    .filter((message) => message.id.startsWith("optimistic-"))
    .map(cloneMessage);
  if (optimisticOnly.length === 0) {
    optimisticPendingQueueCache.delete(key);
    return;
  }
  optimisticPendingQueueCache.set(key, optimisticOnly);
}

export function clearCachedOptimisticPendingMessages(sessionId?: string | null): void {
  const key = normalizeSessionId(sessionId);
  if (!key) return;
  optimisticPendingQueueCache.delete(key);
}

export function isOptimisticPendingMessageId(id: string | null | undefined): boolean {
  return typeof id === "string" && id.startsWith("optimistic-");
}
