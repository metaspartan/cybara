import {
  coerceReasoningEffort,
  normalizeReasoningEffort,
  normalizeReasoningModelId,
  supportedReasoningEfforts,
  supportsXHighReasoning,
  usesAnthropicAdaptiveThinking,
  usesProviderAdaptiveReasoning,
  type ReasoningEffort,
} from "../../../shared/reasoning-capabilities";
import { isKimiCodeProvider, kimiThinkingParams } from "./kimi-wire";

export {
  coerceReasoningEffort,
  normalizeReasoningEffort,
  normalizeReasoningModelId,
  supportedReasoningEfforts,
  supportsXHighReasoning,
  usesAnthropicAdaptiveThinking,
  usesProviderAdaptiveReasoning,
  type ReasoningEffort,
};

type ThinkingFormat = "openai" | "zai" | "qwen" | "deepseek" | "openrouter" | "together";

const PROVIDER_THINKING_FORMAT: Record<string, ThinkingFormat> = {
  "z.ai": "zai",
  "z.ai-coding": "zai",
  "qwen-portal": "qwen",
  alibaba: "qwen",
  "alibaba-coding-plan": "qwen",
  "qwen-token-plan": "qwen",
  "qwen-token-plan-cn": "qwen",
  deepseek: "deepseek",
  openrouter: "openrouter",
  together: "together",
};

export function openAICompatReasoningParams(
  providerId: string,
  effort: ReasoningEffort,
  model?: string | null
): Record<string, unknown> {
  if (isKimiCodeProvider(providerId)) return kimiThinkingParams(effort);
  if (usesProviderAdaptiveReasoning(providerId, model)) return {};
  const format = PROVIDER_THINKING_FORMAT[providerId] || "openai";
  switch (format) {
    case "zai":
    case "qwen":
      return { enable_thinking: true };
    case "deepseek":
      return { thinking: { type: "enabled" }, reasoning_effort: effort };
    case "openrouter":
      return { reasoning: { effort } };
    case "together":
      return { reasoning: { enabled: true }, reasoning_effort: effort };
    case "openai":
    default:
      return { reasoning_effort: effort };
  }
}

const BUDGET: Record<ReasoningEffort, number> = {
  minimal: 1024,
  low: 2048,
  medium: 8192,
  high: 16384,
  xhigh: 32768,
  max: 32768,
};

export function anthropicThinkingBudget(effort: ReasoningEffort, maxOutputTokens?: number): number {
  let budget = BUDGET[effort];
  if (typeof maxOutputTokens === "number" && maxOutputTokens > 0) {
    budget = Math.min(budget, Math.max(1024, maxOutputTokens - 1));
  }
  return budget;
}

export function googleThinkingBudget(effort: ReasoningEffort): number {
  return BUDGET[effort];
}

export function googleThinkingConfig(
  effort: ReasoningEffort,
  model?: string | null
): Record<string, unknown> {
  const modelId = normalizeReasoningModelId(model);
  const resolved = coerceReasoningEffort(effort, "google", modelId);
  if (/^gemini-3(?:\.\d+)?-/.test(modelId)) {
    return { includeThoughts: true, thinkingLevel: resolved };
  }
  return { includeThoughts: true };
}
