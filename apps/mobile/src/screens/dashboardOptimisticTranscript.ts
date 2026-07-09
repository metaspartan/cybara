import type { SessionMessageSummary } from "../lib/api";

const optimisticTranscriptCache = new Map<string, SessionMessageSummary[]>();

function normalizeSessionId(sessionId?: string | null): string | null {
  const value = typeof sessionId === "string" ? sessionId.trim() : "";
  return value || null;
}

function cloneMessage(message: SessionMessageSummary): SessionMessageSummary {
  return {
    ...message,
    images: message.images?.map((image) => ({ ...image })),
    processActivities: message.processActivities?.map((activity) => ({ ...activity })),
    toolCalls: message.toolCalls?.map((toolCall) => ({ ...toolCall })),
  };
}

function timestampMs(message: SessionMessageSummary): number | null {
  const value = Date.parse(message.timestamp || "");
  return Number.isFinite(value) ? value : null;
}

function matchingPersistedUserMessage(
  optimistic: SessionMessageSummary,
  persisted: SessionMessageSummary
): boolean {
  if (optimistic.id === persisted.id) return true;
  if (persisted.role !== "user" || optimistic.content.trim() !== persisted.content.trim()) {
    return false;
  }
  const optimisticTimestamp = timestampMs(optimistic);
  const persistedTimestamp = timestampMs(persisted);
  if (optimisticTimestamp === null || persistedTimestamp === null) return false;
  return Math.abs(optimisticTimestamp - persistedTimestamp) <= 5 * 60 * 1000;
}

function acknowledgedByPersistedHistory(
  optimistic: SessionMessageSummary,
  persistedMessages: SessionMessageSummary[]
): boolean {
  if (persistedMessages.some((message) => matchingPersistedUserMessage(optimistic, message))) {
    return true;
  }
  const optimisticTimestamp = timestampMs(optimistic);
  if (optimisticTimestamp === null) return false;
  return persistedMessages.some((message) => {
    if (message.role !== "assistant") return false;
    const persistedTimestamp = timestampMs(message);
    return persistedTimestamp !== null && persistedTimestamp >= optimisticTimestamp;
  });
}

function writeCache(sessionId: string, messages: SessionMessageSummary[]): void {
  if (messages.length === 0) {
    optimisticTranscriptCache.delete(sessionId);
    return;
  }
  optimisticTranscriptCache.set(sessionId, messages.map(cloneMessage));
}

export function readCachedMobileOptimisticTranscript(
  sessionId?: string | null
): SessionMessageSummary[] {
  const key = normalizeSessionId(sessionId);
  if (!key) return [];
  return (optimisticTranscriptCache.get(key) || []).map(cloneMessage);
}

export function writeCachedMobileOptimisticTranscriptMessage(
  sessionId: string | null | undefined,
  message: SessionMessageSummary
): void {
  const key = normalizeSessionId(sessionId);
  if (!key) return;
  const current = readCachedMobileOptimisticTranscript(key).filter(
    (entry) => entry.id !== message.id
  );
  writeCache(key, [...current, message]);
}

export function clearCachedMobileOptimisticTranscript(
  sessionId?: string | null,
  messageId?: string | null
): void {
  const key = normalizeSessionId(sessionId);
  if (!key) return;
  const normalizedMessageId = typeof messageId === "string" ? messageId.trim() : "";
  if (!normalizedMessageId) {
    optimisticTranscriptCache.delete(key);
    return;
  }
  const remaining = readCachedMobileOptimisticTranscript(key).filter(
    (message) => message.id !== normalizedMessageId
  );
  writeCache(key, remaining);
}

export function mergeCachedMobileOptimisticTranscript(
  sessionId: string | null | undefined,
  persistedMessages: SessionMessageSummary[]
): SessionMessageSummary[] {
  const key = normalizeSessionId(sessionId);
  if (!key) return persistedMessages;
  const remaining = readCachedMobileOptimisticTranscript(key).filter(
    (optimistic) => !acknowledgedByPersistedHistory(optimistic, persistedMessages)
  );
  writeCache(key, remaining);
  if (remaining.length === 0) return persistedMessages;
  const persistedIds = new Set(persistedMessages.map((message) => message.id));
  return [
    ...persistedMessages,
    ...remaining.filter((message) => !persistedIds.has(message.id)).map(cloneMessage),
  ];
}
