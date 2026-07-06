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
  options?: { preserveOptimistic?: boolean }
): PendingChatMessage[] {
  const normalizedServerMessages = normalizePendingChatMessages(serverMessages);
  if (options?.preserveOptimistic === false) {
    return normalizedServerMessages;
  }
  const serverClientPendingIds = new Set(
    normalizedServerMessages
      .map((message) =>
        typeof message.clientPendingId === "string" ? message.clientPendingId.trim() : ""
      )
      .filter(Boolean)
  );
  const optimisticMessages = currentMessages.filter((message) => {
    if (!message.id.startsWith("optimistic-")) return false;
    if (serverClientPendingIds.has(message.id)) return false;
    return !normalizedServerMessages.some(
      (serverMessage) =>
        serverMessage.sessionId === message.sessionId && serverMessage.content === message.content
    );
  });
  return normalizePendingChatMessages([...normalizedServerMessages, ...optimisticMessages]);
}
