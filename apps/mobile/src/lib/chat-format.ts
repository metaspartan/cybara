import type { SessionMessageSummary } from "./api";

export type MessageContentPart =
  { type: "text"; content: string } | { type: "code"; language: string; content: string };

export type UnicodeTextRun = {
  type: "text" | "emoji" | "unicode";
  content: string;
};

export const MOBILE_VISIBLE_CHAT_MESSAGE_LIMIT = 80;

const EMOJI_SEQUENCE_PATTERN =
  /^(?:\p{Regional_Indicator}{2}|[#*0-9]\uFE0F?\u20E3|(?:[\p{Extended_Pictographic}\p{Emoji_Presentation}]\uFE0F?(?:\u200D[\p{Extended_Pictographic}\p{Emoji_Presentation}]\uFE0F?)*))$/u;

const UNICODE_TEXT_FALLBACK_PATTERN =
  /(?:\p{Regional_Indicator}{2}|[#*0-9]\uFE0F?\u20E3|(?:[\p{Extended_Pictographic}\p{Emoji_Presentation}]\uFE0F?(?:\u200D[\p{Extended_Pictographic}\p{Emoji_Presentation}]\uFE0F?)*)|(?:[A-Za-z0-9]\p{Mark}+)|[^\u0000-\u007F]+)/gu;

export function splitUnicodeTextRuns(content: string): UnicodeTextRun[] {
  const runs: UnicodeTextRun[] = [];
  UNICODE_TEXT_FALLBACK_PATTERN.lastIndex = 0;
  let cursor = 0;
  let match: RegExpExecArray | null;
  while ((match = UNICODE_TEXT_FALLBACK_PATTERN.exec(content))) {
    if (match.index > cursor) {
      runs.push({ type: "text", content: content.slice(cursor, match.index) });
    }
    const matched = match[0];
    runs.push({
      type: EMOJI_SEQUENCE_PATTERN.test(matched) ? "emoji" : "unicode",
      content: matched,
    });
    cursor = match.index + matched.length;
  }
  if (cursor < content.length) {
    runs.push({ type: "text", content: content.slice(cursor) });
  }
  return runs.length > 0 ? runs : [{ type: "text", content }];
}

export function hasUnicodeTextFallback(content: string): boolean {
  UNICODE_TEXT_FALLBACK_PATTERN.lastIndex = 0;
  return UNICODE_TEXT_FALLBACK_PATTERN.test(content);
}

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

export function latestVisibleChatMessages(
  messages: SessionMessageSummary[],
  limit = MOBILE_VISIBLE_CHAT_MESSAGE_LIMIT
): SessionMessageSummary[] {
  const visible: SessionMessageSummary[] = [];
  const boundedLimit = Math.max(1, Math.floor(limit));
  for (let index = messages.length - 1; index >= 0 && visible.length < boundedLimit; index -= 1) {
    const message = messages[index];
    if (message.role !== "system") {
      visible.push(message);
    }
  }
  return visible.reverse();
}

export function lastVisibleChatMessage(
  messages: SessionMessageSummary[]
): SessionMessageSummary | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role !== "system") return message;
  }
  return undefined;
}

export function chatIsWaitingForAssistant(
  messages: SessionMessageSummary[],
  sending: boolean
): boolean {
  return sending || lastVisibleChatMessage(messages)?.role === "user";
}
