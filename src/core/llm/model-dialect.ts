import {
  normalizeAnthropicToolUses,
  normalizeOpenAIToolCalls,
  sanitizeAssistantContent,
  type AnthropicCompatContentBlock,
  type NormalizedAnthropicToolUse,
  type NormalizedOpenAIToolCall,
  type OpenAICompatMessage,
} from "./text-tool-calls";

export type ModelDialect =
  | "openai"
  | "anthropic"
  | "glm"
  | "kimi"
  | "minimax"
  | "qwen"
  | "harmony"
  | "xml";

export function detectModelDialect(provider: string, model: string): ModelDialect {
  const value = `${provider} ${model}`.toLowerCase();
  if (/anthropic|claude/.test(value)) return "anthropic";
  if (/glm|z\.ai|zai/.test(value)) return "glm";
  if (/kimi|moonshot/.test(value)) return "kimi";
  if (/minimax/.test(value)) return "minimax";
  if (/qwen|dashscope|alibaba/.test(value)) return "qwen";
  if (/harmony|gpt-oss/.test(value)) return "harmony";
  if (/xml/.test(value)) return "xml";
  return "openai";
}

function resolveToolName(name: string, allowedToolNames: Set<string>): string {
  if (allowedToolNames.has(name)) return name;
  const candidates = [
    name.replace(/^(?:functions?|tools?)\./i, ""),
    name.replace(/^(?:functions?|tools?)[:/]/i, ""),
    name.replaceAll("-", "_"),
  ];
  for (const candidate of candidates) {
    if (allowedToolNames.has(candidate)) return candidate;
  }
  const lower = name.toLowerCase();
  return [...allowedToolNames].find((candidate) => candidate.toLowerCase() === lower) || name;
}

export function normalizeModelToolCalls(input: {
  provider: string;
  model: string;
  message: OpenAICompatMessage;
  iteration: number;
  allowedToolNames: Set<string>;
}): NormalizedOpenAIToolCall[] {
  detectModelDialect(input.provider, input.model);
  return normalizeOpenAIToolCalls(input.message, input.iteration, input.allowedToolNames).map(
    (call) => ({
      ...call,
      name: resolveToolName(call.name, input.allowedToolNames),
    })
  );
}

export function normalizeAnthropicModelToolUses(input: {
  provider: string;
  model: string;
  content: AnthropicCompatContentBlock[] | undefined;
  iteration: number;
  allowedToolNames: Set<string>;
}): NormalizedAnthropicToolUse[] {
  detectModelDialect(input.provider, input.model);
  return normalizeAnthropicToolUses(input.content, input.iteration, input.allowedToolNames).map(
    (call) => ({
      ...call,
      name: resolveToolName(call.name, input.allowedToolNames),
    })
  );
}

export function normalizeModelAssistantText(
  provider: string,
  model: string,
  content: string
): string {
  detectModelDialect(provider, model);
  return sanitizeAssistantContent(content);
}
