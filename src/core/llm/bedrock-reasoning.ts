import {
  coerceReasoningEffort,
  normalizeReasoningEffort,
  usesAnthropicAdaptiveThinking,
} from "./reasoning";

interface BedrockReasoningContentBlock {
  reasoningContent?: {
    reasoningText?: {
      text?: string;
    };
  };
}

export function bedrockAnthropicReasoningFields(
  modelId: string,
  effortValue: unknown
): Record<string, unknown> | undefined {
  const effort = normalizeReasoningEffort(effortValue);
  if (!effort || !usesAnthropicAdaptiveThinking(modelId)) return undefined;
  return {
    thinking: { type: "adaptive" },
    output_config: { effort: coerceReasoningEffort(effort, "bedrock", modelId) },
  };
}

export function collectBedrockReasoningText(content: BedrockReasoningContentBlock[]): string[] {
  return content.flatMap((block) => {
    const text = block.reasoningContent?.reasoningText?.text?.trim();
    return text ? [text] : [];
  });
}
