import {
  anthropicThinkingBudget,
  coerceReasoningEffort,
  normalizeReasoningEffort,
  usesAnthropicAdaptiveThinking,
  usesProviderAdaptiveReasoning,
} from "./reasoning";

export interface AnthropicToolChoiceContext {
  requiredToolName?: string;
  requireToolUse?: boolean;
}

const ANTHROPIC_NATIVE_1M_MODEL =
  /claude-(?:(?:opus|sonnet|fable|mythos)-5|(?:opus|sonnet)-4[-.](?:6|8))(?:-|$)/;

function removeAnthropicSamplingOptions(requestBody: Record<string, unknown>): void {
  delete requestBody.temperature;
  delete requestBody.top_p;
  delete requestBody.top_k;
}

export function shouldSendAnthropicContext1mBeta(modelId: string, requested: boolean): boolean {
  if (!requested) return false;
  return !ANTHROPIC_NATIVE_1M_MODEL.test(modelId.trim().toLowerCase());
}

export function applyAnthropicReasoningOptions(
  requestBody: Record<string, unknown>,
  providerId: string,
  modelId: string,
  maxOutputTokens: number,
  modelParams?: Record<string, unknown>
): void {
  if (usesProviderAdaptiveReasoning(providerId, modelId)) {
    requestBody.thinking = { type: "adaptive" };
    removeAnthropicSamplingOptions(requestBody);
    return;
  }

  const effort = normalizeReasoningEffort(modelParams?.reasoning_effort);
  if (!effort) return;

  const resolvedEffort = coerceReasoningEffort(effort, providerId, modelId);
  if (usesAnthropicAdaptiveThinking(modelId)) {
    requestBody.thinking = { type: "adaptive", display: "summarized" };
    requestBody.output_config = { effort: resolvedEffort };
  } else {
    requestBody.thinking = {
      type: "enabled",
      budget_tokens: anthropicThinkingBudget(resolvedEffort, maxOutputTokens),
    };
  }
  removeAnthropicSamplingOptions(requestBody);
}

export function resolveAnthropicToolChoice(
  toolNames: string[],
  context?: AnthropicToolChoiceContext
): Record<string, string> | undefined {
  if (toolNames.length === 0) return undefined;
  if (context?.requireToolUse !== true) return { type: "auto" };

  const requiredToolName = context.requiredToolName?.trim();
  if (requiredToolName && toolNames.includes(requiredToolName)) {
    return { type: "tool", name: requiredToolName };
  }
  return { type: "any" };
}

export function collectAnthropicThinkingText(
  content: Array<{ thinking?: string; text?: string; type: string }> | undefined
): string[] {
  if (!content) return [];
  return content
    .filter((block) => block.type === "thinking")
    .map((block) => block.thinking ?? block.text ?? "")
    .filter((text) => text.trim().length > 0);
}
