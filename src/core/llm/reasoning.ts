export type ReasoningEffort = "minimal" | "low" | "medium" | "high" | "xhigh";

const VALID = new Set<ReasoningEffort>(["minimal", "low", "medium", "high", "xhigh"]);

export function normalizeReasoningEffort(value: unknown): ReasoningEffort | null {
  if (typeof value !== "string") return null;
  const v = value.trim().toLowerCase();
  if (VALID.has(v as ReasoningEffort)) return v as ReasoningEffort;
  const collapsed = v.replace(/[\s_-]+/g, "");
  if (
    collapsed === "xhigh" ||
    collapsed === "extrahigh" ||
    collapsed === "max" ||
    collapsed === "ultra" ||
    collapsed === "ultrathink" ||
    collapsed === "ultracode"
  ) {
    return "xhigh";
  }
  if (collapsed === "min") return "minimal";
  if (v === "none" || v === "off" || v === "false") return null;
  return null;
}

const BINARY_THINKING_PROVIDERS = new Set(["z.ai", "z.ai-coding", "zai", "z-ai", "qwen-portal"]);

const GPT_5_EFFORTS: ReasoningEffort[] = ["minimal", "low", "medium", "high"];
const GPT_51_EFFORTS: ReasoningEffort[] = ["low", "medium", "high"];
const GPT_52_EFFORTS: ReasoningEffort[] = ["low", "medium", "high", "xhigh"];
const GPT_CODEX_EFFORTS: ReasoningEffort[] = ["low", "medium", "high", "xhigh"];
const GPT_CODEX_MINI_EFFORTS: ReasoningEffort[] = ["medium"];
const GPT_CODEX_MAX_EFFORTS: ReasoningEffort[] = ["medium", "high", "xhigh"];
const GPT_PRO_EFFORTS: ReasoningEffort[] = ["medium", "high", "xhigh"];
const GPT_5_PRO_EFFORTS: ReasoningEffort[] = ["high"];
const GENERIC_OPENAI_EFFORTS: ReasoningEffort[] = ["low", "medium", "high"];

function normalizeModelId(id: string | null | undefined): string {
  return (id ?? "")
    .trim()
    .toLowerCase()
    .replace(/^(?:openai\/|anthropic\/|google\/)?/, "")
    .replace(/-\d{4}-\d{2}-\d{2}$/, "");
}

function resolveOpenAIModelEfforts(modelId: string): ReasoningEffort[] {
  if (modelId === "gpt-5.1-codex-mini") return GPT_CODEX_MINI_EFFORTS;
  if (modelId === "gpt-5.1-codex-max") return GPT_CODEX_MAX_EFFORTS;
  if (/^gpt-5(?:\.\d+)?-codex(?:-|$)/.test(modelId)) return GPT_CODEX_EFFORTS;
  if (modelId === "gpt-5-pro") return GPT_5_PRO_EFFORTS;
  if (/^gpt-5\.[2-9](?:\.\d+)?-pro(?:-|$)/.test(modelId)) return GPT_PRO_EFFORTS;
  if (/^gpt-5\.[2-9](?:\.\d+)?(?:-|$)/.test(modelId)) return GPT_52_EFFORTS;
  if (/^gpt-5\.1(?:-|$)/.test(modelId)) return GPT_51_EFFORTS;
  if (/^gpt-5(?:-|$)/.test(modelId)) return GPT_5_EFFORTS;
  return GENERIC_OPENAI_EFFORTS;
}

const ANTHROPIC_EFFORTS: ReasoningEffort[] = ["minimal", "low", "medium", "high", "xhigh"];
const GOOGLE_EFFORTS: ReasoningEffort[] = ["minimal", "low", "medium", "high"];

const EFFORT_RANK: Record<ReasoningEffort, number> = {
  minimal: 0,
  low: 1,
  medium: 2,
  high: 3,
  xhigh: 4,
};

export function supportedReasoningEfforts(
  providerId?: string | null,
  model?: string | null
): ReasoningEffort[] {
  const provider = (providerId || "").trim().toLowerCase();
  if (BINARY_THINKING_PROVIDERS.has(provider)) {
    return ["medium"];
  }
  const modelId = normalizeModelId(model);
  if (provider === "anthropic" || provider === "anthropic_vertex") {
    return [...ANTHROPIC_EFFORTS];
  }
  if (provider === "google" || provider === "google_vertex") {
    return [...GOOGLE_EFFORTS];
  }
  if (
    provider === "openai" ||
    provider === "openai-codex" ||
    provider === "openai-codex-responses" ||
    provider === "azure-openai" ||
    !modelId
  ) {
    return resolveOpenAIModelEfforts(modelId);
  }
  return [...GENERIC_OPENAI_EFFORTS];
}

export function supportsXHighReasoning(providerId?: string | null, model?: string | null): boolean {
  return supportedReasoningEfforts(providerId, model).includes("xhigh");
}

export function coerceReasoningEffort(
  effort: ReasoningEffort,
  providerId?: string | null,
  model?: string | null
): ReasoningEffort {
  const supported = supportedReasoningEfforts(providerId, model);
  if (supported.includes(effort)) return effort;
  const requestedRank = EFFORT_RANK[effort];
  let downgraded: ReasoningEffort | null = null;
  let downgradedRank = -1;
  let upgraded: ReasoningEffort | null = null;
  let upgradedRank = Number.MAX_SAFE_INTEGER;
  for (const candidate of supported) {
    const candidateRank = EFFORT_RANK[candidate];
    if (candidateRank <= requestedRank && candidateRank > downgradedRank) {
      downgraded = candidate;
      downgradedRank = candidateRank;
    }
    if (candidateRank >= requestedRank && candidateRank < upgradedRank) {
      upgraded = candidate;
      upgradedRank = candidateRank;
    }
  }
  if (downgraded) return downgraded;
  return upgraded ?? supported[0];
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
