import type { SessionMessageSummary } from "../lib/api";
import { MOBILE_VISIBLE_CHAT_MESSAGE_LIMIT } from "../lib/chat-format";

const MAX_CACHED_SESSIONS = 12;

const sessionTranscriptCache = new Map<string, SessionMessageSummary[]>();

function normalizeSessionId(sessionId?: string | null): string | null {
  const value = typeof sessionId === "string" ? sessionId.trim() : "";
  return value || null;
}

export function readCachedMobileSessionTranscript(
  sessionId?: string | null
): SessionMessageSummary[] {
  const key = normalizeSessionId(sessionId);
  if (!key) return [];
  return sessionTranscriptCache.get(key) || [];
}

export function writeCachedMobileSessionTranscript(
  sessionId: string | null | undefined,
  messages: SessionMessageSummary[]
): void {
  const key = normalizeSessionId(sessionId);
  if (!key) return;
  if (messages.length === 0) {
    sessionTranscriptCache.delete(key);
    return;
  }
  sessionTranscriptCache.delete(key);
  sessionTranscriptCache.set(key, messages.slice(-MOBILE_VISIBLE_CHAT_MESSAGE_LIMIT));
  while (sessionTranscriptCache.size > MAX_CACHED_SESSIONS) {
    const oldest = sessionTranscriptCache.keys().next().value;
    if (oldest === undefined) break;
    sessionTranscriptCache.delete(oldest);
  }
}

export function clearCachedMobileSessionTranscript(sessionId?: string | null): void {
  const key = normalizeSessionId(sessionId);
  if (key) sessionTranscriptCache.delete(key);
}
