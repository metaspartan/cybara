import type { MobilePendingChatMessage } from "../lib/api";

export type CachedMobileOptimisticPendingMessage = MobilePendingChatMessage & {
  updatedAt: number;
};

const MOBILE_OPTIMISTIC_PENDING_QUEUE_STALE_MS = 15 * 60 * 1000;
const mobileOptimisticPendingQueueCache = new Map<string, CachedMobileOptimisticPendingMessage[]>();

export function mobilePendingMessageIsOptimistic(message: MobilePendingChatMessage): boolean {
  return message.id.startsWith("optimistic-");
}

export function sortMobilePendingMessages(
  messages: MobilePendingChatMessage[]
): MobilePendingChatMessage[] {
  return [...messages].sort((a, b) => a.sequence - b.sequence || a.createdAt - b.createdAt);
}

export function mergeMobilePendingMessages(
  remoteMessages: MobilePendingChatMessage[],
  currentMessages: MobilePendingChatMessage[],
  options: { preserveOptimistic?: boolean } = {}
): MobilePendingChatMessage[] {
  const preserveOptimistic = options.preserveOptimistic ?? true;
  if (!preserveOptimistic) return sortMobilePendingMessages(remoteMessages);
  const remoteClientPendingIds = new Set(
    remoteMessages
      .map((message) =>
        typeof message.clientPendingId === "string" ? message.clientPendingId.trim() : ""
      )
      .filter(Boolean)
  );
  const optimisticMessages = currentMessages.filter((message) => {
    if (!mobilePendingMessageIsOptimistic(message)) return false;
    if (remoteClientPendingIds.has(message.id)) return false;
    return !remoteMessages.some(
      (remote) => remote.sessionId === message.sessionId && remote.content === message.content
    );
  });
  return sortMobilePendingMessages([...remoteMessages, ...optimisticMessages]);
}

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
  const optimisticOnly = messages.filter(mobilePendingMessageIsOptimistic).map(cloneMessage);
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
