import type { PendingChatMessageSnapshot } from "../core/status";
import {
  nextPendingChatSequence,
  pendingChatSnapshot,
  pendingChatSnapshots,
  removePendingChatQueueItem,
  syncPendingChatStatus,
} from "./chat-pending-state";
import { persistPendingChatItem, persistPendingChatItems } from "./chat-pending-store";
import {
  type PendingChatItem,
  pendingChatQueues,
  rejectPendingChatCompletion,
} from "./chat-runtime-state";

export function reorderPendingChatMessages(
  sessionId: string,
  pendingMessageIds: string[]
):
  | { success: true; pendingMessages: PendingChatMessageSnapshot[] }
  | {
      success: false;
      error: string;
      pendingMessages: PendingChatMessageSnapshot[];
    } {
  const key = sessionId.trim();
  const queue = pendingChatQueues.get(key) || [];
  if (queue.length === 0) {
    return { success: true, pendingMessages: [] };
  }

  const normalizedIds = pendingMessageIds
    .map((id) => (typeof id === "string" ? id.trim() : ""))
    .filter((id, index, ids) => id.length > 0 && ids.indexOf(id) === index);
  const visibleItems = queue.filter((item) => item.materialized !== true);
  const visibleById = new Map(visibleItems.map((item) => [item.id, item]));
  const unknownId = normalizedIds.find((id) => !visibleById.has(id));
  if (unknownId) {
    return {
      success: false,
      error: "Pending message not found",
      pendingMessages: pendingChatSnapshots(key),
    };
  }

  const orderedIds = new Set(normalizedIds);
  const now = Date.now();
  const orderedVisibleItems = [
    ...normalizedIds
      .map((id) => visibleById.get(id))
      .filter((item): item is PendingChatItem => !!item),
    ...visibleItems.filter((item) => !orderedIds.has(item.id)),
  ].map((item) => ({
    ...item,
    updatedAt: now,
    sequence: nextPendingChatSequence(),
  }));
  const materializedItems = queue.filter((item) => item.materialized === true);

  pendingChatQueues.set(key, [...materializedItems, ...orderedVisibleItems]);
  persistPendingChatItems([...materializedItems, ...orderedVisibleItems]);
  const pendingMessages = syncPendingChatStatus(key);
  return { success: true, pendingMessages };
}

export function updatePendingChatMessage(
  sessionId: string,
  pendingMessageId: string,
  content: string
):
  | {
      success: true;
      pendingMessage: PendingChatMessageSnapshot;
      pendingMessages: PendingChatMessageSnapshot[];
    }
  | {
      success: false;
      error: string;
      pendingMessages: PendingChatMessageSnapshot[];
    } {
  const key = sessionId.trim();
  const nextContent = typeof content === "string" ? content.trim() : "";
  if (nextContent.length === 0) {
    return {
      success: false,
      error: "Pending message cannot be empty",
      pendingMessages: pendingChatSnapshots(key),
    };
  }

  const queue = pendingChatQueues.get(key) || [];
  const index = queue.findIndex(
    (item) => item.id === pendingMessageId && item.materialized !== true
  );
  if (index < 0) {
    return {
      success: false,
      error: "Pending message not found",
      pendingMessages: pendingChatSnapshots(key),
    };
  }

  const item = {
    ...queue[index],
    content: nextContent,
    request: {
      ...queue[index].request,
      message: nextContent,
    },
    updatedAt: Date.now(),
  };
  queue[index] = item;
  pendingChatQueues.set(key, queue);
  persistPendingChatItem(item);
  const pendingMessages = syncPendingChatStatus(key);
  return {
    success: true,
    pendingMessage: pendingChatSnapshot(item),
    pendingMessages,
  };
}

export function deletePendingChatMessage(
  sessionId: string,
  pendingMessageId: string
):
  | { success: true; pendingMessages: PendingChatMessageSnapshot[] }
  | {
      success: false;
      error: string;
      pendingMessages: PendingChatMessageSnapshot[];
    } {
  const key = sessionId.trim();
  const queue = pendingChatQueues.get(key) || [];
  const visibleIndex = queue.findIndex(
    (item) => item.id === pendingMessageId && item.materialized !== true
  );
  if (visibleIndex < 0) {
    return {
      success: false,
      error: "Pending message not found",
      pendingMessages: pendingChatSnapshots(key),
    };
  }

  const pendingMessages = removePendingChatQueueItem(key, pendingMessageId);
  rejectPendingChatCompletion(pendingMessageId, new Error("Pending chat message was deleted"));
  return { success: true, pendingMessages };
}
