export type ReasoningEffort = "minimal" | "low" | "medium" | "high" | "xhigh" | "max";

export type ReasoningMode = "adaptive" | "binary" | "effort";

const VALID_REASONING_EFFORTS = new Set<ReasoningEffort>([
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
]);

const BINARY_THINKING_PROVIDERS = new Set([
  "z.ai",
  "z.ai-coding",
  "zai",
  "z-ai",
  "qwen-portal",
  "alibaba",
  "alibaba-coding-plan",
  "qwen-token-plan",
  "qwen-token-plan-cn",
]);

const ADAPTIVE_THINKING_PROVIDERS = new Set([
  "minimax",
  "minimax-cn",
  "minimax-portal",
  "minimax-portal-cn",
]);

const KIMI_CODE_PROVIDERS = new Set([
  "kimi-code",
  "kimi-code-oauth",
  "kimi-coding",
  "kimi-oauth",
  "kimi-code-subscription",
]);

const ANTHROPIC_PROVIDERS = new Set([
  "anthropic",
  "anthropic-oauth",
  "anthropic_vertex",
  "claude-oauth",
]);

const GOOGLE_PROVIDERS = new Set([
  "antigravity",
  "gemini-cli",
  "google",
  "google-antigravity",
  "google-gemini-cli",
  "google_vertex",
]);

const GPT_5_EFFORTS: ReasoningEffort[] = ["minimal", "low", "medium", "high"];
const GPT_51_EFFORTS: ReasoningEffort[] = ["low", "medium", "high"];
const GPT_52_EFFORTS: ReasoningEffort[] = ["low", "medium", "high", "xhigh"];
const GPT_56_EFFORTS: ReasoningEffort[] = ["low", "medium", "high", "xhigh", "max"];
const GPT_CODEX_EFFORTS: ReasoningEffort[] = ["low", "medium", "high", "xhigh"];
const GPT_CODEX_MINI_EFFORTS: ReasoningEffort[] = ["medium"];
const GPT_CODEX_MAX_EFFORTS: ReasoningEffort[] = ["medium", "high", "xhigh"];
const GPT_PRO_EFFORTS: ReasoningEffort[] = ["medium", "high", "xhigh"];
const GPT_5_PRO_EFFORTS: ReasoningEffort[] = ["high"];
const GENERIC_OPENAI_EFFORTS: ReasoningEffort[] = ["low", "medium", "high"];
const ANTHROPIC_LEGACY_EFFORTS: ReasoningEffort[] = ["minimal", "low", "medium", "high"];
const ANTHROPIC_46_EFFORTS: ReasoningEffort[] = ["low", "medium", "high", "max"];
const ANTHROPIC_MODERN_EFFORTS: ReasoningEffort[] = ["low", "medium", "high", "xhigh", "max"];
const GOOGLE_25_EFFORTS: ReasoningEffort[] = ["low", "medium", "high"];
const GOOGLE_3_FLASH_EFFORTS: ReasoningEffort[] = ["minimal", "low", "medium", "high"];
const GOOGLE_3_PRO_EFFORTS: ReasoningEffort[] = ["low", "high"];
const KIMI_K3_EFFORTS: ReasoningEffort[] = ["low", "high", "max"];

const EFFORT_RANK: Record<ReasoningEffort, number> = {
  minimal: 0,
  low: 1,
  medium: 2,
  high: 3,
  xhigh: 4,
  max: 5,
};

export function normalizeReasoningEffort(value: unknown): ReasoningEffort | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  if (VALID_REASONING_EFFORTS.has(normalized as ReasoningEffort)) {
    return normalized as ReasoningEffort;
  }
  const collapsed = normalized.replace(/[\s_-]+/g, "");
  if (collapsed === "xhigh" || collapsed === "extrahigh") return "xhigh";
  if (["max", "ultra", "ultrathink", "ultracode"].includes(collapsed)) return "max";
  if (collapsed === "min") return "minimal";
  return null;
}

export function normalizeReasoningModelId(id: string | null | undefined): string {
  return (id ?? "")
    .trim()
    .toLowerCase()
    .replace(/^(?:openai\/|anthropic\/|google\/)/, "")
    .replace(/-\d{4}-\d{2}-\d{2}$/, "");
}

function resolveOpenAIModelEfforts(modelId: string): ReasoningEffort[] {
  if (/^gpt-5\.6(?:-|$)/.test(modelId)) return GPT_56_EFFORTS;
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

function resolveAnthropicModelEfforts(modelId: string): ReasoningEffort[] {
  if (!modelId.includes("claude")) return [...ANTHROPIC_LEGACY_EFFORTS];
  if (/claude-(?:opus|sonnet)-4[-.]6(?:-|$)/.test(modelId)) return [...ANTHROPIC_46_EFFORTS];
  if (/claude-(?:3|opus-4[-.][0-5]|sonnet-4[-.][0-5]|haiku-4[-.]5)(?:-|$)/.test(modelId)) {
    return [...ANTHROPIC_LEGACY_EFFORTS];
  }
  return [...ANTHROPIC_MODERN_EFFORTS];
}

function resolveGoogleModelEfforts(modelId: string): ReasoningEffort[] {
  if (/^gemini-3(?:\.\d+)?-.*pro/.test(modelId)) return [...GOOGLE_3_PRO_EFFORTS];
  if (/^gemini-3(?:\.\d+)?-.*flash/.test(modelId)) return [...GOOGLE_3_FLASH_EFFORTS];
  return [...GOOGLE_25_EFFORTS];
}

function isKimiK3(provider: string, model: string | null | undefined): boolean {
  return KIMI_CODE_PROVIDERS.has(provider) && /(?:^|\/)k3$/.test(normalizeReasoningModelId(model));
}

export function usesBinaryReasoning(providerId?: string | null): boolean {
  return BINARY_THINKING_PROVIDERS.has((providerId ?? "").trim().toLowerCase());
}

export function usesProviderAdaptiveReasoning(
  providerId?: string | null,
  model?: string | null
): boolean {
  const provider = (providerId ?? "").trim().toLowerCase();
  return (
    ADAPTIVE_THINKING_PROVIDERS.has(provider) && /(?:^|\/)minimax-m3(?:[.-]|$)/i.test(model ?? "")
  );
}

export function reasoningMode(providerId?: string | null, model?: string | null): ReasoningMode {
  if (usesProviderAdaptiveReasoning(providerId, model)) return "adaptive";
  return usesBinaryReasoning(providerId) ? "binary" : "effort";
}

export function supportedReasoningEfforts(
  providerId?: string | null,
  model?: string | null
): ReasoningEffort[] {
  const provider = (providerId ?? "").trim().toLowerCase();
  if (usesBinaryReasoning(provider)) return ["medium"];
  if (usesProviderAdaptiveReasoning(provider, model)) return [];
  const modelId = normalizeReasoningModelId(model);
  if (isKimiK3(provider, modelId)) {
    return [...KIMI_K3_EFFORTS];
  }
  if (ANTHROPIC_PROVIDERS.has(provider)) {
    return resolveAnthropicModelEfforts(modelId);
  }
  if (GOOGLE_PROVIDERS.has(provider)) {
    return resolveGoogleModelEfforts(modelId);
  }
  if (
    provider === "openai" ||
    provider === "openai-codex" ||
    provider === "openai-codex-responses" ||
    provider === "azure-openai" ||
    !modelId
  ) {
    return [...resolveOpenAIModelEfforts(modelId)];
  }
  return [...GENERIC_OPENAI_EFFORTS];
}

export function supportsXHighReasoning(providerId?: string | null, model?: string | null): boolean {
  return supportedReasoningEfforts(providerId, model).includes("xhigh");
}

export function usesAnthropicAdaptiveThinking(model?: string | null): boolean {
  const modelId = normalizeReasoningModelId(model);
  if (!modelId.includes("claude")) return false;
  return !/claude-(?:3|opus-4[-.][0-5]|sonnet-4[-.][0-5]|haiku-4[-.]5)(?:-|$)/.test(modelId);
}

export function coerceReasoningEffort(
  effort: ReasoningEffort,
  providerId?: string | null,
  model?: string | null
): ReasoningEffort {
  const provider = (providerId ?? "").trim().toLowerCase();
  if (isKimiK3(provider, model)) {
    if (effort === "minimal" || effort === "low") return "low";
    if (effort === "medium" || effort === "high") return "high";
    return "max";
  }
  const supported = supportedReasoningEfforts(providerId, model);
  if (supported.length === 0 || supported.includes(effort)) return effort;
  const requestedRank = EFFORT_RANK[effort];
  const lower = supported
    .filter((candidate) => EFFORT_RANK[candidate] <= requestedRank)
    .sort((left, right) => EFFORT_RANK[right] - EFFORT_RANK[left])[0];
  if (lower) return lower;
  return [...supported].sort((left, right) => EFFORT_RANK[left] - EFFORT_RANK[right])[0];
}
