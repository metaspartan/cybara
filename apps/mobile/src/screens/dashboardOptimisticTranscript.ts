import type { SessionMessageSummary } from "../lib/api";
import {
  MOBILE_CHAT_CACHE_KEYS,
  readPersistedJson,
  schedulePersistJson,
} from "../lib/chatCachePersistence";

const optimisticTranscriptCache = new Map<string, SessionMessageSummary[]>();
const MAX_PERSISTED_TRANSCRIPT_SESSIONS = 12;
const MAX_PERSISTED_TRANSCRIPT_MESSAGES = 40;
const PERSISTED_TRANSCRIPT_MAX_AGE_MS = 24 * 60 * 60 * 1000;
let transcriptHydration: Promise<void> | null = null;

function persistTranscriptCache(): void {
  schedulePersistJson(MOBILE_CHAT_CACHE_KEYS.optimisticTranscripts, () => {
    if (optimisticTranscriptCache.size === 0) return null;
    const entries = [...optimisticTranscriptCache.entries()].slice(
      -MAX_PERSISTED_TRANSCRIPT_SESSIONS
    );
    return Object.fromEntries(
      entries.map(([sessionId, messages]) => [
        sessionId,
        messages.slice(-MAX_PERSISTED_TRANSCRIPT_MESSAGES),
      ])
    );
  });
}

export function hydrateMobileOptimisticTranscripts(): Promise<void> {
  if (!transcriptHydration) {
    transcriptHydration = (async () => {
      const data = await readPersistedJson<Record<string, SessionMessageSummary[]>>(
        MOBILE_CHAT_CACHE_KEYS.optimisticTranscripts
      );
      if (!data) return;
      const cutoff = Date.now() - PERSISTED_TRANSCRIPT_MAX_AGE_MS;
      for (const [sessionId, messages] of Object.entries(data)) {
        if (optimisticTranscriptCache.has(sessionId) || !Array.isArray(messages)) continue;
        const fresh = messages.filter((message) => {
          const parsed = timestampMs(message);
          return parsed === null || parsed >= cutoff;
        });
        if (fresh.length > 0) {
          optimisticTranscriptCache.set(sessionId, fresh.map(cloneMessage));
        }
      }
    })();
  }
  return transcriptHydration;
}

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
  } else {
    optimisticTranscriptCache.set(sessionId, messages.map(cloneMessage));
  }
  persistTranscriptCache();
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
    persistTranscriptCache();
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
