import type { ChatMessage } from "./chatModel";

export function isVisibleChatTranscriptMessage(
  message: Pick<ChatMessage, "role" | "content">
): boolean {
  if (message.role === "system") return false;
  return !(
    message.role === "user" && message.content.trimStart().startsWith("[autonomous goal iteration")
  );
}
