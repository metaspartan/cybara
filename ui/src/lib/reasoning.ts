import {
  supportedReasoningEfforts,
  supportsXHighReasoning,
  usesBinaryReasoning,
  usesProviderAdaptiveReasoning,
  type ReasoningEffort,
} from "../../../shared/reasoning-capabilities";

export { supportsXHighReasoning, type ReasoningEffort };

export interface ReasoningOption {
  value: ReasoningEffort | "";
  label: string;
}

const LEVEL_LABELS: Record<ReasoningEffort, string> = {
  minimal: "Minimal",
  low: "Low",
  medium: "Medium",
  high: "High",
  xhigh: "Extra High",
  max: "Max",
};

export function supportedReasoningOptions(
  provider?: string | null,
  model?: string | null
): ReasoningOption[] {
  if (usesProviderAdaptiveReasoning(provider, model)) {
    return [{ value: "", label: "Adaptive" }];
  }
  if (usesBinaryReasoning(provider)) {
    return [
      { value: "", label: "Default" },
      { value: "medium", label: "Thinking" },
    ];
  }
  return [
    { value: "", label: "Default" },
    ...supportedReasoningEfforts(provider, model).map((level) => ({
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
