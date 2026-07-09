import type { ChatMessage } from "./chat";

function messageIdentity(message: ChatMessage): string {
  return `${message.role}\u0000${message.content}`;
}

export function mergeSessionTranscriptMessages(
  persistedMessages: ChatMessage[],
  activeMessages: ChatMessage[]
): ChatMessage[] {
  if (persistedMessages.length === 0) return activeMessages;

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
