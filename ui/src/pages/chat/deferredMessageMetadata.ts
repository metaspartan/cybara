import { chatApi } from "@/lib/api";
import type { ChatMessage } from "./chatModel";

const hydratedMessages = new Map<string, ChatMessage>();
const hydrationRequests = new Map<string, Promise<ChatMessage>>();

function toTimelineMessage(
  response: Awaited<ReturnType<typeof chatApi.getSessionMessage>>
): ChatMessage | null {
  const message = response.data;
  if (
    !response.success ||
    !message ||
    (message.role !== "user" && message.role !== "assistant" && message.role !== "system")
  ) {
    return null;
  }
  return { ...message, role: message.role };
}

export async function loadDeferredMessageMetadata(
  sessionId: string,
  message: ChatMessage
): Promise<ChatMessage> {
  const messageId = message.message_id?.trim();
  if (!message.metadata_deferred || !messageId) return message;
  const key = `${sessionId}\u0000${messageId}`;
  const cached = hydratedMessages.get(key);
  if (cached) return cached;
  const pending = hydrationRequests.get(key);
  if (pending) return pending;
  const request = chatApi
    .getSessionMessage(sessionId, messageId)
    .then((response) => {
      const hydrated = toTimelineMessage(response) ?? message;
      if (hydratedMessages.size >= 256) hydratedMessages.clear();
      hydratedMessages.set(key, hydrated);
      return hydrated;
    })
    .catch(() => ({ ...message, metadata_deferred: false }))
    .finally(() => hydrationRequests.delete(key));
  hydrationRequests.set(key, request);
  return request;
}
