import type { SessionMessageSummary } from "./api";

export type MessageContentPart =
  { type: "text"; content: string } | { type: "code"; language: string; content: string };

export function splitMessageContent(content: string): MessageContentPart[] {
  const parts: MessageContentPart[] = [];
  const regex = /```([^\n`]*)\n?([\s\S]*?)```/g;
  let cursor = 0;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(content))) {
    if (match.index > cursor) {
      parts.push({ type: "text", content: content.slice(cursor, match.index) });
    }
    parts.push({
      type: "code",
      language: match[1]?.trim() || "code",
      content: match[2] || "",
    });
    cursor = match.index + match[0].length;
  }
  if (cursor < content.length) {
    parts.push({ type: "text", content: content.slice(cursor) });
  }
  return parts.length > 0 ? parts : [{ type: "text", content }];
}

export function visibleChatMessages(messages: SessionMessageSummary[]): SessionMessageSummary[] {
  return messages.filter((message) => message.role !== "system");
}

export function chatIsWaitingForAssistant(
  messages: SessionMessageSummary[],
  sending: boolean
): boolean {
  const visible = visibleChatMessages(messages);
  return sending || visible[visible.length - 1]?.role === "user";
}
