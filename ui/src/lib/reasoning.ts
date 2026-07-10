export type ReasoningEffort = "minimal" | "low" | "medium" | "high" | "xhigh";

export interface ReasoningOption {
  value: ReasoningEffort | "";
  label: string;
}

const BINARY_THINKING_PROVIDERS = new Set(["z.ai", "z.ai-coding", "zai", "z-ai", "qwen-portal"]);

const LEVEL_LABELS: Record<ReasoningEffort, string> = {
  minimal: "Minimal",
  low: "Low",
  medium: "Medium",
  high: "High",
  xhigh: "Max",
};

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

function supportedEfforts(provider?: string | null, model?: string | null): ReasoningEffort[] {
  const providerId = (provider || "").trim().toLowerCase();
  if (BINARY_THINKING_PROVIDERS.has(providerId)) {
    return ["medium"];
  }
  const modelId = normalizeModelId(model);
  if (providerId === "anthropic" || providerId === "anthropic_vertex") {
    return [...ANTHROPIC_EFFORTS];
  }
  if (providerId === "google" || providerId === "google_vertex") {
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

export function supportedReasoningOptions(
  provider?: string | null,
  model?: string | null
): ReasoningOption[] {
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
  if (!effort) return "Default";
  const options = supportedReasoningOptions(provider, model);
  return options.find((option) => option.value === effort)?.label ?? "Default";
}
