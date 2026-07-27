import type { AgentMessage } from "../agent";
import type { GoogleContent, GooglePart } from "../agent-internals";
import type { AnthropicContentBlock, AnthropicMessage } from "../prompt-cache";
import {
  bedrockUserContent,
  hasImages,
  toAnthropicImageBlock,
  toGoogleImagePart,
  toOpenAIImageBlock,
} from "./image-blocks";
import { isKimiCodeProvider, normalizeKimiAssistantToolMessage } from "./kimi-wire";

export interface BedrockHistoryMessage {
  role: "user" | "assistant";
  content: Array<Record<string, unknown>>;
}

function appendAnthropicMessage(
  messages: AnthropicMessage[],
  role: AnthropicMessage["role"],
  content: AnthropicContentBlock[]
): void {
  if (content.length === 0) return;
  const previous = messages.at(-1);
  if (previous?.role === role && Array.isArray(previous.content)) {
    previous.content.push(...content);
    return;
  }
  messages.push({ role, content });
}

function appendGoogleContent(
  contents: GoogleContent[],
  role: "user" | "model",
  parts: GooglePart[]
): void {
  if (parts.length === 0) return;
  const previous = contents.at(-1);
  if (previous?.role === role && Array.isArray(previous.parts)) {
    previous.parts.push(...parts);
    return;
  }
  contents.push({ role, parts });
}

function appendBedrockMessage(
  messages: BedrockHistoryMessage[],
  role: BedrockHistoryMessage["role"],
  content: Array<Record<string, unknown>>
): void {
  if (content.length === 0) return;
  const previous = messages.at(-1);
  if (previous?.role === role) {
    previous.content.push(...content);
    return;
  }
  messages.push({ role, content });
}

function toolNamesById(messages: AgentMessage[]): Map<string, string> {
  const names = new Map<string, string>();
  for (const message of messages) {
    for (const toolCall of message.tool_calls ?? []) {
      names.set(toolCall.id, toolCall.name);
    }
  }
  return names;
}

function objectToolResponse(content: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(content);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return { result: parsed };
  } catch {
    return { result: content };
  }
}

export function toAnthropicHistory(messages: AgentMessage[]): AnthropicMessage[] {
  const history: AnthropicMessage[] = [];
  const toolNames = toolNamesById(messages);

  for (const message of messages) {
    if (message.role === "system") continue;

    if (message.role === "assistant") {
      const content: AnthropicContentBlock[] = [];
      if (message.content.trim()) content.push({ type: "text", text: message.content });
      for (const toolCall of message.tool_calls ?? []) {
        content.push({
          type: "tool_use",
          id: toolCall.id,
          name: toolCall.name,
          input: toolCall.arguments,
        });
      }
      appendAnthropicMessage(history, "assistant", content);
      continue;
    }

    if (message.role === "tool") {
      if (message.tool_call_id && toolNames.has(message.tool_call_id)) {
        appendAnthropicMessage(history, "user", [
          {
            type: "tool_result",
            tool_use_id: message.tool_call_id,
            content: message.content,
          },
        ]);
      } else if (message.content.trim()) {
        appendAnthropicMessage(history, "user", [{ type: "text", text: message.content }]);
      }
      continue;
    }

    const content: AnthropicContentBlock[] = [];
    if (message.content.trim()) content.push({ type: "text", text: message.content });
    if (hasImages(message.images)) {
      content.push(
        ...message.images.map((image) => toAnthropicImageBlock(image) as AnthropicContentBlock)
      );
    }
    appendAnthropicMessage(history, "user", content);
  }

  return history;
}

export function toGoogleHistory(messages: AgentMessage[]): GoogleContent[] {
  const history: GoogleContent[] = [];
  const toolNames = toolNamesById(messages);

  for (const message of messages) {
    if (message.role === "system") continue;

    if (message.role === "assistant") {
      const parts: GooglePart[] = [];
      if (message.content.trim()) parts.push({ text: message.content });
      for (const toolCall of message.tool_calls ?? []) {
        parts.push({
          functionCall: {
            name: toolCall.name,
            args: toolCall.arguments,
          },
        });
      }
      appendGoogleContent(history, "model", parts);
      continue;
    }

    if (message.role === "tool") {
      const toolName = message.tool_call_id ? toolNames.get(message.tool_call_id) : undefined;
      if (toolName) {
        appendGoogleContent(history, "user", [
          {
            functionResponse: {
              name: toolName,
              response: objectToolResponse(message.content),
            },
          },
        ]);
      } else if (message.content.trim()) {
        appendGoogleContent(history, "user", [{ text: message.content }]);
      }
      continue;
    }

    const parts: GooglePart[] = [];
    if (message.content.trim()) parts.push({ text: message.content });
    if (hasImages(message.images)) {
      for (const image of message.images) {
        const imagePart = toGoogleImagePart(image);
        if (imagePart) parts.push(imagePart as GooglePart);
      }
    }
    appendGoogleContent(history, "user", parts);
  }

  return history;
}

export function toBedrockHistory(messages: AgentMessage[]): BedrockHistoryMessage[] {
  const history: BedrockHistoryMessage[] = [];
  const toolNames = toolNamesById(messages);

  for (const message of messages) {
    if (message.role === "system") continue;

    if (message.role === "assistant") {
      const content: Array<Record<string, unknown>> = [];
      if (message.content.trim()) content.push({ text: message.content });
      for (const toolCall of message.tool_calls ?? []) {
        content.push({
          toolUse: {
            toolUseId: toolCall.id,
            name: toolCall.name,
            input: toolCall.arguments,
          },
        });
      }
      appendBedrockMessage(history, "assistant", content);
      continue;
    }

    if (message.role === "tool") {
      if (message.tool_call_id && toolNames.has(message.tool_call_id)) {
        appendBedrockMessage(history, "user", [
          {
            toolResult: {
              toolUseId: message.tool_call_id,
              content: [{ json: objectToolResponse(message.content) }],
            },
          },
        ]);
      } else if (message.content.trim()) {
        appendBedrockMessage(history, "user", [{ text: message.content }]);
      }
      continue;
    }

    appendBedrockMessage(history, "user", bedrockUserContent(message.content, message.images));
  }

  return history;
}

export function toOpenAIChatMessage(
  message: AgentMessage,
  providerConfig?: string
): Record<string, unknown> {
  if (message.role === "user" && hasImages(message.images)) {
    return {
      role: "user",
      content: [
        ...(message.content ? [{ type: "text", text: message.content }] : []),
        ...message.images.map(toOpenAIImageBlock),
      ],
    };
  }
  if (message.role === "assistant" && message.tool_calls?.length) {
    const converted = {
      role: "assistant",
      content: message.content || null,
      tool_calls: message.tool_calls.map((toolCall) => ({
        id: toolCall.id,
        type: "function",
        function: {
          name: toolCall.name,
          arguments: JSON.stringify(toolCall.arguments),
        },
      })),
    };
    return isKimiCodeProvider(providerConfig)
      ? normalizeKimiAssistantToolMessage(converted)
      : converted;
  }
  if (message.role === "tool" && message.tool_call_id) {
    return {
      role: "tool",
      content: message.content,
      tool_call_id: message.tool_call_id,
    };
  }
  return { role: message.role, content: message.content };
}

export function toOpenAIChatHistory(
  messages: AgentMessage[],
  providerConfig?: string
): Array<Record<string, unknown>> {
  const systemMessages = messages.filter((message) => message.role === "system");
  const chatMessages = messages.filter((message) => message.role !== "system");
  return [...systemMessages, ...chatMessages].map((message) =>
    toOpenAIChatMessage(message, providerConfig)
  );
}
