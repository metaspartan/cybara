export type ReasoningEffort = "minimal" | "low" | "medium" | "high" | "xhigh" | "max";

export interface ReasoningOption {
  value: ReasoningEffort | "";
  label: string;
}

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

const LEVEL_LABELS: Record<ReasoningEffort, string> = {
  minimal: "Minimal",
  low: "Low",
  medium: "Medium",
  high: "High",
  xhigh: "Extra High",
  max: "Max",
};

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

function normalizeModelId(id: string | null | undefined): string {
  return (id ?? "")
    .trim()
    .toLowerCase()
    .replace(/^(?:openai\/|anthropic\/|google\/)?/, "")
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

const ANTHROPIC_LEGACY_EFFORTS: ReasoningEffort[] = ["minimal", "low", "medium", "high"];
const ANTHROPIC_46_EFFORTS: ReasoningEffort[] = ["low", "medium", "high", "max"];
const ANTHROPIC_MODERN_EFFORTS: ReasoningEffort[] = ["low", "medium", "high", "xhigh", "max"];
const GOOGLE_3_PRO_EFFORTS: ReasoningEffort[] = ["low", "high"];
const GOOGLE_EFFORTS: ReasoningEffort[] = ["low", "medium", "high"];

function resolveAnthropicModelEfforts(modelId: string): ReasoningEffort[] {
  if (!modelId.includes("claude")) return [...ANTHROPIC_LEGACY_EFFORTS];
  if (/claude-(?:opus|sonnet)-4[-.]6(?:-|$)/.test(modelId)) return [...ANTHROPIC_46_EFFORTS];
  if (/claude-(?:3|opus-4[-.][0-5]|sonnet-4[-.][0-5]|haiku-4[-.]5)(?:-|$)/.test(modelId)) {
    return [...ANTHROPIC_LEGACY_EFFORTS];
  }
  return [...ANTHROPIC_MODERN_EFFORTS];
}

function supportedEfforts(provider?: string | null, model?: string | null): ReasoningEffort[] {
  const providerId = (provider || "").trim().toLowerCase();
  if (BINARY_THINKING_PROVIDERS.has(providerId)) {
    return ["medium"];
  }
  const modelId = normalizeModelId(model);
  if (providerId === "anthropic" || providerId === "anthropic_vertex") {
    return resolveAnthropicModelEfforts(modelId);
  }
  if (providerId === "google" || providerId === "google_vertex") {
    if (/^gemini-3(?:\.1)?-.*pro/.test(modelId)) return [...GOOGLE_3_PRO_EFFORTS];
    return [...GOOGLE_EFFORTS];
  }
  if (
    providerId === "openai" ||
    providerId === "openai-codex" ||
    providerId === "openai-codex-responses" ||
    providerId === "azure-openai" ||
    !modelId
  ) {
    return resolveOpenAIModelEfforts(modelId);
  }
  return [...GENERIC_OPENAI_EFFORTS];
}

export function supportsXHighReasoning(provider?: string | null, model?: string | null): boolean {
  return supportedEfforts(provider, model).includes("xhigh");
}

function isBinaryThinkingProvider(provider?: string | null): boolean {
  return BINARY_THINKING_PROVIDERS.has((provider || "").trim().toLowerCase());
}

function isAdaptiveThinkingProvider(provider?: string | null, model?: string | null): boolean {
  const providerId = (provider || "").trim().toLowerCase();
  return (
    ADAPTIVE_THINKING_PROVIDERS.has(providerId) && /(?:^|\/)minimax-m3(?:[.-]|$)/i.test(model ?? "")
  );
}

export function supportedReasoningOptions(
  provider?: string | null,
  model?: string | null
): ReasoningOption[] {
  if (isAdaptiveThinkingProvider(provider, model)) {
    return [{ value: "", label: "Adaptive" }];
  }
  if (isBinaryThinkingProvider(provider)) {
    return [
      { value: "", label: "Default" },
      { value: "medium", label: "Thinking" },
    ];
  }
  return [
    { value: "", label: "Default" },
    ...supportedEfforts(provider, model).map((level) => ({
      value: level,
      label: LEVEL_LABELS[level],
    })),
  ];
}

export function reasoningEffortLabel(
  effort: string | null | undefined,
  provider?: string | null,
  model?: string | null
): string {
  const options = supportedReasoningOptions(provider, model);
  if (!effort) return options[0]?.label ?? "Default";
  return options.find((option) => option.value === effort)?.label ?? "Default";
}

export function parseAgentConfig(config: unknown): Record<string, unknown> {
  if (config && typeof config === "object" && !Array.isArray(config)) {
    return config as Record<string, unknown>;
  }
  if (typeof config !== "string" || !config.trim()) return {};
  try {
    const parsed: unknown = JSON.parse(config);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

export function readAgentReasoningEffort(config: unknown): ReasoningEffort | null {
  const parsed = parseAgentConfig(config);
  const rawParams = parsed.model_params ?? parsed.modelParams;
  if (!rawParams || typeof rawParams !== "object" || Array.isArray(rawParams)) return null;
  const params = rawParams as Record<string, unknown>;
  const effort = params.reasoning_effort ?? params.reasoningEffort;
  if (typeof effort !== "string") return null;
  const normalized = effort.trim().toLowerCase();
  return ["minimal", "low", "medium", "high", "xhigh", "max"].includes(normalized)
    ? (normalized as ReasoningEffort)
    : null;
}
