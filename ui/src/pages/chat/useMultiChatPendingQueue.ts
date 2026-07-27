import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo, useState } from "react";
import { chatApi } from "@/lib/api";
import type { PendingChatMessage, StatusActivity } from "@/lib/status-stream";
import { useUIStore } from "@/stores/uiStore";
import { normalizePendingChatMessages } from "./pendingQueueState";

const MULTI_CHAT_PENDING_QUERY_KEY = "multi-chat-pending-messages";

function showQueueError(error: unknown, fallback: string): void {
  useUIStore.getState().addToast("error", error instanceof Error ? error.message : fallback);
}

export function multiChatPendingQueryKey(sessionId: string): readonly [string, string] {
  return [MULTI_CHAT_PENDING_QUERY_KEY, sessionId];
}

interface MultiChatPendingQueueOptions {
  activities: StatusActivity[];
  enabled: boolean;
  onRefresh: () => void;
  sessionId: string;
}

interface MultiChatPendingQueueController {
  messages: PendingChatMessage[];
  mutatingMessageId: string | null;
  steeringMessageId: string | null;
  replaceMessages: (messages?: PendingChatMessage[]) => void;
  deleteMessage: (pendingMessageId: string) => Promise<void>;
  reorderMessages: (orderedIds: string[]) => Promise<void>;
  steerMessage: (pendingMessageId: string) => Promise<void>;
  updateMessage: (pendingMessageId: string, content: string) => Promise<void>;
}

export function useMultiChatPendingQueue({
  activities,
  enabled,
  onRefresh,
  sessionId,
}: MultiChatPendingQueueOptions): MultiChatPendingQueueController {
  const queryClient = useQueryClient();
  const [steeringMessageId, setSteeringMessageId] = useState<string | null>(null);
  const [mutatingMessageId, setMutatingMessageId] = useState<string | null>(null);
  const queryKey = useMemo(() => multiChatPendingQueryKey(sessionId), [sessionId]);
  const query = useQuery({
    queryKey,
    enabled,
    queryFn: async (): Promise<PendingChatMessage[]> => {
      const response = await chatApi.getPendingMessages(sessionId);
      if (!response.success || !response.data) {
        throw new Error(response.error || "Failed to load queued messages");
      }
      return normalizePendingChatMessages(response.data.pendingMessages);
    },
    staleTime: 5_000,
  });

  const replaceMessages = useCallback(
    (messages?: PendingChatMessage[]): void => {
      if (!messages) return;
      queryClient.setQueryData(queryKey, normalizePendingChatMessages(messages));
    },
    [queryClient, queryKey]
  );

  const refresh = useCallback((): void => {
    onRefresh();
    void queryClient.invalidateQueries({ queryKey });
  }, [onRefresh, queryClient, queryKey]);

  const steerMessage = useCallback(
    async (pendingMessageId: string): Promise<void> => {
      setSteeringMessageId(pendingMessageId);
      try {
        const response = await chatApi.steerPendingMessage(sessionId, pendingMessageId, {
          processActivities: activities.map((activity) => ({
            id: activity.id,
            phase: activity.phase,
            text: activity.text,
            timestamp: activity.timestamp,
            toolName: activity.toolName,
            toolCallId: activity.toolCallId,
            sandboxProvider: activity.sandboxProvider,
          })),
        });
        if (!response.success || !response.data?.success) {
          throw new Error(response.error || response.data?.error || "Failed to steer message");
        }
        replaceMessages(response.data.pendingMessages);
        refresh();
      } catch (error) {
        showQueueError(error, "Failed to steer message");
      } finally {
        setSteeringMessageId(null);
      }
    },
    [activities, refresh, replaceMessages, sessionId]
  );

  const reorderMessages = useCallback(
    async (orderedIds: string[]): Promise<void> => {
      const previous = query.data || [];
      const byId = new Map(previous.map((message) => [message.id, message]));
      const ordered = orderedIds
        .map((id) => byId.get(id))
        .filter((message): message is PendingChatMessage => !!message);
      if (ordered.length === previous.length) queryClient.setQueryData(queryKey, ordered);
      try {
        const response = await chatApi.reorderPendingMessages(sessionId, orderedIds);
        if (!response.success || !response.data?.success) {
          throw new Error(response.error || response.data?.error || "Failed to reorder messages");
        }
        replaceMessages(response.data.pendingMessages);
      } catch (error) {
        queryClient.setQueryData(queryKey, previous);
        showQueueError(error, "Failed to reorder messages");
      }
    },
    [query.data, queryClient, queryKey, replaceMessages, sessionId]
  );

  const updateMessage = useCallback(
    async (pendingMessageId: string, content: string): Promise<void> => {
      setMutatingMessageId(pendingMessageId);
      try {
        const response = await chatApi.updatePendingMessage(sessionId, pendingMessageId, content);
        if (!response.success || !response.data?.success) {
          throw new Error(response.error || response.data?.error || "Failed to update message");
        }
        replaceMessages(response.data.pendingMessages);
      } catch (error) {
        showQueueError(error, "Failed to update message");
      } finally {
        setMutatingMessageId(null);
      }
    },
    [replaceMessages, sessionId]
  );

  const deleteMessage = useCallback(
    async (pendingMessageId: string): Promise<void> => {
      setMutatingMessageId(pendingMessageId);
      try {
        const response = await chatApi.deletePendingMessage(sessionId, pendingMessageId);
        if (!response.success || !response.data?.success) {
          throw new Error(response.error || response.data?.error || "Failed to delete message");
        }
        replaceMessages(response.data.pendingMessages);
      } catch (error) {
        showQueueError(error, "Failed to delete message");
      } finally {
        setMutatingMessageId(null);
      }
    },
    [replaceMessages, sessionId]
  );

  return {
    messages: query.data || [],
    mutatingMessageId,
    steeringMessageId,
    replaceMessages,
    deleteMessage,
    reorderMessages,
    steerMessage,
    updateMessage,
  };
}
