import type { ChatMessage } from "./chatModel";

export function isVisibleChatTranscriptMessage(
  message: Pick<ChatMessage, "role" | "content">
): boolean {
  return message.role !== "system";
}

export function goalIterationNumber(message: Pick<ChatMessage, "role" | "content">): number | null {
  if (message.role !== "user") return null;
  const match = message.content.trimStart().match(/^\[autonomous goal iteration (\d+)\]/i);
  if (!match) return null;
  const iteration = Number.parseInt(match[1] ?? "", 10);
  return Number.isFinite(iteration) && iteration > 0 ? iteration : null;
}
