import type { PendingChatMessage } from "@/lib/status-stream";

export function normalizePendingChatMessages(
  messages?: PendingChatMessage[]
): PendingChatMessage[] {
  return [...(messages || [])]
    .filter(
      (message) =>
        typeof message.id === "string" &&
        typeof message.content === "string" &&
        message.content.trim().length > 0
    )
    .sort((a, b) => (a.sequence || 0) - (b.sequence || 0) || a.createdAt - b.createdAt);
}

export function mergePendingChatMessages(
  serverMessages: PendingChatMessage[] | undefined,
  currentMessages: PendingChatMessage[],
  options?: {
    preserveOptimistic?: boolean;
    preserveAcknowledged?: boolean;
    materializedPendingIds?: ReadonlySet<string>;
  }
): PendingChatMessage[] {
  const normalizedServerMessages = normalizePendingChatMessages(serverMessages);
  if (
    options?.preserveOptimistic === false &&
    options.preserveAcknowledged !== true &&
    !options.materializedPendingIds
  ) {
    return normalizedServerMessages;
  }
  const serverIds = new Set(normalizedServerMessages.map((message) => message.id));
  const serverClientPendingIds = new Set(
    normalizedServerMessages
      .map((message) =>
        typeof message.clientPendingId === "string" ? message.clientPendingId.trim() : ""
      )
      .filter(Boolean)
  );
  const retainedMessages = currentMessages.filter((message) => {
    if (options?.materializedPendingIds?.has(message.id)) return false;
    if (serverIds.has(message.id)) return false;
    if (!message.id.startsWith("optimistic-")) {
      return options?.preserveAcknowledged === true;
    }
    if (options?.preserveOptimistic === false) return false;
    if (serverClientPendingIds.has(message.id)) return false;
    return !normalizedServerMessages.some((serverMessage) => {
      return (
        serverMessage.sessionId === message.sessionId && serverMessage.content === message.content
      );
    });
  });
  return normalizePendingChatMessages([...normalizedServerMessages, ...retainedMessages]);
}

export function materializedPendingChatIds(
  messages: Array<{ pending_chat_id?: string }>
): ReadonlySet<string> {
  return new Set(
    messages
      .map((message) =>
        typeof message.pending_chat_id === "string" ? message.pending_chat_id.trim() : ""
      )
      .filter(Boolean)
  );
}
