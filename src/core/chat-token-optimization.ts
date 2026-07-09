import type { AgentMessage } from "./agent";
import { formatToolResultForModel } from "./llm/model-visible-format";
import { formatRecoverableToolOutputPreview } from "./tool-output-recovery";

export const TOOL_RESULT_PROMPT_MAX_CHARS = 2000;
export const TOOL_RESULT_FINAL_PROMPT_MAX_CHARS = 800;
export const HISTORICAL_TOOL_DUMP_MAX_CHARS = 1600;

interface PromptMessageLike {
  role: string;
  content: string;
}

function truncateForPrompt(
  value: string,
  maxChars: number,
  options: { sessionId?: string; toolName?: string; toolCallId?: string } = {}
): string {
  return formatRecoverableToolOutputPreview(value, maxChars, options).content;
}

function isToolExecutionDump(content: string): boolean {
  const normalized = content.trim();
  return (
    normalized.startsWith("Here are the results from the tool execution:") ||
    (normalized.length > HISTORICAL_TOOL_DUMP_MAX_CHARS * 2 &&
      /\bTool:\s*[A-Za-z0-9_.-]+[\s\S]{0,240}\bResult:/i.test(normalized))
  );
}

function summarizeToolDump(content: string): string {
  const toolNames = [...content.matchAll(/\bTool:\s*([A-Za-z0-9_.-]+)/g)]
    .map((match) => match[1])
    .filter((name): name is string => Boolean(name))
    .slice(0, 12);
  const uniqueNames = [...new Set(toolNames)];
  const toolLabel = uniqueNames.length > 0 ? uniqueNames.join(", ") : "tools";
  return `[Previous tool output omitted from active context. Tools run: ${toolLabel}. Full details remain in the chat transcript.]`;
}

export function compactChatContentForPrompt(message: PromptMessageLike): string {
  if (message.role === "assistant" && isToolExecutionDump(message.content)) {
    return summarizeToolDump(message.content);
  }
  return message.content;
}

export function compactMessagesForPrompt<T extends PromptMessageLike>(messages: T[]): T[] {
  return messages.map((message) => ({
    ...message,
    content: compactChatContentForPrompt(message),
  }));
}

export function buildMemoryFlushMessages(
  messages: PromptMessageLike[],
  flushPrompt: string
): AgentMessage[] {
  return [
    ...compactMessagesForPrompt(messages).map((message) => ({
      role: message.role as AgentMessage["role"],
      content: message.content,
    })),
    { role: "user", content: flushPrompt },
  ];
}

export function formatToolResultPromptBlock(
  toolName: string,
  result: unknown,
  options: { toonEnabled?: boolean; maxChars?: number; sessionId?: string; toolCallId?: string } = {}
): string {
  const content =
    typeof result === "string"
      ? result
      : formatToolResultForModel(result, { toonEnabled: options.toonEnabled });
  return `Tool: ${toolName}\nResult: ${truncateForPrompt(content, options.maxChars ?? TOOL_RESULT_PROMPT_MAX_CHARS, {
    sessionId: options.sessionId,
    toolName,
    toolCallId: options.toolCallId,
  })}`;
}
