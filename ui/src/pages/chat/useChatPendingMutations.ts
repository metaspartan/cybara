import type { LoadedChatSession } from "@/hooks/useChat";
import { chatApi } from "@/lib/api";
import {
  finalizeCompletedActivities,
  type LiveActivityItem,
  mergeActivityLists,
} from "@/lib/chatActivities";
import type { PendingChatMessage } from "@/lib/status-stream";
import type { SessionContextUsage, SessionTokenUsage } from "@/types";
import { type Dispatch, type RefObject, type SetStateAction, useCallback, useState } from "react";
import {
  buildPreSteeringActivityMessage,
  type ChatMessage,
  type PendingProcessCapture,
  pruneCanonicalizedLiveActivities,
} from "./chatModel";
import { clearCachedOptimisticPendingMessages } from "./pendingQueueCache";
import { normalizePendingChatMessages } from "./pendingQueueState";

interface UseChatPendingMutationsOptions {
  sessionId: string | null;
  pendingMessages: PendingChatMessage[];
  setPendingMessages: Dispatch<SetStateAction<PendingChatMessage[]>>;
  liveActivities: LiveActivityItem[];
  setLiveActivities: Dispatch<SetStateAction<LiveActivityItem[]>>;
  runActivityBufferRef: RefObject<LiveActivityItem[]>;
  pendingProcessCaptureRef: RefObject<PendingProcessCapture | null>;
  loadSteeredSession: (sessionId: string) => Promise<LoadedChatSession>;
  loadSession: (
    sessionId: string,
    messages: ChatMessage[],
    workspaceDir?: string | null,
    preserveReferenceTail?: boolean
  ) => void;
  syncSessionAgentSelection: (agentId: string | null | undefined) => void;
  setSessionContextUsage: Dispatch<SetStateAction<SessionContextUsage | null>>;
  setSessionTokenUsage: Dispatch<SetStateAction<SessionTokenUsage | null>>;
}

interface ChatPendingMutationsController {
  steeringMessageId: string | null;
  pendingMessageMutationId: string | null;
  handleSteerPendingMessage: (pendingMessageId: string) => Promise<void>;
  handleReorderPendingMessages: (orderedIds: string[]) => Promise<void>;
  handleUpdatePendingMessage: (pendingMessageId: string, content: string) => Promise<void>;
  handleDeletePendingMessage: (pendingMessageId: string) => Promise<void>;
}

export function useChatPendingMutations({
  sessionId,
  pendingMessages,
  setPendingMessages,
  liveActivities,
  setLiveActivities,
  runActivityBufferRef,
  pendingProcessCaptureRef,
  loadSteeredSession,
  loadSession,
  syncSessionAgentSelection,
  setSessionContextUsage,
  setSessionTokenUsage,
}: UseChatPendingMutationsOptions): ChatPendingMutationsController {
  const [steeringMessageId, setSteeringMessageId] = useState<string | null>(null);
  const [pendingMessageMutationId, setPendingMessageMutationId] = useState<string | null>(null);

  const handleSteerPendingMessage = useCallback(
    async (pendingMessageId: string) => {
      if (!sessionId) return;
      setSteeringMessageId(pendingMessageId);
      const preSteerActivities = mergeActivityLists(runActivityBufferRef.current, liveActivities);
      const preSteerProcessActivities = finalizeCompletedActivities(preSteerActivities)
        .filter((activity) => {
          const text = activity.text.trim().toLowerCase();
          return (
            text.length > 0 &&
            text !== "steering to follow-up..." &&
            text !== "starting queued follow-up"
          );
        })
        .map((activity) => ({
          id: activity.id,
          phase: activity.phase,
          text: activity.text,
          timestamp: activity.timestamp,
          toolName: activity.toolName,
          toolCallId: activity.toolCallId,
          sandboxProvider: activity.sandboxProvider,
        }));
      try {
        const response = await chatApi.steerPendingMessage(sessionId, pendingMessageId, {
          processActivities: preSteerProcessActivities,
        });
        if (response.success && response.data) {
          setPendingMessages(normalizePendingChatMessages(response.data.pendingMessages));
          if (response.data.pendingMessages.length === 0) {
            clearCachedOptimisticPendingMessages(sessionId);
          }
          let materializedMessages: ChatMessage[] = [];
          try {
            const refreshed = await loadSteeredSession(sessionId);
            if (refreshed?.messagesList) {
              materializedMessages = refreshed.messagesList as ChatMessage[];
              loadSession(
                sessionId,
                materializedMessages,
                (refreshed as { workspace_dir?: string | null }).workspace_dir || null
              );
              syncSessionAgentSelection(
                (refreshed as { agent_id?: string | null }).agent_id || null
              );
              setSessionContextUsage(
                (refreshed as { contextUsage?: SessionContextUsage | null }).contextUsage || null
              );
              setSessionTokenUsage(
                (refreshed as { tokenUsage?: SessionTokenUsage | null }).tokenUsage || null
              );
            }
          } catch (error) {
            console.error("Failed to refresh steered chat session:", error);
          }
          if (materializedMessages.length === 0) {
            const steeredMessage = response.data.message as ChatMessage;
            const preSteerMessage =
              (response.data.interruptedMessage as ChatMessage | undefined) ||
              buildPreSteeringActivityMessage(steeredMessage, preSteerActivities);
            materializedMessages = [preSteerMessage, steeredMessage].filter(
              (message): message is ChatMessage => !!message
            );
          }
          runActivityBufferRef.current = pruneCanonicalizedLiveActivities(
            materializedMessages,
            runActivityBufferRef.current
          );
          if (pendingProcessCaptureRef.current) {
            pendingProcessCaptureRef.current = {
              ...pendingProcessCaptureRef.current,
              activities: pruneCanonicalizedLiveActivities(
                materializedMessages,
                pendingProcessCaptureRef.current.activities
              ),
            };
          }
          setLiveActivities((previous) =>
            pruneCanonicalizedLiveActivities(materializedMessages, previous)
          );
          return;
        }
        console.error("Failed to steer pending message:", response.error || response.data?.error);
      } finally {
        setSteeringMessageId(null);
      }
    },
    [loadSession, loadSteeredSession, liveActivities, sessionId, syncSessionAgentSelection]
  );

  const handleReorderPendingMessages = useCallback(
    async (orderedIds: string[]) => {
      if (!sessionId || orderedIds.length === 0) return;
      const previousMessages = pendingMessages;
      const byId = new Map(previousMessages.map((message) => [message.id, message]));
      const orderedMessages = orderedIds
        .map((id) => byId.get(id))
        .filter((message): message is PendingChatMessage => !!message);
      if (orderedMessages.length === previousMessages.length) {
        setPendingMessages(orderedMessages);
      }
      try {
        const response = await chatApi.reorderPendingMessages(sessionId, orderedIds);
        if (response.success && response.data?.success) {
          setPendingMessages(normalizePendingChatMessages(response.data.pendingMessages));
          return;
        }
        setPendingMessages(previousMessages);
        console.error(
          "Failed to reorder pending messages:",
          response.error || response.data?.error
        );
      } catch (error) {
        setPendingMessages(previousMessages);
        console.error("Failed to reorder pending messages:", error);
      }
    },
    [pendingMessages, sessionId]
  );

  const handleUpdatePendingMessage = useCallback(
    async (pendingMessageId: string, content: string) => {
      if (!sessionId || pendingMessageId.startsWith("optimistic-")) return;
      const nextContent = content.trim();
      if (!nextContent) return;
      const previousMessages = pendingMessages;
      const now = Date.now();
      setPendingMessages((current) =>
        normalizePendingChatMessages(
          current.map((message) =>
            message.id === pendingMessageId
              ? { ...message, content: nextContent, updatedAt: now }
              : message
          )
        )
      );
      setPendingMessageMutationId(pendingMessageId);
      try {
        const response = await chatApi.updatePendingMessage(
          sessionId,
          pendingMessageId,
          nextContent
        );
        if (response.success && response.data?.success) {
          setPendingMessages(normalizePendingChatMessages(response.data.pendingMessages));
          return;
        }
        setPendingMessages(previousMessages);
        console.error("Failed to update pending message:", response.error || response.data?.error);
      } catch (error) {
        setPendingMessages(previousMessages);
        console.error("Failed to update pending message:", error);
      } finally {
        setPendingMessageMutationId(null);
      }
    },
    [pendingMessages, sessionId]
  );

  const handleDeletePendingMessage = useCallback(
    async (pendingMessageId: string) => {
      if (!sessionId || pendingMessageId.startsWith("optimistic-")) return;
      const previousMessages = pendingMessages;
      setPendingMessages((current) => current.filter((message) => message.id !== pendingMessageId));
      setPendingMessageMutationId(pendingMessageId);
      try {
        const response = await chatApi.deletePendingMessage(sessionId, pendingMessageId);
        if (response.success && response.data?.success) {
          setPendingMessages(normalizePendingChatMessages(response.data.pendingMessages));
          return;
        }
        setPendingMessages(previousMessages);
        console.error("Failed to delete pending message:", response.error || response.data?.error);
      } catch (error) {
        setPendingMessages(previousMessages);
        console.error("Failed to delete pending message:", error);
      } finally {
        setPendingMessageMutationId(null);
      }
    },
    [pendingMessages, sessionId]
  );

  return {
    steeringMessageId,
    pendingMessageMutationId,
    handleSteerPendingMessage,
    handleReorderPendingMessages,
    handleUpdatePendingMessage,
    handleDeletePendingMessage,
  };
}
