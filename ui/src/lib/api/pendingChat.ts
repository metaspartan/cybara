import { fetchApi } from "@/lib/api-client";
import type { PendingChatMessage } from "@/lib/status-stream";
import type { ChatMessage } from "@/types";

export type ChatProcessActivityPayload = Array<{
  id?: string;
  phase?: "start" | "result" | "error" | "blocked";
  text?: string;
  timestamp?: number | string;
  toolName?: string;
  toolCallId?: string;
  sandboxProvider?: string;
}>;

export interface PendingMutationResponse {
  success: boolean;
  pendingMessage?: PendingChatMessage;
  pendingMessages?: PendingChatMessage[];
  error?: string;
}

function pendingBase(sessionId: string): string {
  return `/chat/sessions/${sessionId}/pending`;
}

export function listPendingMessages(sessionId: string) {
  return fetchApi<{ sessionId: string; pendingMessages: PendingChatMessage[] }>(
    pendingBase(sessionId)
  );
}

export function getPendingMessage(sessionId: string, pendingMessageId: string) {
  return fetchApi<PendingMutationResponse & { images?: unknown[] }>(
    `${pendingBase(sessionId)}/${pendingMessageId}`
  );
}

export function reorderPendingMessages(sessionId: string, pendingMessageIds: string[]) {
  return fetchApi<PendingMutationResponse>(`${pendingBase(sessionId)}/reorder`, {
    method: "POST",
    body: JSON.stringify({ pendingMessageIds }),
  });
}

export function updatePendingMessage(
  sessionId: string,
  pendingMessageId: string,
  content: string,
  images?: unknown[]
) {
  return fetchApi<PendingMutationResponse>(`${pendingBase(sessionId)}/${pendingMessageId}`, {
    method: "PATCH",
    body: JSON.stringify(images ? { content, images } : { content }),
  });
}

export function deletePendingMessage(sessionId: string, pendingMessageId: string) {
  return fetchApi<PendingMutationResponse>(`${pendingBase(sessionId)}/${pendingMessageId}`, {
    method: "DELETE",
  });
}

export function steerPendingMessage(
  sessionId: string,
  pendingMessageId: string,
  options?: { processActivities?: ChatProcessActivityPayload }
) {
  return fetchApi<
    PendingMutationResponse & {
      message?: ChatMessage;
      interruptedMessage?: ChatMessage;
      steeringQueued?: boolean;
    }
  >(`${pendingBase(sessionId)}/${pendingMessageId}/steer`, {
    method: "POST",
    body: JSON.stringify({ processActivities: options?.processActivities || [] }),
  });
}

export function stopSession(sessionId: string) {
  return fetchApi<{
    success: boolean;
    stopped: boolean;
    sessionId: string;
    error?: string;
  }>(`/chat/sessions/${sessionId}/stop`, { method: "POST" });
}
