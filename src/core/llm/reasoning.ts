export type ReasoningEffort = "minimal" | "low" | "medium" | "high" | "xhigh";

const VALID = new Set<ReasoningEffort>(["minimal", "low", "medium", "high", "xhigh"]);

export function normalizeReasoningEffort(value: unknown): ReasoningEffort | null {
  if (typeof value !== "string") return null;
  const v = value.trim().toLowerCase();
  if (VALID.has(v as ReasoningEffort)) return v as ReasoningEffort;
  if (v === "max") return "xhigh";
  if (v === "none" || v === "off" || v === "false") return null;
  return null;
}

type ThinkingFormat = "openai" | "zai" | "qwen" | "deepseek" | "openrouter" | "together";

const PROVIDER_THINKING_FORMAT: Record<string, ThinkingFormat> = {
  "z.ai": "zai",
  "z.ai-coding": "zai",
  "qwen-portal": "qwen",
  alibaba: "qwen",
  "alibaba-coding-plan": "qwen",
  deepseek: "deepseek",
  openrouter: "openrouter",
  together: "together",
};

export function openAICompatReasoningParams(
  providerId: string,
  effort: ReasoningEffort
): Record<string, unknown> {
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
