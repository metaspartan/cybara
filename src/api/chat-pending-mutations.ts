import { normalizeChatImageAttachments } from "../core/chat/attachments";
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

export function getPendingChatMessageDetail(
  sessionId: string,
  pendingMessageId: string
):
  | { success: true; pendingMessage: PendingChatMessageSnapshot; images: unknown[] }
  | { success: false; error: string } {
  const key = sessionId.trim();
  const item = (pendingChatQueues.get(key) || []).find(
    (entry) => entry.id === pendingMessageId && entry.materialized !== true
  );
  if (!item) return { success: false, error: "Pending message not found" };
  return {
    success: true,
    pendingMessage: pendingChatSnapshot(item),
    images: item.request.images ? [...item.request.images] : [],
  };
}

export async function updatePendingChatMessage(
  sessionId: string,
  pendingMessageId: string,
  content: string,
  images?: unknown
): Promise<
  | {
      success: true;
      pendingMessage: PendingChatMessageSnapshot;
      pendingMessages: PendingChatMessageSnapshot[];
    }
  | {
      success: false;
      error: string;
      pendingMessages: PendingChatMessageSnapshot[];
    }
> {
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

  const existing = queue[index];
  const replacesImages = images !== undefined;
  if (replacesImages && images !== null && !Array.isArray(images)) {
    return {
      success: false,
      error: "Pending message images must be an array",
      pendingMessages: pendingChatSnapshots(key),
    };
  }
  const requestedImages = replacesImages ? await normalizeChatImageAttachments(images) : null;
  if (
    replacesImages &&
    Array.isArray(images) &&
    images.length > 0 &&
    (requestedImages?.length ?? 0) === 0
  ) {
    return {
      success: false,
      error: "No valid image attachments were provided",
      pendingMessages: pendingChatSnapshots(key),
    };
  }

  const baseRequest = {
    ...existing.request,
    message: nextContent,
  };
  if (requestedImages) delete baseRequest.images;
  const item = {
    ...existing,
    content: nextContent,
    request: requestedImages?.length ? { ...baseRequest, images: requestedImages } : baseRequest,
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
