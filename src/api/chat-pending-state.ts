import {
  broadcastStatusSnapshot,
  type PendingChatMessageSnapshot,
  setSessionPendingChatMessages,
} from "../core/status";
import { hasImages } from "../core/llm/image-blocks";
import {
  deletePersistedPendingChatItem,
  loadPersistedPendingChatItems,
} from "./chat-pending-store";
import {
  type InMemoryChatSession,
  parseIsoTimestampMs,
  pendingChatQueues,
  type PendingChatItem,
} from "./chat-runtime-state";
import type { ChatMessage } from "./chat-types";

let pendingChatSequence = 0;

export function nextPendingChatSequence(): number {
  pendingChatSequence += 1;
  return pendingChatSequence;
}

export function pendingChatSnapshot(item: PendingChatItem): PendingChatMessageSnapshot {
  return {
    id: item.id,
    sessionId: item.sessionId,
    ...(item.clientPendingId ? { clientPendingId: item.clientPendingId } : {}),
    content: item.content,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    mode: item.mode,
    sequence: item.sequence,
  };
}

export function pendingChatSnapshots(sessionId: string): PendingChatMessageSnapshot[] {
  return (pendingChatQueues.get(sessionId) || [])
    .filter((item) => item.materialized !== true)
    .map(pendingChatSnapshot);
}

export function syncPendingChatStatus(sessionId: string): PendingChatMessageSnapshot[] {
  const snapshots = pendingChatSnapshots(sessionId);
  setSessionPendingChatMessages(sessionId, snapshots);
  broadcastStatusSnapshot();
  return snapshots;
}

export function hasPendingChatMessages(sessionId: string): boolean {
  return (pendingChatQueues.get(sessionId) || []).some((item) => item.materialized !== true);
}

export function findMaterializedPendingMessage(
  session: InMemoryChatSession,
  pendingMessageId: string
): ChatMessage | undefined {
  return session.messages.find(
    (message) =>
      message.role === "user" &&
      (message._pendingSteeringId === pendingMessageId ||
        message.pending_chat_id === pendingMessageId)
  );
}

export function hasAssistantResponseAfterPendingMessage(
  session: InMemoryChatSession,
  pendingMessageId: string
): boolean {
  const pendingIndex = session.messages.findIndex(
    (message) =>
      message.role === "user" &&
      (message._pendingSteeringId === pendingMessageId ||
        message.pending_chat_id === pendingMessageId)
  );
  if (pendingIndex < 0) return false;
  for (let index = pendingIndex + 1; index < session.messages.length; index += 1) {
    const role = session.messages[index]?.role;
    if (role === "user") return false;
    if (role === "assistant") return true;
  }
  return false;
}

export function removePendingChatQueueItem(
  sessionId: string,
  pendingMessageId: string
): PendingChatMessageSnapshot[] {
  const remaining = (pendingChatQueues.get(sessionId) || []).filter(
    (item) => item.id !== pendingMessageId
  );
  if (remaining.length > 0) pendingChatQueues.set(sessionId, remaining);
  else pendingChatQueues.delete(sessionId);
  deletePersistedPendingChatItem(pendingMessageId);
  return syncPendingChatStatus(sessionId);
}

export function preparePendingMessage(
  session: InMemoryChatSession,
  item: PendingChatItem
): ChatMessage {
  const existing = findMaterializedPendingMessage(session, item.id);
  if (existing) return existing;
  const latestMessageTimestamp = session.messages.reduce((latest, message) => {
    const parsed = parseIsoTimestampMs(message.timestamp);
    return parsed ? Math.max(latest, parsed) : latest;
  }, 0);
  const timestamp = new Date(
    Math.max(item.updatedAt || item.createdAt, latestMessageTimestamp + 2)
  ).toISOString();
  const message: ChatMessage = {
    role: "user",
    content: item.content,
    timestamp,
    _pendingSteeringId: item.id,
    pending_chat_id: item.id,
    ...(item.clientPendingId ? { client_pending_id: item.clientPendingId } : {}),
    ...(hasImages(item.request.images) ? { images: item.request.images } : {}),
  };
  return message;
}

export function materializePendingMessage(
  session: InMemoryChatSession,
  item: PendingChatItem
): ChatMessage {
  const existing = findMaterializedPendingMessage(session, item.id);
  if (existing) return existing;
  const message = preparePendingMessage(session, item);
  session.messages.push(message);
  session.updatedAt = message.timestamp || new Date().toISOString();
  return message;
}

export function restorePendingChatQueueState(
  schedulePendingDrain?: (sessionId: string) => void
): number {
  const restored = loadPersistedPendingChatItems();
  const sessionIds = new Set<string>();
  for (const item of restored) {
    const queue = pendingChatQueues.get(item.sessionId) || [];
    if (!queue.some((existing) => existing.id === item.id)) {
      queue.push(item);
      queue.sort(
        (left, right) => left.sequence - right.sequence || left.createdAt - right.createdAt
      );
      pendingChatQueues.set(item.sessionId, queue);
    }
    pendingChatSequence = Math.max(pendingChatSequence, item.sequence);
    sessionIds.add(item.sessionId);
  }
  for (const sessionId of sessionIds) {
    syncPendingChatStatus(sessionId);
    schedulePendingDrain?.(sessionId);
  }
  return restored.length;
}
