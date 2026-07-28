export interface QueuedChatHistoryMessage {
  role?: string;
  pending_chat_id?: string;
}

export interface QueuedChatSnapshot<T extends QueuedChatHistoryMessage> {
  messages: T[];
  pendingIds: string[];
}

export interface WaitForQueuedAssistantOptions<T extends QueuedChatHistoryMessage> {
  loadSnapshot: () => Promise<QueuedChatSnapshot<T> | null>;
  pendingId: string;
  pollIntervalMs?: number;
  signal?: AbortSignal;
  sleep?: (milliseconds: number) => Promise<void>;
}

export function findQueuedAssistantMessage<T extends QueuedChatHistoryMessage>(
  messages: T[],
  pendingId: string
): T | null {
  const userIndex = messages.findIndex(
    (message) => message.role === "user" && message.pending_chat_id === pendingId
  );
  if (userIndex < 0) return null;
  for (let index = userIndex + 1; index < messages.length; index += 1) {
    const message = messages[index];
    if (message?.role === "user") return null;
    if (message?.role === "assistant") return message;
  }
  return null;
}

export async function waitForQueuedAssistantMessage<T extends QueuedChatHistoryMessage>(
  options: WaitForQueuedAssistantOptions<T>
): Promise<T | null> {
  const sleep = options.sleep ?? Bun.sleep;
  const interval = Math.max(50, options.pollIntervalMs ?? 400);
  while (!options.signal?.aborted) {
    const snapshot = await options.loadSnapshot();
    if (snapshot) {
      const assistant = findQueuedAssistantMessage(snapshot.messages, options.pendingId);
      if (assistant) return assistant;
      const materialized = snapshot.messages.some(
        (message) => message.role === "user" && message.pending_chat_id === options.pendingId
      );
      if (!materialized && !snapshot.pendingIds.includes(options.pendingId)) return null;
    }
    await sleep(interval);
  }
  return null;
}
