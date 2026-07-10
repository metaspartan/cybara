export type ReasoningEffort = "minimal" | "low" | "medium" | "high" | "xhigh";

const VALID = new Set<ReasoningEffort>(["minimal", "low", "medium", "high", "xhigh"]);

export function normalizeReasoningEffort(value: unknown): ReasoningEffort | null {
  if (typeof value !== "string") return null;
  const v = value.trim().toLowerCase();
  if (VALID.has(v as ReasoningEffort)) return v as ReasoningEffort;
  const collapsed = v.replace(/[\s_-]+/g, "");
  if (collapsed === "max" || collapsed === "extrahigh" || collapsed === "xhigh") return "xhigh";
  if (collapsed === "ultra" || collapsed === "ultrathink") return "xhigh";
  if (collapsed === "min") return "minimal";
  if (v === "none" || v === "off" || v === "false") return null;
  return null;
}

const BINARY_THINKING_PROVIDERS = new Set(["z.ai", "z.ai-coding", "zai", "z-ai", "qwen-portal"]);

export function supportsXHighReasoning(providerId?: string | null, model?: string | null): boolean {
  const provider = (providerId || "").trim().toLowerCase();
  const modelId = (model || "").trim().toLowerCase();
  if (!modelId) return false;
  if (modelId.includes("codex")) return true;
  if (provider === "anthropic" || provider === "anthropic_vertex") return true;
  const gpt = modelId.match(/^(?:openai\/)?gpt-5\.(\d+)/);
  if (gpt) return Number(gpt[1]) >= 2;
  return false;
}

export function supportedReasoningEfforts(
  providerId?: string | null,
  model?: string | null
): ReasoningEffort[] {
  const provider = (providerId || "").trim().toLowerCase();
  if (BINARY_THINKING_PROVIDERS.has(provider)) {
    return ["medium"];
  }
  const base: ReasoningEffort[] = ["minimal", "low", "medium", "high"];
  if (supportsXHighReasoning(provider, model)) {
    base.push("xhigh");
  }
  return base;
}

export function coerceReasoningEffort(
  effort: ReasoningEffort,
  providerId?: string | null,
  model?: string | null
): ReasoningEffort {
  const supported = supportedReasoningEfforts(providerId, model);
  if (supported.includes(effort)) return effort;
  if (effort === "xhigh" && supported.includes("high")) return "high";
  if (effort === "minimal" && supported.includes("low")) return "low";
  if (supported.includes("medium")) return "medium";
  return supported[0];
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
