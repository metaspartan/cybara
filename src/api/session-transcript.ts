import type { ChatMessage } from "./chat";

function messageIdentity(message: ChatMessage): string {
  return `${message.role}\u0000${message.content}`;
}

export function mergeSessionTranscriptMessages(
  persistedMessages: ChatMessage[],
  activeMessages: ChatMessage[]
): ChatMessage[] {
  if (persistedMessages.length === 0) return activeMessages;

  const compacted = activeMessages.some(
    (message) => message.role === "system" && message.content.includes("Context Summary")
  );
  if (compacted) {
    return mergePersistedFirst(persistedMessages, activeMessages);
  }

  return mergeActiveFirst(persistedMessages, activeMessages);
}

function mergePersistedFirst(
  persistedMessages: ChatMessage[],
  activeMessages: ChatMessage[]
): ChatMessage[] {
  const activeByIdentity = new Map<string, ChatMessage[]>();
  for (const message of activeMessages) {
    if (message.role !== "user" && message.role !== "assistant") continue;
    const identity = messageIdentity(message);
    const matches = activeByIdentity.get(identity) || [];
    matches.push(message);
    activeByIdentity.set(identity, matches);
  }

  const merged = persistedMessages.map((persisted) => {
    const matches = activeByIdentity.get(messageIdentity(persisted));
    const active = matches?.shift();
    if (!active) return persisted;
    return {
      ...persisted,
      ...active,
      content: persisted.content,
      timestamp: persisted.timestamp || active.timestamp,
    };
  });

  for (const matches of activeByIdentity.values()) {
    merged.push(...matches);
  }

  return merged;
}

function messageTimestamp(message: ChatMessage): number | null {
  if (!message.timestamp) return null;
  const parsed = Date.parse(
    message.timestamp.replace(" ", "T") + (message.timestamp.endsWith("Z") ? "" : "Z")
  );
  return Number.isFinite(parsed) ? parsed : null;
}

function mergeActiveFirst(
  persistedMessages: ChatMessage[],
  activeMessages: ChatMessage[]
): ChatMessage[] {
  const persistedByIdentity = new Map<string, ChatMessage[]>();
  for (const message of persistedMessages) {
    const matches = persistedByIdentity.get(messageIdentity(message)) || [];
    matches.push(message);
    persistedByIdentity.set(messageIdentity(message), matches);
  }

  const merged = activeMessages
    .filter((message) => message.role === "user" || message.role === "assistant")
    .map((active) => {
      const persisted = persistedByIdentity.get(messageIdentity(active))?.shift();
      if (!persisted) return active;
      return {
        ...persisted,
        ...active,
        content: active.content,
        timestamp: persisted.timestamp || active.timestamp,
      };
    });
  const persistedOnly = [...persistedByIdentity.values()].flat();
  if (persistedOnly.length === 0) return merged;

  return [...merged, ...persistedOnly]
    .map((message, index) => ({
      message,
      index,
      timestamp: messageTimestamp(message),
    }))
    .sort((left, right) => {
      if (
        left.timestamp === null ||
        right.timestamp === null ||
        left.timestamp === right.timestamp
      ) {
        return left.index - right.index;
      }
      return left.timestamp - right.timestamp;
    })
    .map((entry) => entry.message);
}
